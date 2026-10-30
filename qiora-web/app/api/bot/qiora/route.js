import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()

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
  if (!url || !key) throw new Error('Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en Vercel.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function perfilTelegram(admin, chatId) {
  const id = clean(chatId)
  if (!id) return null
  const { data, error } = await admin.from('almacen_usuarios').select('*')
    .eq('telegram_chat_id', id).eq('activo', true).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

function esAdmin(p) {
  const puesto = upper(p?.puesto)
  return puesto === 'ADMIN_PADRE' || puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' || puesto === 'ALMACENISTA' || puesto.startsWith('ADMIN_')
}

async function registrarTelegram(admin, payload) {
  const chatId = clean(payload.telegram_chat_id)
  if (!/^\d{5,20}$/.test(chatId)) return { ok: false, error: 'No se pudo identificar tu cuenta de Telegram.' }

  // Un Telegram ya vinculado y activo nunca vuelve a pedir contraseña.
  const existente = await perfilTelegram(admin, chatId)
  if (existente) return {
    ok: true, registrado: true, ya_registrado: true,
    mensaje: `Tu cuenta ya está vinculada.\nUsuario: ${existente.usuario_almacen}\nDistrito: ${existente.distrito}\nPuesto: ${existente.puesto || 'No indicado'}`,
    usuario: existente.usuario_almacen, nombre: existente.nombre || '',
    distrito: existente.distrito, puesto: existente.puesto || '',
  }

  const distrito = upper(payload.distrito)
  const usuario = upper(payload.usuario_almacen)
  const clave = String(payload.clave ?? '')
  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return { ok: false, error: 'Distrito inválido.' }
  if (!/^[A-Z0-9_-]{2,10}$/.test(usuario)) return { ok: false, error: 'Número de usuario o almacén inválido.' }
  if (!clave || clave.length > 256) return { ok: false, error: 'Introduce tu contraseña personal de SAT.' }

  const { data: perfil, error: perfilError } = await admin.from('almacen_usuarios')
    .select('id,usuario_almacen,distrito,nombre,puesto,activo,auth_user_id,telegram_chat_id')
    .eq('usuario_almacen', usuario).eq('distrito', distrito).eq('activo', true).limit(1).maybeSingle()
  if (perfilError) throw new Error(perfilError.message)
  if (!perfil || !perfil.auth_user_id) return { ok: false, error: 'No existe un usuario activo de SAT con ese distrito y número.' }
  if (clean(perfil.telegram_chat_id)) return { ok: false, error: 'Este usuario ya está vinculado a otra cuenta de Telegram. Solicita apoyo al administrador de SAT.' }

  const auth = supabaseAuthClient()
  const { data: login, error: loginError } = await auth.auth.signInWithPassword({
    email: `${usuario.toLowerCase()}@qiora.local`, password: `QIORA#${clave}`,
  })
  if (loginError || !login?.user?.id) return { ok: false, error: 'Contraseña incorrecta. Verifica tus datos de SAT.' }
  const authId = String(login.user.id).toLowerCase()
  await auth.auth.signOut().catch(() => {})
  if (authId !== String(perfil.auth_user_id).toLowerCase()) return { ok: false, error: 'La cuenta autenticada no corresponde al usuario indicado en SAT.' }

  const { data: ocupado, error: ocupadoError } = await admin.from('almacen_usuarios')
    .select('id').eq('telegram_chat_id', chatId).limit(1).maybeSingle()
  if (ocupadoError) throw new Error(ocupadoError.message)
  if (ocupado) return { ok: false, error: 'Esta cuenta de Telegram ya está vinculada a otro usuario SAT.' }

  const ahora = new Date().toISOString()
  const { data: actualizado, error: updateError } = await admin.from('almacen_usuarios').update({
    telegram_chat_id: chatId, bot_confirmado: true,
    fecha_confirmacion_bot: ahora, actualizado_en: ahora,
  }).eq('id', perfil.id).eq('activo', true).is('telegram_chat_id', null)
    .select('usuario_almacen,distrito,nombre,puesto,telegram_chat_id').maybeSingle()
  if (updateError) throw new Error(updateError.message)
  if (!actualizado) return { ok: false, error: 'No se pudo completar el vínculo; la cuenta pudo cambiar durante el registro.' }

  return {
    ok: true, registrado: true, ya_registrado: false,
    mensaje: `Registro completado.\nUsuario: ${usuario}\nDistrito: ${distrito}\nPuesto: ${actualizado.puesto || 'No indicado'}`,
    usuario: actualizado.usuario_almacen, distrito: actualizado.distrito,
    puesto: actualizado.puesto || '', nombre: actualizado.nombre || '',
  }
}

async function obtenerResultadosSAP(admin) {
  const { data, error } = await admin.from('comandos_sap').select(
    'id_comando,distrito,usuario_solicita,telegram_chat_id,proceso,parametro,estado,fecha_solicitud,fecha_inicio,fecha_fin,resultado,resultado_mac,documento_sap,intentos,pc_ejecutora,creado_en,actualizado_en'
  ).eq('telegram_notificado', false).not('telegram_chat_id', 'is', null)
    .order('fecha_solicitud', { ascending: true }).limit(100)
  if (error) throw new Error(error.message)
  return { ok: true, avisos: (data || []).map(x => ({
    ...x, pc: x.pc_ejecutora || '', resultado: x.resultado || x.resultado_mac || '',
  })) }
}

async function marcarResultadoSAP(admin, payload) {
  const id = clean(payload.id_comando)
  if (!id) return { ok: false, error: 'Falta id_comando.' }
  const { data, error } = await admin.from('comandos_sap').update({
    telegram_notificado: true, telegram_notificado_en: new Date().toISOString(),
  }).eq('id_comando', id).eq('telegram_notificado', false)
    .select('id_comando').maybeSingle()
  if (error) throw new Error(error.message)
  return { ok: true, marcado: Boolean(data), id_comando: id }
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)
  if (accion === 'telegram_registrar') return registrarTelegram(admin, payload)
  if (accion === 'telegram_sap_notificaciones') return obtenerResultadosSAP(admin)
  if (accion === 'telegram_sap_marcar_notificado') return marcarResultadoSAP(admin, payload)

  const perfil = await perfilTelegram(admin, payload.telegram_chat_id)
  if (accion === 'telegram_mi_perfil') {
    if (!perfil) return { ok: false, registrado: false, error: 'Usuario no registrado o inactivo.' }
    return { ok: true, registrado: true, usuario: perfil.usuario_almacen, nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '', permisos: perfil }
  }
  if (accion === 'telegram_config_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a un usuario activo de SAT.' }
    return { ok: true, permitido: esAdmin(perfil), usuario: perfil.usuario_almacen || '', nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '', permisos: perfil, administrar_permisos: Boolean(perfil.administrar_permisos) }
  }
  if (accion === 'telegram_sap_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a SAT.' }
    return { ok: true, permitido: esAdmin(perfil), usuario: perfil.usuario_almacen || '', nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '' }
  }
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
    if (directo !== null) return json(directo, directo.ok === false ? 400 : 200)
    return json({ ok: false, error: `La acción ${accion} todavía no está migrada directamente a SAT/Supabase.`, codigo: 'ACCION_PENDIENTE_MIGRACION' }, 501)
  } catch (e) {
    console.error('[SAT BOT API]', e?.message || 'Error interno')
    return json({ ok: false, error: e?.message || 'Error interno SAT.' }, 500)
  }
}
