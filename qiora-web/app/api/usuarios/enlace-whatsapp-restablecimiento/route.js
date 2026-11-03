import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const response = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const norm = value => String(value ?? '').trim().toUpperCase()

function whatsappNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 10) return `52${digits}`
  if (digits.length === 12 && digits.startsWith('52')) return digits
  if (digits.length === 13 && digits.startsWith('521')) return digits
  return null
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const site = process.env.QIORA_URL_PUBLICA
  if (!url || !publicKey || !serviceKey || site !== 'https://sistematraspasos.com') {
    return response({ ok: false, error: 'Falta configurar Supabase o QIORA_URL_PUBLICA en Vercel.' }, 503)
  }

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return response({ ok: false, error: 'Inicia sesión.' }, 401)

  const publicDb = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await publicDb.auth.getUser(jwt)
  if (authError || !authData?.user) return response({ ok: false, error: 'Sesión inválida.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
    .select('distrito,puesto,activo,administrar_permisos')
    .eq('auth_user_id', authData.user.id).maybeSingle()
  if (actorError || !actor || actor.activo !== true) return response({ ok: false, error: 'No autorizado.' }, 403)

  const isParent = norm(actor.puesto) === 'ADMIN_PADRE'
  const isDistrictAdmin = norm(actor.puesto) === `ADMIN_${norm(actor.distrito)}`
  if (!isParent && (!isDistrictAdmin || actor.administrar_permisos !== true)) {
    return response({ ok: false, error: 'No tienes permiso para administrar usuarios.' }, 403)
  }

  let body
  try { body = await request.json() } catch { return response({ ok: false, error: 'Solicitud inválida.' }, 400) }
  const userId = String(body?.usuario_id ?? '').trim()
  if (!/^[1-9][0-9]*$/.test(userId)) return response({ ok: false, error: 'Identificador inválido.' }, 400)

  const { data: target, error: targetError } = await admin.from('almacen_usuarios')
    .select('id,auth_user_id,usuario_almacen,distrito,telefono,activo,puesto')
    .eq('id', userId).maybeSingle()
  if (targetError || !target) return response({ ok: false, error: 'No se encontró el usuario.' }, 404)
  if (!isParent && norm(target.distrito) !== norm(actor.distrito)) return response({ ok: false, error: 'No puedes gestionar otro distrito.' }, 403)
  if (norm(target.puesto).startsWith('ADMIN_') && !isParent) return response({ ok: false, error: 'No puedes gestionar cuentas administrativas.' }, 403)
  if (target.activo !== true || !target.auth_user_id) return response({ ok: false, error: 'El usuario debe estar activo y vinculado con Auth.' }, 400)
  if (target.auth_user_id === authData.user.id) return response({ ok: false, error: 'No puedes generar un enlace para tu propia cuenta desde esta opción.' }, 400)

  const phone = whatsappNumber(target.telefono)
  if (!phone) return response({ ok: false, error: 'El teléfono debe tener 10 dígitos de México o incluir el código internacional 52.' }, 400)

  const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(target.auth_user_id)
  if (getUserError || !authUser?.user?.email) return response({ ok: false, error: 'No se encontró la identidad de acceso del usuario.' }, 400)

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery', email: authUser.user.email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkError || !tokenHash) return response({ ok: false, error: 'No se pudo generar el enlace de recuperación.' }, 500)

  const recoveryUrl = `${site}/restablecer-clave?token_hash=${encodeURIComponent(tokenHash)}`
  const message = [
    'QIORA - Restablecimiento de contraseña',
    `Usuario: ${target.usuario_almacen}.${target.distrito}`,
    'Abre este enlace de uso único para crear una contraseña nueva:',
    recoveryUrl,
    'Si no solicitaste este cambio, informa a tu administrador. No compartas este enlace.',
  ].join('\n\n')
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`

  return response({ ok: true, whatsapp_url: whatsappUrl, mensaje: 'Enlace generado. Revisa el destinatario en WhatsApp antes de enviarlo.' })
}
