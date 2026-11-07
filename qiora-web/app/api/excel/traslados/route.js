
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

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

function normalizarFila(x, distrito) {
  const documento = S(
    x.documentoTraspaso || x.documento_traspaso
  )

  if (!/^\d{8,12}$/.test(documento)) {
    throw new Error('DOCUMENTO_SAP_INVALIDO: ' + documento)
  }

  return {
    distrito,
    centro: U(x.centro || distrito),
    almacen: S(x.almacen),
    documento_traspaso: documento,
    fecha: S(x.fecha),
    movimiento: S(x.movimiento),

    centro_receptor: U(
      x.centroReceptor || x.centro_receptor || distrito
    ),

    almacen_receptor: S(
      x.almacenReceptor || x.almacen_receptor
    ),

    documento_receptor: S(
      x.documentoReceptor || x.documento_receptor
    ) || null,

    fecha_receptor: S(
      x.fechaReceptor || x.fecha_receptor
    ) || null,

    movimiento_receptor: S(
      x.movimientoReceptor || x.movimiento_receptor
    ) || null,

    status_sap: S(x.status || x.status_sap),

    dias: Number(
      String(x.dias || 0).replace(',', '.')
    ) || 0,

    raw_sap: x,
    actualizado_en: new Date().toISOString()
  }
}

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
      '⬅️ ORIGEN',
      `🏢 Almacén: ${x.almacen || 'NO REGISTRADO'}`,
      '➡️ DESTINO',
      `🏢 Almacén: ${x.almacen_receptor || 'NO REGISTRADO'}`,
      '🟡 PENDIENTE DE ENTRADA'
    ].join('\n'))
  ]

  return {
    total: ps.length,
    mensaje: lines.join('\n\n'),
    pendientes: ps
  }
}

export async function POST(req) {
  try {
    const d = await req.json()

    const distrito = U(d.distrito || d.centro)
    const token = S(d.token)

    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !token) {
      return out({
        ok: false,
        error: 'DISTRITO_O_TOKEN_INVALIDO'
      }, 400)
    }

    const db = dbAdmin()

    await validarExcel(db, distrito, token)

    if (U(d.action) !== 'SUBIR_TRASLADOS_SAP') {
      return out({
        ok: false,
        error: 'ACCION_INVALIDA'
      }, 400)
    }

    // PROTEGER LOS REGISTROS SI EXCEL VIENE VACIO
    if (
      !Array.isArray(d.filas) ||
      d.filas.length === 0 ||
      d.filas.length > 10000
    ) {
      return out({
        ok: false,
        error: 'EXCEL_SIN_REGISTROS_O_FILAS_INVALIDAS',
        mensaje: 'No se borraron ni reemplazaron los registros anteriores.'
      }, 400)
    }

    // NORMALIZAR INFORMACION
    const rows = d.filas.map(x =>
      normalizarFila(x, distrito)
    )

    // EVITAR DOCUMENTOS DUPLICADOS EN EL MISMO EXCEL
    const documentos = rows.map(x => x.documento_traspaso)

    if (new Set(documentos).size !== documentos.length) {
      return out({
        ok: false,
        error: 'DOCUMENTOS_DUPLICADOS',
        mensaje: 'No se modificaron los registros anteriores.'
      }, 400)
    }

    // REEMPLAZAR LOS REGISTROS DEL DISTRITO
    // LA FUNCION SQL ELIMINA LOS ANTERIORES E INSERTA LOS NUEVOS
    const { data: recibidos, error: replaceError } =
      await db.rpc('qiora_reemplazar_traslados_sap', {
        p_distrito: distrito,
        p_filas: rows
      })

    if (replaceError) {
      console.error('[REEMPLAZO TRASLADOS]', replaceError)
      throw replaceError
    }

    // LEER INFORMACION ACTUALIZADA
    const { data: all, error: readError } = await db
      .from('qiora_traslados_sap')
      .select('*')
      .eq('distrito', distrito)
      .order('fecha', { ascending: true })

    if (readError) throw readError

    // GENERAR REPORTE DE PENDIENTES
    const reporte = textoReporte(distrito, all || [])

    let avisoCreado = false

    // SOLO GENERAR AVISO SI EXISTEN PENDIENTES
    if (reporte.total > 0) {
      const { error: avisoError } = await db
        .from('qiora_avisos_traslados')
        .insert({
          distrito,
          tipo: 'REPORTE_PENDIENTES',
          total_pendientes: reporte.total,
          mensaje: reporte.mensaje,
          estado: 'PENDIENTE',
          origen_comando: S(d.comandoId) || null,
          creado_en: new Date().toISOString()
        })

      if (avisoError) throw avisoError

      avisoCreado = true
    }

    return out({
      ok: true,
      distrito,
      recibidos: Number(recibidos) || rows.length,
      total_pendientes: reporte.total,
      aviso_creado: avisoCreado,
      mensaje: avisoCreado
        ? 'Traslados reemplazados. Reporte de pendientes generado.'
        : 'Traslados reemplazados. No existen pendientes por reportar.'
    })

  } catch (e) {
    console.error('[EXCEL TRASLADOS]', e)

    const msg = S(e.message || e)

    return out({
      ok: false,
      error: msg
    }, msg === 'TOKEN_INVALIDO' ? 403 : 500)
  }
}
