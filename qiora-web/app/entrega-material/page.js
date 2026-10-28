'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const str = v => String(v ?? '').trim()
const normal = v => str(v).toUpperCase()
const esTPE = lote => /^TPE/i.test(str(lote))
const cantidad = m => Number(m.cantidad) || 0
const normalizar = (m, i) => ({
  ...m,
  _key: String(m.id ?? `${m.sku}-${m.lote}-${i}`),
  sku: str(m.sku),
  descripcion: str(m.descripcion || m.material),
  material: str(m.material || m.descripcion),
  lote: str(m.lote),
  cantidad: Number(m.cantidad),
  series: Array.isArray(m.series) ? m.series.map(normal).filter(Boolean) : []
})

export default function EntregaMaterial() {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [pendientes, setPendientes] = useState([])
  const [folio, setFolio] = useState('')
  const [controlGuardado, setControlGuardado] = useState('')
  const [buscarControl, setBuscarControl] = useState('')
  const [guardada, setGuardada] = useState(false)
  const [almacen, setAlmacen] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [fecha, setFecha] = useState('')
  const [retiro, setRetiro] = useState('')
  const [estatus, setEstatus] = useState('')
  const [materiales, setMateriales] = useState([])
  const [seleccion, setSeleccion] = useState('')
  const [captura, setCaptura] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [manual, setManual] = useState(false)
  const [nuevoSku, setNuevoSku] = useState('')
  const [buscandoSku, setBuscandoSku] = useState(false)
  const [errorSku, setErrorSku] = useState('')
  const ultimaBusquedaSku = useRef(0)
  const [nuevoLotes, setNuevoLotes] = useState([])
  const [nuevoLote, setNuevoLote] = useState('')
  const [nuevoCantidad, setNuevoCantidad] = useState(1)
  const [editando, setEditando] = useState('')
  const [editCantidad, setEditCantidad] = useState(1)

  const cargarSolicitud = useCallback(s => {
    setFolio(str(s.folio)); setAlmacen(str(s.almacen).padStart(4, '0'))
    setTecnico(str(s.tecnico)); setFecha(str(s.fecha)); setRetiro(str(s.fecha_retiro))
    setEstatus(str(s.estatus));
    const items = (Array.isArray(s.materiales) ? s.materiales : []).map(normalizar)
    // Recuperar borrador de series TPE por solicitud y fila. Nunca altera las reservas.
    try {
      const raw = window.localStorage.getItem('qiora_series_draft_' + str(s.folio))
      const draft = raw ? JSON.parse(raw) : {}
      for (const m of items) {
        const k = `${m.id ?? ''}|${m.sku}|${m.lote}|${m.cantidad}`
        const saved = draft[k]
        if (esTPE(m.lote) && Array.isArray(saved) && saved.length <= m.cantidad && new Set(saved).size === saved.length) m.series = saved.map(normal)
      }
    } catch (_) {}
    setMateriales(items)
    setGuardada(false); setControlGuardado('')
    setSeleccion(items.find(m => esTPE(m.lote))?._key || '')
    setCaptura(''); setManual(false); setError(''); setExito(''); setNuevoSku('');setNuevoLotes([]);setNuevoLote('');setErrorSku('');setEditando('')
  }, [])

  // Cargar la entrega ya registrada directamente desde Supabase, incluyendo sus series.
  const cargarGuardada = useCallback(async (control, mostrarError = true) => {
    const codigo = normal(control)
    if (!/^ABAS-[0-9]{8}$/.test(codigo)) {
      if (mostrarError) setError('Capture un FOLIO_CONTROL válido, ejemplo ABAS-00000001.')
      return
    }
    setBusy(true); setError('')
    try {
      const {data, error: e} = await supabase.rpc('qiora_material_consultar_entrega_guardada', {p_folio_control: codigo})
      if (e) throw e
      if (!data?.folio_control) throw new Error('No se encontró la entrega guardada.')
      const items = (Array.isArray(data.materiales) ? data.materiales : []).map(normalizar)
      setMateriales(items)
      setFolio(str(data.folio_solicitud)); setAlmacen(str(data.destino))
      setTecnico(str(data.tecnico)); setFecha(str(data.creado_en)); setRetiro('')
      setEstatus(str(data.estado)); setSeleccion(items.find(m => esTPE(m.lote))?._key || '')
      setGuardada(true); setControlGuardado(codigo); setBuscarControl(codigo)
      setCaptura(''); setNuevoSku(''); setErrorSku(''); setPendientes([])
      setExito('Entrega guardada · ' + codigo + ' · series recuperadas desde Supabase.')
      try { window.localStorage.setItem('qiora_ultima_entrega_control',codigo) } catch (_) {}
      window.history.replaceState(null, '', window.location.pathname + '?folio_control=' + encodeURIComponent(codigo))
    } catch (e) { if (mostrarError) setError(e?.message || 'No se pudo cargar la entrega.') }
    finally { setBusy(false) }
  }, [])

  // Conservar series escaneadas incluso antes de Guardar Entrega.
  useEffect(() => {
    if (!folio || guardada || !materiales.length) return
    const draft = {}
    for (const m of materiales) {
      if (esTPE(m.lote) && m.series.length) draft[`${m.id ?? ''}|${m.sku}|${m.lote}|${m.cantidad}`] = m.series
    }
    try { window.localStorage.setItem('qiora_series_draft_' + folio, JSON.stringify(draft)) } catch (_) {}
  }, [folio, materiales, guardada])

  const buscarPendientes = useCallback(async (a, f = '') => {
    const almacenNormal = str(a).padStart(4, '0')
    if (!/^[0-9]{4}$/.test(almacenNormal) && !f) {
      setError('Capture el almacén del técnico (1 a 4 dígitos).'); return
    }
    setBusy(true); setError(''); setExito('')
    try {
      const {data, error: e} = await supabase.rpc('qiora_material_listar', {
        p_folio: f, p_almacen: f ? '' : almacenNormal,
        p_estatus: '', p_desde: null, p_hasta: null
      })
      if (e) throw e
      const lista = (Array.isArray(data) ? data : []).filter(s =>
        ['PENDIENTE', 'EN_PREPARACION'].includes(normal(s.estatus)) &&
        (!f || str(s.folio) === str(f)) &&
        (f || str(s.almacen).padStart(4,'0') === almacenNormal)
      )
      setPendientes(lista)
      if (!lista.length) {
        setFolio(''); setMateriales([]); setSeleccion('');
        setError('El técnico no tiene solicitudes pendientes.'); return
      }
      cargarSolicitud(lista[0])
    } catch (e) { setError(e?.message || 'No fue posible consultar solicitudes.') }
    finally { setBusy(false) }
  }, [cargarSolicitud])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const control = query.get('folio_control') || (() => { try { return window.localStorage.getItem('qiora_ultima_entrega_control') || '' } catch (_) { return '' } })()
    if (control) cargarGuardada(control, !!query.get('folio_control'))
    else if (query.get('folio')) buscarPendientes('', query.get('folio'))
  }, [buscarPendientes, cargarGuardada])

  const objetivo = materiales.find(m => m._key === seleccion)
  const faltantes = useMemo(() => materiales.filter(m => esTPE(m.lote) && (
    !Number.isInteger(cantidad(m)) || cantidad(m) <= 0 ||
    m.series.length !== cantidad(m) ||
    new Set(m.series.map(normal)).size !== m.series.length
  )), [materiales])
  const duplicadasGlobales = useMemo(() => {
    const todas = materiales.flatMap(m => m.series.map(normal))
    return new Set(todas).size !== todas.length
  }, [materiales])
  const puedeGuardar = !guardada && !!folio && materiales.length > 0 && !busy && !manual && !faltantes.length && !duplicadasGlobales

  const consultarSku = useCallback(async (skuValor, mostrarErrores = false) => {
    const sku = str(skuValor).toUpperCase()
    const id = ++ultimaBusquedaSku.current
    if (!folio || !sku) {
      setNuevoLotes([]); setNuevoLote(''); setBuscandoSku(false)
      if (mostrarErrores) setErrorSku('Seleccione una solicitud e indique un SKU.')
      return
    }
    setBuscandoSku(true); setErrorSku(''); setError('')
    try {
      const {data,error:e} = await supabase.rpc('qiora_material_stock_sku_entrega', {
        p_folio:folio, p_sku:sku
      })
      if (id !== ultimaBusquedaSku.current) return
      if (e) throw e
      const lotes = (Array.isArray(data?.lotes) ? data.lotes : [])
        .filter(x => Number(x.disponible) > 0)
        .map(x => ({...x, lote:str(x.lote), material:str(x.material)}))
      if (!lotes.length) {
        setNuevoLotes([]); setNuevoLote('')
        setErrorSku('SKU inexistente o sin existencias disponibles en STOCK_ALMACEN.')
        return
      }
      setNuevoLotes(lotes)
      setNuevoLote(anterior => lotes.some(x => x.lote === anterior) ? anterior : lotes[0].lote)
      setNuevoCantidad(c => Number(c) > 0 ? c : 1)
    } catch(e) {
      if (id === ultimaBusquedaSku.current) {
        setNuevoLotes([]); setNuevoLote('')
        setErrorSku(e?.message || 'No se pudo consultar STOCK_ALMACEN.')
      }
    } finally {
      if (id === ultimaBusquedaSku.current) setBuscandoSku(false)
    }
  }, [folio])

  useEffect(() => {
    const sku = str(nuevoSku)
    ++ultimaBusquedaSku.current
    setNuevoLotes([]);setNuevoLote('');setErrorSku('')
    if (!folio || !sku) {setBuscandoSku(false);return}
    // Debounce: permite escanear el SKU sin lanzar una consulta por cada digito.
    const timer = setTimeout(() => consultarSku(sku), 350)
    return () => clearTimeout(timer)
  }, [nuevoSku, folio, consultarSku])
  async function actualizarReserva(accion,m=null,nuevaCantidad=null) {
    if (guardada) return setError('La entrega ya fue guardada; no se pueden editar sus materiales.')
    if(!folio || manual)return setError('Seleccione una solicitud pendiente.')
    setBusy(true);setError('');setExito('')
    try{
      const {error:e}=await supabase.rpc('qiora_material_editar_reserva_entrega',{
        p_folio:folio,p_reserva_id:m?.id||null,p_accion:accion,
        p_cantidad:accion==='ELIMINAR'?null:Number(nuevaCantidad),
        p_sku:accion==='AGREGAR'?nuevoSku.trim():null,
        p_lote:accion==='AGREGAR'?nuevoLote:null
      })
      if(e)throw e
      setEditando('');setNuevoSku('');setNuevoLotes([]);setNuevoLote('');setErrorSku('');setNuevoCantidad(1)
      await buscarPendientes('',folio)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function agregarSerie() {
    if (guardada) return setError('La entrega ya fue guardada. Las series registradas son de solo lectura.')
    setError(''); setExito('')
    if (!objetivo || !esTPE(objetivo.lote)) return setError('Seleccione un material con lote TPE.')
    const valor = normal(captura)
    if (!valor) return setError('Escanee o capture una serie.')
    if (materiales.some(m => m.series.includes(valor))) return setError('La serie ya fue capturada en esta entrega.')
    if (objetivo.series.length >= cantidad(objetivo)) return setError('Ya se capturaron todas las series requeridas.')
    setBusy(true)
    try {
      const {error:e}=await supabase.rpc('qiora_material_validar_serie_entrega',{
        p_folio:folio,p_sku:objetivo.sku,p_lote:objetivo.lote,p_serie:valor
      })
      if(e)throw e
    }catch(e){setError(e.message);return}finally{setBusy(false)}
    setMateriales(prev => prev.map(m => m._key === seleccion ? {...m,series:[...m.series,valor]} : m))
    setCaptura('')
  }
  function quitarSerie(valor) {
    if (guardada) return
    setMateriales(prev => prev.map(m => m._key === seleccion ? {...m,series:m.series.filter(s=>s!==valor)} : m))
    setError(''); setExito('')
  }
  function limpiar() {
    setBusqueda(''); setPendientes([]); setFolio(''); setAlmacen(''); setTecnico('')
    setFecha(''); setRetiro(''); setEstatus(''); setMateriales([]); setSeleccion('')
    setGuardada(false);setControlGuardado('');setBuscarControl('');
    window.history.replaceState(null,'',window.location.pathname);
    setCaptura(''); setError(''); setExito(''); setManual(false);setNuevoSku('');setNuevoLotes([]);setNuevoLote('');setErrorSku('');setNuevoCantidad(1);setEditando('')
  }
  async function guardar() {
    if (!puedeGuardar) {setError('Faltan series de lotes TPE o hay series duplicadas.'); return}
    setBusy(true);setError('');setExito('')
    try {
      const payload = materiales.map(m => ({
        id: m.id, sku:m.sku, descripcion:m.descripcion, material:m.material,
        cantidad:m.cantidad, lote:m.lote,
        requiere_series:esTPE(m.lote)?'SI':'NO', series:m.series
      }))
      const {data,error:e} = await supabase.rpc('qiora_material_guardar_entrega', {
        p_folio_solicitud:folio, p_almacen:almacen, p_materiales:payload
      })
      if(e)throw e
      setExito(`Entrega registrada en MIGO. FOLIO ${str(data?.folio)} · FOLIO_CONTROL ${str(data?.folio_control)} · PENDIENTE SAP`)
      setEstatus('EN_PROCESO_SAP')
      // Las series son definitivas en qiora_entregas_registro.materiales.
      // No limpiar la vista: recuperar los datos ya persistidos en Supabase.
      const ctl = str(data?.folio_control)
      if (ctl) {
        try { window.localStorage.removeItem('qiora_series_draft_' + folio) } catch (_) {}
        await cargarGuardada(ctl)
      }
    }catch(e){setError(e?.message||'Error al guardar entrega.')}finally{setBusy(false)}
  }

  return <main className="em"><div className="wrap">
    <button onClick={()=>router.push('/ver-solicitudes')}>← Ver solicitudes</button>
    <header><h1>ENTREGA DE MATERIAL</h1><p>Complemento con materiales cargados desde la hoja Solicitudes.</p></header>
    <section><h3>Buscar solicitudes por almacén</h3>
      <div className="acciones"><label>Almacén<input value={busqueda} maxLength={4} placeholder="0000" onChange={e=>setBusqueda(e.target.value.replace(/\D/g,'').slice(0,4))} /></label>
        <button onClick={()=>buscarPendientes(busqueda)} disabled={busy}>Buscar pendientes</button>
        <button onClick={()=>{setManual(true);setError('La entrega sin solicitud requiere reserva autorizada en Supabase. Esta opción no permite omitir existencias ni máximos.');setExito('')}}>Entrega sin solicitud</button></div>
      <div className="grid"><label>Solicitud pendiente<select value={folio} onChange={e=>{const s=pendientes.find(x=>str(x.folio)===e.target.value);if(s)cargarSolicitud(s)}}><option value="">Primero busque por almacén</option>{pendientes.map(x=><option key={x.folio} value={x.folio}>{x.folio}</option>)}</select></label>
      <label>Almacén<input readOnly value={almacen}/></label><label>Técnico<input readOnly value={tecnico}/></label>
      <label>Fecha solicitud<input readOnly value={fecha?new Date(fecha).toLocaleDateString('es-MX'):''}/></label>
      <label>Fecha retiro<input readOnly value={retiro}/></label><label>Estatus<input readOnly value={estatus}/></label></div>
    </section>
    <section><h3>Consultar entrega guardada</h3>
      <div className="acciones"><label>FOLIO_CONTROL<input placeholder="ABAS-00000001" value={buscarControl} onChange={e=>setBuscarControl(normal(e.target.value))}/></label>
      <button disabled={busy || !buscarControl} onClick={()=>cargarGuardada(buscarControl)}>Ver entrega y series</button></div>
      {guardada&&<p className="ok">Entrega registrada: {controlGuardado}. Las series permanecen guardadas después de actualizar la página. Esta entrega es de solo lectura.</p>}
    </section>
    {!guardada&&<section><h3>Agregar material adicional</h3><p className="muted">Al escribir o escanear un SKU se cargan automáticamente el material y los lotes con existencia de STOCK_ALMACEN.</p>
      <div className="grid">
        <label>SKU<input value={nuevoSku} placeholder="Escanee o escriba SKU" autoComplete="off"
          onChange={e=>setNuevoSku(e.target.value.replace(/[^0-9A-Za-z]/g,'').toUpperCase())}
          onBlur={()=>{if(nuevoSku && !nuevoLotes.length && !buscandoSku)consultarSku(nuevoSku)}}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();consultarSku(nuevoSku)}}}/></label>
        <label>Material<input value={nuevoLotes.find(x=>x.lote===nuevoLote)?.material||nuevoLotes[0]?.material||''} readOnly placeholder={buscandoSku?'Consultando...':'Se llena automático'}/></label>
        <label>Cantidad<input type="number" min="1" max="10000" value={nuevoCantidad} onChange={e=>setNuevoCantidad(e.target.value)}/></label>
        <label>Lote<select value={nuevoLote} onChange={e=>setNuevoLote(e.target.value)} disabled={!nuevoLotes.length}>
          <option value="">Seleccione lote</option>
          {nuevoLotes.map((x,i)=><option key={`${x.lote}-${i}`} value={x.lote}>{x.lote||'SIN LOTE'} · disponible {x.disponible}</option>)}
        </select></label>
        <label>Requiere Series<input readOnly value={esTPE(nuevoLote)?'SI':'NO'}/></label>
        <button className="orange" disabled={busy||buscandoSku||!folio||!nuevoLotes.length||!nuevoLote||!(Number(nuevoCantidad)>0)||Number(nuevoCantidad)>Number(nuevoLotes.find(x=>x.lote===nuevoLote)?.disponible||0)} onClick={()=>actualizarReserva('AGREGAR',null,nuevoCantidad)}>+ Agregar Material</button>
      </div>
      {buscandoSku&&<p className="muted">Buscando SKU en STOCK_ALMACEN...</p>}
      {!!errorSku&&<p className="warn">{errorSku}</p>}
    </section>}
    <section><h3>Materiales agregados</h3><div className="scroll"><table><thead><tr><th>SKU</th><th>Material</th><th>Cantidad</th><th>Lote</th><th>Series</th><th>Acción</th></tr></thead><tbody>
      {materiales.length?materiales.map(m=><tr key={m._key}><td>{m.sku}</td><td>{m.material}</td><td>{m.cantidad}</td><td>{m.lote||'—'}</td><td>{m.series.length?m.series.join(', '):(esTPE(m.lote)?`Faltan ${cantidad(m)} series`:'No requiere')}</td>
        <td><div className="rowbuttons">{!guardada&&<><button className="small" disabled={busy} onClick={()=>{setSeleccion(m._key);setEditando(m._key);setEditCantidad(m.cantidad);setError('')}}>Modificar</button><button className="small red" disabled={busy} onClick={()=>{if(window.confirm('¿Eliminar este material de la solicitud?')) actualizarReserva('ELIMINAR',m)}}>Eliminar</button>{esTPE(m.lote)&&<button className="small" disabled={busy} onClick={()=>setSeleccion(m._key)}>Series</button></>}</div>{!guardada&&editando===m._key&&<div className="editrow"><input type="number" min="1" value={editCantidad} onChange={e=>setEditCantidad(e.target.value)}/><button className="small green" disabled={busy||Number(editCantidad)<1} onClick={()=>actualizarReserva('MODIFICAR',m,editCantidad)}>Aplicar</button><button className="small" onClick={()=>setEditando('')}>Cancelar</button></div>}</td></tr>):<tr><td colSpan={6}>Sin materiales agregados.</td></tr>}
    </tbody></table></div></section>
    {!guardada&&materiales.some(m=>esTPE(m.lote))&&<section><h3>Capturar serie</h3><label>Material TPE<select value={seleccion} onChange={e=>{setSeleccion(e.target.value);setCaptura('');setError('')}}>{materiales.filter(m=>esTPE(m.lote)).map(m=><option key={m._key} value={m._key}>{m.sku} · {m.material} · {m.lote} ({m.series.length}/{m.cantidad})</option>)}</select></label>
      <div className="acciones"><label>Escanee o seleccione serie<input value={captura} onChange={e=>setCaptura(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();agregarSerie()}}} placeholder="Escanee o seleccione serie"/></label><button disabled={!objetivo||busy} onClick={agregarSerie}>+ Agregar serie</button></div>
      <div className="scroll"><table><thead><tr><th>#</th><th>Serie</th><th>Acción</th></tr></thead><tbody>{objetivo?.series.length?objetivo.series.map((s,i)=><tr key={s}><td>{i+1}</td><td>{s}</td><td><button className="small red" disabled={busy} onClick={()=>quitarSerie(s)}>Eliminar</button></td></tr>):<tr><td colSpan={3}>Sin series capturadas.</td></tr>}</tbody></table></div>
      <p className="muted">Series capturadas: {objetivo?.series.length||0} / {objetivo?.cantidad||0}</p>
    </section>}
    {!guardada&&<section><div className="bottom"><button className="green" disabled={!puedeGuardar} onClick={guardar}>{busy?'Guardando...':'Guardar Entrega'}</button><button className="red" disabled={busy} onClick={limpiar}>Limpiar</button></div>
      {!!faltantes.length&&<p className="warn">No se puede guardar: faltan series TPE en {faltantes.map(m=>m.sku+` (${m.series.length}/${m.cantidad})`).join(', ')}.</p>}
      {duplicadasGlobales&&<p className="warn">Existen series duplicadas entre materiales.</p>}
      {!!error&&<p className="warn">{error}</p>}{!!exito&&<p className="ok">{exito}</p>}
    </section>}
    {guardada&&<section><button onClick={limpiar}>Nueva entrega</button>{!!error&&<p className="warn">{error}</p>}</section>}
  </div><style jsx>{css}</style></main>
}

const css = `.skurow{display:flex;gap:5px;align-items:center}.skurow input{flex:1;min-width:0}.rowbuttons{display:flex;gap:5px;justify-content:center;flex-wrap:wrap}.editrow{display:flex;gap:5px;margin-top:8px}.editrow input{width:74px;min-width:0}.em .editrow button{white-space:nowrap}.em{background:#03251e;color:white;min-height:100vh;padding:16px;font:13px Arial}.wrap{max-width:1080px;margin:auto}.em header{background:linear-gradient(120deg,#0a5746,#159f79);text-align:center}.em header,.em section{border:1px solid #346e61;border-radius:12px;padding:17px;margin:13px 0;background:#08342a}.em h1{margin:0}.em h3{margin:0 0 10px}.em label{display:block;font-weight:bold;font-size:12px;min-width:0}.em input,.em select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:0;border-radius:7px;background:#f2f6f8;color:#123;min-height:38px}.em button{background:#119b79;color:white;padding:10px 15px;border:0;border-radius:8px;cursor:pointer;font-weight:bold}.em button:disabled{opacity:.45;cursor:not-allowed}.acciones{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}.em .green{background:#12ae64}.em .red{background:#d33}.em .orange{background:#f57216}.em .small{padding:7px 10px;font-size:11px}.scroll{overflow:auto;margin-top:12px}.em table{width:100%;border-collapse:collapse;background:#f9faf9;color:#234}.em th{background:#067b56;color:white}.em th,.em td{padding:10px;border:1px solid #bdcec5;text-align:center}.em td:nth-child(2){text-align:left}.bottom{display:grid;grid-template-columns:1fr 1fr;gap:12px}.muted{font-size:12px;color:#a5d4ca}.warn{background:#ffe2e2;color:#9b1f1f;padding:12px;border-radius:9px}.ok{background:#d9ffe4;color:#075f37;padding:12px;border-radius:9px}@media(max-width:680px){.grid,.acciones{grid-template-columns:1fr}.bottom{grid-template-columns:1fr}}`
