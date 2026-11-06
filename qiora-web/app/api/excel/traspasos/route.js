import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const S = x => String(x ?? '').trim()
function output(json,status=200){return NextResponse.json(json,{status,headers:{'Cache-Control':'no-store'}})}
function dateMx(v){const d=new Date(v||Date.now());if(isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}
function cell(v){return S(v).replace(/[\t\r\n]/g,' ').slice(0,3000)}
function isAbas(t){return S(t.folio_control).toUpperCase().startsWith('ABAS-')||S(t.orden_servicio).toUpperCase()==='ENTREGA_MATERIAL'}
function folioVisible(t){return isAbas(t)?'ABAS-'+S(t.destino).padStart(4,'0'):'TRAS-'+S(t.origen)+'-'+S(t.destino)}
function sheetLine(t,m){
 const series=Array.isArray(m.series)?m.series.slice(0,15):[]
 const values=[
  folioVisible(t),dateMx(t.fecha),S(t.solicitado_por).split('|')[0].trim(),
  m.sku,m.descripcion||m.material,m.cantidad,t.distrito,t.origen,t.tecnico_origen,t.destino,t.tecnico_destino,
  m.lote,m.requiere_series==='SI'||series.length>0?'SI':'NO',t.orden_servicio||'TRASPASO','PENDIENTE',
  t.folio_control,'PENDIENTE','','','', '',...Array.from({length:15},(_,i)=>series[i]||'')]
 return values.map(cell).join('\t')
}
function descifrarToken(v){
 const hex=S(process.env.QIORA_TELEGRAM_ENCRYPTION_KEY)
 if(!/^[a-f0-9]{64}$/i.test(hex))throw Error('Falta QIORA_TELEGRAM_ENCRYPTION_KEY')
 const parts=S(v).split('.')
 if(parts.length!==3)throw Error('Token de Telegram cifrado incorrectamente')
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(hex,'hex'),Buffer.from(parts[0],'base64'))
 decipher.setAuthTag(Buffer.from(parts[1],'base64'))
 return Buffer.concat([decipher.update(Buffer.from(parts[2],'base64')),decipher.final()]).toString('utf8')
}
function textoConfirmacion(t){
 const materiales=Array.isArray(t.materiales)?t.materiales:[]
 const lineas=materiales.flatMap(m=>[
  '📌 SKU: '+S(m.sku),
  '📦 Material: '+S(m.descripcion||m.material),
  '🔢 Cantidad: '+S(m.cantidad),
  '🏷️ Lote: '+S(m.lote),
  ...(Array.isArray(m.series)&&m.series.length?['🔠 Series: '+m.series.map(S).join(', ')]:[]),
  ''
 ])
 return ['✅ TRASPASO SAP REALIZADO','','🏢 Distrito: '+S(t.distrito),
  '📄 Folio: '+(S(t.folio_sap)||'TRAS-'+S(t.origen)+'-'+S(t.destino)),
  '📋 Folio control: '+S(t.folio_control),
  ...lineas,
  '⬅️ Origen: '+S(t.origen),'➡️ Destino: '+S(t.destino),
  '📦 Documento SAP: '+S(t.documento_sap)].join('\n').slice(0,4000)
}
async function enviarTelegram(token,chat,mensaje){
 const abort=AbortSignal.timeout(12000)
 const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:mensaje}),signal:abort,cache:'no-store'
 })
 const r=await response.json().catch(()=>({}))
 if(!response.ok||!r.ok)throw Error('Telegram '+(r.description||response.status))
}
async function notificarConfirmacion(db,folio,centro){
 const {data:t,error:te}=await db.from('qiora_traspasos').select('folio_control,folio_sap,distrito,origen,destino,materiales,estado,documento_sap').eq('folio_control',folio).eq('distrito',centro).single()
 if(te)throw te
 // Los ABAS no se envian al grupo de TRASPASOS; su notificacion requiere un flujo propio.
 if(isAbas(t))throw Error('Las entregas ABAS requieren notificacion de entrega independiente')
 if(t.estado!=='COMPLETADO'||!/^\d{10}$/.test(S(t.documento_sap)))throw Error('Sin documento SAP COMPLETADO para notificar')
 const {data:cfg,error:ce}=await db.from('qiora_distritos_telegram').select('token_cifrado,chat_traspasos').eq('centro',centro).single()
 if(ce||!cfg?.chat_traspasos||!cfg?.token_cifrado)throw Error('Configura el grupo Telegram de '+centro)
 const destinatarios=[{nombre:'GRUPO',chat:S(cfg.chat_traspasos),token:descifrarToken(cfg.token_cifrado)}]
 const privateToken=S(process.env.QIORA_BOT_TOKEN)
 const {data:usuarios,error:ue}=await db.from('almacen_usuarios').select('usuario_almacen,telegram_chat_id').eq('distrito',centro).eq('activo',true).in('usuario_almacen',[t.origen,t.destino])
 if(ue)throw ue
 if(privateToken){
  for(const u of usuarios||[]){
   const chat=S(u.telegram_chat_id)
   if(chat&&!destinatarios.some(x=>x.chat===chat))destinatarios.push({nombre:'BOT',chat,token:privateToken})
  }
 }
 const mensajes=[], errores=[]
 for(const dest of destinatarios){
  const key='CONFIRMACION_'+dest.nombre+':'+dest.chat
  const {error:ins}=await db.from('qiora_traspasos_avisos').upsert({folio_control:folio,destino:key,estado:'PENDIENTE'}, {onConflict:'folio_control,destino',ignoreDuplicates:true})
  if(ins){errores.push(key+': '+ins.message);continue}
  const {data:lock,error:le}=await db.from('qiora_traspasos_avisos').update({estado:'ENVIANDO',actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key).in('estado',['PENDIENTE','ERROR']).select('destino')
  if(le){errores.push(key+': '+le.message);continue}
  if(!lock?.length)continue
  try{
   await enviarTelegram(dest.token,dest.chat,textoConfirmacion(t))
   const {error:mark}=await db.from('qiora_traspasos_avisos').update({estado:'ENVIADO',error:null,actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key)
   if(mark)errores.push(key+': enviado, pero no se pudo guardar acuse: '+mark.message)
   mensajes.push(key)
  }catch(e){
   errores.push(key+': '+e.message)
   await db.from('qiora_traspasos_avisos').update({estado:'ERROR',error:S(e.message).slice(0,400),actualizado_en:new Date().toISOString()}).eq('folio_control',folio).eq('destino',key)
  }
 }
 if(!privateToken)errores.push('Falta QIORA_BOT_TOKEN para mensajes privados')
 return {enviados:mensajes,errores}
}
async function sincronizarEntregaAbas(db,folio,centro){
 if(!/^ABAS-[A-Z0-9-]{4,60}$/i.test(folio))return null
 // Validar que el movimiento pertenece al distrito antes de sincronizar.
 const {data:t,error:te}=await db.from('qiora_traspasos').select('folio_control,distrito,estado,documento_sap').eq('folio_control',folio).eq('distrito',centro).single()
 if(te||!t)throw Error('No se encontro entrega ABAS en el distrito autorizado')
 if(!['COMPLETADO','REALIZADO'].includes(S(t.estado).toUpperCase()))return {ok:true,estado:t.estado,sincronizado:false}
 const {data,error}=await db.rpc('qiora_material_sincronizar_sap',{p_folio_control:folio})
 if(error)throw Error('Error conciliando entrega ABAS: '+error.message)
 return data
}
export async function POST(req){
 try{
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  if(!url||!secret)return output({ok:false,error:'Configuracion Supabase incompleta'},503)
  const d=await req.json(),centro=S(d.distrito).toUpperCase(),token=S(d.token)
  if(!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)||!token)return output({ok:false,error:'TOKEN_INVALIDO'},403)
  const db=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}})
  const action=S(d.action||d.accion).toLowerCase()
  if(action==='traspasos_en_proceso'){
   const {data,error}=await db.rpc('qiora_excel_reclamar_traspasos',{p_distrito:centro,p_token:token,p_max:20})
   if(error)return output({ok:false,error:error.message},error.message.includes('TOKEN_INVALIDO')?403:500)
   const lines=[]
   for(const t of (Array.isArray(data)?data:[])){
    if(S(t.distrito)!==centro)continue
    for(const m of (Array.isArray(t.materiales)?t.materiales:[])){
     if((m.series||[]).length>15)return output({ok:false,error:'Mas de 15 series en '+t.folio_control},422)
     lines.push(sheetLine(t,m))
    }
   }
   return new Response(lines.join('\n'),{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})
  }
  if(action==='reenviar_confirmacion'){
   const {data:valido,error:ve}=await db.rpc('qiora_excel_validar_credencial',{p_distrito:centro,p_token:token})
   if(ve||valido!==true)return output({ok:false,error:'TOKEN_INVALIDO'},403)
   const folio=S(d.folioControl||d.folio_control)
   if(!/^TRAS-[A-Z0-9-]{4,60}$/i.test(folio))return output({ok:false,error:'Folio invalido'},400)
   try{const telegram=await notificarConfirmacion(db,folio,centro);return output({ok:telegram.errores.length===0,telegram})}
   catch(e){return output({ok:false,error:e.message},409)}
  }
  if(action==='resultado_sap'){
   const estado=S(d.estadoBot||d.estado_bot||d.estado).toUpperCase()
   const doc=S(d.documentoSAP||d.documento_sap)
   const folio=S(d.folioControl||d.folio_control)
   const {data,error}=await db.rpc('qiora_excel_resultado_traspaso',{
    p_distrito:centro,p_token:token,p_folio_control:folio,
    p_estado:estado,p_documento_sap:estado==='REALIZADO'||estado==='COMPLETADO'?doc:'',
    p_mensaje_sap:S(d.mensajeSAP||d.mensaje_sap||(estado==='NO REALIZADO'?doc:''))
   })
   if(error)return output({ok:false,error:error.message},error.message.includes('TOKEN_INVALIDO')?403:409)
   if(estado==='REALIZADO'||estado==='COMPLETADO'){
    if(folio.toUpperCase().startsWith('ABAS-')){
     try{const entrega=await sincronizarEntregaAbas(db,folio,centro);return output({...data,entrega})}
     catch(e){return output({...data,entrega:{ok:false,error:S(e.message)},advertencia:'SAP confirmado; conciliacion ABAS pendiente'})}
    }
    try{
     const telegram=await notificarConfirmacion(db,folio,centro)
     return output({...data,telegram,advertencia:telegram.errores.length?'SAP confirmado; revisar notificaciones Telegram':undefined})
    }catch(e){
     return output({...data,telegram:{enviados:[],errores:[S(e.message)]},advertencia:'SAP confirmado; Telegram pendiente'})
    }
   }
   return output(data)
  }
  return output({ok:false,error:'ACCION_INVALIDA'},400)
 }catch(e){return output({ok:false,error:e.message},500)}
}
