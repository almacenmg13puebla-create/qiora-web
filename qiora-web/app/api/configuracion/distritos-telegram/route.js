import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createCipheriv, randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = value => String(value ?? '').trim()
const U = value => S(value).toUpperCase()

function respuesta(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })
}

function obtenerClientes() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY

  if (!url || !publicKey || !serviceKey) {
    throw new Error('Faltan variables de conexión de Supabase en Vercel.')
  }

  return {
    publicClient: createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    }),
    admin: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
}

async function validarAdminPadre(request, admin, publicClient) {
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Inicia sesión nuevamente.'), { status: 401 })
  }

  const token = authorization.slice(7).trim()
  const { data, error } = await publicClient.auth.getUser(token)
  const user = data?.user

  if (error || !user) {
    throw Object.assign(new Error('La sesión no es válida.'), { status: 401 })
  }

  const { data: perfil, error: perfilError } = await admin
    .from('almacen_usuarios')
    .select('puesto,activo')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (perfilError) throw perfilError

  if (
    !perfil ||
    perfil.activo !== true ||
    U(perfil.puesto) !== 'ADMIN_PADRE'
  ) {
    throw Object.assign(
      new Error('Solo ADMIN_PADRE puede administrar la configuración de Telegram.'),
      { status: 403 }
    )
  }

  return user
}

function cifrarTokenTelegram(token) {
  const hex = process.env.QIORA_TELEGRAM_ENCRYPTION_KEY || ''

  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw Object.assign(
      new Error('Falta configurar QIORA_TELEGRAM_ENCRYPTION_KEY en Vercel.'),
      { status: 503 }
    )
  }

  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('El token de Telegram no tiene un formato válido.')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv)
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()

  // Formato compatible con el descifrado de la API de traspasos:
  // ivBase64.tagBase64.contenidoCifradoBase64
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join('.')
}

function errorResponse(error) {
  console.error('[CONFIGURACION TELEGRAM DISTRITOS]', error)

  const status = Number(error?.status) || 500
  return respuesta({
    ok: false,
    error: S(error?.message) || 'Error interno al procesar Telegram.'
  }, status)
}

export async function GET(request) {
  try {
    const { publicClient, admin } = obtenerClientes()
    await validarAdminPadre(request, admin, publicClient)

    const { data, error } = await admin
      .from('qiora_distritos_telegram')
      .select('centro,token_cifrado,chat_traspasos')
      .order('centro', { ascending: true })

    if (error) throw error

    const distritos = {}
    for (const row of data || []) {
      const centro = U(row.centro)
      if (!centro) continue

      // Nunca se devuelve el token descifrado al navegador.
      distritos[centro] = {
        chat_traspasos: S(row.chat_traspasos),
        tiene_token: Boolean(row.token_cifrado)
      }
    }

    return respuesta({ ok: true, distritos })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request) {
  try {
    const { publicClient, admin } = obtenerClientes()
    await validarAdminPadre(request, admin, publicClient)

    let body
    try {
      body = await request.json()
    } catch {
      return respuesta({ ok: false, error: 'El cuerpo de la solicitud no contiene JSON válido.' }, 400)
    }

    const centro = U(body?.centro)
    const token = S(body?.token_traspasos)
    const chat = S(body?.chat_traspasos)

    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)) {
      return respuesta({ ok: false, error: 'Código de centro inválido.' }, 400)
    }

    if (chat && !/^-?[1-9]\d{0,19}$/.test(chat)) {
      return respuesta({ ok: false, error: 'El ID de CHAT_TRASPASOS debe ser numérico.' }, 400)
    }

    if (!token && !chat) {
      return respuesta({ ok: true, mensaje: 'No hubo cambios en la configuración de Telegram.' })
    }

    const { data: existente, error: buscarError } = await admin
      .from('qiora_distritos_telegram')
      .select('centro,token_cifrado,chat_traspasos')
      .eq('centro', centro)
      .maybeSingle()

    if (buscarError) throw buscarError

    const tokenCifrado = token
      ? cifrarTokenTelegram(token)
      : existente?.token_cifrado || null

    const chatFinal = chat || existente?.chat_traspasos || null

    if (!tokenCifrado) {
      return respuesta({
        ok: false,
        error: 'Captura el token del bot antes de guardar la configuración inicial.'
      }, 400)
    }

    const valores = {
      centro,
      token_cifrado: tokenCifrado,
      chat_traspasos: chatFinal
    }

    const resultado = existente
      ? await admin
          .from('qiora_distritos_telegram')
          .update(valores)
          .eq('centro', centro)
      : await admin
          .from('qiora_distritos_telegram')
          .insert(valores)

    if (resultado.error) throw resultado.error

    return respuesta({
      ok: true,
      mensaje: `Configuración de Telegram guardada para ${centro}.`
    })
  } catch (error) {
    return errorResponse(error)
  }
}
