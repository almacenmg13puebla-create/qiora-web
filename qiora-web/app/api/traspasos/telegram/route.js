import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createDecipheriv } from 'node:crypto'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const out=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}})
const s=v=>String(v??'').trim()
function decrypt(v){
 const hex=process.env.QIORA_TELEGRAM_ENCRYPTION_KEY||''
 if(!/^[a-f0-9]{64}$/i.test(hex))throw Error('QIORA_TELEGRAM_ENCRYPTION_KEY inválida')
 const parts=s(v).split('.');if(parts.length!==3)throw Error('Token cifrado inválido')
 const d=createDecipheriv('aes-256-gcm',Buffer.from(hex,'hex'),Buffer.from(parts[0],'base64'))
 d.setAuthTag(Buffer.from(parts[1],'base64'))
 return Buffer.concat([d.update(Buffer.from(parts[2],'base64')),d.final()]).toString('utf8')
}
async function send(token,chat,text){
 const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),cache:'no-store'})
 const json=await response.json().catch(()=>({}));if(!response.ok||!json.ok)throw Error('Telegram: '+(json.description||response.status));return json
}
function format(t){
 const mat=(Array.isArray(t.materiales)?t.materiales:[]).map(m=>'• '+s(m.sku)+'\n'+s(m.descripcion||m.material)+'\nCantidad: '+s(m.cantidad)+'\nLote: '+s(m.lote)+(Array.isArray(m.series)&&m.series.length?'\nSeries:\n'+m.series.join('\n'):'' )).join('\n\n')
 return '🚚 NUEVO TRASPASO SAP\n\n🖥 Origen de captura:\n🌐 WEB\n\n🏢 Distrito/Centro:\n'+s(t.distrito)+'\n\n📋 Folio SAP:\n'+s(t.folio_sap||'PENDIENTE DE SAP')+'\n\n🆔 Folio control:\n'+s(t.folio_control)+'\n\n🧾 Orden de servicio:\n'+s(t.orden_servicio||'TRASPASO')+'\n\n👤 Solicitado por:\n'+s(t.solicitado_por)+'\n\n⬅️ Origen:\n'+s(t.origen)+' | '+s(t.tecnico_origen)+'\n\n➡️ Destino:\n'+s(t.destino)+' | '+s(t.tecnico_destino)+'\n\n📦 Materiales:\n\n'+mat+'\n\n⏳ Tiempo estimado:\n10 minutos aproximadamente\n\n📌 Estado:\n🟡 PENDIENTE\n\n🤖 Generado automáticamente por\nQIORA CONECTA\n════════════════════════════════════'
}
export async function POST(request){
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!pub||!secret)return out({ok:false,error:'Faltan variables Supabase en Vercel'},503)
  const jwt=s(request.headers.get('authorization')).replace(/^Bearer\s+/i,'')
  if(!jwt)return out({ok:false,error:'Sesión requerida'},401)
  const client=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error:ae}=await client.auth.getUser(jwt)
  if(ae||!user)return out({ok:false,error:'Sesión inválida'},401)
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  const body=await request.json(),folio=s(body.folio_control)
  if(!/^TRAS-[A-Za-z0-9-]{4,60}$/.test(folio))return out({ok:false,error:'Folio inválido'},400)
  const {data:actor,error:actorErr}=await admin.from('almacen_usuarios').select('usuario_almacen,distrito,activo').eq('auth_user_id',user.id).eq('activo',true).maybeSingle()
  if(actorErr||!actor)return out({ok:false,error:'Usuario sin acceso'},403)
  const {data:t,error:te}=await admin.from('qiora_traspasos').select('id,folio_control,folio_sap,distrito,creado_por,origen,destino,tecnico_origen,tecnico_destino,solicitado_por,orden_servicio,materiales,estado').eq('folio_control',folio).maybeSingle()
  if(te||!t)return out({ok:false,error:'Traspaso no encontrado'},404)
  if(t.creado_por!==user.id||s(t.distrito).toUpperCase()!==s(actor.distrito).toUpperCase())return out({ok:false,error:'No autorizado para este traspaso'},403)
  if(s(t.estado).toUpperCase()!=='PENDIENTE')return out({ok:false,error:'El estado no es PENDIENTE'},409)
  const {data:cfg,error:ce}=await admin.from('qiora_distritos_telegram').select('token_cifrado,chat_traspasos').eq('centro',t.distrito).maybeSingle()
  if(ce||!cfg?.token_cifrado||!cfg?.chat_traspasos)return out({ok:false,error:'Telegram no configurado para '+t.distrito},503)
  const {data:users,error:ue}=await admin.from('almacen_usuarios').select('usuario_almacen,telegram_chat_id,activo').eq('distrito',t.distrito).in('usuario_almacen',[t.origen,t.destino]).eq('activo',true)
  if(ue)return out({ok:false,error:'No se pudieron consultar chats privados'},500)
  const targets=[{kind:'GRUPO',chat:s(cfg.chat_traspasos),token:decrypt(cfg.token_cifrado)}]
  const privateToken=s(process.env.QIORA_BOT_TOKEN)
  if(privateToken){for(const u of users||[]){if(s(u.telegram_chat_id)&&!targets.some(x=>x.chat===s(u.telegram_chat_id)))targets.push({kind:'PRIVADO',chat:s(u.telegram_chat_id),token:privateToken})}}
  const text=format(t),errors=[];let enviados=0
  for(const target of targets){
   const key=target.kind+':'+target.chat
   const {error:ie}=await admin.from('qiora_traspasos_avisos').upsert({folio_control:folio,destino:key,estado:'PENDIENTE'},{onConflict:'folio_control,destino',ignoreDuplicates:true})
   if(ie){errors.push(key+': '+ie.message);continue}
   // Reserva atómica, a single request can claim a pending target.
   const {data:claim,error:cl}=await admin.from('qiora_traspasos_avisos').update({estado:'ENVIANDO',actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key).eq('estado','PENDIENTE').select('destino')
   if(cl||!claim?.length)continue
   try{await send(target.token,target.chat,text);enviados++;await admin.from('qiora_traspasos_avisos').update({estado:'ENVIADO',error:null,actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key)}
   catch(e){errors.push(key+': '+e.message);await admin.from('qiora_traspasos_avisos').update({estado:'ERROR',error:e.message.slice(0,400),actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key)}
  }
  return out({ok:errors.length===0,enviados,errores:errors,error:errors.join(' | ')||undefined,nota:!privateToken?'Configurar QIORA_BOT_TOKEN para mensajes privados':undefined})
 }catch(e){return out({ok:false,error:e.message||'Error de Telegram'},500)}
}
