'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {supabase} from '../../lib/supabase'
const s=x=>String(x??'').trim()
const n=x=>Number(x||0)
const uuid=()=>crypto.randomUUID()
export default function SolicitudMaterial(){
 const router=useRouter();const [ctx,C]=useState(null),[token,T]=useState(''),[almacen,A]=useState(''),[ref,R]=useState(''),[cantidad,Q]=useState(1),[items,I]=useState([]),[busy,B]=useState(false),[err,E]=useState(''),[ok,O]=useState('')
 const rpc=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
 const cargar=useCallback(async(t)=>{const [c,r]=await Promise.all([rpc('qiora_material_contexto',{}),rpc('qiora_material_mis_reservas',{p_token:t})]);C(c);A(c.almacen);I(r||[])},[])
 useEffect(()=>{const t=sessionStorage.getItem('qiora_mat_token')||uuid();sessionStorage.setItem('qiora_mat_token',t);T(t);cargar(t).catch(e=>E(e.message))},[cargar])
 // Un grupo se muestra una sola vez; los SKU del grupo solo se asignan al reservar.
 const catalogo=ctx?.catalogo||[]
 const grupos=[...new Set(catalogo.map(m=>s(m.grupo)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'))
 const esGrupo=ref.startsWith('GRUPO:')
 const nombreGrupo=esGrupo?ref.slice(6):''
 const miembros=esGrupo?catalogo.filter(m=>s(m.grupo).toUpperCase()===nombreGrupo.toUpperCase()):[]
 const seleccion=esGrupo?null:catalogo.find(m=>s(m.sku)===ref)
 const grupo=s(seleccion?.grupo||nombreGrupo)
 const maximo=esGrupo?Math.max(0,...miembros.map(m=>n(m.maximo))):n(seleccion?.maximo)
 const skus=esGrupo?new Set(miembros.map(m=>s(m.sku))):new Set(ref?[ref]:[])
 const stockTec=(ctx?.stock_tecnicos||[]).filter(x=>skus.has(s(x.sku))).reduce((a,x)=>a+n(x.disponible),0)
 const reservas=ctx?.reservas||[]
 const pendiente=reservas.filter(x=>s(x.tecnico_almacen)===s(almacen) && (grupo?s(x.grupo).toUpperCase()===grupo.toUpperCase():skus.has(s(x.sku)))).reduce((a,x)=>a+n(x.cantidad),0)
 const origenCentral='ME'+s(ctx?.distrito).slice(-2)
 const lotesCentral=(ctx?.stock_almacen||[]).filter(x=>s(x.origen).toUpperCase()===origenCentral.toUpperCase()&&skus.has(s(x.sku))&&(!esGrupo||s(x.lote).toUpperCase().startsWith('TPE')))
 const stockCentral=lotesCentral.reduce((a,x)=>a+n(x.disponible),0)
 const pendienteCentral=reservas.filter(x=>s(x.origen).toUpperCase()===origenCentral.toUpperCase()&&skus.has(s(x.sku))&&(!esGrupo||s(x.lote).toUpperCase().startsWith('TPE'))).reduce((a,x)=>a+n(x.cantidad),0)
 const disponibleCentral=Math.max(0,stockCentral-pendienteCentral)
 const restoMaximo=maximo>0?Math.max(0,maximo-stockTec-pendiente):null
 const opcionesSku=catalogo.filter(m=>!s(m.grupo))
 async function agregar(){B(true);E('');O('');try{if(!ref)throw Error('Selecciona material o grupo.');if(!Number.isInteger(Number(cantidad))||Number(cantidad)<1)throw Error('Cantidad invalida.');if(restoMaximo!==null&&Number(cantidad)>restoMaximo)throw Error('MAXIMO ALCANZADO: el tecnico tiene '+stockTec+' y '+pendiente+' reservado; maximo '+maximo+'.');if(disponibleCentral<=0)throw Error('SIN EXISTENCIAS: todas las unidades del almacen central estan agotadas o reservadas.');await rpc('qiora_material_reservar',{p_token:token,p_almacen:almacen,p_referencia:ref,p_cantidad:Number(cantidad)});await cargar(token);O('Material validado y reservado.')}catch(e){E(e.message)}finally{B(false)}}
 async function eliminar(id){B(true);E('');try{await rpc('qiora_material_eliminar',{p_token:token,p_reserva_id:id});await cargar(token);O('Reserva liberada.')}catch(e){E(e.message)}finally{B(false)}}
 async function enviar(){B(true);E('');try{const d=await rpc('qiora_material_enviar',{p_token:token});O('SOLICITUD ENVIADA: '+d.folio+' · PENDIENTE');const t=uuid();sessionStorage.setItem('qiora_mat_token',t);T(t);I([]);await cargar(t)}catch(e){E(e.message)}finally{B(false)}}
 return <main className="qmat"><div className="wrap"><button onClick={()=>router.push('/')}>← Regresar al menú</button><header><h1>Solicitud de Material</h1><p>La fecha de entrega se asigna automáticamente según el día de solicitud.</p></header>
 <section className="panel"><div className="fields"><label>Almacén (1 a 4 dígitos)<input value={almacen} readOnly/></label><label>Técnico<input value={ctx?.tecnico||''} readOnly/></label></div></section>
 <section className="panel"><label>Material<select value={ref} onChange={e=>R(e.target.value)}><option value="">Seleccione material o grupo</option>{opcionesSku.map(x=><option key={x.sku} value={x.sku}>{x.sku} {x.material} MÁXIMO {x.maximo??'—'}</option>)}{grupos.map(g=><option key={'g'+g} value={'GRUPO:'+g}>{g} MÁXIMO {Math.max(0,...catalogo.filter(m=>s(m.grupo)===g).map(m=>n(m.maximo)))}</option>)}</select></label><label>Cantidad<input type="number" min="1" step="1" value={cantidad} onChange={e=>Q(e.target.value)}/></label>
 <div className="chips"><span>Máximo permitido: {maximo||'—'}</span><span>Stock técnico: {stockTec}</span><span>Reservas del técnico: {pendiente}</span><span>Stock almacén: {stockCentral}</span><span>Reservado almacén: {pendienteCentral}</span><span>Disponible para solicitar: {disponibleCentral}</span>{restoMaximo!==null&&<span>Restante según máximo: {restoMaximo}</span>}</div><button className="orange" onClick={agregar} disabled={busy||!token||!ref||disponibleCentral<=0||(restoMaximo!==null&&restoMaximo<=0)}>+ Agregar Material</button></section>
 <section className="panel"><h3>Materiales agregados</h3><div className="scroll"><table><thead><tr><th>SKU</th><th>Material</th><th>Cantidad</th><th>Lote</th><th>Acción</th></tr></thead><tbody>{items.length?items.map(x=><tr key={x.id}><td>{x.sku}</td><td>{x.material}</td><td>{x.cantidad}</td><td>{x.lote||'—'}</td><td><button className="red" disabled={busy} onClick={()=>eliminar(x.id)}>Eliminar</button></td></tr>):<tr><td colSpan="5">Sin materiales agregados.</td></tr>}</tbody></table></div><button className="green" disabled={busy||!items.length} onClick={enviar}>Enviar Solicitud</button></section>
 {err&&<div className="error" role="alert"><b>NO SE PUEDE AGREGAR / ENVIAR</b><p>{err}</p><button onClick={()=>E('')}>Aceptar</button></div>}{ok&&<div className="success">{ok}</div>}</div><style jsx>{styles}</style></main>
}
const styles=`.qmat{min-height:100vh;background:linear-gradient(145deg,#052b22,#021811);color:white;padding:16px;font:14px Arial}.wrap{max-width:920px;margin:auto}.qmat header,.qmat .panel{border:1px solid #3b766b;border-radius:14px;padding:19px;margin:15px 0;background:#072d26}.qmat header{text-align:center;background:linear-gradient(115deg,#07543e,#17a27a)}.qmat h1{margin:0;font-size:27px}.qmat h3{margin-top:0}.qmat p{font-size:13px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:13px}.qmat label{display:block;font-weight:bold;margin-bottom:12px}.qmat input,.qmat select{width:100%;display:block;padding:12px;margin-top:5px;border-radius:9px;border:1px solid #bfd4cf;background:#f7fafb;color:#132a25}.qmat button{cursor:pointer;border:0;padding:11px 17px;border-radius:9px;background:#10886e;color:white;font-weight:bold;margin:5px}.qmat button:disabled{opacity:.5;cursor:not-allowed}.qmat .orange{background:#f17811;width:100%;margin:9px 0}.qmat .green{background:#12a65d;width:100%;margin:17px 0 0}.qmat .red{background:#dc3333}.chips{display:flex;gap:7px;flex-wrap:wrap}.chips span{background:#0b856b;padding:8px;border-radius:8px}.scroll{overflow-x:auto}.qmat table{width:100%;border-collapse:collapse;background:#f8faf9;color:#123329}.qmat th{background:#087456;color:#fff}.qmat td,.qmat th{padding:10px;border:1px solid #cedbd6}.qmat .error{position:fixed;left:50%;top:36%;transform:translate(-50%,-25%);background:white;color:#be2525;padding:28px;border-radius:16px;text-align:center;max-width:460px;width:92%;box-shadow:0 0 0 100vw #0009;z-index:10}.qmat .error button{background:#d33}.qmat .success{padding:12px;background:#bbf9d4;color:#07542b;border-radius:9px}@media(max-width:640px){.fields{grid-template-columns:1fr}}`
