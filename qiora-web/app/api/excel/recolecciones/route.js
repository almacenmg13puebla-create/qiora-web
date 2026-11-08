import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()
const norm = v => U(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
const jsonOut = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const textOut = text => new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc('qiora_excel_validar_credencial', { p_distrito: distrito, p_token: token })
  if (error) throw new Error('ERROR_VALIDANDO_TOKEN: ' + error.message)
  if (data !== true) throw new Error('TOKEN_INVALIDO')
}

function escaparTSV(valor) {
  return String(valor ?? '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

async function consultarRecolecciones(db, distrito) {
  const resultado = []
  const TAMANO = 1000
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await db.from('recolecciones_equipos')
      .select('id,folio,fecha,distrito,almacen,tecnico,recibe,telefono,serie,material,descripcion,lote,tp_stocks,dias_en_cajuela,estado,documento_sap,actualizado_en')
      .eq('distrito', distrito).order('fecha', { ascending: true }).order('id', { ascending: true })
      .range(desde, desde + TAMANO - 1)
    if (error) throw new Error('ERROR_CONSULTANDO_SUPABASE: ' + error.message)
    if (!data?.length) break
    resultado.push(...data)
    if (data.length < TAMANO) break
  }
  return resultado
}

function generarTSV(rows) {
  const headers = ['ID','FOLIO','FECHA','DISTRITO','ALMACEN','TECNICO','RECIBE','TELEFONO','SERIE','MATERIAL','DESCRIPCION','LOTE','TP_STOCKS','DIAS_EN_CAJUELA','ESTADO','DOCUMENTO_SAP','ACTUALIZADO_EN']
  const lineas = [headers.join('\t')]
  for (const r of rows) lineas.push([
    r.id,r.folio,r.fecha,r.distrito,r.almacen,r.tecnico,r.recibe,r.telefono,r.serie,r.material,r.descripcion,r.lote,r.tp_stocks,r.dias_en_cajuela,r.estado,r.documento_sap,r.actualizado_en
  ].map(escaparTSV).join('\t'))
  return lineas.join('\r\n')
}

function valorFechaHora(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'medium' }).format(d)
}

function resolverDestinatarios(usuarios, registro) {
  const porNombre = new Map()
  const porAlmacen = new Map()
  for (const u of usuarios || []) {
    if (!u.telegram_chat_id || u.activo !== true) continue
    const n = norm(u.nombre)
    const a = norm(u.usuario_almacen)
    if (n && !porNombre.has(n)) porNombre.set(n, u)
    if (a && !porAlmacen.has(a)) porAlmacen.set(a, u)
  }
  const encontrados = []
  // TECNICO normalmente contiene el nombre del responsable; ALMACEN permite
  // resolverlo por código. RECIBE puede contener nombre o número de almacén.
  const tecnico = porNombre.get(norm(registro.tecnico)) || porAlmacen.get(norm(registro.almacen))
  const recibe = porNombre.get(norm(registro.recibe)) || porAlmacen.get(norm(registro.recibe))
  for (const u of [tecnico, recibe]) {
    if (u && norm(u.distrito) === norm(registro.distrito)) encontrados.push(u)
  }
  return [...new Map(encontrados.map(u => [S(u.telegram_chat_id), u])).values()]
}

async function crearAvisosPrivados(db, distrito, registro, documentoSAP) {
  const folio = S(registro.folio)
  if (!folio) throw new Error('FOLIO_RECOLECCION_REQUERIDO_PARA_NOTIFICAR')
  const { data: filas, error: filasError } = await db.from('recolecciones_equipos')
    .select('id,folio,fecha,distrito,almacen,tecnico,recibe,serie,material,descripcion,lote,estado,documento_sap,actualizado_en')
    .eq('distrito', distrito).eq('folio', folio).eq('estado', 'ENTREGADA')
    .order('id', { ascending: true })
  if (filasError) throw new Error('ERROR_CONSULTANDO_SERIES_FOLIO: ' + filasError.message)
  const grupo = (filas || []).filter(x => S(x.documento_sap) === documentoSAP || !S(x.documento_sap))
  const base = grupo[0] || registro
  const { data: usuarios, error: usuariosError } = await db.from('almacen_usuarios')
    .select('id,usuario_almacen,nombre,distrito,puesto,telegram_chat_id,activo')
    .eq('distrito', distrito).eq('activo', true)
  if (usuariosError) throw new Error('ERROR_CONSULTANDO_TELEGRAM_TECNICOS: ' + usuariosError.message)
  const destinatarios = resolverDestinatarios(usuarios, base)
  const series = (grupo.length ? grupo : [registro]).map(x => ({
    serie: S(x.serie), material: S(x.material), descripcion: S(x.descripcion), lote: S(x.lote)
  })).filter(x => x.serie)
  const fechaHora = valorFechaHora(base.actualizado_en)
  const detalleSeries = series.length ? series.map((x,i) => `${i+1}. Serie: ${x.serie}\n   Material: ${x.material || 'NO REGISTRADO'}\n   Descripción: ${x.descripcion || 'NO REGISTRADA'}\n   Lote: ${x.lote || 'NO REGISTRADO'}`).join('\n\n') : 'No hay series registradas.'
  const avisos = destinatarios.map(u => {
    const mensaje = [
      '✅ QIORA BOT | RECOLECCIÓN PROCESADA A RECU','',
      `🏢 Distrito: ${distrito}`,
      `📋 Folio: ${folio}`,
      `👨‍🔧 Técnico responsable: ${S(base.tecnico) || 'NO REGISTRADO'}`,
      `🏬 Almacén: ${S(base.almacen) || 'NO REGISTRADO'}`,
      `👤 Recibió: ${S(base.recibe) || 'NO REGISTRADO'}`,
      `📄 Documento SAP: ${documentoSAP}`,'',
      '📦 EQUIPOS PROCESADOS', detalleSeries,'',
      `📅 Fecha y hora: ${fechaHora}`,
      '✅ Estado: ENTREGADA A RECU',
      '', '🤖 Confirmación automática de QIORA BOT.'
    ].join('\n').slice(0, 3900)
    return {
      recoleccion_id: S(base.id), distrito, folio, documento_sap: documentoSAP,
      telegram_chat_id: S(u.telegram_chat_id), usuario_almacen: S(u.usuario_almacen),
      nombre_destinatario: S(u.nombre), mensaje, estado: 'PENDIENTE'
    }
  })
  if (avisos.length) {
    const { error } = await db.from('qiora_recolecciones_avisos')
      .upsert(avisos, { onConflict: 'distrito,folio,documento_sap,telegram_chat_id' })
    if (error) throw new Error('RECOLECCION_GUARDADA_PERO_AVISOS_NO_CREADOS: ' + error.message)
  }
  return { avisos_creados: avisos.length, destinatarios: destinatarios.map(u => ({ usuario_almacen: u.usuario_almacen, nombre: u.nombre })) }
}

async function actualizarEstadoRecoleccion(db, d, distrito) {
  const id = S(d.id)
  const estado = U(d.estado)
  const documentoSAP = S(d.documento_sap)
  if (!id) return jsonOut({ ok: false, error: 'ID_RECOLECCION_REQUERIDO' }, 400)
  if (estado !== 'ENTREGADA') return jsonOut({ ok: false, error: 'ESTADO_NO_PERMITIDO' }, 400)
  if (!/^\d{8,20}$/.test(documentoSAP)) return jsonOut({ ok: false, error: 'DOCUMENTO_SAP_INVALIDO' }, 400)

  const { data: actual, error: consultaError } = await db.from('recolecciones_equipos')
    .select('id,folio,fecha,distrito,almacen,tecnico,recibe,serie,material,descripcion,lote,estado,documento_sap,actualizado_en')
    .eq('id', id).eq('distrito', distrito).maybeSingle()
  if (consultaError) throw new Error('ERROR_CONSULTANDO_RECOLECCION: ' + consultaError.message)
  if (!actual) return jsonOut({ ok: false, error: 'RECOLECCION_NO_ENCONTRADA_EN_DISTRITO' }, 404)
  if (U(actual.estado) === 'ENTREGADA') {
    if (S(actual.documento_sap) && S(actual.documento_sap) !== documentoSAP) {
      return jsonOut({ ok: false, error: 'DOCUMENTO_SAP_NO_COINCIDE_CON_EL_REGISTRADO', documento_existente: actual.documento_sap }, 409)
    }
    if (!S(actual.documento_sap)) {
      const { error: backfillError } = await db.from('recolecciones_equipos').update({ documento_sap: documentoSAP, actualizado_en: new Date().toISOString() }).eq('id', id).eq('distrito', distrito).is('documento_sap', null)
      if (backfillError) throw new Error('ERROR_GUARDANDO_DOCUMENTO_SAP: ' + backfillError.message)
    }
  } else {
    if (U(actual.estado) !== 'RECOLECTADA') return jsonOut({ ok: false, error: 'ESTADO_ORIGEN_INVALIDO', estado_actual: actual.estado }, 409)
    const { data: actualizado, error: updateError } = await db.from('recolecciones_equipos').update({
      estado: 'ENTREGADA', documento_sap: documentoSAP, actualizado_en: new Date().toISOString()
    }).eq('id', id).eq('distrito', distrito).eq('estado', 'RECOLECTADA')
      .select('id').maybeSingle()
    if (updateError) throw new Error('ERROR_ACTUALIZANDO_RECOLECCION: ' + updateError.message)
    if (!actualizado) return jsonOut({ ok: false, error: 'NO_SE_PUDO_ACTUALIZAR_ESTADO' }, 409)
  }
  const notificaciones = await crearAvisosPrivados(db, distrito, actual, documentoSAP)
  return jsonOut({
    ok: true, id, distrito, folio: actual.folio, estado: 'ENTREGADA', documento_sap: documentoSAP,
    notificaciones_privadas_creadas: notificaciones.avisos_creados,
    destinatarios: notificaciones.destinatarios,
    mensaje: 'Recolección y documento SAP guardados. Avisos privados preparados para QIORA BOT.'
  })
}

export async function POST(req) {
  try {
    let d
    try { d = await req.json() } catch { return jsonOut({ ok: false, error: 'JSON_INVALIDO' }, 400) }
    const action = U(d.action)
    const distrito = U(d.distrito || d.centro)
    const token = S(d.token)
    if (action !== 'DESCARGAR_RECOLECCIONES' && action !== 'ACTUALIZAR_ESTADO_RECOLECCION') return jsonOut({ ok: false, error: 'ACCION_INVALIDA', recibida: action }, 400)
    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return jsonOut({ ok: false, error: 'DISTRITO_INVALIDO' }, 400)
    if (!token) return jsonOut({ ok: false, error: 'TOKEN_REQUERIDO' }, 401)
    const db = dbAdmin()
    await validarExcel(db, distrito, token)
    if (action === 'ACTUALIZAR_ESTADO_RECOLECCION') return await actualizarEstadoRecoleccion(db, d, distrito)
    const rows = await consultarRecolecciones(db, distrito)
    return textOut(generarTSV(rows))
  } catch (e) {
    const mensaje = S(e?.message || e)
    console.error('[EXCEL RECOLECCIONES]', mensaje)
    if (mensaje === 'TOKEN_INVALIDO') return jsonOut({ ok: false, error: mensaje }, 403)
    return jsonOut({ ok: false, error: mensaje }, 500)
  }
}
