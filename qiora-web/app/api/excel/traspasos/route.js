import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const S = x => String(x ?? '').trim()
function output(json,status=200){return NextResponse.json(json,{status,headers:{'Cache-Control':'no-store'}})}
function dateMx(v){const d=new Date(v||Date.now());if(isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}
function cell(v){return S(v).replace(/[\t\r\n]/g,' ').slice(0,3000)}
function sheetLine(t,m){
 const series=Array.isArray(m.series)?m.series.slice(0,15):[]
 const values=[
  'TRAS-'+S(t.origen)+'-'+S(t.destino), dateMx(t.fecha), S(t.solicitado_por).split('|')[0].trim(),
  m.sku, m.descripcion||m.material, m.cantidad, t.distrito,t.origen,t.tecnico_origen,t.destino,t.tecnico_destino,
  m.lote, m.requiere_series==='SI'||series.length>0?'SI':'NO',t.orden_servicio||'TRASPASO','PENDIENTE',
  t.folio_control,'PENDIENTE','','','', '',...Array.from({length:15},(_,i)=>series[i]||'')]
 return values.map(cell).join('\t')
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
    const mats=Array.isArray(t.materiales)?t.materiales:[]
    for(const m of mats){if((m.series||[]).length>15)return output({ok:false,error:'Folio '+t.folio_control+' contiene mas de 15 series por renglon'},422);lines.push(sheetLine(t,m))}
   }
   return new Response(lines.join('\n'),{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})
  }
  if(action==='resultado_sap'){
   const estado=S(d.estadoBot||d.estado_bot||d.estado).toUpperCase()
   const doc=S(d.documentoSAP||d.documento_sap)
   const {data,error}=await db.rpc('qiora_excel_resultado_traspaso',{
    p_distrito:centro,p_token:token,p_folio_control:S(d.folioControl||d.folio_control),
    p_estado:estado,p_documento_sap:estado==='REALIZADO'?doc:'',
    p_mensaje_sap:S(d.mensajeSAP||d.mensaje_sap||(estado==='NO REALIZADO'?doc:''))
   })
   if(error)return output({ok:false,error:error.message},error.message.includes('TOKEN_INVALIDO')?403:409)
   return output(data)
  }
  return output({ok:false,error:'ACCION_INVALIDA'},400)
 }catch(e){return output({ok:false,error:e.message},500)}
}
