
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    throw new Error('Variables Supabase incompletas en Vercel.')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function supabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en Vercel.'
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

// ======================================================
// PERFIL DE TELEGRAM
// ======================================================

async function perfilTelegram(admin, chatId) {
  const id = clean(chatId)

  if (!id) return null

  const { data, error } = await admin
    .from('almacen_usuarios')
    .select('*')
    .eq('telegram_chat_id', id)
    .eq('activo', true)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return data || null
}

function esAdmin(p) {
  const puesto = upper(p?.puesto)

  return (
    puesto === 'ADMIN_PADRE' ||
    puesto === 'ADMIN' ||
    puesto === 'ADMINISTRADOR' ||
    puesto === 'ALMACENISTA' ||
    puesto.startsWith('ADMIN_')
  )
}

// ======================================================
// REGISTRO TELEGRAM
// ======================================================

async function registrarTelegram(admin, payload) {
  const chatId = clean(payload.telegram_chat_id)

  if (!/^\d{5,20}$/.test(chatId)) {
    return {
      ok: false,
      error: 'No se pudo identificar tu cuenta de Telegram.',
    }
  }

  // PRIMERO: comprobar si Telegram ya está vinculado.
  // Si existe, nunca solicitar nuevamente la contraseña.

  const existente = await perfilTelegram(admin, chatId)

  if (existente) {
    return {
      ok: true,
      registrado: true,
      ya_registrado: true,
      mensaje:
        `Tu cuenta ya está vinculada.\n` +
        `Usuario: ${existente.usuario_almacen}\n` +
        `Distrito: ${existente.distrito}\n` +
        `Puesto: ${existente.puesto || 'No indicado'}`,
      usuario: existente.usuario_almacen,
      nombre: existente.nombre || '',
      distrito: existente.distrito,
      puesto: existente.puesto || '',
    }
  }

  // Solamente usuarios sin Telegram vinculado continúan.

  const distrito = upper(payload.distrito)
  const usuario = upper(payload.usuario_almacen)
  const clave = String(payload.clave ?? '')

  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) {
    return {
      ok: false,
      error: 'Distrito inválido.',
    }
  }

  if (!/^[A-Z0-9_-]{2,10}$/.test(usuario)) {
    return {
      ok: false,
      error: 'Número de usuario o almacén inválido.',
    }
  }

  if (!clave || clave.length > 256) {
    return {
      ok: false,
      error: 'Introduce tu contraseña personal de SAT.',
    }
  }

  // Buscar usuario y distrito en SAT.

  const { data: perfil, error: perfilError } = await admin
    .from('almacen_usuarios')
    .select(
      'id,usuario_almacen,distrito,nombre,puesto,activo,auth_user_id,telegram_chat_id'
    )
    .eq('usuario_almacen', usuario)
    .eq('distrito', distrito)
    .eq('activo', true)
    .limit(1)
    .maybeSingle()

  if (perfilError) throw new Error(perfilError.message)

  if (!perfil || !perfil.auth_user_id) {
    return {
      ok: false,
      error: 'No existe un usuario activo con esos datos en SAT.',
    }
  }

  // Rechazar si pertenece a otro Telegram.

  if (clean(perfil.telegram_chat_id)) {
    return {
      ok: false,
      error:
        'Este usuario ya está vinculado a otra cuenta de Telegram. Solicita apoyo al administrador de SAT.',
    }
  }

  // Validar contraseña con el mecanismo del login web.

  const auth = supabaseAuthClient()

  const { data: login, error: loginError } =
    await auth.auth.signInWithPassword({
      email: `${usuario.toLowerCase()}@qiora.local`,
      password: `QIORA#${clave}`,
    })

  if (loginError || !login?.user?.id) {
    return {
      ok: false,
      error: 'Contraseña incorrecta. Verifica tus datos de SAT.',
    }
  }

  const authId = String(login.user.id).toLowerCase()

  await auth.auth.signOut().catch(() => {})

  if (
    authId !==
    String(perfil.auth_user_id).toLowerCase()
  ) {
    return {
      ok: false,
      error:
        'La cuenta autenticada no corresponde al usuario indicado en SAT.',
    }
  }

  // Comprobar que el Telegram no esté vinculado a otro usuario.

  const { data: ocupado, error: ocupadoError } = await admin
    .from('almacen_usuarios')
    .select('id,usuario_almacen,distrito')
    .eq('telegram_chat_id', chatId)
    .limit(1)
    .maybeSingle()

  if (ocupadoError) throw new Error(ocupadoError.message)

  if (ocupado) {
    return {
      ok: false,
      error:
        'Esta cuenta de Telegram ya está vinculada a otro usuario SAT.',
    }
  }

  // Vinculación protegida contra modificaciones concurrentes.

  const ahora = new Date().toISOString()

  const { data: actualizado, error: updateError } = await admin
    .from('almacen_usuarios')
    .update({
      telegram_chat_id: chatId,
      bot_confirmado: true,
      fecha_confirmacion_bot: ahora,
      actualizado_en: ahora,
    })
    .eq('id', perfil.id)
    .eq('activo', true)
    .or('telegram_chat_id.is.null,telegram_chat_id.eq.')
    .select(
      'usuario_almacen,distrito,nombre,puesto,telegram_chat_id'
    )
    .maybeSingle()

  if (updateError) throw new Error(updateError.message)

  if (!actualizado) {
    return {
      ok: false,
      error:
        'No se pudo completar el vínculo. La cuenta pudo cambiar durante el registro.',
    }
  }

  return {
    ok: true,
    registrado: true,
    ya_registrado: false,
    mensaje:
      `Registro completado.\n` +
      `Usuario: ${usuario}\n` +
      `Distrito: ${distrito}\n` +
      `Puesto: ${perfil.puesto || 'No indicado'}`,
    usuario: actualizado.usuario_almacen,
    distrito: actualizado.distrito,
    puesto: actualizado.puesto || '',
    nombre: actualizado.nombre || '',
  }
}

// ======================================================
// ACCIONES MIGRADAS
// ======================================================

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)

  if (accion === 'telegram_registrar') {
    return registrarTelegram(admin, payload)
  }

  const perfil = await perfilTelegram(
    admin,
    payload.telegram_chat_id
  )

  if (accion === 'telegram_config_permiso') {
    if (!perfil) {
      return {
        ok: true,
        permitido: false,
        registrado: false,
        mensaje:
          'Telegram no está vinculado a un usuario activo de SAT.',
      }
    }

    return {
      ok: true,
      permitido: true,
      registrado: true,
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
      permisos: perfil.permisos || {},
      administrar_permisos: Boolean(
        perfil.administrar_permisos
      ),
      perfil,
    }
  }

  if (accion === 'telegram_sap_permiso') {
    if (!perfil) {
      return {
        ok: true,
        permitido: false,
        registrado: false,
        mensaje: 'Telegram no está vinculado a SAT.',
      }
    }

    return {
      ok: true,
      permitido: true,
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
    }
  }

  if (accion === 'telegram_mi_perfil') {
    if (!perfil) {
      return {
        ok: false,
        registrado: false,
        error: 'Usuario no registrado o inactivo.',
      }
    }

    return {
      ok: true,
      registrado: true,
      usuario: perfil.usuario_almacen,
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
      permisos: perfil,
    }
  }

  return null
}

// ======================================================
// API POST
// ======================================================

export async function POST(request) {
  try {
    if (!verificarBot(request)) {
      return json({
        ok: false,
        error: 'Bot no autorizado.',
      }, 401)
    }

    let payload

    try {
      payload = await request.json()
    } catch {
      return json({
        ok: false,
        error: 'JSON inválido.',
      }, 400)
    }

    const accion = clean(
      payload?.accion || payload?.action
    )

    if (!accion) {
      return json({
        ok: false,
        error: 'Falta accion.',
      }, 400)
    }

    const admin = supabaseAdmin()

    const directo = await accionMigrada(admin, payload)

    if (directo) {
      return json(
        directo,
        directo.ok === false ? 400 : 200
      )
    }

    // No ejecutar acciones que todavía no están implementadas.
    // Se conserva el bloqueo para evitar operaciones inseguras.

    return json({
      ok: false,
      error:
        `La acción ${accion} todavía no está migrada directamente a SAT/Supabase.`,
      codigo: 'ACCION_PENDIENTE_MIGRACION',
    }, 501)

  } catch (e) {
    console.error(
      '[SAT BOT API]',
      e?.message || 'Error interno'
    )

    return json({
      ok: false,
      error: e?.message || 'Error interno SAT.',
    }, 500)
  }
}
