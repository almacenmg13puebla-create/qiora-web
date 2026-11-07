
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()

const out = (v, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_NO_CONFIGURADO')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

// =============================================
// VALIDAR CREDENCIAL DE EXCEL
// =============================================

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc(
    'qiora_excel_validar_credencial',
    {
      p_distrito: distrito,
      p_token: token
    }
  )

  if (error || data !== true) {
    throw new Error('TOKEN_INVALIDO')
  }
}

// =============================================
// DESCIFRAR TOKEN TELEGRAM DEL DISTRITO
// AES-256-GCM
// =============================================

function descifrarTokenTelegram(valor) {
  const hex =
    process.env.QIORA_TELEGRAM_ENCRYPTION_KEY || ''

  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('CLAVE_TELEGRAM_NO_CONFIGURADA')
  }

  const partes = S(valor).split('.')

  if (partes.length !== 3) {
    throw new Error('FORMATO_TOKEN_CIFRADO_INVALIDO')
  }

  const [ivB64, tagB64, encryptedB64] = partes

  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')

  if (
    iv.length !== 12 ||
    tag.length !== 16 ||
    encrypted.length === 0
  ) {
    throw new Error('DATOS_CIFRADOS_INVALIDOS')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(hex, 'hex'),
    iv
  )

  decipher.setAuthTag(tag)

  const token = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString('utf8')

  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('TOKEN_TELEGRAM_DESCIFRADO_INVALIDO')
  }

  return token
}

// =============================================
// DIVIDIR MENSAJES PARA TELEGRAM
// =============================================

function dividirMensaje(texto, limite = 3900) {
  const resultado = []
  let actual = ''

  for (const linea of String(texto).split('\n')) {
    if (Array.from(linea).length > limite) {
      if (actual) {
        resultado.push(actual)
        actual = ''
      }

      const caracteres = Array.from(linea)

      for (let i = 0; i < caracteres.length; i += limite) {
        resultado.push(
          caracteres.slice(i, i + limite).join('')
        )
      }

      continue
    }

    const siguiente = actual
      ? actual + '\n' + linea
      : linea

    if (Array.from(siguiente).length > limite) {
      resultado.push(actual)
      actual = linea
    } else {
      actual = siguiente
    }
  }

  if (actual) resultado.push(actual)

  return resultado
}

// =============================================
// ENVIAR DIRECTAMENTE AL GRUPO DEL DISTRITO
// =============================================

async function enviarTelegramDistrito(token, chat, mensaje) {
  if (!token || !chat) {
    throw new Error('TOKEN_O_CHAT_TELEGRAM_VACIO')
  }

  if (!/^-?[1-9]\d{0,19}$/.test(String(chat))) {
    throw new Error('CHAT_TRASPASOS_INVALIDO')
  }

  const partes = dividirMensaje(mensaje)

  let enviados = 0

  for (const parte of partes) {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chat,
          text: parte,
          disable_web_page_preview: true
        }),
        cache: 'no-store'
      }
    )

    let resultado

    try {
      resultado = await response.json()
    } catch {
      throw new Error('RESPUESTA_TELEGRAM_INVALIDA')
    }

    if (!response.ok || resultado.ok !== true) {
      throw new Error(
        `TELEGRAM_ERROR_PARTE_${enviados + 1}: ` +
        S(resultado.description || response.status)
      )
    }

    enviados++
  }

  return {
    enviado: true,
    partes: enviados
  }
}

// =============================================
// NORMALIZAR FILAS SAP
// =============================================

function normalizarFila(x, distrito) {
  const documento = S(
    x.documentoTraspaso || x.documento_traspaso
  )

  if (!/^\d{8,12}$/.test(documento)) {
    throw new Error(
      'DOCUMENTO_SAP_INVALIDO: ' + documento
    )
  }

  return {
    distrito,

    centro: U(x.centro || distrito),

    almacen: S(x.almacen),

    documento_traspaso: documento,

    fecha: S(x.fecha),

    movimiento: S(x.movimiento),

    centro_receptor: U(
      x.centroReceptor ||
      x.centro_receptor ||
      distrito
    ),

    almacen_receptor: S(
      x.almacenReceptor ||
      x.almacen_receptor
    ),

    documento_receptor: S(
      x.documentoReceptor ||
      x.documento_receptor
    ) || null,

    fecha_receptor: S(
      x.fechaReceptor ||
      x.fecha_receptor
    ) || null,

    movimiento_receptor: S(
      x.movimientoReceptor ||
      x.movimiento_receptor
    ) || null,

    status_sap: S(
      x.status ||
      x.status_sap
    ),

    dias: Number(
      String(x.dias || 0).replace(',', '.')
    ) || 0,

    raw_sap: x,

    actualizado_en: new Date().toISOString()
  }
}

// =============================================
// IDENTIFICAR PENDIENTES
// =============================================

function pendientes(rows) {
  return rows.filter(x =>
    !x.documento_receptor &&
    ![
      'CERRADO',
      'REALIZADO',
      'RECIBIDO',
      'ENTRADA',
      'ENTRADA REALIZADA',
      'FINALIZADO'
    ].includes(U(x.status_sap))
  )
}

// =============================================
// CONSTRUIR REPORTE
// =============================================

function textoReporte(distrito, rows) {
  const ps = pendientes(rows)

  const lines = [
    '📥 TRASPASOS PENDIENTES POR ENTRADA',
    '',
    `🏢 Distrito: ${distrito}`,
    `📊 Total: ${ps.length}`,
    '',
    ...ps.map((x, i) => [
      `${i + 1}) 📄 Documento: ${x.documento_traspaso}`,
      `📅 Fecha: ${x.fecha || 'NO REGISTRADA'}`,
      `🔄 Movimiento: ${x.movimiento || 'NO REGISTRADO'}`,
      '',
      '⬅️ ORIGEN',
      `🏢 Almacén: ${x.almacen || 'NO REGISTRADO'}`,
      '',
      '➡️ DESTINO',
      `🏢 Almacén: ${x.almacen_receptor || 'NO REGISTRADO'}`,
      '',
      '🟡 PENDIENTE DE ENTRADA'
    ].join('\n'))
  ]

  return {
    total: ps.length,
    mensaje: lines.join('\n\n'),
    pendientes: ps
  }
}

// =============================================
// POST PRINCIPAL
// =============================================

export async function POST(req) {
  try {
    const d = await req.json()

    const distrito = U(d.distrito || d.centro)
    const tokenExcel = S(d.token)

    if (
      !/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) ||
      !tokenExcel
    ) {
      return out({
        ok: false,
        error: 'DISTRITO_O_TOKEN_INVALIDO'
      }, 400)
    }

    const db = dbAdmin()

    // 1. VALIDAR EXCEL
    await validarExcel(
      db,
      distrito,
      tokenExcel
    )

    if (U(d.action) !== 'SUBIR_TRASLADOS_SAP') {
      return out({
        ok: false,
        error: 'ACCION_INVALIDA'
      }, 400)
    }

    // 2. VALIDAR FILAS
    if (
      !Array.isArray(d.filas) ||
      d.filas.length === 0 ||
      d.filas.length > 10000
    ) {
      return out({
        ok: false,
        error: 'EXCEL_SIN_REGISTROS_O_FILAS_INVALIDAS',
        mensaje: 'No se borraron los registros anteriores.'
      }, 400)
    }

    // 3. NORMALIZAR
    const rows = d.filas.map(x =>
      normalizarFila(x, distrito)
    )

    // 4. EVITAR DOCUMENTOS DUPLICADOS
    const documentos = rows.map(
      x => x.documento_traspaso
    )

    if (
      new Set(documentos).size !== documentos.length
    ) {
      return out({
        ok: false,
        error: 'DOCUMENTOS_DUPLICADOS',
        mensaje: 'No se modificaron los registros anteriores.'
      }, 400)
    }

    // 5. REEMPLAZAR INFORMACION DEL DISTRITO
    const {
      data: recibidos,
      error: replaceError
    } = await db.rpc(
      'qiora_reemplazar_traslados_sap',
      {
        p_distrito: distrito,
        p_filas: rows
      }
    )

    if (replaceError) {
      console.error(
        '[REEMPLAZO TRASLADOS]',
        replaceError
      )

      throw replaceError
    }

    // 6. LEER INFORMACION ACTUALIZADA
    const {
      data: all,
      error: readError
    } = await db
      .from('qiora_traslados_sap')
      .select('*')
      .eq('distrito', distrito)
      .order('fecha', { ascending: true })

    if (readError) throw readError

    // 7. GENERAR REPORTE
    const reporte = textoReporte(
      distrito,
      all || []
    )

    let telegramEnviado = false
    let partesTelegram = 0
    let avisoGuardado = false

    // 8. SOLO ENVIAR SI EXISTEN PENDIENTES
    if (reporte.total > 0) {

      // OBTENER CONFIGURACION DEL DISTRITO
      const {
        data: config,
        error: configError
      } = await db
        .from('qiora_distritos_telegram')
        .select(
          'centro,token_cifrado,chat_traspasos'
        )
        .eq('centro', distrito)
        .maybeSingle()

      if (configError) throw configError

      if (
        !config ||
        !config.token_cifrado ||
        !config.chat_traspasos
      ) {
        throw new Error(
          'TELEGRAM_DISTRITO_NO_CONFIGURADO: ' +
          distrito
        )
      }

      // DESCIFRAR TOKEN PROPIO DEL DISTRITO
      const tokenTelegram = descifrarTokenTelegram(
        config.token_cifrado
      )

      // ENVIAR DIRECTAMENTE AL GRUPO
      const resultadoTelegram =
        await enviarTelegramDistrito(
          tokenTelegram,
          config.chat_traspasos,
          reporte.mensaje
        )

      telegramEnviado = resultadoTelegram.enviado
      partesTelegram = resultadoTelegram.partes

      // 9. GUARDAR HISTORIAL COMO ENVIADO
      // No se inserta en la cola del BOT.
      const {
        error: avisoError
      } = await db
        .from('qiora_avisos_traslados')
        .insert({
          distrito,
          tipo: 'REPORTE_PENDIENTES',
          total_pendientes: reporte.total,
          mensaje: reporte.mensaje,
          estado: 'ENVIADO',
          origen_comando: S(d.comandoId) || null,
          creado_en: new Date().toISOString()
        })

      if (avisoError) {
        console.error(
          '[HISTORIAL AVISO TELEGRAM]',
          avisoError
        )
      } else {
        avisoGuardado = true
      }
    }

    // 10. RESPUESTA
    return out({
      ok: true,

      distrito,

      recibidos: Number(recibidos) || rows.length,

      total_pendientes: reporte.total,

      telegram_enviado: telegramEnviado,

      partes_telegram: partesTelegram,

      aviso_guardado: avisoGuardado,

      mensaje: telegramEnviado
        ? 'Traslados actualizados y reporte enviado al grupo Telegram del distrito.'
        : 'Traslados actualizados. No existen pendientes por reportar.'
    })

  } catch (e) {
    console.error(
      '[EXCEL TRASLADOS TELEGRAM]',
      e
    )

    const msg = S(e.message || e)

    const status =
      msg === 'TOKEN_INVALIDO' ? 403 :
      msg.startsWith('TELEGRAM_ERROR') ? 502 :
      msg.includes('NO_CONFIGURADO') ? 503 :
      500

    return out({
      ok: false,
      error: msg
    }, status)
  }
}
