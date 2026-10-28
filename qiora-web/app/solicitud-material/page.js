'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const T = x => String(x ?? '').trim()
const N = x => Number(x || 0)
const dinero = x => N(x).toLocaleString('es-MX', {maximumFractionDigits: 3})
const fecha = x => x ? new Intl.DateTimeFormat('es-MX',{dateStyle:'short',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(x)) : '-'

export default function SolicitudMaterialPage() {
  const router = useRouter()
  const [cargando,setCargando] = useState(true)
  const [ocupado,setOcupado] = useState(false)
  const [error,setError] = useState('')
  const [mensaje,setMensaje] = useState('')
  const [contexto,setContexto] = useState(null)
  const [catalogo,setCatalogo] = useState([])
  const [solicitudes,setSolicitudes] = useState([])
  const [puedeAutorizar,setPuedeAutorizar] = useState(false)
  const [almacen,setAlmacen] = useState('')
  const [busqueda,setBusqueda] = useState('')
  const [motivo,setMotivo] = useState('')
  const [carrito,setCarrito] = useState([])
  const [respuestas,setRespuestas] = useState({})

  const cargar = useCallback(async () => {
    setCargando(true);setError('')
    try {
      const {data:{user},error:authError} = await supabase.auth.getUser()
      if(authError || !user) { router.replace('/');return }
      const {data:perfil,error:perfilError} = await supabase.rpc('qiora_mi_perfil')
      if(perfilError) throw perfilError
      if(!perfil?.activo || !(perfil.solicitud_material || perfil.ver_solicitud || perfil.ver_solicitudes)) throw Error('No tienes permiso para Solicitud de Material.')
      const [c,l] = await Promise.all([
        supabase.rpc('qiora_solicitud_catalogo',{p_almacen:null}),
        supabase.rpc('qiora_solicitud_listar',{p_limite:100})
      ])
      if(c.error) throw c.error
      if(l.error) throw l.error
      setContexto(c.data)
      setCatalogo(c.data?.filas || [])
      setSolicitudes(l.data?.filas || [])
      setPuedeAutorizar(Boolean(l.data?.puede_autorizar))
    } catch(e) {setError(e.message || 'No se pudo cargar la información.')} finally {setCargando(false)}
  },[router])

  useEffect(()=>{cargar()},[cargar])
  const filtrados=useMemo(()=>catalogo.filter(x=>(!almacen || T(x.almacen).toUpperCase() === almacen) &&
    (!busqueda || [x.sku,x.descripcion,x.lote].some(y=>T(y).toUpperCase().includes(busqueda.toUpperCase())))).slice(0,250),[catalogo,almacen,busqueda])
  const almacenes=useMemo(()=>[...new Set(catalogo.map(x=>T(x.almacen).toUpperCase()))].filter(Boolean).sort(),[catalogo])
  const totalCarrito=carrito.reduce((n,x)=>n+N(x.cantidad),0)

  function agregar(fila) {
    setError('');setMensaje('')
    if(!almacen){setError('Selecciona primero el almacén que entregará el material.');return}
    if(T(fila.almacen).toUpperCase()!==almacen){setError('El material no pertenece al almacén seleccionado.');return}
    const llave=T(fila.sku)+'|'+T(fila.lote)
    if(carrito.some(x=>x.llave===llave)){setError('Este material y lote ya están agregados.');return}
    setCarrito(v=>[...v,{llave,sku:T(fila.sku),descripcion:T(fila.descripcion),lote:T(fila.lote),cantidad:'1',disponible:N(fila.disponible)}])
  }
  async function crear(e){
    e.preventDefault();setError('');setMensaje('')
    if(!almacen || !carrito.length){setError('Selecciona un almacén y al menos un material.');return}
    if(carrito.some(x=>!Number.isFinite(N(x.cantidad)) || N(x.cantidad)<=0 || N(x.cantidad)>x.disponible)){
      setError('Revisa las cantidades. No pueden ser cero ni superar la existencia consultada.');return
    }
    setOcupado(true)
    try{
      const {data,error:e}=await supabase.rpc('qiora_solicitud_crear',{
        p_almacen_origen:almacen,p_motivo:motivo,
        p_materiales:carrito.map(x=>({sku:x.sku,lote:x.lote,cantidad:Number(x.cantidad)}))
      })
      if(e) throw e
      if(!data?.ok) throw Error('No se pudo registrar la solicitud.')
      setMensaje('Solicitud '+data.folio+' registrada como PENDIENTE.')
      setCarrito([]);setMotivo('')
      await cargar()
    }catch(e){setError(e.message||'Error al registrar solicitud.')}finally{setOcupado(false)}
  }
  async function resolver(folio,estado){
    setError('');setMensaje('')
    if(!window.confirm('¿Confirmas '+(estado==='AUTORIZADA'?'autorizar':'rechazar')+' '+folio+'?'))return
    setOcupado(true)
    try{
      const {data,error:e}=await supabase.rpc('qiora_solicitud_resolver',{p_folio:folio,p_estado:estado,p_respuesta:respuestas[folio]||''})
      if(e)throw e
      if(!data?.ok)throw Error('No fue posible actualizar la solicitud.')
      setMensaje(folio+' actualizado a '+estado)
      await cargar()
    }catch(e){setError(e.message||'No se pudo actualizar.')}finally{setOcupado(false)}
  }

  return <main className="qsm">
    <div className="contenedor">
      <button className="volver" onClick={()=>router.push('/')}>← Menú principal</button>
      <header><h1>SOLICITUD DE MATERIAL</h1><p>QIORA CONECTA · Solicitudes y autorizaciones · No genera movimientos SAP</p></header>
      {error && <div role="alert" className="error">{error}</div>}
      {mensaje && <div role="status" className="exito">{mensaje}</div>}
      {cargando ? <p>Cargando solicitudes y existencias...</p> : <>
        <section className="panel"><h2>Datos de la solicitud</h2>
          <p>Distrito: <strong>{contexto?.distrito}</strong> · Almacén solicitante: <strong>{contexto?.mi_almacen}</strong></p>
          {contexto?.puede_crear ? <form onSubmit={crear}>
            <div className="filtros">
              <label>Almacén de origen (entrega)<select value={almacen} onChange={e=>{setAlmacen(e.target.value);setCarrito([])}}><option value="">Selecciona almacén</option>{almacenes.map(a=><option key={a}>{a}</option>)}</select></label>
              <label>Buscar SKU, descripción o lote<input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar material" /></label>
            </div>
            <div className="tabla"><table><thead><tr><th>SKU</th><th>Material</th><th>Lote</th><th>Disponible</th><th>Acción</th></tr></thead><tbody>
              {filtrados.map((x,i)=><tr key={x.almacen+'|'+x.sku+'|'+x.lote+'|'+i}><td>{x.sku}</td><td>{x.descripcion}</td><td>{x.lote||'-'}</td><td>{dinero(x.disponible)}</td><td><button type="button" disabled={!almacen} onClick={()=>agregar(x)}>Agregar</button></td></tr>)}
              {!filtrados.length&&<tr><td colSpan="5">No hay existencias para los filtros seleccionados.</td></tr>}
            </tbody></table></div>
            <h3>Materiales solicitados ({carrito.length})</h3>
            <div className="tabla"><table><thead><tr><th>SKU</th><th>Material</th><th>Lote</th><th>Disponible</th><th>Cantidad solicitada</th><th></th></tr></thead><tbody>
              {carrito.map(x=><tr key={x.llave}><td>{x.sku}</td><td>{x.descripcion}</td><td>{x.lote||'-'}</td><td>{dinero(x.disponible)}</td><td><input className="cantidad" type="number" min="0.001" step="any" max={x.disponible} value={x.cantidad} onChange={e=>setCarrito(v=>v.map(y=>y.llave===x.llave?{...y,cantidad:e.target.value}:y))}/></td><td><button type="button" onClick={()=>setCarrito(v=>v.filter(y=>y.llave!==x.llave))}>Quitar</button></td></tr>)}
              {!carrito.length&&<tr><td colSpan="6">Sin materiales seleccionados.</td></tr>}
            </tbody></table></div>
            <p>Total de unidades solicitadas: <strong>{dinero(totalCarrito)}</strong></p>
            <label>Motivo de la solicitud<textarea maxLength={1000} rows={3} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Describe el motivo" /></label>
            <button className="principal" type="submit" disabled={ocupado||!carrito.length||!almacen}>Registrar solicitud</button>
          </form>:<p>Tu perfil permite consultar, pero no registrar solicitudes nuevas.</p>}
        </section>
        <section className="panel"><div className="titulo"><h2>Historial de solicitudes</h2><button onClick={cargar} disabled={ocupado}>Actualizar</button></div>
          <div className="tabla"><table><thead><tr><th>Folio / Fecha</th><th>Solicitante</th><th>Origen → Destino</th><th>Materiales</th><th>Estado</th><th>Resolución</th></tr></thead><tbody>
            {solicitudes.map(s=><tr key={s.folio}><td><strong>{s.folio}</strong><br/>{fecha(s.creado_en)}</td><td>{s.solicitante_nombre}</td><td>{s.almacen_origen} → {s.almacen_destino}</td><td>{(s.materiales||[]).map((m,i)=><div key={i}>{m.sku} · {m.lote||'Sin lote'} · {dinero(m.cantidad)}</div>)}</td><td><strong>{s.estado}</strong>{s.respuesta&&<p>{s.respuesta}</p>}</td><td>{puedeAutorizar&&s.estado==='PENDIENTE'?<div className="acciones"><input placeholder="Comentario (opcional)" value={respuestas[s.folio]||''} maxLength={1000} onChange={e=>setRespuestas(v=>({...v,[s.folio]:e.target.value}))}/><button disabled={ocupado} onClick={()=>resolver(s.folio,'AUTORIZADA')}>Autorizar</button><button disabled={ocupado} onClick={()=>resolver(s.folio,'RECHAZADA')}>Rechazar</button></div>:'-'}</td></tr>)}
            {!solicitudes.length&&<tr><td colSpan="6">Sin solicitudes registradas.</td></tr>}
          </tbody></table></div>
        </section>
      </>}
    </div>
    <style jsx>{`
      .qsm{min-height:100vh;background:#062d23;color:#f3fff9;font-family:Arial,Helvetica,sans-serif;padding:16px}
      .contenedor{max-width:1320px;margin:auto}.volver,button{background:#147f60;color:white;border:0;padding:10px 14px;border-radius:9px;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}
      header{background:linear-gradient(110deg,#0c503d,#169b76);border-radius:15px;padding:22px;margin:12px 0 20px;text-align:center}h1{margin:0}header p{margin-bottom:0}
      .panel{background:#0c4135;border:1px solid #4f947d;border-radius:15px;padding:18px;margin-bottom:18px}h2{margin-top:0;font-size:20px}
      .filtros{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:15px 0}label{display:block;font-weight:600;margin-bottom:12px}
      input,select,textarea{display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:7px;border:1px solid #bdd4cb;border-radius:8px;background:white;color:#172e25;font:inherit}textarea{resize:vertical}
      .tabla{overflow-x:auto;margin:10px 0 18px}table{border-collapse:collapse;width:100%;background:#f7fbf9;color:#173629;min-width:800px}th{background:#126b51;color:white;text-align:left}td,th{padding:10px;border-bottom:1px solid #c7ded5;font-size:13px;vertical-align:top}
      .cantidad{width:100px}.principal{font-weight:700;padding:13px 18px;background:#14a77b}.titulo{display:flex;justify-content:space-between;align-items:center;gap:10px}.acciones{min-width:180px}.acciones button{margin:5px 5px 0 0}
      .error{padding:14px;background:#ffdddd;color:#841717;margin:12px 0;border-radius:8px}.exito{padding:14px;background:#d5f4e6;color:#125b36;margin:12px 0;border-radius:8px}
    `}</style>
  </main>
}
