import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const response=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(req){
 try{
  const {NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key,SUPABASE_SECRET_KEY:fallback}=process.env
  if(!url||!(key||fallback))return response({ok:false,error:'SUPABASE_NO_CONFIGURADO'},503)
  const data=await req.json()
  const centro=String(data.distrito||'').trim().toUpperCase()
  const token=String(data.token||'').trim()
  const tipo=String(data.tipo||'').trim().toUpperCase()
  const lote=String(data.lote||'').trim()
  if(!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)||!token||!['STOCK_TECNICOS','STOCK_ALMACEN','IQ09_EQUIPOS'].includes(tipo)||lote.length>180)return response({ok:false,error:'PARAMETROS_INVALIDOS'},400)
  const db=createClient(url,key||fallback,{auth:{persistSession:false,autoRefreshToken:false}})
  if(data.action==='batch'){
   if(!Array.isArray(data.filas)||data.filas.length<1||data.filas.length>150||!Number.isInteger(data.offset))return response({ok:false,error:'LOTE_INVALIDO'},400)
   const {data:out,error}=await db.rpc('qiora_excel_inventario_lote',{p_distrito:centro,p_token:token,p_tipo:tipo,p_lote:lote,p_offset:data.offset,p_filas:data.filas})
   return error?response({ok:false,error:error.message},400):response(out)
  }
  if(data.action==='commit'){
   if(!Number.isInteger(data.total)||data.total<1)return response({ok:false,error:'TOTAL_INVALIDO'},400)
   const {data:out,error}=await db.rpc('qiora_excel_inventario_commit',{p_distrito:centro,p_token:token,p_tipo:tipo,p_lote:lote,p_total:data.total})
   return error?response({ok:false,error:error.message},400):response(out)
  }
  return response({ok:false,error:'ACCION_INVALIDA'},400)
 }catch(e){return response({ok:false,error:String(e.message||e)},500)}
}
