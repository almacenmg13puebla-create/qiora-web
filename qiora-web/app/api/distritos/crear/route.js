import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'

const errorJson = (error, status = 400) =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )

const norm = value => String(value ?? '').trim().toUpperCase()

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !publicKey || !secret) {
    return errorJson('Faltan variables de Supabase en el servidor.', 503)
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return errorJson('Inicia sesión.', 401)

  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(token)

  if (authError || !user) return errorJson('Sesión inválida.', 401)

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: caller, error: callerError } = await admin
    .from('almacen_usuarios')
    .select('puesto,activo')
    .eq('auth_user_id', user.id)
    .eq('activo', true)
    .maybeSingle()

  if (
    callerError ||
    !caller ||
    norm(caller.puesto) !== 'ADMIN_PADRE'
  ) {
    return errorJson('Solo ADMIN_PADRE puede crear distritos.', 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return errorJson('JSON inválido.')
  }

  const centro = norm(body?.centro)
  const nombre = String(body?.nombre_region ?? '').trim()
  const tokenExcel = String(body?.token_excel ?? '').trim()

  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)) {
    return errorJson('Centro inválido. Ejemplo: MG22.')
  }

  if (!nombre || nombre.length > 150) {
    return errorJson('Nombre o región inválido.')
  }

  if (body?.activo === false) {
    return errorJson('Crea el distrito activo; podrás desactivarlo después.')
  }

  if (tokenExcel.length > 4096) {
    return errorJson('TOKEN_EXCEL demasiado largo.')
  }

  const usuario = `ADMIN_${centro}`

  // Comprobar que el distrito no exista antes de crear la cuenta Auth.
  const { data: already, error: existsError } = await admin
    .from('qiora_distritos')
    .select('centro')
    .eq('centro', centro)
    .maybeSingle()

  if (existsError) return errorJson(existsError.message, 500)
  if (already) {
    return errorJson(
      'El distrito ya existe. Usa la opción para crear su administrador.',
      409
    )
  }

  const { data: duplicate, error: duplicateError } = await admin
    .from('almacen_usuarios')
    .select('usuario_almacen')
    .eq('usuario_almacen', usuario)
    .limit(1)

  if (duplicateError) return errorJson(duplicateError.message, 500)
  if (duplicate?.length) return errorJson('El usuario administrador ya existe.', 409)

  // Clave aleatoria única para el administrador nuevo.
  const claveTemporal = randomBytes(18).toString('base64url') + 'Aa1!'
  const email = `admin_${centro.toLowerCase()}@qiora.local`

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: `QIORA#${claveTemporal}`,
    email_confirm: true,
    app_metadata: {
      qiora_provisioned_admin: true,
      qiora_distrito: centro,
      force_password_change: true,
    },
  })

  if (createError || !created?.user) {
    return errorJson(
      `Error creando cuenta de autenticación: ${createError?.message || 'Desconocido'}`,
      400
    )
  }

  const authId = created.user.id

  try {
    const { data, error } = await admin.rpc('qiora_crear_distrito_admin_servidor', {
      p_centro: centro,
      p_nombre_region: nombre,
      p_token_excel: tokenExcel || null,
      p_auth_id: authId,
      p_actor_id: user.id,
    })

    if (error || data !== true) {
      throw new Error(error?.message || 'No se guardó el distrito ni su administrador.')
    }

    return NextResponse.json(
      {
        ok: true,
        centro,
        usuario,
        clave_temporal: claveTemporal,
        aviso: 'Guarda la clave temporal ahora y cámbiala después del primer acceso.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(authId)

    if (rollbackError) {
      return errorJson(
        `Falló el alta y no se pudo limpiar la cuenta Auth ${authId}. Requiere revisión administrativa. ${error.message}`,
        500
      )
    }

    return errorJson(`No se creó el distrito: ${error.message}`, 500)
  }
}
