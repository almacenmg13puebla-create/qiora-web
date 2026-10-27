import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const fail = (error, status=400) => NextResponse.json({ok:false,error},{status})
const norm = value => String(value ?? '').trim().toUpperCase()

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publicKey || !serviceKey) return fail('Variables Supabase incompletas en Vercel.',503)
  const bearer = request.headers.get('authorization') || ''
  if (!bearer.startsWith('Bearer ')) return fail('Inicia sesion.',401)
  const publicClient = createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user}={},error:sessionError} = await publicClient.auth.getUser(bearer.slice(7))
  if (sessionError || !user) return fail('Sesion invalida.',401)
  const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:actor,error:actorError} = await admin.from('almacen_usuarios')
    .select('distrito,puesto,activo').eq('auth_user_id',user.id).maybeSingle()
  if (actorError || !actor || actor.activo !== true) return fail('Usuario no autorizado.',403)
  const parent = norm(actor.puesto)==='ADMIN_PADRE'
  const localAdmin = norm(actor.puesto)==='ADMIN_'+norm(actor.distrito)
  if (!parent && !localAdmin) return fail('Solo ADMIN_PADRE y el administrador de distrito pueden crear usuarios.',403)
  let body
  try { body=await request.json() } catch { return fail('Datos invalidos.') }
  const distrito = parent ? norm(body.distrito || actor.distrito) : norm(actor.distrito)
  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return fail('Distrito invalido.')
  if (!parent && body.distrito && norm(body.distrito)!==distrito) return fail('No puedes crear usuarios de otro distrito.',403)
  const {data:district,error:districtError} = await admin.from('distritos').select('codigo,activo').eq('codigo',distrito).maybeSingle()
  if (districtError || !district || !district.activo) return fail('Distrito inexistente o inactivo.')
  const usuario_almacen=norm(body.usuario_almacen)
  const nombre=String(body.nombre ?? '').trim()
  const puesto=norm(body.puesto)
  const clave=String(body.clave ?? '')
  if (!/^[A-Z0-9_-]{2,40}$/.test(usuario_almacen)) return fail('Usuario/almacen invalido.')
  if (nombre.length<3 || nombre.length>200) return fail('Nombre invalido.')
  if (!puesto || puesto.startsWith('ADMIN')) return fail('No puedes asignar puestos administrativos.',403)
  if (clave.length<10 || clave.length>100) return fail('La clave debe tener de 10 a 100 caracteres.')
  const {data:existing,error:existingError} = await admin.from('almacen_usuarios')
    .select('id').eq('usuario_almacen',usuario_almacen).limit(1)
  if (existingError) return fail('Error al verificar duplicados.',500)
  if (existing?.length) return fail('Ese usuario ya existe.')
  const datos = {
    usuario_almacen,nombre,puesto,
    numero_empleado:String(body.numero_empleado ?? '').trim(),
    telefono:String(body.telefono ?? '').trim(),
    correo:String(body.correo ?? '').trim(),
    coordinador:String(body.coordinador ?? '').trim(),
    usuario_ffm:String(body.usuario_ffm ?? '').trim(),
    fecha_nacimiento:body.fecha_nacimiento || null,
    permisos:body.permisos && typeof body.permisos==='object' && !Array.isArray(body.permisos) ? body.permisos : {}
  }
  // Compatibilidad con el esquema de inicio de sesion existente.
  const {data:created,error:createError} = await admin.auth.admin.createUser({
    email:`${usuario_almacen.toLowerCase()}@qiora.local`,password:`QIORA#${clave}`,email_confirm:true
  })
  if (createError || !created?.user) return fail('Error creando Auth: '+(createError?.message||''))
  const uid=created.user.id
  const {error:profileError} = await admin.rpc('qiora_usuarios_crear_servidor',{
    p_auth_id:uid,p_datos:datos,p_distrito:distrito,p_actor_id:user.id
  })
  if (profileError) {
    const {error:rollbackError} = await admin.auth.admin.deleteUser(uid)
    if (rollbackError) return fail('Error de perfil y fallo de compensacion; requiere revision administrativa.',500)
    return fail('No se pudo crear el usuario: '+profileError.message)
  }
  return NextResponse.json({ok:true,usuario_almacen,distrito})
}
