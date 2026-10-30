import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()
const norm = (v) => upper(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function verificarBot(request) {
  const esperado = clean(process.env.QIORA_BOT_API_KEY)
  const recibido = clean(request.headers.get('x-qiora-bot-key'))
  return Boolean(esperado && recibido && esperado === recibido)
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Variables Supabase incompletas en Vercel.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function supabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Falta la clave pública de Supabase para validar la contraseña SAT.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function perfilTelegram(admin, chatId) {
  const id = clean(chatId)
  if (!id) return null
  const { data, error } = await admin.from('almacen_usuarios').select('*')
    .eq('telegram_chat_id', id).eq('activo', true).limit(1).maybeSingle()
  if (error) throw new Error(`Perfil Telegram: ${error.message}`)
  return data || null
}

function esAdmin(p) {
  const puesto = norm(p?.puesto)
  return puesto === 'ADMIN_PADRE' || puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' ||
    puesto === 'ALMACENISTA' || puesto.startsWith('ADMIN_')
}

function esAdminPadre(p) {
  return norm(p?.puesto) === 'ADMIN_PADRE' || p?.dashboard_nacional === true
}

function requierePerfil(p) {
  if (!p) throw new Error('Telegram no está vinculado a un usuario activo de SAT.')
}

function fechaLocalMX() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', month: '2-digit', day: '2-digit', year: 'numeric'
  }).formatToParts(new Date())
  const get = (k) => partes.find(x => x.type === k)?.value || ''
  return { mmdd: `${get('month')}-${get('day')}`, dia: `${get('year')}-${get('month')}-${get('day')}` }
}

async function consultarMiPerfil(admin, payload) {
  const chatId = clean(payload.telegram_chat_id)
  if (!/^\d{5,20}$/.test(chatId)) throw new Error('No se recibió una cuenta de Telegram válida.')
  const { data: perfil, error } = await admin.from('almacen_usuarios')
    .select('usuario_almacen,nombre,telefono,puesto,distrito,odoo,ffm,usuario_ffm,coordinador,supervisor,correo,activo,telegram_chat_id,ultima_conexion,fecha_nacimiento,ausente,fecha_regreso')
    .eq('telegram_chat_id', chatId).eq('activo', true).limit(1).maybeSingle()
  if (error) throw new Error(`No se pudo consultar tu perfil: ${error.message}`)
  if (!perfil) throw new Error('Tu Telegram no está vinculado a un usuario activo. Envía REGISTRAR DISTRITO USUARIO para vincularlo.')

  const ahora = new Date().toISOString()
  const { error: updateError } = await admin.from('almacen_usuarios')
    .update({ ultima_conexion: ahora, actualizado_en: ahora })
    .eq('telegram_chat_id', chatId).eq('activo', true)
  if (updateError) throw new Error(`No se pudo actualizar la última conexión: ${updateError.message}`)

  return perfil
}

function textoMiPerfil(perfil) {
  const dato = (v) => clean(v) || 'NO REGISTRADO'
  return [
    '👤 MI PERFIL QIORA',
    '',
    `🏢 Almacén/Usuario: ${dato(perfil.usuario_almacen)}`,
    `👷 Nombre: ${dato(perfil.nombre)}`,
    `💼 Puesto: ${dato(perfil.puesto)}`,
    `🏬 Distrito: ${dato(perfil.distrito)}`,
    `📱 Teléfono: ${dato(perfil.telefono)}`,
    `🆔 Odoo: ${dato(perfil.odoo)}`,
    `🪪 Usuario FFM: ${dato(perfil.usuario_ffm || perfil.ffm)}`,
    `👥 Coordinador: ${dato(perfil.coordinador)}`,
    `👤 Supervisor: ${dato(perfil.supervisor)}`,
    `✉️ Correo: ${dato(perfil.correo)}`,
    `🎂 Fecha de nacimiento: ${dato(perfil.fecha_nacimiento)}`,
    `📌 Estado: ${perfil.activo ? 'ACTIVO' : 'INACTIVO'}`,
    `📅 Última conexión: ${dato(perfil.ultima_conexion)}`
  ].join('\n')
}

async function registrarTelegram(admin, payload) {
  const distrito = upper(payload.distrito)
  const usuario = upper(payload.usuario_almacen)
  const chatId = clean(payload.telegram_chat_id)
  const clave = String(payload.clave ?? '')

  if (!/^([A-Z]{2,5}[0-9]{1,5})$/.test(distrito)) throw new Error('Distrito inválido.')
  if (!/^[A-Z0-9_-]{2,10}$/.test(usuario)) throw new Error('Número de usuario o almacén inválido.')
  if (!/^\d{5,20}$/.test(chatId)) throw new Error('No se pudo identificar tu cuenta de Telegram.')
  if (!clave || clave.length > 256) throw new Error('Introduce tu contraseña personal de SAT.')

  const { data: perfil, error } = await admin.from('almacen_usuarios')
    .select('id,usuario_almacen,distrito,nombre,puesto,activo,auth_user_id,telegram_chat_id')
    .eq('usuario_almacen', usuario).eq('distrito', distrito).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!perfil || perfil.activo !== true || !perfil.auth_user_id) throw new Error('No se encontró un usuario activo de SAT con ese distrito y número.')
  if (clean(perfil.telegram_chat_id) && clean(perfil.telegram_chat_id) !== chatId) throw new Error('Este usuario ya está vinculado a otra cuenta de Telegram. Solicita apoyo al administrador de SAT.')

  const auth = supabaseAuthClient()
  const { data: login, error: loginError } = await auth.auth.signInWithPassword({
    email: `${usuario.toLowerCase()}@qiora.local`, password: `QIORA#${clave}`
  })
  if (loginError || !login?.user?.id) throw new Error('Contraseña incorrecta. Verifica tu usuario y contraseña de SAT.')
  await auth.auth.signOut().catch(() => {})
  if (String(login.user.id).toLowerCase() !== String(perfil.auth_user_id).toLowerCase()) throw new Error('La cuenta autenticada no corresponde al usuario indicado en SAT.')

  const { data: ocupado, error: ocupadoError } = await admin.from('almacen_usuarios')
    .select('id').eq('telegram_chat_id', chatId).neq('id', perfil.id).limit(1).maybeSingle()
  if (ocupadoError) throw new Error(ocupadoError.message)
  if (ocupado) throw new Error('Esta cuenta de Telegram ya está vinculada a otro usuario SAT.')

  if (clean(perfil.telegram_chat_id) !== chatId) {
    const ahora = new Date().toISOString()
    const { error: updateError } = await admin.from('almacen_usuarios').update({
      telegram_chat_id: chatId, bot_confirmado: true,
      fecha_confirmacion_bot: ahora, actualizado_en: ahora
    }).eq('id', perfil.id).eq('activo', true).or('telegram_chat_id.is.null,telegram_chat_id.eq.')
    if (updateError) throw new Error(updateError.message)
  }
  return {
    ok: true, registrado: true, usuario: perfil.usuario_almacen, distrito: perfil.distrito,
    puesto: perfil.puesto || '', nombre: perfil.nombre || '', faltantes: [],
    mensaje: `Registro completado.\nUsuario: ${usuario}\nDistrito: ${distrito}\nPuesto: ${perfil.puesto || 'No indicado'}`
  }
}

function estadoComando(estado) {
  const e = norm(estado)
  if (['REALIZADO', 'COMPLETADO', 'FINALIZADO', 'OK'].includes(e)) return 'REALIZADO'
  if (['ERROR', 'NO REALIZADO', 'RECHAZADO', 'FALLIDO'].includes(e)) return 'ERROR'
  return e
}

async function sapNotificaciones(admin) {
  const { data, error } = await admin.from('comandos_sap').select(
    'id_comando,distrito,usuario_solicita,telegram_chat_id,proceso,estado,resultado,pc_ejecutora,fecha_solicitud,telegram_notificado'
  ).eq('telegram_notificado', false).order('fecha_solicitud', { ascending: true }).limit(50)
  if (error) throw new Error(`COMANDOS_SAP: ${error.message}`)
  const terminales = (data || []).filter(x => ['REALIZADO', 'COMPLETADO', 'ERROR', 'NO REALIZADO', 'VENCIDO'].includes(norm(x.estado)) && clean(x.telegram_chat_id))
  return { ok: true, avisos: terminales.map(x => ({
    id_comando: x.id_comando, telegram_chat_id: x.telegram_chat_id,
    distrito: x.distrito || '', proceso: x.proceso || '', estado: estadoComando(x.estado),
    resultado: x.resultado || '', pc: x.pc_ejecutora || ''
  })) }
}

async function sapMarcarNotificado(admin, payload) {
  const id = clean(payload.id_comando)
  if (!id) throw new Error('Falta id_comando.')
  const { data, error } = await admin.from('comandos_sap').update({
    telegram_notificado: true, telegram_notificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString()
  }).eq('id_comando', id).select('id_comando').maybeSingle()
  if (error) throw new Error(`No se pudo marcar COMANDOS_SAP: ${error.message}`)
  if (!data) throw new Error(`No se encontró el comando ${id}.`)
  return { ok: true, id_comando: id }
}

async function traspasosCambios(admin) {
  const { data: avisos, error } = await admin.from('qiora_traspasos_avisos').select(
    'folio_control,destino,estado,error,telegram_notificado,telegram_notificado_en'
  ).eq('telegram_notificado', false).limit(200)
  if (error) throw new Error(`QIORA_TRASPASOS_AVISOS: ${error.message}`)
  const out = []
  for (const aviso of (avisos || [])) {
    const folio = clean(aviso.folio_control)
    if (!folio) continue
    const { data: t, error: traspasoError } = await admin.from('qiora_traspasos').select(
      'folio_control,folio_sap,distrito,origen,destino,solicitado_por,orden_servicio,estado,materiales,detalle_error,documento_sap,mensaje_sap,tecnico_origen,tecnico_destino'
    ).eq('folio_control', folio).limit(1).maybeSingle()
    if (traspasoError) throw new Error(`QIORA_TRASPASOS ${folio}: ${traspasoError.message}`)
    if (!t) continue
    const estadoRaw = norm(t.estado || aviso.estado)
    const estado = ['COMPLETADO', 'REALIZADO'].includes(estadoRaw) ? 'REALIZADO' :
      ['ERROR', 'NO REALIZADO', 'RECHAZADO'].includes(estadoRaw) ? 'NO REALIZADO' : ''
    if (!estado) continue

    const candidatos = [aviso.destino, t.tecnico_destino, t.destino, t.solicitado_por, t.tecnico_origen, t.origen]
      .map(clean).filter(Boolean)
    let chat = ''
    if (candidatos.length) {
      const { data: usuarios, error: userError } = await admin.from('almacen_usuarios')
        .select('usuario_almacen,telegram_chat_id,activo').eq('distrito', t.distrito).eq('activo', true)
        .in('usuario_almacen', [...new Set(candidatos)])
      if (userError) throw new Error(`Destinatarios del traspaso ${folio}: ${userError.message}`)
      const mapa = new Map((usuarios || []).map(x => [upper(x.usuario_almacen), clean(x.telegram_chat_id)]))
      for (const candidato of candidatos) { const found = mapa.get(upper(candidato)); if (found) { chat = found; break } }
    }
    if (!chat) continue
    out.push({
      distrito: t.distrito || '', folio: t.folio_sap || folio, folio_control: folio,
      usuario: t.solicitado_por || '', estado,
      resultado: t.detalle_error || t.mensaje_sap || aviso.error || '',
      documento_sap: t.documento_sap || t.folio_sap || '',
      origen: t.origen || '', destino: t.destino || aviso.destino || '',
      materiales: Array.isArray(t.materiales) ? t.materiales : [], telegram_chat_id: chat
    })
  }
  return { ok: true, avisos: out }
}

async function traspasoMarcarNotificado(admin, payload) {
  const folio = clean(payload.folio_control)
  if (!folio) throw new Error('Falta folio_control.')
  const { data, error } = await admin.from('qiora_traspasos_avisos').update({
    telegram_notificado: true, telegram_notificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString()
  }).eq('folio_control', folio).select('folio_control')
  if (error) throw new Error(`No se pudo marcar aviso de traspaso: ${error.message}`)
  return { ok: true, marcadas: data?.length || 0 }
}

async function programadas(admin) {
  const { mmdd, dia } = fechaLocalMX()
  const { data: usuarios, error } = await admin.from('almacen_usuarios').select(
    'usuario_almacen,nombre,distrito,telegram_chat_id,fecha_nacimiento,activo,notificaciones_activas'
  ).eq('activo', true).eq('distrito', 'MG13').not('telegram_chat_id', 'is', null).not('fecha_nacimiento', 'is', null)
  if (error) throw new Error(`Cumpleaños programados: ${error.message}`)
  const pendientes = []
  for (const p of (usuarios || [])) {
    if (p.notificaciones_activas === false) continue
    const fecha = clean(p.fecha_nacimiento)
    if (fecha.slice(5, 10) !== mmdd) continue
    const identidad = norm(p.nombre || p.usuario_almacen).replace(/[^A-Z0-9]/g, '')
    if (!identidad) continue
    const clave = `CUMPLEANOS|MG13|${identidad}|${dia}`
    pendientes.push({ clave, distrito: 'MG13', telegram_chat_id: clean(p.telegram_chat_id), tipo: 'CUMPLEANOS', imagen: 'cumpleanos_qiora.png', mensaje: `FELIZ CUMPLEAÑOS, ${p.nombre || p.usuario_almacen}!\n\nQue tengas un excelente día. Muchas felicidades de parte de QIORA.` })
  }
  if (pendientes.length) {
    const { error: insertError } = await admin.from('qiora_telegram_notificaciones').upsert(
      pendientes.map(x => ({ ...x, estado: 'PENDIENTE' })), { onConflict: 'clave', ignoreDuplicates: true }
    )
    if (insertError) throw new Error(`Guardar cumpleaños pendientes: ${insertError.message}`)
  }
  const { data, error: readError } = await admin.from('qiora_telegram_notificaciones').select(
    'clave,distrito,telegram_chat_id,tipo,imagen,mensaje'
  ).eq('estado', 'PENDIENTE').order('creado_en', { ascending: true }).limit(100)
  if (readError) throw new Error(`Leer notificaciones programadas: ${readError.message}`)
  return { ok: true, avisos: data || [] }
}

async function notificacionMarcar(admin, payload) {
  const clave = clean(payload.clave)
  if (!clave) throw new Error('Falta clave de notificación.')
  const { data, error } = await admin.from('qiora_telegram_notificaciones').update({
    estado: 'ENVIADO', enviado_en: new Date().toISOString()
  }).eq('clave', clave).eq('estado', 'PENDIENTE').select('clave').maybeSingle()
  if (error) throw new Error(`Marcar notificación: ${error.message}`)
  return { ok: true, marcada: Boolean(data) }
}

async function trasladosActivosAvisos(admin) {
  const { data, error } = await admin.from('qiora_telegram_notificaciones').select(
    'clave,distrito,telegram_chat_id,mensaje'
  ).eq('tipo', 'TRASLADO_ACTIVO').eq('estado', 'PENDIENTE').order('creado_en', { ascending: true }).limit(100)
  if (error) throw new Error(`Avisos de traslados activos: ${error.message}`)
  return { ok: true, avisos: (data || []).map(x => ({ clave: x.clave, distrito: x.distrito, telegram_chat_id: x.telegram_chat_id, mensaje: x.mensaje })) }
}

async function trasladosActivosMarcar(admin, payload) {
  const clave = clean(payload.clave)
  const distrito = upper(payload.distrito)
  if (!clave || !distrito) throw new Error('Falta distrito o clave del traslado activo.')
  const { data, error } = await admin.from('qiora_telegram_notificaciones').update({
    estado: 'ENVIADO', enviado_en: new Date().toISOString()
  }).eq('clave', clave).eq('distrito', distrito).eq('tipo', 'TRASLADO_ACTIVO').eq('estado', 'PENDIENTE').select('clave').maybeSingle()
  if (error) throw new Error(`Marcar traslado activo: ${error.message}`)
  return { ok: true, marcada: Boolean(data) }
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action).toLowerCase()
  if (accion === 'telegram_registrar') return registrarTelegram(admin, payload)
  if (accion === 'telegram_mi_perfil' || accion === 'telegram_mi_almacen') {
    const perfil = await consultarMiPerfil(admin, payload)
    return { ok: true, perfil, mensaje: textoMiPerfil(perfil) }
  }

  if (accion === 'telegram_config_permiso' || accion === 'telegram_sap_permiso') {
    const p = await perfilTelegram(admin, payload.telegram_chat_id)
    if (!p) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a un usuario activo de SAT.' }
    return {
      ok: true, permitido: esAdmin(p) || p.puesto === 'COORDINADOR',
      usuario: p.usuario_almacen || '', nombre: p.nombre || '', puesto: p.puesto || '',
      distrito: p.distrito || '', permisos: p, administrar_permisos: Boolean(p.administrar_permisos)
    }
  }

  // Endpoints internos del proceso Node: se autentican con QIORA_BOT_API_KEY.
  if (accion === 'telegram_sap_notificaciones') return sapNotificaciones(admin)
  if (accion === 'telegram_sap_marcar_notificado') return sapMarcarNotificado(admin, payload)
  if (accion === 'telegram_traspasos_cambios') return traspasosCambios(admin)
  if (accion === 'telegram_traspaso_marcar_notificado') return traspasoMarcarNotificado(admin, payload)
  if (accion === 'telegram_notificaciones_programadas') return programadas(admin)
  if (accion === 'telegram_notificacion_marcar') return notificacionMarcar(admin, payload)
  if (accion === 'telegram_traslados_activos_avisos') return trasladosActivosAvisos(admin)
  if (accion === 'telegram_traslados_activos_marcar') return trasladosActivosMarcar(admin, payload)

  return null
}

export async function POST(request) {
  try {
    if (!verificarBot(request)) return json({ ok: false, error: 'Bot no autorizado.' }, 401)
    let payload
    try { payload = await request.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }
    const accion = clean(payload?.accion || payload?.action)
    if (!accion) return json({ ok: false, error: 'Falta accion.' }, 400)
    const admin = supabaseAdmin()
    const directo = await accionMigrada(admin, payload)
    if (directo) return json(directo, directo.ok === false ? 400 : 200)
    return json({
      ok: false,
      error: `La acción ${accion} todavía no está migrada directamente a SAT/Supabase.`,
      codigo: 'ACCION_PENDIENTE_MIGRACION'
    }, 501)
  } catch (e) {
    console.error('[SAT BOT API]', e?.message || 'Error interno')
    return json({ ok: false, error: e?.message || 'Error interno SAT.' }, 500)
  }
}
