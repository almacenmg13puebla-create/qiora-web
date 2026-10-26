'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {supabase} from '../../lib/supabase'

const vacio=()=>({sku:'',descripcion:'',cantidad:'1',lote:'',series:''})
const estilo={background:'#082d23',color:'#e6fff3',minHeight:'100vh',padding:'22px',fontFamily:'Arial,sans-serif'}
const panel={border:'1px solid #246d56',borderRadius:12,padding:18,background:'#0c3b2c',marginBottom:18}
const campo={width:'100%',padding:11,borderRadius:8,border:'1px solid #76a899',background:'#fff',color:'#10251e',boxSizing:'border-box'}
const boton={padding:'11px 16px',border:0,borderRadius:8,background:'#13a474',color:'white',fontWeight:700,cursor:'pointer'}
const fila={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:12}
function Field({label,children}){return <label style={{display:'block',fontSize:13,fontWeight:700}}>{label}<div style={{marginTop:6}}>{children}</div></label>}
function Fecha({valor}){return new Date(valor).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}
export default function Traspasos(){
 const router=useRouter();const [permiso,setPermiso]=useState(false),[validando,setValidando]=useState(true)
 const [origen,setOrigen]=useState(''),[destino,setDestino]=useState(''),[folioSAP,setFolioSAP]=useState('')
 const [materiales,setMateriales]=useState([vacio()]),[datos,setDatos]=useState([]),[busca,setBusca]=useState(''),[estado,setEstado]=useState('')
 const [cargando,setCargando]=useState(false),[msg,setMsg]=useState(''),[error,setError]=useState(''),[detalle,setDetalle]=useState(null)
 useEffect(()=>{let vivo=true;(async()=>{try{const {data:{user}}=await supabase.auth.getUser();if(!user){router.replace('/');return};const {data,error:e}=await supabase.rpc('qiora_mi_perfil');if(e)throw e;if(!data?.activo||!(data?.traspasos||data?.capturar_traspaso||data?.ver_traspasos)){throw new Error('Tu usuario no tiene permiso para Traspasos')};if(vivo)setPermiso(true)}catch(e){if(vivo)setError(e.message)}finally{if(vivo)setValidando(false)}})();return()=>{vivo=false}},[router])
 async function consultar(){setCargando(true);setError('');try{const {data,error:e}=await supabase.rpc('qiora_traspasos_listar',{p_buscar:busca.trim(),p_estado:estado});if(e)throw e;setDatos(data||[])}catch(e){setError(e.message)}finally{setCargando(false)}}
 useEffect(()=>{if(permiso)consultar()},[permiso]) // carga inicial
 function cambiar(i,k,v){setMateriales(a=>a.map((m,j)=>i===j?{...m,[k]:v}:m))}
 async function guardar(e){e.preventDefault();setError('');setMsg('');if(!confirm('¿Registrar la solicitud de traspaso? No ejecutará SAP.'))return;setCargando(true);try{
 const items=materiales.map(m=>({sku:m.sku.trim(),descripcion:m.descripcion.trim(),cantidad:Number(m.cantidad),lote:m.lote.trim(),series:m.series.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean)}));
 if(items.some(m=>!m.sku||!Number.isSafeInteger(m.cantidad)||m.cantidad<1))throw new Error('Completa SKU y cantidad válida en cada material');
 const {data,error:e}=await supabase.rpc('qiora_traspasos_crear',{p_origen:origen.trim(),p_destino:destino.trim(),p_materiales:items,p_folio_sap:folioSAP.trim()||null});if(e)throw e;
 setMsg('Solicitud registrada: '+data.folio_control+'. Estado PENDIENTE; SAP aún no ha ejecutado el movimiento.');setOrigen('');setDestino('');setFolioSAP('');setMateriales([vacio()]);await consultar()
 }catch(e){setError(e.message)}finally{setCargando(false)}}
 return <main style={estilo}><div style={{maxWidth:1250,margin:'auto'}}>
 <header style={{position:'sticky',top:0,zIndex:5,background:'#082d23',padding:'12px 0',borderBottom:'1px solid #276c58',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><div><h1 style={{margin:0,fontSize:25}}>QIORA CONECTA · TRASPASOS</h1><small>Solicitudes y seguimiento de traspasos SAP</small></div><button onClick={()=>router.push('/')} style={boton}>Inicio</button></header>
 {error&&<p role="alert" style={{color:'#ffb7b7',background:'#4d1720',padding:12,borderRadius:7}}>{error}</p>}{msg&&<p role="status" style={{color:'#c2ffe2',background:'#07583d',padding:12,borderRadius:7}}>{msg}</p>}
 {validando?<p>Verificando acceso...</p>:permiso?<>
 <section style={panel}><h2 style={{marginTop:0}}>Nuevo traspaso</h2><form onSubmit={guardar}>
 <div style={fila}><Field label="Almacén origen"><input style={campo} required value={origen} maxLength={120} onChange={e=>setOrigen(e.target.value)} placeholder="0022 | Nombre"/></Field><Field label="Almacén destino"><input style={campo} required value={destino} maxLength={120} onChange={e=>setDestino(e.target.value)} placeholder="1929 | Nombre"/></Field><Field label="Folio SAP (si ya existe)"><input style={campo} value={folioSAP} onChange={e=>setFolioSAP(e.target.value)} placeholder="Opcional"/></Field></div>
 <h3>Materiales</h3>{materiales.map((m,i)=><div key={i} style={{border:'1px solid #286c55',borderRadius:9,padding:12,marginBottom:12}}><div style={fila}>
 <Field label="SKU"><input style={campo} required value={m.sku} onChange={e=>cambiar(i,'sku',e.target.value)}/></Field><Field label="Descripción"><input style={campo} value={m.descripcion} onChange={e=>cambiar(i,'descripcion',e.target.value)}/></Field><Field label="Cantidad"><input style={campo} type="number" min="1" step="1" required value={m.cantidad} onChange={e=>cambiar(i,'cantidad',e.target.value)}/></Field><Field label="Lote"><input style={campo} value={m.lote} onChange={e=>cambiar(i,'lote',e.target.value)} placeholder="TPE NUEVO"/></Field></div>
 <Field label="Series (una por línea, o separadas por coma)"><textarea style={{...campo,minHeight:65}} value={m.series} onChange={e=>cambiar(i,'series',e.target.value)}/></Field>
 {materiales.length>1&&<button type="button" style={{...boton,background:'#af3742',marginTop:8}} onClick={()=>setMateriales(a=>a.filter((_,j)=>i!==j))}>Quitar material</button>}</div>)}
 <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" style={{...boton,background:'#286e91'}} onClick={()=>setMateriales(a=>[...a,vacio()])}>+ Agregar material</button><button type="submit" style={boton} disabled={cargando}>{cargando?'Guardando...':'Guardar solicitud'}</button></div>
 </form></section>
 <section style={panel}><h2 style={{marginTop:0}}>Consultar traspasos</h2><div style={fila}><Field label="Buscar"><input style={campo} value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Folio, origen, destino, solicitante"/></Field><Field label="Estado"><select style={campo} value={estado} onChange={e=>setEstado(e.target.value)}>{['','PENDIENTE','EN_PROCESO','COMPLETADO','ERROR','CANCELADO'].map(x=><option key={x} value={x}>{x||'TODOS'}</option>)}</select></Field></div><button style={boton} type="button" onClick={consultar} disabled={cargando}>Buscar / Actualizar</button>
 <div style={{overflowX:'auto',marginTop:14}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:850,fontSize:13}}><thead style={{position:'sticky',top:0,background:'#13624b'}}><tr>{['Folio control','Fecha','Origen','Destino','Solicitado por','Estado','SAP','Detalle'].map(t=><th key={t} style={{textAlign:'left',padding:10}}>{t}</th>)}</tr></thead><tbody>{datos.map(d=><tr key={d.id} style={{borderBottom:'1px solid #31725b'}}><td style={{padding:10}}>{d.folio_control}</td><td style={{padding:10}}><Fecha valor={d.creado_en}/></td><td style={{padding:10}}>{d.origen}</td><td style={{padding:10}}>{d.destino}</td><td style={{padding:10}}>{d.solicitado_por}</td><td style={{padding:10}}>{d.estado}</td><td style={{padding:10}}>{d.folio_sap||'—'}</td><td style={{padding:10}}><button style={boton} onClick={()=>setDetalle(d)}>Ver</button></td></tr>)}</tbody></table>{datos.length===0&&<p>No hay traspasos para mostrar.</p>}</div></section>
 {detalle&&<section style={panel}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><h2>Detalle {detalle.folio_control}</h2><button style={boton} onClick={()=>setDetalle(null)}>Cerrar</button></div><p>Distrito: {detalle.distrito} · Estado: {detalle.estado} · Folio SAP: {detalle.folio_sap||'Sin registrar'}</p><div style={{overflowX:'auto'}}><table style={{width:'100%'}}><thead><tr>{['SKU','Descripción','Cantidad','Lote','Series'].map(x=><th key={x} style={{textAlign:'left'}}>{x}</th>)}</tr></thead><tbody>{(detalle.materiales||[]).map((m,i)=><tr key={i}><td>{m.sku}</td><td>{m.descripcion}</td><td>{m.cantidad}</td><td>{m.lote}</td><td>{(m.series||[]).join(', ')}</td></tr>)}</tbody></table></div>{detalle.detalle_error&&<p style={{color:'#ffbaba'}}>Error SAP: {detalle.detalle_error}</p>}</section>}
 </>:null}</div></main>
}
