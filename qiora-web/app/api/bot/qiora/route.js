import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()

function verificarBot(request) {
  const expected = clean(process.env.QIORA_BOT_API_KEY)
  const received = clean(request.headers.get('x-qiora-bot-key'))
  return Boolean(expected && received && expected === received)
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
  const { data, error } = await admin.from('almacen_usuarios').select('*').eq('telegram_chat_id', id).eq('activo', true).limit(1).maybeSingle()
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
  const existing = await perfilTelegram(admin, chatId)
  if (existing) return { ok: true, registrado: true, ya_registrado: true, usuario: existing.usuario_almacen, nombre: existing.nombre || '', distrito: existing.distrito, puesto: existing.puesto || '', mensaje: `Tu cuenta ya está vinculada.\nUsuario: ${existing.usuario_almacen}\nDistrito: ${existing.distrito}\nPuesto: ${existing.puesto || 'No indicado'}` }

  const distrito = upper(payload.distrito)
  const usuario = upper(payload.usuario_almacen)
  const clave = String(payload.clave ?? '')
  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return { ok: false, error: 'Distrito inválido.' }
  if (!/^[A-Z0-9_-]{2,10}$/.test(usuario)) return { ok: false, error: 'Usuario o almacén inválido.' }
  if (!clave || clave.length > 256) return { ok: false, error: 'Introduce tu contraseña personal de SAT.' }

  const { data: profile, error: profileError } = await admin.from('almacen_usuarios').select('id,usuario_almacen,distrito,nombre,puesto,activo,auth_user_id,telegram_chat_id').eq('usuario_almacen', usuario).eq('distrito', distrito).eq('activo', true).limit(1).maybeSingle()
  if (profileError) throw new Error(profileError.message)
  if (!profile?.auth_user_id) return { ok: false, error: 'No existe un usuario activo con esos datos en SAT.' }
  if (clean(profile.telegram_chat_id)) return { ok: false, error: 'Este usuario ya está vinculado a otra cuenta de Telegram.' }

  const auth = supabaseAuthClient()
  const { data: login, error: loginError } = await auth.auth.signInWithPassword({ email: `${usuario.toLowerCase()}@qiora.local`, password: `QIORA#${clave}` })
  if (loginError || !login?.user?.id) return { ok: false, error: 'Contraseña incorrecta. Verifica tus datos de SAT.' }
  const authId = String(login.user.id).toLowerCase()
  await auth.auth.signOut().catch(() => {})
  if (authId !== String(profile.auth_user_id).toLowerCase()) return { ok: false, error: 'La cuenta autenticada no corresponde al usuario indicado.' }

  const { data: occupied, error: occupiedError } = await admin.from('almacen_usuarios').select('id').eq('telegram_chat_id', chatId).limit(1).maybeSingle()
  if (occupiedError) throw new Error(occupiedError.message)
  if (occupied) return { ok: false, error: 'Esta cuenta de Telegram ya está vinculada a otro usuario SAT.' }

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await admin.from('almacen_usuarios').update({ telegram_chat_id: chatId, bot_confirmado: true, fecha_confirmacion_bot: now, actualizado_en: now }).eq('id', profile.id).eq('activo', true).is('telegram_chat_id', null).select('usuario_almacen,distrito,nombre,puesto,telegram_chat_id').maybeSingle()
  if (updateError) throw new Error(updateError.message)
  if (!updated) return { ok: false, error: 'No se pudo completar el vínculo. La cuenta pudo cambiar durante el registro.' }
  return { ok: true, registrado: true, usuario: updated.usuario_almacen, distrito: updated.distrito, nombre: updated.nombre || '', puesto: updated.puesto || '', mensaje: `Registro completado.\nUsuario: ${usuario}\nDistrito: ${distrito}\nPuesto: ${updated.puesto || 'No indicado'}` }
}

async function sapNotificaciones(admin) {
  const { data, error } = await admin.from('comandos_sap').select('id_comando,distrito,usuario_solicita,telegram_chat_id,proceso,parametro,estado,resultado,resultado_mac,documento_sap,pc_ejecutora,fecha_fin').eq('telegram_notificado', false).not('telegram_chat_id', 'is', null).order('fecha_solicitud', { ascending: true }).limit(100)
  if (error) throw new Error(error.message)
  return { ok: true, avisos: (data || []).map(x => ({ ...x, pc: x.pc_ejecutora, resultado: x.resultado || x.resultado_mac })) }
}

async function marcarSap(admin, payload) {
  const id = clean(payload.id_comando)
  if (!id) return { ok: false, error: 'Falta id_comando.' }
  const { data, error } = await admin.from('comandos_sap').update({ telegram_notificado: true, telegram_notificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }).eq('id_comando', id).eq('telegram_notificado', false).select('id_comando').maybeSingle()
  if (error) throw new Error(error.message)
  return { ok: true, marcado: Boolean(data) }
}

async function traspasosCambios(admin) {
  const { data: avisos, error } = await admin.from('qiora_traspasos_avisos').select('folio_control,destino,estado,error,actualizado_en').eq('telegram_notificado', false).order('actualizado_en', { ascending: true }).limit(100)
  if (error) throw new Error(error.message)
  const out = []
  for (const aviso of avisos || []) {
    const { data: transfer, error: transferError } = await admin.from('qiora_traspasos').select('folio_control,folio_sap,distrito,origen,destino,solicitado_por,estado,materiales,documento_sap,mensaje_sap,tecnico_origen,tecnico_destino').eq('folio_control', aviso.folio_control).limit(1).maybeSingle()
    if (transferError) throw new Error(transferError.message)
    if (!transfer) continue
    const { data: recipients, error: recipientError } = await admin.from('almacen_usuarios').select('telegram_chat_id,usuario_almacen,nombre,notificaciones_activas,activo').eq('activo', true).eq('distrito', transfer.distrito).eq('usuario_almacen', clean(aviso.destino || transfer.destino)).not('telegram_chat_id', 'is', null)
    if (recipientError) throw new Error(recipientError.message)
    for (const recipient of recipients || []) {
      if (recipient.notificaciones_activas === false || !recipient.telegram_chat_id) continue
      out.push({ ...transfer, folio: transfer.folio_sap || transfer.folio_control, folio_control: transfer.folio_control, resultado: aviso.error || transfer.mensaje_sap || '', telegram_chat_id: recipient.telegram_chat_id })
    }
  }
  return { ok: true, avisos: out }
}

async function marcarTraspaso(admin, payload) {
  const folio = clean(payload.folio_control)
  if (!folio) return { ok: false, error: 'Falta folio_control.' }
  const { data, error } = await admin.from('qiora_traspasos_avisos').update({ telegram_notificado: true, telegram_notificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }).eq('folio_control', folio).eq('telegram_notificado', false).select('folio_control').maybeSingle()
  if (error) throw new Error(error.message)
  return { ok: true, marcado: Boolean(data) }
}

async function entradasPendientes(admin) {
  const { data: rows, error } = await admin.from('equipos_entrada_pendiente').select('id,serie,distrito,almacen,estatus,actualizado_en').eq('telegram_notificado', false).order('actualizado_en', { ascending: true }).limit(200)
  if (error) throw new Error(error.message)
  const out = []
  for (const row of rows || []) {
    const { data: users, error: usersError } = await admin.from('almacen_usuarios').select('telegram_chat_id,usuario_almacen,nombre,notificaciones_activas').eq('activo', true).eq('distrito', row.distrito).eq('usuario_almacen', row.almacen).not('telegram_chat_id', 'is', null)
    if (usersError) throw new Error(usersError.message)
    for (const user of users || []) {
      if (user.notificaciones_activas === false || !user.telegram_chat_id) continue
      out.push({ id: row.id, clave: String(row.id), serie: row.serie, distrito: row.distrito, almacen: row.almacen, telegram_chat_id: user.telegram_chat_id, mensaje: `ENTRADA PENDIENTE\nDistrito: ${row.distrito}\nAlmacén: ${row.almacen}\nSerie: ${row.serie}\nEstatus: ${row.estatus || 'PENDIENTE'}` })
    }
  }
  return { ok: true, avisos: out }
}

async function marcarEntrada(admin, payload) {
  const id = Number(payload.clave || payload.id)
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'Identificador de entrada inválido.' }
  const { data, error } = await admin.from('equipos_entrada_pendiente').update({ telegram_notificado: true, telegram_notificado_en: new Date().toISOString() }).eq('id', id).eq('telegram_notificado', false).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return { ok: true, marcado: Boolean(data) }
}


// ======================================================
// NOTIFICACIONES PROGRAMADAS DE TELEGRAM
// Lee únicamente avisos cuya fecha ya llegó y cuyo estado
// sigue PENDIENTE. El bot marca cada aviso tras procesarlo.
// ======================================================
async function notificacionesProgramadas(admin) {
  const ahora = new Date().toISOString()
  const { data, error } = await admin
    .from('qiora_telegram_notificaciones')
    .select('id,clave,telegram_chat_id,distrito,tipo,mensaje,fecha_programada')
    .eq('estado', 'PENDIENTE')
    .lte('fecha_programada', ahora)
    .order('fecha_programada', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)

  const avisos = []
  for (const aviso of data || []) {
    // Validar que el destinatario siga activo y permita notificaciones.
    const { data: usuario, error: usuarioError } = await admin
      .from('almacen_usuarios')
      .select('telegram_chat_id,activo,notificaciones_activas,distrito')
      .eq('telegram_chat_id', clean(aviso.telegram_chat_id))
      .eq('activo', true)
      .limit(1)
      .maybeSingle()

    if (usuarioError) throw new Error(usuarioError.message)
    if (!usuario || usuario.notificaciones_activas === false) continue
    if (clean(aviso.distrito) && upper(usuario.distrito) !== upper(aviso.distrito)) continue

    avisos.push({
      clave: aviso.clave,
      telegram_chat_id: usuario.telegram_chat_id,
      distrito: aviso.distrito || usuario.distrito || '',
      tipo: aviso.tipo,
      mensaje: aviso.mensaje || '',
      fecha_programada: aviso.fecha_programada,
    })
  }

  return { ok: true, avisos }
}

async function marcarNotificacionProgramada(admin, payload) {
  const clave = clean(payload.clave)
  if (!clave) return { ok: false, error: 'Falta la clave de la notificación.' }

  const { data, error } = await admin
    .from('qiora_telegram_notificaciones')
    .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString() })
    .eq('clave', clave)
    .eq('estado', 'PENDIENTE')
    .select('id,clave,estado,enviado_en')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return { ok: true, marcado: Boolean(data), notificacion: data || null }
}

// Busca almacenes o tecnicos activos exclusivamente dentro del distrito
// del usuario autenticado en Telegram. El cliente no puede elegir otro distrito.
async function buscarAlmacenTraspaso(admin, payload) {
  const chatId = clean(payload.telegram_chat_id)
  const perfil = await perfilTelegram(admin, chatId)
  if (!perfil) {
    return { ok: false, error: 'Telegram no esta vinculado a un usuario activo de SAT.' }
  }

  const distrito = clean(perfil.distrito)
  if (!distrito) {
    return { ok: false, error: 'El usuario no tiene distrito asignado en SAT.' }
  }

  const consulta = clean(payload.almacen)
  if (consulta.length < 2 || consulta.length > 80) {
    return { ok: false, error: 'Escribe al menos 2 caracteres del almacen o tecnico.' }
  }

  // Se consultan usuario_almacen y nombre por separado para evitar construir
  // expresiones .or() con texto libre del usuario.
  const patron = `%${consulta.replace(/[%_,]/g, ' ')}%`
  const columnas = 'usuario_almacen,nombre,distrito,puesto'
  const base = () => admin.from('almacen_usuarios')
    .select(columnas)
    .eq('activo', true)
    .eq('distrito', distrito)

  const [porAlmacen, porNombre] = await Promise.all([
    base().ilike('usuario_almacen', patron).limit(20),
    base().ilike('nombre', patron).limit(20),
  ])

  if (porAlmacen.error) throw new Error(porAlmacen.error.message)
  if (porNombre.error) throw new Error(porNombre.error.message)

  const unicos = new Map()
  for (const fila of [...(porAlmacen.data || []), ...(porNombre.data || [])]) {
    const almacen = clean(fila.usuario_almacen)
    if (!almacen) continue
    unicos.set(almacen, {
      almacen,
      nombre: clean(fila.nombre) || almacen,
    })
  }

  const encontrados = [...unicos.values()].slice(0, 20)
  return {
    ok: true,
    distrito,
    encontrados,
    mensaje: encontrados.length
      ? `${encontrados.length} coincidencia(s) encontradas en ${distrito}.`
      : `No se encontraron almacenes o tecnicos en ${distrito} con ese criterio.`,
  }
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)
  if (accion === 'telegram_registrar') return registrarTelegram(admin, payload)
  if (accion === 'telegram_sap_notificaciones') return sapNotificaciones(admin)
  if (accion === 'telegram_sap_marcar_notificado') return marcarSap(admin, payload)
  if (accion === 'telegram_traspasos_cambios') return traspasosCambios(admin)
  if (accion === 'telegram_traspaso_marcar_notificado') return marcarTraspaso(admin, payload)
  if (accion === 'telegram_traslados_activos_avisos') return entradasPendientes(admin)
  if (accion === 'telegram_traslados_activos_marcar') return marcarEntrada(admin, payload)
  if (accion === 'telegram_notificaciones_programadas') return notificacionesProgramadas(admin)
  if (accion === 'telegram_notificacion_marcar') return marcarNotificacionProgramada(admin, payload)
  if (accion === 'telegram_traspaso_nombre_almacen') return buscarAlmacenTraspaso(admin, payload)

  const perfil = await perfilTelegram(admin, payload.telegram_chat_id)
  if (accion === 'telegram_config_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a un usuario activo de SAT.' }
    return { ok: true, permitido: esAdmin(perfil), usuario: perfil.usuario_almacen || '', nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '', permisos: perfil, administrar_permisos: Boolean(perfil.administrar_permisos) }
  }
  if (accion === 'telegram_sap_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a SAT.' }
    return { ok: true, permitido: esAdmin(perfil), usuario: perfil.usuario_almacen || '', nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '' }
  }
  if (accion === 'telegram_mi_perfil') {
    if (!perfil) return { ok: false, registrado: false, error: 'Usuario no registrado o inactivo.' }
    return { ok: true, registrado: true, usuario: perfil.usuario_almacen, nombre: perfil.nombre || '', puesto: perfil.puesto || '', distrito: perfil.distrito || '', permisos: perfil }
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
    const result = await accionMigrada(admin, payload)
    if (result) return json(result, result.ok === false ? 400 : 200)
    return json({ ok: false, error: `La acción ${accion} todavía no está migrada directamente a SAT/Supabase.`, codigo: 'ACCION_PENDIENTE_MIGRACION' }, 501)
  } catch (error) {
    console.error('[SAT BOT API]', error?.message || 'Error interno')
    return json({ ok: false, error: error?.message || 'Error interno SAT.' }, 500)
  }
}
