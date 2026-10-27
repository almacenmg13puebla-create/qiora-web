import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
const fail = (error,status=400) => NextResponse.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!publicKey||!secret)return fail('Faltan variables Supabase en Vercel.',503)
  const jwt=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')
  if(!jwt)return fail('Inicia sesión.',401)
  const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error:authError}=await client.auth.getUser(jwt)
  if(authError||!user)return fail('Sesión inválida.',401)
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:actor,error:actorError}=await admin.from('almacen_usuarios')
    .select('puesto,activo').eq('auth_user_id',user.id).eq('activo',true).maybeSingle()
  if(actorError||!actor||String(actor.puesto||'').trim().toUpperCase()!=='ADMIN_PADRE')return fail('Solo ADMIN_PADRE puede crear administradores.',403)
  let body
  try{body=await request.json()}catch{return fail('JSON inválido.')}
  const centro=String(body?.centro||'').trim().toUpperCase()
  if(!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro))return fail('Centro inválido.')
  const usuario='ADMIN_'+centro
  const {data:distrito,error:dError}=await admin.from('qiora_distritos')
    .select('centro,activo').eq('centro',centro).maybeSingle()
  if(dError)return fail(dError.message,500)
  if(!distrito)return fail('El distrito no existe.',404)
  if(distrito.activo!==true)return fail('El distrito no está activo.',409)
  const {data:exists,error:eError}=await admin.from('almacen_usuarios')
    .select('usuario_almacen').eq('usuario_almacen',usuario).limit(1)
  if(eError)return fail(eError.message,500)
  if(exists?.length)return fail('El administrador ya existe. No se creó otra cuenta.',409)
  // Una contraseña diferente, aleatoria y de un solo uso para cada administrador.
  // El inicio de sesión QIORA usa el prefijo QIORA# para la contraseña real de Supabase Auth.
  const claveTemporal=randomBytes(24).toString('base64url')+'Aa1!'
  const {data:created,error:createError}=await admin.auth.admin.createUser({
    email:`admin_${centro.toLowerCase()}@qiora.local`,
    password:'QIORA#'+claveTemporal,email_confirm:true,
    app_metadata:{qiora_provisioned_admin:true,qiora_distrito:centro,force_password_change:true}
  })
  if(createError||!created?.user)return fail('No se pudo crear el acceso: '+(createError?.message||'Error desconocido'),409)
  const uid=created.user.id
  try{
    const {data,error}=await admin.rpc('qiora_crear_admin_distrito_existente',{
      p_centro:centro,p_auth_id:uid,p_actor_id:user.id
    })
    if(error||data!==true)throw new Error(error?.message||'No se guardó el perfil')
    return NextResponse.json({ok:true,usuario,centro,clave_temporal:claveTemporal},{headers:{'Cache-Control':'no-store'}})
  }catch(err){
    const {error:cleanupError}=await admin.auth.admin.deleteUser(uid)
    if(cleanupError)return fail('Fallo al guardar el perfil y se necesita revisar manualmente Auth ID '+uid+'. '+err.message,500)
    return fail('No se creó el administrador: '+err.message,500)
  }
}
