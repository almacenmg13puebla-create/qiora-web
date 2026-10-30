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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

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
  return puesto === 'ADMIN_PADRE' || puesto === 'ADMIN' ||
    puesto === 'ADMINISTRADOR' || puesto === 'ALMACENISTA' ||
    puesto.startsWith('ADMIN_')
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)
  const perfil = await perfilTelegram(admin, payload.telegram_chat_id)

  if (accion === 'telegram_config_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a un usuario activo de SAT.' }
    return {
      ok: true,
      permitido: esAdmin(perfil),
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
      permisos: perfil.permisos || {},
      administrar_permisos: Boolean(perfil.administrar_permisos),
    }
  }

  if (accion === 'telegram_sap_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a SAT.' }
    return {
      ok: true,
      permitido: esAdmin(perfil),
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
    }
  }

  return null
}

async function puenteLegacy(payload) {
  const legacy = clean(process.env.LEGACY_APPS_SCRIPT_URL)
  if (!legacy) {
    return {
      ok: false,
      error: 'Esta acción todavía no fue migrada a SAT y LEGACY_APPS_SCRIPT_URL no está configurada en Vercel.',
      codigo: 'ACCION_PENDIENTE_MIGRACION',
    }
  }

  const response = await fetch(legacy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Puente legacy HTTP ${response.status}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('El puente legacy devolvió una respuesta no JSON.')
  }
}

export async function POST(request) {
  try {
    if (!verificarBot(request)) return json({ ok: false, error: 'Bot no autorizado.' }, 401)

    let payload
    try { payload = await request.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }

    const accion = clean(payload?.accion || payload?.action)
    if (!accion) return json({ ok: false, error: 'Falta accion.' }, 400)

    const admin = supabaseAdmin()

    // FASE 1: identidad y permisos ya salen directamente de Supabase.
    const directo = await accionMigrada(admin, payload)
    if (directo) return json(directo)

    // FASE TRANSITORIA: las acciones aún no migradas pasan por SAT y
    // solamente SAT conoce la URL legacy. El bot de la PC nunca la recibe.
    const legacy = await puenteLegacy(payload)
    return json(legacy, legacy?.ok === false ? 400 : 200)
  } catch (e) {
    console.error('[SAT BOT API]', e)
    return json({ ok: false, error: e?.message || 'Error interno SAT.' }, 500)
  }
}
