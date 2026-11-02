import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const fail = (error, status = 400) => NextResponse.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return fail('Configuración incompleta.',503)
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i,'')
  if (!token) return fail('Inicia sesión.',401)
  const publicClient = createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error:sessionError} = await publicClient.auth.getUser(token)
  if (sessionError || !user) return fail('Sesión inválida.',401)
  if (user.app_metadata?.force_password_change !== true) return fail('No hay cambio inicial pendiente.',403)
  let body
  try {body = await request.json()} catch {return fail('Datos inválidos.')}
  const password = String(body?.nueva_clave ?? '')
  if (password.length<12 || password.length>128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return fail('Contraseña inválida: mínimo 12 caracteres, letras y números.')
  const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:profile,error:profileError} = await admin.from('almacen_usuarios').select('activo').eq('auth_user_id',user.id).maybeSingle()
  if (profileError || !profile || profile.activo !== true) return fail('Perfil inactivo o no encontrado.',403)
  // Preservar metadatos del usuario y desactivar el indicador solo después de actualizar Auth.
  const {error:updateError} = await admin.auth.admin.updateUserById(user.id,{
    password:`QIORA#${password}`,
    app_metadata:{...user.app_metadata,force_password_change:false}
  })
  if (updateError) return fail('No se pudo actualizar la contraseña.',500)
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}})
}
