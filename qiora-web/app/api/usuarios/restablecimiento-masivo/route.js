import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
const respuesta = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, private' } })
const norm = value => String(value ?? '').trim().toUpperCase()

function generarClaveTemporal() {
  // La aplicación antepone QIORA# al autenticar; el usuario escribe solo esta clave.
  return randomBytes(12).toString('base64url')
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publicKey || !serviceKey) return respuesta({ ok: false, error: 'Falta configurar Supabase.' }, 503)

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return respuesta({ ok: false, error: 'Inicia sesión.' }, 401)
  const publico = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: sesionError } = await publico.auth.getUser(jwt)
  if (sesionError || !user) return respuesta({ ok: false, error: 'Sesión inválida.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
    .select('puesto,activo').eq('auth_user_id', user.id).maybeSingle()
  if (actorError || !actor || actor.activo !== true || norm(actor.puesto) !== 'ADMIN_PADRE') {
    return respuesta({ ok: false, error: 'Solo ADMIN_PADRE puede generar credenciales temporales masivas.' }, 403)
  }

  let body
  try { body = await request.json() } catch { return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400) }
  const distrito = norm(body?.distrito)
  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return respuesta({ ok: false, error: 'Selecciona un distrito válido.' }, 400)

  const { data: distritoRow, error: distritoError } = await admin.from('distritos')
    .select('codigo,activo').eq('codigo', distrito).maybeSingle()
  if (distritoError || !distritoRow || distritoRow.activo !== true) return respuesta({ ok: false, error: 'El distrito no existe o está inactivo.' }, 404)

  const { data: usuarios, error: usuariosError } = await admin.from('almacen_usuarios')
    .select('id,auth_user_id,usuario_almacen,nombre,distrito,puesto,activo')
    .eq('distrito', distrito).eq('activo', true).not('auth_user_id', 'is', null)
  if (usuariosError) return respuesta({ ok: false, error: 'No se pudieron consultar los usuarios del distrito.' }, 500)

  const resultados = []
  let fallidos = 0
  for (const target of (usuarios || [])) {
    if (!target.auth_user_id || target.auth_user_id === user.id || norm(target.puesto) === 'ADMIN_PADRE') continue
    const claveTemporal = generarClaveTemporal()
    try {
      const { data: authResult, error: authError } = await admin.auth.admin.getUserById(target.auth_user_id)
      if (authError || !authResult?.user) { fallidos++; continue }
      const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
        password: `QIORA#${claveTemporal}`,
        app_metadata: { ...(authResult.user.app_metadata || {}), force_password_change: true }
      })
      if (updateError) { fallidos++; continue }
      resultados.push({
        distrito,
        nombre: String(target.nombre || '').trim(),
        usuario: `${String(target.usuario_almacen || '').trim()}.${distrito}`,
        contrasena_temporal: claveTemporal,
        estado: 'Cambio obligatorio al iniciar sesión'
      })
    } catch { fallidos++ }
  }

  return respuesta({
    ok: true,
    distrito,
    credenciales: resultados,
    actualizados: resultados.length,
    fallidos,
    mensaje: `Distrito ${distrito}: ${resultados.length} contraseña(s) temporal(es) generada(s). ${fallidos} cuenta(s) no pudieron actualizarse.`
  })
}
