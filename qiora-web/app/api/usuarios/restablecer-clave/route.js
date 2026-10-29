import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'

const fail = (error, status = 400) =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )

const norm = value => String(value ?? '').trim().toUpperCase()

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !publicKey || !serviceKey) {
    return fail('Faltan variables de Supabase en el servidor.', 503)
  }

  const bearer = request.headers.get('authorization') || ''
  const jwt = bearer.replace(/^Bearer\s+/i, '')
  if (!jwt) return fail('Inicia sesión.', 401)

  const publicClient = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await publicClient.auth.getUser(jwt)
  if (authError || !user) return fail('Sesión inválida.', 401)

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: actor, error: actorError } = await admin
    .from('almacen_usuarios')
    .select('id,distrito,puesto,activo')
    .eq('auth_user_id', user.id)
    .eq('activo', true)
    .maybeSingle()

  if (actorError || !actor) return fail('Usuario no autorizado.', 403)

  const parent = norm(actor.puesto) === 'ADMIN_PADRE'
  const localAdmin = norm(actor.puesto) === `ADMIN_${norm(actor.distrito)}`
  if (!parent && !localAdmin) {
    return fail('Solo ADMIN_PADRE o el administrador de su distrito puede restablecer contraseñas.', 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return fail('JSON inválido.')
  }

  const usuarioId = String(body?.usuario_id ?? '').trim()
  if (!usuarioId) return fail('Falta usuario_id.')

  const { data: target, error: targetError } = await admin
    .from('almacen_usuarios')
    .select('id,auth_user_id,distrito,usuario_almacen,activo')
    .eq('id', usuarioId)
    .maybeSingle()

  if (targetError) return fail('No se pudo consultar el usuario.', 500)
  if (!target || !target.auth_user_id) {
    return fail('No se encontró el usuario o no tiene cuenta de autenticación.', 404)
  }

  if (!parent && norm(target.distrito) !== norm(actor.distrito)) {
    return fail('No puedes restablecer la contraseña de otro distrito.', 403)
  }

  if (target.auth_user_id === user.id) {
    return fail('Usa el proceso de cambio de contraseña de tu propia cuenta.', 400)
  }

  const claveTemporal = randomBytes(18).toString('base64url') + 'Aa1!'
  const { error: updateError } = await admin.auth.admin.updateUserById(
    target.auth_user_id,
    { password: `QIORA#${claveTemporal}` }
  )

  if (updateError) {
    return fail(`No se pudo actualizar la contraseña: ${updateError.message}`, 500)
  }

  return NextResponse.json(
    {
      ok: true,
      usuario: target.usuario_almacen,
      distrito: target.distrito,
      clave_temporal: claveTemporal,
      aviso: 'La contraseña anterior dejó de funcionar. Entrega la clave temporal por un canal seguro.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
