import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()
const jsonOut = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' }
})

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc('qiora_excel_validar_credencial', {
    p_distrito: distrito,
    p_token: token
  })
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
    resultado.push(...(data || []))
    if (!data || data.length < TAMANO) break
  }
  return resultado
}

function generarTSV(rows) {
  const headers = ['ID','FOLIO','FECHA','DISTRITO','ALMACEN','TECNICO','RECIBE','TELEFONO','SERIE','MATERIAL','DESCRIPCION','LOTE','TP_STOCKS','DIAS_EN_CAJUELA','ESTADO','DOCUMENTO_SAP','ACTUALIZADO_EN']
  const lines = [headers.join('\t')]
  for (const r of rows) {
    const values = [r.id,r.folio,r.fecha,r.distrito,r.almacen,r.tecnico,r.recibe,r.telefono,r.serie,r.material,r.descripcion,r.lote,r.tp_stocks,r.dias_en_cajuela,r.estado,r.documento_sap,r.actualizado_en]
    lines.push(values.map(escaparTSV).join('\t'))
  }
  return lines.join('\r\n')
}

function normalizarNombre(v) {
  return U(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

function construirMensaje({ fila, series, documentoSAP, destinatario }) {
  const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'medium' })
  const lineas = [
    '✅ QIORA BOT - RECEPCIÓN PROCESADA EN SAP', '',
    `Hola ${fila.tecnico || destinatario.nombre || destinatario.usuario_almacen || ''},`,
    'Tu recolección quedó contabilizada correctamente en SAP.', '',
    `📋 Folio: ${fila.folio || ''}`,
    `🏢 Distrito: ${fila.distrito || ''}`,
    `🏬 Almacén: ${fila.almacen || ''}`,
    `👷 Técnico: ${fila.tecnico || ''}`,
    `👤 Recibió: ${fila.recibe || ''}`,
    `📄 Documento SAP: ${documentoSAP}`,
    `📅 Fecha y hora: ${fecha}`, '',
    `📦 EQUIPOS RECIBIDOS (${series.length})`
  ]
  for (const x of series) {
    lineas.push(`• Serie: ${x.serie || ''}`)
    lineas.push(`  Material: ${x.material || 'NO REGISTRADO'}`)
    lineas.push(`  Descripción: ${x.descripcion || 'NO REGISTRADA'}`)
  }
  lineas.push('', '📌 Estado: CONTABILIZADO EN SAP', '🤖 QIORA BOT')
  return lineas.join('\n').slice(0, 3900)
}

async function enviarTelegram(chatId, mensaje) {
  const token = S(process.env.QIORA_BOT_TOKEN)
  if (!token) throw new Error('FALTA_QIORA_BOT_TOKEN_EN_VERCEL')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: mensaje }), cache: 'no-store'
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.ok !== true) throw new Error(result.description || `TELEGRAM_HTTP_${response.status}`)
}

async function notificarRecepcion(db, fila, documentoSAP) {
  // Esperar a que TODAS las series del mismo folio tengan el mismo documento y estado final.
  const { data: series, error: seriesError } = await db.from('recolecciones_equipos')
    .select('id,folio,distrito,almacen,tecnico,recibe,serie,material,descripcion,estado,documento_sap')
    .eq('distrito', fila.distrito).eq('folio', fila.folio)
  if (seriesError) throw new Error('ERROR_LEYENDO_SERIES_FOLIO: ' + seriesError.message)
  if (!series?.length || series.some(x => U(x.estado) !== 'ENTREGADA' || S(x.documento_sap) !== documentoSAP)) {
    return { enviados: 0, pendiente: true, motivo: 'FALTAN_SERIES_DEL_FOLIO_POR_CONFIRMAR' }
  }

  const { data: usuarios, error: usersError } = await db.from('almacen_usuarios')
    .select('usuario_almacen,nombre,puesto,distrito,telegram_chat_id,activo')
    .eq('distrito', fila.distrito).eq('activo', true)
  if (usersError) throw new Error('ERROR_BUSCANDO_DESTINATARIOS: ' + usersError.message)

  // Los DOS avisos de esta recepción corresponden al técnico responsable.
  // El usuario que recibe se muestra en el texto, pero nunca es destinatario.
  const tecnico = (usuarios || []).find(u => U(u.puesto) === 'TECNICO' && S(u.usuario_almacen) === S(fila.almacen))
  const destinatarios = tecnico && S(tecnico.telegram_chat_id) ? [tecnico] : []
  if (!destinatarios.length) return { enviados: 0, pendiente: false, motivo: 'SIN_TELEGRAM_CHAT_ID_TECNICO_O_RECEPTOR' }

  let enviados = 0
  for (const usuario of destinatarios) {
    const chatId = S(usuario.telegram_chat_id)
    const mensaje = construirMensaje({ fila, series, documentoSAP, destinatario: usuario })
    // Registro único por folio + documento + chat. Si ya se envió, no repetir.
    const { data: existente, error: checkError } = await db.from('qiora_recolecciones_telegram_envios')
      .select('id,estado').eq('folio', fila.folio).eq('documento_sap', documentoSAP).eq('telegram_chat_id', chatId).maybeSingle()
    if (checkError) throw new Error('ERROR_CONSULTANDO_CONTROL_TELEGRAM: ' + checkError.message)
    if (existente?.estado === 'ENVIADO') continue

    let controlId = existente?.id
    if (!controlId) {
      const { data: nuevo, error: insertError } = await db.from('qiora_recolecciones_telegram_envios')
        .insert({ folio: fila.folio, distrito: fila.distrito, documento_sap: documentoSAP, telegram_chat_id: chatId, usuario_almacen: usuario.usuario_almacen || null, nombre_destinatario: usuario.nombre || null, estado: 'PENDIENTE' })
        .select('id').single()
      if (insertError) {
        if (insertError.code === '23505') continue
        throw new Error('ERROR_REGISTRANDO_AVISO_TELEGRAM: ' + insertError.message)
      }
      controlId = nuevo.id
    }
    try {
      await enviarTelegram(chatId, mensaje)
      const { error: markError } = await db.from('qiora_recolecciones_telegram_envios')
        .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString(), error: null }).eq('id', controlId)
      if (markError) throw new Error(markError.message)
      enviados++
    } catch (e) {
      await db.from('qiora_recolecciones_telegram_envios').update({ estado: 'ERROR', error: S(e.message).slice(0, 1000) }).eq('id', controlId)
      throw e
    }
  }
  return { enviados, pendiente: false }
}

async function actualizarEstadoRecoleccion(db, d, distrito) {
  const id = S(d.id)
  const estado = U(d.estado)
  const documentoSAP = S(d.documento_sap)
  if (!id) return jsonOut({ ok: false, error: 'ID_RECOLECCION_REQUERIDO' }, 400)
  if (estado !== 'ENTREGADA') return jsonOut({ ok: false, error: 'ESTADO_NO_PERMITIDO' }, 400)
  if (!/^\d{8,20}$/.test(documentoSAP)) return jsonOut({ ok: false, error: 'DOCUMENTO_SAP_INVALIDO' }, 400)

  const { data: actual, error: consultaError } = await db.from('recolecciones_equipos')
    .select('id,folio,distrito,almacen,tecnico,recibe,estado,documento_sap')
    .eq('id', id).eq('distrito', distrito).maybeSingle()
  if (consultaError) throw new Error('ERROR_CONSULTANDO_RECOLECCION: ' + consultaError.message)
  if (!actual) return jsonOut({ ok: false, error: 'RECOLECCION_NO_ENCONTRADA_EN_DISTRITO' }, 404)

  if (U(actual.estado) === 'ENTREGADA' && S(actual.documento_sap) && S(actual.documento_sap) !== documentoSAP) {
    return jsonOut({ ok: false, error: 'DOCUMENTO_SAP_DIFERENTE_AL_YA_GUARDADO', documento_existente: actual.documento_sap }, 409)
  }
  if (!['RECOLECTADA', 'ENTREGADA', 'ENTREGADA_PENDIENTE_SUPABASE'].includes(U(actual.estado))) {
    return jsonOut({ ok: false, error: 'ESTADO_ORIGEN_INVALIDO', estado_actual: actual.estado }, 409)
  }

  const { data: actualizado, error: updateError } = await db.from('recolecciones_equipos')
    .update({ estado: 'ENTREGADA', documento_sap: documentoSAP, actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('distrito', distrito)
    .select('id,folio,fecha,distrito,almacen,tecnico,recibe,estado,documento_sap,actualizado_en').maybeSingle()
  if (updateError) throw new Error('ERROR_ACTUALIZANDO_RECOLECCION: ' + updateError.message)
  if (!actualizado) return jsonOut({ ok: false, error: 'NO_SE_PUDO_ACTUALIZAR_RECOLECCION' }, 409)

  const aviso = await notificarRecepcion(db, actualizado, documentoSAP)
  return jsonOut({
    ok: true, id: actualizado.id, folio: actualizado.folio, distrito,
    estado: 'ENTREGADA', documento_sap: documentoSAP,
    telegram: aviso,
    mensaje: aviso.pendiente
      ? 'Documento SAP guardado. Se notificará cuando todas las series del folio estén confirmadas.'
      : `Documento SAP guardado. Mensajes Telegram enviados: ${aviso.enviados}.`
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
    return new Response(generarTSV(rows), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = S(e?.message || e)
    console.error('[EXCEL RECOLECCIONES]', msg)
    if (msg === 'TOKEN_INVALIDO') return jsonOut({ ok: false, error: msg }, 403)
    return jsonOut({ ok: false, error: msg }, 500)
  }
}
