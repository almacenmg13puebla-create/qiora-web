
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createCipheriv, randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (message, status = 400) =>
  NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: { 'Cache-Control': 'no-store' }
    }
  )

async function authPadre(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !pub || !secret) {
    throw Object.assign(
      new Error('Faltan variables de Supabase'),
      { status: 503 }
    )
  }

  const jwt = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')

  if (!jwt) {
    throw Object.assign(
      new Error('Inicia sesión'),
      { status: 401 }
    )
  }

  const client = createClient(url, pub, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  const {
    data: { user },
    error: ae
  } = await client.auth.getUser(jwt)

  if (ae || !user) {
    throw Object.assign(
      new Error('Sesión inválida'),
      { status: 401 }
    )
  }

  const admin = createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  const {
    data: actor,
    error: pe
  } = await admin
    .from('almacen_usuarios')
    .select('puesto,activo')
    .eq('auth_user_id', user.id)
    .eq('activo', true)
    .maybeSingle()

  if (
    pe ||
    String(actor?.puesto || '').trim().toUpperCase() !== 'ADMIN_PADRE'
  ) {
    throw Object.assign(
      new Error('Solo ADMIN_PADRE puede configurar Telegram'),
      { status: 403 }
    )
  }

  return { admin, user }
}

function cipherToken(value) {
  const hex = process.env.QIORA_TELEGRAM_ENCRYPTION_KEY || ''

  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw Object.assign(
      new Error('Configura QIORA_TELEGRAM_ENCRYPTION_KEY en Vercel (64 caracteres hexadecimales)'),
      { status: 503 }
    )
  }

  const iv = randomBytes(12)

  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(hex, 'hex'),
    iv
  )

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ])

  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64')
  ].join('.')
}

export async function GET(request) {
  try {
    const { admin } = await authPadre(request)

    const { data, error } = await admin
      .from('qiora_distritos_telegram')
      .select('centro,chat_traspasos,token_cifrado')

    if (error) throw error

    const distritos = {}

    for (const r of data || []) {
      distritos[r.centro] = {
        chat_traspasos: r.chat_traspasos || '',
        tiene_token_traspasos: !!r.token_cifrado
      }
    }

    return NextResponse.json(
      { ok: true, distritos },
      {
        headers: { 'Cache-Control': 'no-store' }
      }
    )

  } catch (e) {
    return fail(
      e.message || 'Error de consulta',
      e.status || 500
    )
  }
}

export async function POST(request) {
  try {
    const { admin } = await authPadre(request)

    const body = await request.json()

    const centro = String(body.centro || '')
      .trim()
      .toUpperCase()

    const token = String(body.token_traspasos || '').trim()
    const chat = String(body.chat_traspasos || '').trim()

    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)) {
      return fail('Centro inválido')
    }

    if (token && !/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return fail('Formato de TOKEN_TRASPASOS inválido')
    }

    // CORRECCIÓN:
    // Acepta grupos normales (-5341996130)
    // y supergrupos (-1001234567890).
    if (chat && !/^-[1-9]\d{0,19}$/.test(chat)) {
      return fail(
        'CHAT_TRASPASOS debe ser un ID numérico negativo de Telegram'
      )
    }

    if (!token && !chat) {
      return fail('Capture un token o chat para guardar')
    }

    const {
      data: existing,
      error: ex
    } = await admin
      .from('qiora_distritos_telegram')
      .select('centro,chat_traspasos,token_cifrado')
      .eq('centro', centro)
      .maybeSingle()

    if (ex) throw ex

    const {
      data: parent,
      error: p
    } = await admin
      .from('distritos')
      .select('codigo')
      .eq('codigo', centro)
      .maybeSingle()

    if (p) throw p

    if (!parent) {
      return fail('El centro no existe en public.distritos', 404)
    }

    const payload = {
      centro,
      chat_traspasos: chat || existing?.chat_traspasos || null
    }

    if (token) {
      payload.token_cifrado = cipherToken(token)
    } else if (!existing?.token_cifrado) {
      return fail('Primero capture TOKEN_TRASPASOS')
    }

    const { error } = await admin
      .from('qiora_distritos_telegram')
      .upsert(payload, { onConflict: 'centro' })

    if (error) throw error

    return NextResponse.json(
      {
        ok: true,
        centro,
        chat_traspasos: payload.chat_traspasos,
        tiene_token_traspasos: true
      },
      {
        headers: { 'Cache-Control': 'no-store' }
      }
    )

  } catch (e) {
    return fail(
      e.message || 'Error al guardar',
      e.status || 500
    )
  }
}
