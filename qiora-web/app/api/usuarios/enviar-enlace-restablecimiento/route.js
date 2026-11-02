
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'

const respuesta = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })

const norm = x => String(x ?? '').trim().toUpperCase()

const correoValido = x =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && x.length <= 254

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const smtpUsuario = process.env.SMTP_USER
  const smtpClave = process.env.SMTP_PASSWORD
  const sitio = process.env.QIORA_URL_PUBLICA

  if (!url || !publicKey || !serviceKey || !smtpUsuario || !smtpClave || !sitio) {
    return respuesta({
      ok: false,
      error: 'Falta configurar el servicio de correo en Vercel.',
    }, 503)
  }

  if (sitio !== 'https://sistematraspasos.com') {
    return respuesta({
      ok: false,
      error: 'Configura QIORA_URL_PUBLICA con el dominio oficial.',
    }, 503)
  }

  const jwt = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')

  if (!jwt) {
    return respuesta({ ok: false, error: 'Inicia sesión.' }, 401)
  }

  const publico = createClient(url, publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const {
    data: { user },
    error: sesionError,
  } = await publico.auth.getUser(jwt)

  if (sesionError || !user) {
    return respuesta({ ok: false, error: 'Sesión inválida.' }, 401)
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data: actor, error: actorError } = await admin
    .from('almacen_usuarios')
    .select('distrito,puesto,activo')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (actorError || !actor || actor.activo !== true) {
    return respuesta({ ok: false, error: 'No autorizado.' }, 403)
  }

  const padre = norm(actor.puesto) === 'ADMIN_PADRE'

  const adminDistrito =
    norm(actor.puesto) === `ADMIN_${norm(actor.distrito)}`

  if (!padre && !adminDistrito) {
    return respuesta({
      ok: false,
      error: 'Solo administradores autorizados.',
    }, 403)
  }

  let body

  try {
    body = await request.json()
  } catch {
    return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400)
  }

  const usuarioId = String(body?.usuario_id ?? '').trim()

  // CORRECCIÓN: almacen_usuarios.id es numérico (int8), no UUID.
  if (!/^[1-9][0-9]*$/.test(usuarioId)) {
    return respuesta({
      ok: false,
      error: 'Identificador inválido.',
    }, 400)
  }

  const { data: target, error: targetError } = await admin
    .from('almacen_usuarios')
    .select('id,auth_user_id,usuario_almacen,distrito,correo,activo')
    .eq('id', usuarioId)
    .maybeSingle()

  if (targetError || !target) {
    return respuesta({
      ok: false,
      error: 'No se encontró el técnico.',
    }, 404)
  }

  if (!padre && norm(target.distrito) !== norm(actor.distrito)) {
    return respuesta({
      ok: false,
      error: 'No puedes gestionar otro distrito.',
    }, 403)
  }

  if (target.activo !== true || !target.auth_user_id) {
    return respuesta({
      ok: false,
      error: 'El técnico debe estar activo y vinculado con Auth.',
    }, 400)
  }

  if (target.auth_user_id === user.id) {
    return respuesta({
      ok: false,
      error: 'No uses esta opción para tu propia cuenta.',
    }, 400)
  }

  const destino = String(target.correo ?? '').trim()

  if (
    !correoValido(destino) ||
    destino.toLowerCase().endsWith('@qiora.local')
  ) {
    return respuesta({
      ok: false,
      error: 'El técnico no tiene un correo electrónico real válido. Edítalo primero.',
    }, 400)
  }

  const { data: authResult, error: authError } =
    await admin.auth.admin.getUserById(target.auth_user_id)

  if (authError || !authResult?.user?.email) {
    return respuesta({
      ok: false,
      error: 'No se encontró la identidad Auth del técnico.',
    }, 400)
  }

  // Generar enlace de recuperación para la identidad Auth existente.
  const { data: linkResult, error: linkError } =
    await admin.auth.admin.generateLink({
      type: 'recovery',
      email: authResult.user.email,
    })

  const token = linkResult?.properties?.hashed_token

  if (linkError || !token) {
    return respuesta({
      ok: false,
      error: 'No se pudo generar el enlace de recuperación.',
    }, 500)
  }

  const enlace =
    `${sitio}/restablecer-clave?token_hash=${encodeURIComponent(token)}`

  const titulo =
    `Recuperación de contraseña QIORA: ${target.usuario_almacen}.${target.distrito}`

  const texto = `
Se solicitó restablecer la contraseña de tu cuenta QIORA.

Usuario: ${target.usuario_almacen}
Distrito: ${target.distrito}

Abre este enlace de uso único para establecer una nueva contraseña:

${enlace}

Si no solicitaste este cambio, informa a tu administrador.
No compartas este enlace.
`

  let transporte

  try {
    transporte = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUsuario,
        pass: smtpClave,
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    })

    const resultado = await transporte.sendMail({
      from: smtpUsuario,
      to: destino,
      subject: titulo,
      text: texto,
    })

    if (
      !resultado.accepted?.some(
        x => x.toLowerCase() === destino.toLowerCase()
      )
    ) {
      return respuesta({
        ok: false,
        error: 'Gmail no confirmó la aceptación del destinatario.',
      }, 502)
    }
  } catch (err) {
    console.error(
      'Error SMTP QIORA',
      err?.code || 'sin_codigo'
    )

    return respuesta({
      ok: false,
      error: 'No se pudo enviar desde Gmail. Revisa la configuración SMTP.',
    }, 502)
  } finally {
    if (transporte) {
      transporte.close()
    }
  }

  return respuesta({
    ok: true,
    mensaje: 'Gmail aceptó el mensaje. Confirma su recepción con el técnico.',
  })
}
