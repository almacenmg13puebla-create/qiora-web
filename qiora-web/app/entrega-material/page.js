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

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function htmlComprobanteEntrega({ data, materiales, almacen, tecnico, folio, distrito, manual }) {
  const fecha = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short'
  })
  const totalPiezas = materiales.reduce((n, m) => n + cantidad(m), 0)
  const filas = materiales.map((m, i) => `
    <tr>
      <td>${i + 1}</td><td>${escaparHtml(m.sku)}</td>
      <td>${escaparHtml(m.descripcion || m.material)}</td>
      <td class="num">${escaparHtml(m.cantidad)}</td>
      <td>${escaparHtml(m.lote || 'SIN LOTE')}</td>
    </tr>
    ${m.series?.length ? `<tr class="series"><td></td><td colspan="4"><strong>Series:</strong><br>${m.series.map(escaparHtml).join('<br>')}</td></tr>` : ''}
  `).join('')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Comprobante ${escaparHtml(data?.folio_control || '')}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17231f;margin:0;background:#eef2ef}
    .sheet{width:210mm;min-height:297mm;margin:18px auto;padding:15mm;background:#fff;box-shadow:0 2px 16px #0002}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #087653;padding-bottom:14px}
    .brand{font-size:24px;font-weight:800;color:#087653;letter-spacing:1px}.subtitle{font-size:12px;color:#50635b;margin-top:5px}
    h1{font-size:20px;margin:0;text-align:right;color:#123d30}.folio{text-align:right;font-size:13px;margin-top:9px;font-weight:bold}
    h2{font-size:13px;color:#087653;border-bottom:1px solid #cbd8d1;padding-bottom:6px;margin:22px 0 10px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;font-size:12px}.field{padding:5px 0;border-bottom:1px solid #e3e9e5}.label{font-size:10px;color:#60736a;text-transform:uppercase;display:block;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;font-size:11px}th{background:#087653;color:#fff;text-align:left;padding:9px 7px}td{border:1px solid #d5dfd9;padding:8px 7px;vertical-align:top}.num{text-align:center}.series td{background:#f5faf7;line-height:1.55}
    .totals{display:flex;justify-content:flex-end;gap:28px;margin:16px 0;font-size:12px;font-weight:bold}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin-top:65px;text-align:center;font-size:11px}.sign{border-top:1px solid #253a31;padding-top:8px}.foot{border-top:1px solid #d5dfd9;margin-top:55px;padding-top:10px;text-align:center;color:#718078;font-size:9px}
    .actions{width:210mm;margin:12px auto;text-align:right}.actions button{background:#087653;color:white;border:0;border-radius:5px;padding:10px 18px;font-weight:bold;cursor:pointer}
    @page{size:A4 portrait;margin:0} @media print{body{background:#fff}.sheet{margin:0;width:210mm;min-height:297mm;box-shadow:none;padding:15mm}.actions{display:none}}
    @media screen and (max-width:800px){.sheet,.actions{width:100%;margin:0}.sheet{padding:18px;min-height:100vh}.top{gap:15px}h1{font-size:16px}}
  </style></head><body>
  <div class="actions"><button onclick="window.print()">Imprimir</button></div>
  <article class="sheet">
    <div class="top"><div><div class="brand">QIORA</div><div class="subtitle">CONTROL DE ALMACÉN · COMPROBANTE DE ENTREGA</div></div>
      <div><h1>ENTREGA DE MATERIAL</h1><div class="folio">FOLIO CONTROL: ${escaparHtml(data?.folio_control || 'NO GENERADO')}</div></div></div>
    <h2>DATOS DE LA ENTREGA</h2><div class="grid">
      <div class="field"><span class="label">Folio de solicitud</span>${escaparHtml(data?.folio || folio || (manual ? 'SIN SOLICITUD' : 'NO REGISTRADO'))}</div>
      <div class="field"><span class="label">Fecha de registro</span>${escaparHtml(fecha)}</div>
      <div class="field"><span class="label">Distrito</span>${escaparHtml(distrito || 'Consultar asignación SAT')}</div>
      <div class="field"><span class="label">Estado</span>PENDIENTE SAP</div>
      <div class="field"><span class="label">Almacén destino</span>${escaparHtml(almacen)}</div>
      <div class="field"><span class="label">Técnico que recibe</span>${escaparHtml(tecnico)}</div>
    </div>
    <h2>DETALLE DE MATERIALES</h2><table><thead><tr><th>#</th><th>SKU</th><th>DESCRIPCIÓN</th><th>CANT.</th><th>LOTE</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="totals"><span>PARTIDAS: ${materiales.length}</span><span>TOTAL DE PIEZAS: ${totalPiezas}</span></div>
    <div class="signatures"><div class="sign">ENTREGA<br>Nombre y firma</div><div class="sign">RECIBE<br>Nombre y firma</div></div>
    <div class="foot">QIORA · Comprobante generado desde el registro confirmado en Supabase. Conserve este documento como respaldo.</div>
  </article>
  </body></html>`
}


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
  const [manualDistrito, setManualDistrito] = useState('')
  const [identificando, setIdentificando] = useState(false)
  const [nuevoSku, setNuevoSku] = useState('')
  const [buscandoSku, setBuscandoSku] = useState(false)
  const [errorSku, setErrorSku] = useState('')
  const ultimaBusquedaSku = useRef(0)
  const cantidadInputRef = useRef(null)
  const skuInputRef = useRef(null)
  const agregandoConEnter = useRef(false)
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


  // Independiente de Solicitudes: consulta UNICAMENTE el tecnico en el distrito del usuario.
  const identificarTecnico = useCallback(async (codigo) => {
    const valor = str(codigo)
    if (!/^[0-9]{1,4}$/.test(valor)) return setError('Indique un almacén técnico de 1 a 4 dígitos.')
    setIdentificando(true); setError(''); setExito('')
    try {
      const {data,error:e} = await supabase.rpc('qiora_material_identificar_tecnico',{p_almacen:valor})
      if(e)throw e
      setManual(true); setManualDistrito(str(data.distrito)); setGuardada(false); setPendientes([]); setFolio('')
      setAlmacen(str(data.almacen)); setTecnico(str(data.tecnico))
      setFecha(''); setRetiro(''); setEstatus('ASIGNACIÓN SIN SOLICITUD')
      let borrador=[]
      try {borrador=JSON.parse(window.localStorage.getItem('qiora_manual_draft_'+str(data.distrito)+'_'+str(data.almacen))||'[]')}catch(_){}
      const items=(Array.isArray(borrador)?borrador:[]).map(normalizar)
      setMateriales(items);setSeleccion(items.find(m=>esTPE(m.lote))?._key||'');setNuevoSku('');setNuevoLotes([])
      setExito('Técnico identificado: '+str(data.tecnico)+' · Almacén '+str(data.almacen)+'. No se consultaron solicitudes pendientes.')
    } catch(e) {setError(e?.message||'No se pudo identificar al técnico.')}
    finally {setIdentificando(false)}
  }, [])

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


  useEffect(() => {
    if (!manual || !manualDistrito || !almacen || guardada) return
    try {window.localStorage.setItem('qiora_manual_draft_'+manualDistrito+'_'+almacen,JSON.stringify(materiales))}catch(_){}
  }, [manual,manualDistrito,almacen,guardada,materiales])

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
  const puedeGuardar = !guardada && (manual ? !!almacen && !!tecnico : !!folio) && materiales.length > 0 && !busy && !faltantes.length && !duplicadasGlobales

  const consultarSku = useCallback(async (skuValor, mostrarErrores = false) => {
    const sku = str(skuValor).toUpperCase()
    const id = ++ultimaBusquedaSku.current
    if ((!folio && !manual) || !sku) {
      setNuevoLotes([]); setNuevoLote(''); setBuscandoSku(false)
      if (mostrarErrores) setErrorSku('Seleccione una solicitud o identifique al técnico e indique el SKU.')
      return
    }
    setBuscandoSku(true); setErrorSku(''); setError('')
    try {
      const {data,error:e} = manual
        ? await supabase.rpc('qiora_material_stock_manual',{p_almacen:almacen,p_sku:sku})
        : await supabase.rpc('qiora_material_stock_sku_entrega',{p_folio:folio,p_sku:sku})
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
  }, [folio,manual,almacen])

  useEffect(() => {
    const sku = str(nuevoSku)
    ++ultimaBusquedaSku.current
    setNuevoLotes([]);setNuevoLote('');setErrorSku('')
    if ((!folio && !manual) || !sku) {setBuscandoSku(false);return}
    // Debounce: permite escanear el SKU sin lanzar una consulta por cada digito.
    const timer = setTimeout(() => consultarSku(sku), 350)
    return () => clearTimeout(timer)
  }, [nuevoSku, folio, manual, consultarSku])
  // Flujo de escáner/teclado: SKU + Enter -> Cantidad + Enter -> agregar.
  async function enterSku(e) {
    if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return
    e.preventDefault()
    if (e.repeat) return
    const sku = str(nuevoSku)
    if (!sku) { setErrorSku('Capture un SKU.'); return }
    // Garantizar que la consulta haya terminado antes de permitir el segundo Enter.
    await consultarSku(sku, true)
    cantidadInputRef.current?.focus()
    cantidadInputRef.current?.select()
  }

  function limpiarCamposMaterial() {
    ++ultimaBusquedaSku.current
    setNuevoSku('')
    setNuevoLotes([])
    setNuevoLote('')
    setNuevoCantidad(1)
    setBuscandoSku(false)
    setErrorSku('')
    // Regresar al SKU solamente despues de agregar correctamente.
    requestAnimationFrame(() => skuInputRef.current?.focus())
  }

  async function enterCantidad(e) {
    if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return
    e.preventDefault()
    if (e.repeat || agregandoConEnter.current || busy) return
    if (buscandoSku) { setErrorSku('Espere a que termine la consulta del SKU.'); return }
    if (!manual && !folio) { setError('Seleccione una solicitud pendiente.'); return }
    const lote = nuevoLotes.find(x => x.lote === nuevoLote)
    const n = Number(nuevoCantidad)
    if (!lote) { setErrorSku('El SKU no tiene un lote disponible.'); return }
    if (!Number.isInteger(n) || n < 1 || n > Number(lote.disponible)) {
      setErrorSku(`Cantidad inválida. Disponible en lote ${lote.lote || 'SIN LOTE'}: ${lote.disponible}.`)
      return
    }
    agregandoConEnter.current = true
    try {
      await actualizarReserva('AGREGAR', null, n)
    } finally {
      agregandoConEnter.current = false
    }
  }

  async function actualizarReserva(accion,m=null,nuevaCantidad=null) {
    if (guardada) return setError('La entrega ya fue guardada; no se pueden editar sus materiales.')
    if(manual) {
      if(accion==='AGREGAR') {
        const x=nuevoLotes.find(z=>z.lote===nuevoLote); const n=Number(nuevaCantidad);
        if(!x||!Number.isInteger(n)||n<1||n>Number(x.disponible))return setError('Cantidad o lote sin existencia disponible.')
        if(materiales.some(z=>z.sku===nuevoSku&&z.lote===nuevoLote))return setError('SKU y lote ya agregados; utilice Modificar.')
        setMateriales(prev=>[...prev,normalizar({sku:nuevoSku,lote:nuevoLote,material:x.material,descripcion:x.material,cantidad:n,series:[]},prev.length)]);
        limpiarCamposMaterial();setError('');return true
      }
      if(accion==='ELIMINAR') {setMateriales(prev=>prev.filter(z=>z._key!==m._key));setEditando('');return}
      if(accion==='MODIFICAR') {
        const n=Number(nuevaCantidad);if(!Number.isInteger(n)||n<1||n>10000)return setError('Cantidad inválida.')
        setMateriales(prev=>prev.map(z=>z._key===m._key?{...z,cantidad:n,series:z.series.slice(0,n)}:z));setEditando('');return
      }
    }
    if(!folio)return setError('Seleccione una solicitud pendiente.')
    setBusy(true);setError('');setExito('')
    try{
      const {error:e}=await supabase.rpc('qiora_material_editar_reserva_entrega',{
        p_folio:folio,p_reserva_id:m?.id||null,p_accion:accion,
        p_cantidad:accion==='ELIMINAR'?null:Number(nuevaCantidad),
        p_sku:accion==='AGREGAR'?nuevoSku.trim():null,
        p_lote:accion==='AGREGAR'?nuevoLote:null
      })
      if(e)throw e
      setEditando('')
      await buscarPendientes('',folio)
      if (accion === 'AGREGAR') limpiarCamposMaterial()
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
      const {error:e}= manual
        ? await supabase.rpc('qiora_material_validar_serie_manual',{p_almacen:almacen,p_sku:objetivo.sku,p_lote:objetivo.lote,p_serie:valor})
        : await supabase.rpc('qiora_material_validar_serie_entrega',{p_folio:folio,p_sku:objetivo.sku,p_lote:objetivo.lote,p_serie:valor})
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
    setFecha(''); setRetiro(''); setEstatus(''); setMateriales([]); setSeleccion('');setManualDistrito('')
    setGuardada(false);setControlGuardado('');setBuscarControl('');
    window.history.replaceState(null,'',window.location.pathname);
    setCaptura(''); setError(''); setExito(''); setManual(false);setNuevoSku('');setNuevoLotes([]);setNuevoLote('');setErrorSku('');setNuevoCantidad(1);setEditando('')
  }
  async function guardar() {
    if (!puedeGuardar) {setError('Faltan series de lotes TPE o hay series duplicadas.'); return}
    setBusy(true);setError('');setExito('')
    // Abrir la ventana sincrónicamente desde el clic para evitar bloqueadores de ventanas emergentes.
    const ventanaImpresion = window.open('', '_blank')
    if (!ventanaImpresion) {
      setBusy(false)
      setError('El navegador bloqueó la ventana del comprobante. Permite ventanas emergentes para este sitio e inténtalo de nuevo.')
      return
    }
    ventanaImpresion.document.write('<!doctype html><title>Preparando comprobante...</title><p style="font:16px Arial;padding:24px">Guardando entrega y preparando comprobante...</p>')
    ventanaImpresion.document.close()
    try {
      const payload = materiales.map(m => ({
        id: m.id, sku:m.sku, descripcion:m.descripcion, material:m.material,
        cantidad:m.cantidad, lote:m.lote,
        requiere_series:esTPE(m.lote)?'SI':'NO', series:m.series
      }))
      const {data,error:e} = manual
        ? await supabase.rpc('qiora_material_guardar_sin_solicitud',{p_almacen:almacen,p_materiales:payload})
        : await supabase.rpc('qiora_material_guardar_entrega', {p_folio_solicitud:folio, p_almacen:almacen, p_materiales:payload})
      if(e)throw e
      if (!data?.folio_control) throw new Error('Supabase no devolvió FOLIO_CONTROL; no se puede generar el comprobante.')
      const html = htmlComprobanteEntrega({
        data, materiales, almacen, tecnico, folio,
        distrito: manualDistrito, manual
      })
      ventanaImpresion.document.open()
      ventanaImpresion.document.write(html)
      ventanaImpresion.document.close()
      setExito(`Entrega registrada en MIGO. FOLIO ${str(data?.folio)} · FOLIO_CONTROL ${str(data?.folio_control)} · PENDIENTE SAP. Comprobante abierto para imprimir.`)
      setEstatus('EN_PROCESO_SAP')
      // Las series son definitivas en qiora_entregas_registro.materiales.
      // No limpiar la vista: recuperar los datos ya persistidos en Supabase.
      const ctl = str(data?.folio_control)
      if (ctl) {
        try { window.localStorage.removeItem('qiora_series_draft_' + folio);if(manual)window.localStorage.removeItem('qiora_manual_draft_'+manualDistrito+'_'+almacen) } catch (_) {}
        await cargarGuardada(ctl)
      }
    }catch(e){
      try { ventanaImpresion.close() } catch (_) {}
      setError(e?.message||'Error al guardar entrega.')
    }finally{setBusy(false)}
  }

  return <main className="em"><div className="wrap">
    <button onClick={()=>router.push('/ver-solicitudes')}>← Ver solicitudes</button>
    <header><h1>ENTREGA DE MATERIAL</h1><p>Complemento con materiales cargados desde la hoja Solicitudes.</p></header>
    <section><h3>Buscar solicitudes o asignar sin solicitud</h3>
      <div className="acciones"><label>Almacén<input value={busqueda} maxLength={4} placeholder="0000" onChange={e=>setBusqueda(e.target.value.replace(/\D/g,'').slice(0,4))} /></label>
        <button onClick={()=>buscarPendientes(busqueda)} disabled={busy}>Buscar pendientes</button>
        <button onClick={()=>identificarTecnico(busqueda)} disabled={busy||identificando}>{identificando?'Identificando...':'Entrega sin solicitud'}</button></div>
      <div className="grid">{!manual&&<label>Solicitud pendiente<select value={folio} onChange={e=>{const s=pendientes.find(x=>str(x.folio)===e.target.value);if(s)cargarSolicitud(s)}}><option value="">Primero busque por almacén</option>{pendientes.map(x=><option key={x.folio} value={x.folio}>{x.folio}</option>)}</select></label>}
      <label>Almacén<input readOnly value={almacen}/></label><label>Técnico<input readOnly value={tecnico}/></label>
      {!manual&&<><label>Fecha solicitud<input readOnly value={fecha?new Date(fecha).toLocaleDateString('es-MX'):''}/></label>
      <label>Fecha retiro<input readOnly value={retiro}/></label></>}<label>Estatus<input readOnly value={estatus}/></label></div>
      {manual&&<p className="muted">Asignación directa al técnico, sin consultar solicitudes pendientes. Los materiales se validarán y se registrarán en una operación atómica al guardar; antes del guardado solo se conserva un borrador local.</p>}
    </section>
    <section><h3>Consultar entrega guardada</h3>
      <div className="acciones"><label>FOLIO_CONTROL<input placeholder="ABAS-00000001" value={buscarControl} onChange={e=>setBuscarControl(normal(e.target.value))}/></label>
      <button disabled={busy || !buscarControl} onClick={()=>cargarGuardada(buscarControl)}>Ver entrega y series</button></div>
      {guardada&&<p className="ok">Entrega registrada: {controlGuardado}. Las series permanecen guardadas después de actualizar la página. Esta entrega es de solo lectura.</p>}
    </section>
    {!guardada&&<section><h3>Agregar material adicional</h3><p className="muted">Al escribir o escanear el SKU, presione Enter para pasar a Cantidad. Después de capturar la cantidad, presione Enter para agregar automáticamente el material. Se validan lote y existencias.</p>
      <div className="grid">
        <label>SKU<input ref={skuInputRef} value={nuevoSku} placeholder="Escanee o escriba SKU" autoComplete="off"
          onChange={e=>setNuevoSku(e.target.value.replace(/[^0-9A-Za-z]/g,'').toUpperCase())}
          onBlur={()=>{if(nuevoSku && !nuevoLotes.length && !buscandoSku)consultarSku(nuevoSku)}}
          onKeyDown={enterSku}/></label>
        <label>Material<input value={nuevoLotes.find(x=>x.lote===nuevoLote)?.material||nuevoLotes[0]?.material||''} readOnly placeholder={buscandoSku?'Consultando...':'Se llena automático'}/></label>
        <label>Cantidad<input ref={cantidadInputRef} type="number" min="1" max="10000" value={nuevoCantidad} onChange={e=>setNuevoCantidad(e.target.value)} onKeyDown={enterCantidad}/></label>
        <label>Lote<select value={nuevoLote} onChange={e=>setNuevoLote(e.target.value)} disabled={!nuevoLotes.length}>
          <option value="">Seleccione lote</option>
          {nuevoLotes.map((x,i)=><option key={`${x.lote}-${i}`} value={x.lote}>{x.lote||'SIN LOTE'} · disponible {x.disponible}</option>)}
        </select></label>
        <label>Requiere Series<input readOnly value={esTPE(nuevoLote)?'SI':'NO'}/></label>
        <button className="orange" disabled={busy||buscandoSku||(!manual&&!folio)||!nuevoLotes.length||!(Number(nuevoCantidad)>0)||Number(nuevoCantidad)>Number(nuevoLotes.find(x=>x.lote===nuevoLote)?.disponible||0)} onClick={()=>actualizarReserva('AGREGAR',null,nuevoCantidad)}>+ Agregar Material</button>
      </div>
      {buscandoSku&&<p className="muted">Buscando SKU en STOCK_ALMACEN...</p>}
      {!!errorSku&&<p className="warn">{errorSku}</p>}
    </section>}
    <section><h3>Materiales agregados</h3><div className="scroll"><table><thead><tr><th>SKU</th><th>Material</th><th>Cantidad</th><th>Lote</th><th>Series</th><th>Acción</th></tr></thead><tbody>
      {materiales.length?materiales.map(m=><tr key={m._key}><td>{m.sku}</td><td>{m.material}</td><td>{m.cantidad}</td><td>{m.lote||'—'}</td><td>{m.series.length?m.series.join(', '):(esTPE(m.lote)?`Faltan ${cantidad(m)} series`:'No requiere')}</td>
        <td><div className="rowbuttons">{!guardada&&<><button className="small" disabled={busy} onClick={()=>{setSeleccion(m._key);setEditando(m._key);setEditCantidad(m.cantidad);setError('')}}>Modificar</button><button className="small red" disabled={busy} onClick={()=>{if(window.confirm('¿Eliminar este material de la solicitud?')) actualizarReserva('ELIMINAR',m)}}>Eliminar</button>{esTPE(m.lote)&&<button className="small" disabled={busy} onClick={()=>setSeleccion(m._key)}>Series</button>}</>}</div>{!guardada&&editando===m._key&&<div className="editrow"><input type="number" min="1" value={editCantidad} onChange={e=>setEditCantidad(e.target.value)}/><button className="small green" disabled={busy||Number(editCantidad)<1} onClick={()=>actualizarReserva('MODIFICAR',m,editCantidad)}>Aplicar</button><button className="small" onClick={()=>setEditando('')}>Cancelar</button></div>}</td></tr>):<tr><td colSpan={6}>Sin materiales agregados.</td></tr>}
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
