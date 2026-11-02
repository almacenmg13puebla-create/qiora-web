import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const respuesta = (data, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
})
export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publicKey || !serviceKey) return respuesta({ ok: false, error: 'Configuración incompleta.' }, 503)
  let body
  try { body = await request.json() } catch { return respuesta({ ok: false, error: 'Solicitud inválida.' }, 400) }
  const token = String(body?.token_hash ?? '')
  const password = String(body?.nueva_clave ?? '')
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(token)) return respuesta({ ok: false, error: 'Enlace inválido.' }, 400)
  if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return respuesta({ ok: false, error: 'Usa 12 a 128 caracteres con letras y números.' }, 400)
  }
  const publico = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await publico.auth.verifyOtp({ token_hash: token, type: 'recovery' })
  if (error || !data?.user?.id) return respuesta({ ok: false, error: 'Enlace inválido o vencido. Solicita otro.' }, 400)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: target, error: targetError } = await admin.from('almacen_usuarios')
    .select('activo').eq('auth_user_id', data.user.id).maybeSingle()
  if (targetError || !target || target.activo !== true) return respuesta({ ok: false, error: 'Cuenta inactiva o no encontrada.' }, 403)
  // Mantener compatibilidad con la función de inicio de sesión vigente (QIORA#).
  const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
    password: `QIORA#${password}`,
    app_metadata: { ...data.user.app_metadata, force_password_change: false },
  })
  if (updateError) return respuesta({ ok: false, error: 'No se pudo actualizar la contraseña. Solicita otro enlace.' }, 500)
  return respuesta({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' })
}
