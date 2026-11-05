import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()

function jsonOut(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })
}

function textOut(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc('qiora_excel_validar_credencial', {
    p_distrito: distrito,
    p_token: token
  })
  if (error) {
    console.error('[RECOLECCIONES TOKEN]', error.message)
    throw new Error('ERROR_VALIDANDO_TOKEN')
  }
  if (data !== true) throw new Error('TOKEN_INVALIDO')
}

function escaparTSV(valor) {
  return String(valor ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

async function consultarRecolecciones(db, distrito) {
  const resultado = []
  const TAMANO = 1000
  let desde = 0

  while (true) {
    const hasta = desde + TAMANO - 1
    const { data, error } = await db
      .from('recolecciones_equipos')
      .select(`
        id, folio, fecha, distrito, almacen, tecnico, recibe, telefono,
        serie, material, descripcion, lote, tp_stocks, dias_en_cajuela,
        estado, actualizado_en
      `)
      .eq('distrito', distrito)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)

    if (error) {
      console.error('[RECOLECCIONES CONSULTA]', error.message)
      throw new Error('ERROR_CONSULTANDO_SUPABASE: ' + error.message)
    }
    if (!data || data.length === 0) break
    resultado.push(...data)
    if (data.length < TAMANO) break
    desde += TAMANO
  }
  return resultado
}

function generarTSV(rows) {
  const headers = [
    'ID', 'FOLIO', 'FECHA', 'DISTRITO', 'ALMACEN', 'TECNICO',
    'RECIBE', 'TELEFONO', 'SERIE', 'MATERIAL', 'DESCRIPCION',
    'LOTE', 'TP_STOCKS', 'DIAS_EN_CAJUELA', 'ESTADO', 'ACTUALIZADO_EN'
  ]
  const lineas = [headers.join('\t')]
  for (const r of rows) {
    const valores = [
      r.id, r.folio, r.fecha, r.distrito, r.almacen, r.tecnico,
      r.recibe, r.telefono, r.serie, r.material, r.descripcion,
      r.lote, r.tp_stocks, r.dias_en_cajuela, r.estado, r.actualizado_en
    ]
    lineas.push(valores.map(escaparTSV).join('\t'))
  }
  return lineas.join('\r\n')
}

// SAP ya confirmó el documento. Esta acción solo permite la transición
// RECOLECTADA -> ENTREGADA dentro del distrito validado por el token Excel.
async function actualizarEstadoRecoleccion(db, d, distrito) {
  const id = S(d.id)
  const estado = U(d.estado)
  const documentoSAP = S(d.documento_sap)

  if (!id) return jsonOut({ ok: false, error: 'ID_RECOLECCION_REQUERIDO' }, 400)
  if (estado !== 'ENTREGADA') return jsonOut({ ok: false, error: 'ESTADO_NO_PERMITIDO' }, 400)
  if (!/^\d{8,20}$/.test(documentoSAP)) {
    return jsonOut({ ok: false, error: 'DOCUMENTO_SAP_INVALIDO' }, 400)
  }

  const { data: actual, error: consultaError } = await db
    .from('recolecciones_equipos')
    .select('id,distrito,estado')
    .eq('id', id)
    .eq('distrito', distrito)
    .maybeSingle()

  if (consultaError) {
    console.error('[RECOLECCION CONSULTA ESTADO]', consultaError.message)
    throw new Error('ERROR_CONSULTANDO_RECOLECCION')
  }
  if (!actual) {
    return jsonOut({ ok: false, error: 'RECOLECCION_NO_ENCONTRADA_EN_DISTRITO' }, 404)
  }

  // Idempotencia: los reintentos tras un timeout no duplican la transición.
  if (U(actual.estado) === 'ENTREGADA') {
    return jsonOut({
      ok: true,
      ya_actualizada: true,
      id,
      estado: 'ENTREGADA',
      mensaje: 'La recolección ya estaba entregada.'
    })
  }

  if (U(actual.estado) !== 'RECOLECTADA') {
    return jsonOut({
      ok: false,
      error: 'ESTADO_ORIGEN_INVALIDO',
      estado_actual: actual.estado
    }, 409)
  }

  const { data: actualizado, error: updateError } = await db
    .from('recolecciones_equipos')
    .update({
      estado: 'ENTREGADA',
      actualizado_en: new Date().toISOString()
    })
    .eq('id', id)
    .eq('distrito', distrito)
    .eq('estado', 'RECOLECTADA')
    .select('id,distrito,estado,actualizado_en')
    .maybeSingle()

  if (updateError) {
    console.error('[RECOLECCION ACTUALIZAR]', updateError.message)
    throw new Error('ERROR_ACTUALIZANDO_RECOLECCION')
  }

  if (!actualizado) {
    const { data: verificacion, error: verError } = await db
      .from('recolecciones_equipos')
      .select('id,estado')
      .eq('id', id)
      .eq('distrito', distrito)
      .maybeSingle()

    if (verError) throw new Error('ERROR_VERIFICANDO_ESTADO')
    if (verificacion && U(verificacion.estado) === 'ENTREGADA') {
      return jsonOut({ ok: true, ya_actualizada: true, id, estado: 'ENTREGADA' })
    }
    return jsonOut({ ok: false, error: 'NO_SE_PUDO_ACTUALIZAR_ESTADO' }, 409)
  }

  console.log('[QIORA RECOLECCIONES ESTADO]', JSON.stringify({
    id,
    distrito,
    estado_anterior: 'RECOLECTADA',
    estado_nuevo: 'ENTREGADA',
    documento_sap: documentoSAP
  }))

  return jsonOut({
    ok: true,
    id: actualizado.id,
    distrito: actualizado.distrito,
    estado: actualizado.estado,
    documento_sap: documentoSAP,
    actualizado_en: actualizado.actualizado_en,
    mensaje: 'Recolección actualizada correctamente en Supabase.'
  })
}

export async function POST(req) {
  try {
    let d
    try {
      d = await req.json()
    } catch {
      return jsonOut({ ok: false, error: 'JSON_INVALIDO' }, 400)
    }

    const action = U(d.action)
    const distrito = U(d.distrito || d.centro)
    const token = S(d.token)

    if (action !== 'DESCARGAR_RECOLECCIONES' && action !== 'ACTUALIZAR_ESTADO_RECOLECCION') {
      return jsonOut({ ok: false, error: 'ACCION_INVALIDA', recibida: action }, 400)
    }
    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) {
      return jsonOut({ ok: false, error: 'DISTRITO_INVALIDO' }, 400)
    }
    if (!token) return jsonOut({ ok: false, error: 'TOKEN_REQUERIDO' }, 401)

    const db = dbAdmin()
    await validarExcel(db, distrito, token)

    if (action === 'ACTUALIZAR_ESTADO_RECOLECCION') {
      return await actualizarEstadoRecoleccion(db, d, distrito)
    }

    const rows = await consultarRecolecciones(db, distrito)
    const tsv = generarTSV(rows)
    console.log('[QIORA RECOLECCIONES]', JSON.stringify({
      distrito, registros: rows.length, accion: action
    }))
    return textOut(tsv, 200)
  } catch (e) {
    const mensaje = S(e?.message || e)
    console.error('[EXCEL RECOLECCIONES]', mensaje)
    if (mensaje === 'TOKEN_INVALIDO') return jsonOut({ ok: false, error: mensaje }, 403)
    if (mensaje === 'ERROR_VALIDANDO_TOKEN') return jsonOut({ ok: false, error: mensaje }, 500)
    return jsonOut({ ok: false, error: mensaje }, 500)
  }
}
