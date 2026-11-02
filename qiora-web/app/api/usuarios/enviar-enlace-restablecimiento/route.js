import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const respuesta = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const norm = x => String(x ?? '').trim().toUpperCase()
const correoValido = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && x.length <= 254

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  const remitente = process.env.QIORA_CORREO_REMITENTE
  const sitio = process.env.QIORA_URL_PUBLICA
  if (!url || !publicKey || !serviceKey || !resendKey || !remitente || !sitio) {
    return respuesta({ ok: false, error: 'Falta configurar el servicio de correo en Vercel.' }, 503)
  }
  if (sitio !== 'https://sistematraspasos.com') {
    return respuesta({ ok: false, error: 'Configura QIORA_URL_PUBLICA con el dominio oficial.' }, 503)
  }
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return respuesta({ ok: false, error: 'Inicia sesión.' }, 401)
  const publico = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: sesionError } = await publico.auth.getUser(jwt)
  if (sesionError || !user) return respuesta({ ok: false, error: 'Sesión inválida.' }, 401)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
    .select('distrito,puesto,activo').eq('auth_user_id', user.id).maybeSingle()
  if (actorError || !actor || actor.activo !== true) return respuesta({ ok: false, error: 'No autorizado.' }, 403)
  const padre = norm(actor.puesto) === 'ADMIN_PADRE'
  const adminDistrito = norm(actor.puesto) === `ADMIN_${norm(actor.distrito)}`
  if (!padre && !adminDistrito) return respuesta({ ok: false, error: 'Solo administradores autorizados.' }, 403)
  let body
  try { body = await request.json() } catch { return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400) }
  const usuarioId = String(body?.usuario_id ?? '').trim()
  if (!/^[0-9a-fA-F-]{36}$/.test(usuarioId)) return respuesta({ ok: false, error: 'Identificador inválido.' }, 400)
  const { data: target, error: targetError } = await admin.from('almacen_usuarios')
    .select('id,auth_user_id,usuario_almacen,distrito,correo,activo')
    .eq('id', usuarioId).maybeSingle()
  if (targetError || !target) return respuesta({ ok: false, error: 'No se encontró el técnico.' }, 404)
  if (!padre && norm(target.distrito) !== norm(actor.distrito)) {
    return respuesta({ ok: false, error: 'No puedes gestionar otro distrito.' }, 403)
  }
  if (target.activo !== true || !target.auth_user_id) {
    return respuesta({ ok: false, error: 'El técnico debe estar activo y vinculado con Auth.' }, 400)
  }
  if (target.auth_user_id === user.id) return respuesta({ ok: false, error: 'No uses esta opción para tu propia cuenta.' }, 400)
  const destino = String(target.correo ?? '').trim()
  if (!correoValido(destino) || destino.toLowerCase().endsWith('@qiora.local')) {
    return respuesta({ ok: false, error: 'El técnico no tiene un correo electrónico real válido. Edítalo primero.' }, 400)
  }
  const { data: authResult, error: authError } = await admin.auth.admin.getUserById(target.auth_user_id)
  if (authError || !authResult?.user?.email) {
    return respuesta({ ok: false, error: 'No se encontró la identidad Auth del técnico.' }, 400)
  }
  // Auth mantiene @qiora.local. El enlace se genera para esa identidad,
  // pero se envía exclusivamente al correo real del perfil.
  const { data: linkResult, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery', email: authResult.user.email,
  })
  const token = linkResult?.properties?.hashed_token
  if (linkError || !token) return respuesta({ ok: false, error: 'No se pudo generar el enlace de recuperación.' }, 500)
  const enlace = `${sitio}/restablecer-clave?token_hash=${encodeURIComponent(token)}`
  const titulo = `Recuperación de contraseña QIORA: ${target.usuario_almacen}.${target.distrito}`
  const texto = `Se solicitó restablecer la contraseña de tu cuenta QIORA (${target.usuario_almacen}.${target.distrito}).\n\nAbre este enlace de uso único para establecer una nueva contraseña:\n${enlace}\n\nSi no solicitaste este cambio, informa a tu administrador. No compartas este enlace.`
  let envio
  try {
    envio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remitente, to: [destino], subject: titulo, text: texto }),
      cache: 'no-store',
    })
  } catch {
    return respuesta({ ok: false, error: 'No se pudo contactar al proveedor de correo.' }, 502)
  }
  if (!envio.ok) return respuesta({ ok: false, error: 'El proveedor no aceptó el envío. Comprueba el remitente y su configuración.' }, 502)
  return respuesta({ ok: true, mensaje: 'Solicitud de envío aceptada por el proveedor. Confirma la recepción con el técnico.' })
}
