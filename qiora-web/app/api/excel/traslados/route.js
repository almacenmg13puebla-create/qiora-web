import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()
const out = (v, status = 200) => NextResponse.json(v, { status, headers: { 'Cache-Control': 'no-store' } })

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc('qiora_excel_validar_credencial', { p_distrito: distrito, p_token: token })
  if (error || data !== true) throw new Error('TOKEN_INVALIDO')
}

function descifrarToken(valor) {
  const hex = S(process.env.QIORA_TELEGRAM_ENCRYPTION_KEY)
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('QIORA_TELEGRAM_ENCRYPTION_KEY_NO_CONFIGURADA')
  const partes = S(valor).split('.')
  if (partes.length !== 3) throw new Error('TOKEN_TRASPASOS_CIFRADO_INVALIDO')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), Buffer.from(partes[0], 'base64'))
  decipher.setAuthTag(Buffer.from(partes[1], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(partes[2], 'base64')), decipher.final()]).toString('utf8')
}

function normalizarFila(x, distrito) {
  const documento = S(x.documentoTraspaso || x.documento_traspaso)
  if (!/^\d{8,12}$/.test(documento)) throw new Error('DOCUMENTO_SAP_INVALIDO: ' + documento)
  return {
    distrito,
    centro: U(x.centro || distrito),
    almacen: S(x.almacen),
    documento_traspaso: documento,
    fecha: S(x.fecha),
    movimiento: S(x.movimiento),
    centro_receptor: U(x.centroReceptor || x.centro_receptor || distrito),
    almacen_receptor: S(x.almacenReceptor || x.almacen_receptor),
    documento_receptor: S(x.documentoReceptor || x.documento_receptor) || null,
    fecha_receptor: S(x.fechaReceptor || x.fecha_receptor) || null,
    movimiento_receptor: S(x.movimientoReceptor || x.movimiento_receptor) || null,
    status_sap: S(x.status || x.status_sap),
    dias: Number(String(x.dias || 0).replace(',', '.')) || 0,
    raw_sap: x,
    actualizado_en: new Date().toISOString()
  }
}

function esPendiente(x) {
  return !S(x.documento_receptor) && !['CERRADO','REALIZADO','RECIBIDO','ENTRADA','ENTRADA REALIZADA','FINALIZADO'].includes(U(x.status_sap))
}

function mensajeReporte(distrito, rows) {
  const ps = rows.filter(esPendiente)
  const lines = ['📥 TRASPASOS PENDIENTES POR DAR ENTRADA', '', `🏢 Distrito: ${distrito}`, `📊 Total de pendientes: ${ps.length}`, '']
  if (!ps.length) lines.push('✅ No hay traspasos pendientes de dar entrada.')
  ps.forEach((x, i) => lines.push([
    `${i + 1}) 📄 Documento: ${S(x.documento_traspaso)}`,
    `📅 Fecha: ${S(x.fecha) || 'NO REGISTRADA'}`,
    `🔄 Movimiento: ${S(x.movimiento) || 'NO REGISTRADO'}`,
    `⬅️ Origen: ${S(x.almacen) || 'NO REGISTRADO'}`,
    `➡️ Destino: ${S(x.almacen_receptor) || 'NO REGISTRADO'}`,
    `⏳ Días: ${x.dias ?? 0}`,
    '🟡 PENDIENTE DE ENTRADA'
  ].join('\n')))
  return { pendientes: ps, mensaje: lines.join('\n\n') }
}

async function enviarTelegram(token, chatId, texto) {
  const bloques = []
  let actual = ''
  for (const linea of String(texto).split('\n')) {
    if ((actual + '\n' + linea).length > 3900 && actual) { bloques.push(actual); actual = '' }
    actual += (actual ? '\n' : '') + linea
  }
  if (actual) bloques.push(actual)
  for (const bloque of bloques) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: bloque, disable_web_page_preview: true }),
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok !== true) throw new Error(`TELEGRAM_${chatId}: ${j.description || r.status}`)
  }
}

async function notificarDistrito(db, distrito, rows) {
  const { data: cfg, error: cfgError } = await db.from('qiora_distritos_telegram')
    .select('centro,chat_traspasos,token_cifrado').eq('centro', distrito).single()
  if (cfgError) throw new Error(`CONFIG_TELEGRAM_${distrito}: ${cfgError.message}`)
  if (U(cfg.centro) !== distrito || !S(cfg.chat_traspasos) || !S(cfg.token_cifrado)) throw new Error(`CONFIG_GRUPO_INVALIDA_${distrito}`)

  const { pendientes, mensaje } = mensajeReporte(distrito, rows)
  const tokenGrupo = descifrarToken(cfg.token_cifrado)
  await enviarTelegram(tokenGrupo, S(cfg.chat_traspasos), mensaje)

  const almacenes = [...new Set(pendientes.map(x => S(x.almacen_receptor)).filter(Boolean))]
  let privadosEnviados = 0
  const erroresPrivados = []
  if (almacenes.length) {
    const { data: usuarios, error: usersError } = await db.from('almacen_usuarios')
      .select('usuario_almacen,nombre,distrito,telegram_chat_id,activo')
      .eq('distrito', distrito).eq('activo', true).in('usuario_almacen', almacenes)
    if (usersError) throw new Error(`USUARIOS_${distrito}: ${usersError.message}`)
    const porAlmacen = new Map((usuarios || []).filter(u => U(u.distrito) === distrito).map(u => [S(u.usuario_almacen), u]))
    const botToken = S(process.env.QIORA_BOT_TOKEN)
    for (const almacen of almacenes) {
      const usuario = porAlmacen.get(almacen)
      const chat = S(usuario?.telegram_chat_id)
      if (!chat) continue
      if (!botToken) { erroresPrivados.push(`FALTA_QIORA_BOT_TOKEN:${almacen}`); continue }
      const propios = pendientes.filter(x => S(x.almacen_receptor) === almacen)
      const detalle = mensajeReporte(distrito, propios).mensaje
      try {
        await enviarTelegram(botToken, chat, `👤 ${S(usuario.nombre) || almacen}\n\n${detalle}`)
        privadosEnviados++
      } catch (e) { erroresPrivados.push(`${almacen}: ${S(e.message)}`) }
    }
  }
  return { distrito, grupo_enviado: true, chat_grupo: S(cfg.chat_traspasos), total_pendientes: pendientes.length, privados_enviados: privadosEnviados, errores_privados: erroresPrivados }
}

export async function POST(req) {
  try {
    const d = await req.json()
    const distrito = U(d.distrito || d.centro)
    const token = S(d.token)
    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !token) return out({ ok: false, error: 'DISTRITO_O_TOKEN_INVALIDO' }, 400)
    const db = dbAdmin()
    await validarExcel(db, distrito, token)
    if (U(d.action) !== 'SUBIR_TRASLADOS_SAP') return out({ ok: false, error: 'ACCION_INVALIDA' }, 400)
    if (!Array.isArray(d.filas) || d.filas.length === 0 || d.filas.length > 10000) return out({ ok: false, error: 'EXCEL_SIN_REGISTROS_O_FILAS_INVALIDAS', mensaje: 'No se borraron ni reemplazaron los registros anteriores.' }, 400)

    const rows = d.filas.map(x => normalizarFila(x, distrito))
    const documentos = rows.map(x => x.documento_traspaso)
    if (new Set(documentos).size !== documentos.length) return out({ ok: false, error: 'DOCUMENTOS_DUPLICADOS', mensaje: 'No se modificaron los registros anteriores.' }, 400)

    const { data: recibidos, error: replaceError } = await db.rpc('qiora_reemplazar_traslados_sap', { p_distrito: distrito, p_filas: rows })
    if (replaceError) throw replaceError

    const { data: all, error: readError } = await db.from('qiora_traslados_sap').select('*').eq('distrito', distrito).order('fecha', { ascending: true })
    if (readError) throw readError

    // Enviar el reporte completo DESPUES de confirmar el reemplazo y releer Supabase.
    // El alcance queda fijado al distrito autenticado: nunca se consultan otros distritos.
    let telegram
    try {
      telegram = await notificarDistrito(db, distrito, all || [])
    } catch (e) {
      telegram = { distrito, grupo_enviado: false, error: S(e.message) }
    }

    const reporte = mensajeReporte(distrito, all || [])
    return out({
      ok: true,
      distrito,
      recibidos: Number(recibidos) || rows.length,
      total_pendientes: reporte.pendientes.length,
      reporte_enviado: telegram.grupo_enviado === true,
      telegram,
      mensaje: telegram.grupo_enviado
        ? `Traslados actualizados. Reporte completo enviado al grupo de ${distrito}.`
        : `Traslados actualizados, pero no se pudo enviar Telegram: ${telegram.error || 'revisar errores privados'}`
    })
  } catch (e) {
    console.error('[EXCEL TRASLADOS]', e)
    const msg = S(e.message || e)
    return out({ ok: false, error: msg }, msg === 'TOKEN_INVALIDO' ? 403 : 500)
  }
}
