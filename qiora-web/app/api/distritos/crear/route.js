import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
const errorJson = (error,status=400) => NextResponse.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}})

export async function POST(request) {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL
 const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!url||!publicKey||!secret)return errorJson('Faltan variables de Supabase en el servidor.',503)
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')
 if(!token)return errorJson('Inicia sesión.',401)
 const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user},error:authError}=await client.auth.getUser(token)
 if(authError||!user)return errorJson('Sesión inválida.',401)
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:caller,error:callerError}=await admin.from('almacen_usuarios')
  .select('puesto,activo').eq('auth_user_id',user.id).eq('activo',true).maybeSingle()
 if(callerError||!caller||String(caller.puesto||'').trim().toUpperCase()!=='ADMIN_PADRE')return errorJson('Solo ADMIN_PADRE puede crear distritos.',403)
 let body
 try{body=await request.json()}catch{return errorJson('JSON inválido.')}
 const centro=String(body.centro||'').trim().toUpperCase()
 const nombre=String(body.nombre_region||'').trim()
 if(!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro))return errorJson('Centro inválido, ejemplo MG13.')
 if(!nombre||nombre.length>150)return errorJson('Nombre o región inválido.')
 if(body.activo===false)return errorJson('Crea el distrito activo; podrás desactivarlo después.')
 const usuario='ADMIN_'+centro
 // Preflight antes de cualquier operación de alta
 const {data:already,error:existsError}=await admin.from('qiora_distritos').select('centro').eq('centro',centro).maybeSingle()
 if(existsError)return errorJson(existsError.message,500)
 if(already)return errorJson('El distrito ya existe. No se modificarán sus usuarios. Para un distrito existente utiliza el proceso de aprovisionamiento controlado.',409)
 const {data:duplicate,error:dupError}=await admin.from('almacen_usuarios').select('usuario_almacen').eq('usuario_almacen',usuario).limit(1)
 if(dupError)return errorJson(dupError.message,500)
 if(duplicate?.length)return errorJson('El nombre de administrador ya existe.',409)
 // Contraseña distinta y aleatoria para cada distrito; compatible con login QIORA (QIORA# + clave).
 const claveTemporal=randomBytes(18).toString('base64url')+'Aa1!'
 const email=`admin_${centro.toLowerCase()}@qiora.local`
 const {data:created,error:createdError}=await admin.auth.admin.createUser({
   email,password:'QIORA#'+claveTemporal,email_confirm:true,
   app_metadata:{qiora_provisioned_admin:true,qiora_distrito:centro,force_password_change:true}
 })
 if(createdError||!created?.user)return errorJson('Error creando cuenta de autenticación: '+(createdError?.message||'Desconocido'),400)
 const uid=created.user.id
 try{
   // La función SQL verifica que el centro no exista, crea el catálogo y el perfil en una transacción.
   const {data,error}=await admin.rpc('qiora_crear_distrito_admin_servidor',{
     p_centro:centro,p_nombre_region:nombre,p_token_excel:body.token_excel||null,
     p_auth_id:uid,p_actor_id:user.id
   })
   if(error||data!==true)throw new Error(error?.message||'No se guardó distrito/admin')
   return NextResponse.json({ok:true,centro,usuario,clave_temporal:claveTemporal,
     aviso:'Contraseña inicial única. Cambiarla después del primer acceso.'},{headers:{'Cache-Control':'no-store'}})
 }catch(e){
   const {error:rollback}=await admin.auth.admin.deleteUser(uid)
   if(rollback)return errorJson('Falló el alta y no se pudo limpiar cuenta Auth '+uid+': '+e.message,500)
   return errorJson('No se creó el distrito: '+e.message,500)
 }
}
