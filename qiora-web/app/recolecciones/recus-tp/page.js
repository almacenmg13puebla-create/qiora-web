'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { supabase } from '../../../lib/supabase'

const today = () => new Date().toLocaleDateString('en-CA')
const norm = v => String(v ?? '').trim().toUpperCase()
const label = v => norm(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '')
const aliases = {
  serie: ['SERIE', 'NUMEROSERIE', 'NUMERODESERIE', 'SERIAL', 'NUMERODESERIAL', 'NUMSERIE', 'SERIALNUMBER'],
  sku: ['SKU', 'MATERIALSAP', 'CODIGOMATERIAL', 'CODIGO', 'MATERIAL'],
  material: ['DESCRIPCION', 'DESCRIPCIONMATERIAL', 'NOMBRE', 'NOMBREMATERIAL', 'DESCRIPCIONDELARTICULO'],
  lote: ['LOTE', 'LOTES', 'BATCH'],
}
function fromExcelRow(row) {
  const items = Object.entries(row).map(([key, value]) => [label(key), String(value ?? '').trim()])
  const pick = names => items.find(([key, value]) => names.includes(key) && value)?.[1] || ''
  return { serie: pick(aliases.serie), sku: pick(aliases.sku), material: pick(aliases.material), lote: pick(aliases.lote) }
}
function excelDate(v) {
  if (!v) return ''
  const s = String(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

export default function RecusTP() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [distrito, setDistrito] = useState('')
  const [distritos, setDistritos] = useState([])
  const [pedido, setPedido] = useState('')
  const [salida, setSalida] = useState('')
  const [fecha, setFecha] = useState(today)
  const [entrada, setEntrada] = useState('PENDIENTE')
  const [cantidad, setCantidad] = useState('')
  const [series, setSeries] = useState([])
  const [excelNombre, setExcelNombre] = useState('')
  const [registros, setRegistros] = useState([])
  const [idActualizar, setIdActualizar] = useState('')
  const [entradaActualizar, setEntradaActualizar] = useState('')
  const [acuse, setAcuse] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filtro, setFiltro] = useState('')

  const api = useCallback(async (method, data, multipart = false) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData?.session?.access_token) throw new Error('Tu sesión venció. Inicia sesión otra vez.')
    const res = await fetch('/api/recolecciones/recus-tp', {
      method,
      headers: { Authorization: `Bearer ${sessionData.session.access_token}`, ...(multipart ? {} : method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'GET' ? {} : { body: multipart ? data : JSON.stringify(data) }),
      cache: 'no-store',
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || result.ok !== true) throw new Error(result.error || `Error HTTP ${res.status}`)
    return result
  }, [])

  const recargar = useCallback(async () => {
    const r = await api('GET')
    setRegistros(r.registros || [])
  }, [api])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error: profileError } = await supabase.rpc('qiora_mi_perfil')
        if (profileError || !data?.activo) throw new Error('No fue posible consultar tu perfil activo.')
        if (active) { setPerfil(data); setDistrito(norm(data.distrito)) }
        if (norm(data.puesto) === 'ADMIN_PADRE') {
          const { data: users } = await supabase.from('almacen_usuarios').select('distrito').eq('activo', true).limit(10000)
          if (active) setDistritos([...new Set((users || []).map(u => norm(u.distrito)).filter(Boolean))].sort())
        }
        const r = await api('GET')
        if (active) setRegistros(r.registros || [])
      } catch (e) { if (active) setError(e.message) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [api])

  async function leerExcel(e) {
    setError(''); setMensaje(''); setSeries([]); setExcelNombre('')
    const file = e.target.files?.[0]
    if (!file) return
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('Selecciona un archivo .xlsx o .xls.'); return }
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      const parsed = rows.map(fromExcelRow).filter(r => Object.values(r).some(Boolean))
      if (!parsed.length || parsed.some(r => !r.serie)) throw new Error('No pude encontrar la columna de serie o hay filas sin serie. Encabezado requerido: Serie.')
      if (new Set(parsed.map(r => norm(r.serie))).size !== parsed.length) throw new Error('El Excel contiene números de serie duplicados.')
      if (parsed.length > 5000) throw new Error('El máximo por entrega es de 5000 piezas.')
      setSeries(parsed)
      setCantidad(String(parsed.length))
      setExcelNombre(file.name)
      setMensaje(`Excel leído: ${parsed.length} pieza(s). Revisa la cantidad antes de guardar.`)
    } catch (err) { setError(err.message || 'No se pudo leer el archivo Excel.') }
  }

  async function guardar(e) {
    e.preventDefault(); setError(''); setMensaje('')
    if (!series.length) { setError('Primero selecciona un Excel con series.'); return }
    if (Number(cantidad) !== series.length) { setError('La cantidad debe coincidir con las piezas del Excel.'); return }
    if (!distrito) { setError('Selecciona el distrito.'); return }
    if (!window.confirm(`¿Guardar ${series.length} pieza(s) del pedido ${pedido} en ${distrito}?`)) return
    setSaving(true)
    try {
      await api('POST', { distrito, pedido, salida, fecha, folio_entrada: entrada || 'PENDIENTE', cantidad: Number(cantidad), series })
      setMensaje('Entrega RECUS TP guardada correctamente.')
      setPedido(''); setSalida(''); setFecha(today()); setEntrada('PENDIENTE'); setCantidad(''); setSeries([]); setExcelNombre('')
      await recargar()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function guardarEntrada(e) {
    e.preventDefault(); setError(''); setMensaje('')
    if (!idActualizar || !entradaActualizar.trim()) { setError('Selecciona un pedido pendiente y captura la entrada.'); return }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('id', idActualizar); fd.set('folio_entrada', entradaActualizar)
      if (acuse) fd.set('acuse', acuse)
      await api('PATCH', fd, true)
      setMensaje('Folio de entrada actualizado correctamente.')
      setIdActualizar(''); setEntradaActualizar(''); setAcuse(null)
      await recargar()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const pending = registros.filter(r => norm(r.folio_entrada) === 'PENDIENTE' || !r.folio_entrada)
  const filtered = useMemo(() => registros.filter(r => {
    const q = norm(filtro)
    return !q || [r.pedido, r.salida, r.distrito, r.folio_entrada, ...(r.series || []).map(s => s.serie)].some(v => norm(v).includes(q))
  }), [registros, filtro])
  const pieces = filtered.reduce((n, r) => n + Number(r.cantidad || 0), 0)

  return (
    <main className="recu-page"><div className="shell">
      <button type="button" className="back" onClick={() => router.push('/recolecciones')}>← Regresar a Recolecciones</button>
      <header><div><small>QIORA · RECOLECCIONES</small><h1>RECUS TP – Entregas a Totalplay</h1><p>Registrar entregas, cargar series desde Excel y actualizar folios pendientes.</p></div><span className="district">{distrito || 'SIN DISTRITO'}</span></header>
      {error && <div role="alert" className="alert error">{error}</div>}
      {mensaje && <div role="status" className="alert success">{mensaje}</div>}
      {loading ? <p className="dim">Consultando registros…</p> : <>
        <section className="panel"><h2>1. Registrar entrega de recolecciones</h2>
          <form onSubmit={guardar}>
            <div className="grid">
              {norm(perfil?.puesto) === 'ADMIN_PADRE' && <label>Distrito<select required value={distrito} onChange={e => setDistrito(e.target.value)}>{!distrito && <option value="">Selecciona distrito</option>}{(distritos.length ? distritos : [distrito]).map(x => <option key={x} value={x}>{x}</option>)}</select></label>}
              <label>Pedido TP<input required value={pedido} onChange={e => setPedido(e.target.value)} placeholder="Pedido Totalplay" maxLength={120} /></label>
              <label>Salida SAP<input required value={salida} onChange={e => setSalida(e.target.value)} placeholder="Número de salida" maxLength={120} /></label>
              <label>Fecha<input required type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></label>
              <label>Folio de Entrada<input value={entrada} onChange={e => setEntrada(e.target.value)} placeholder="PENDIENTE" maxLength={120} /></label>
              <label>Piezas<input type="number" required min="1" max="5000" value={cantidad} onChange={e => setCantidad(e.target.value)} /></label>
              <label>Subir Excel (.xlsx / .xls)<input type="file" accept=".xlsx,.xls" onChange={leerExcel} />{excelNombre && <small>{excelNombre} · {series.length} series</small>}</label>
            </div>
            <p className="help">El Excel debe incluir una columna <strong>Serie</strong>. También reconoce SKU, Descripción/Material y Lote. La cantidad debe coincidir con las series cargadas.</p>
            <button className="primary" disabled={saving || !series.length}>{saving ? 'Guardando…' : 'Guardar RECUS TP'}</button>
          </form>
        </section>
        <section className="panel"><h2>2. Actualizar entrada pendiente</h2>
          <form onSubmit={guardarEntrada} className="grid">
            <label>Pedido pendiente<select required value={idActualizar} onChange={e => setIdActualizar(e.target.value)}><option value="">Selecciona una entrega pendiente</option>{pending.map(r => <option key={r.id} value={r.id}>{r.distrito} · {r.pedido} · {r.cantidad} piezas</option>)}</select></label>
            <label>Folio de entrada<input required value={entradaActualizar} onChange={e => setEntradaActualizar(e.target.value)} placeholder="Número que entregó Totalplay" /></label>
            <label>Acuse Totalplay PDF (opcional)<input type="file" accept="application/pdf,.pdf" onChange={e => setAcuse(e.target.files?.[0] || null)} /></label>
            <div className="action"><button className="primary" disabled={saving || !pending.length}>{saving ? 'Guardando…' : 'Guardar entrada y acuse'}</button></div>
          </form>{!pending.length && <p className="dim">Sin entradas TP pendientes.</p>}
        </section>
        <section className="panel"><div className="tabletitle"><div><h2>3. Historial de entregas</h2><p>{filtered.length} entregas · {pieces} piezas</p></div><input aria-label="Buscar pedido o serie" placeholder="Buscar pedido, serie o folio…" value={filtro} onChange={e => setFiltro(e.target.value)} /></div>
          <div className="tablewrap"><table><thead><tr><th>Distrito</th><th>Pedido</th><th>Salida SAP</th><th>Fecha</th><th>Folio Entrada</th><th>Piezas</th><th>Estado</th><th>Acuse</th><th>Detalle de series</th></tr></thead><tbody>{filtered.length ? filtered.map(r => <tr key={r.id}><td>{r.distrito}</td><td>{r.pedido}</td><td>{r.salida}</td><td>{excelDate(r.fecha)}</td><td>{r.folio_entrada}</td><td>{r.cantidad}</td><td><span className={norm(r.folio_entrada) === 'PENDIENTE' ? 'pill warn' : 'pill'}>{r.estatus}</span></td><td>{r.acuse_url ? <a href={r.acuse_url} target="_blank" rel="noopener noreferrer">Ver PDF</a> : '—'}</td><td><details><summary>{r.series.length} series</summary><div className="series">{r.series.map((s,i) => <div key={i}>{s.serie} · {s.sku || 'Sin SKU'} · {s.material || 'Sin descripción'} · {s.lote || 'Sin lote'}</div>)}</div></details></td></tr>) : <tr><td colSpan="9">Sin registros.</td></tr>}</tbody></table></div>
          <p className="help">Por seguridad se muestran las últimas 500 entregas autorizadas. Los acuses PDF se abren con enlaces temporales.</p>
        </section>
      </>}
    </div><style jsx>{`
      .recu-page{min-height:100vh;background:#042a23;color:#f2fff9;font-family:Arial,Helvetica,sans-serif;padding:20px;box-sizing:border-box}.shell{max-width:1260px;margin:auto}.back{background:#0b8568;color:white;border:1px solid #20ad86;border-radius:10px;padding:11px 17px;font-weight:700;cursor:pointer;margin-bottom:16px}header{background:linear-gradient(125deg,#07523e,#0f9270);border:1px solid #229c79;border-radius:17px;padding:23px 26px;display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}header small{letter-spacing:1.6px;font-weight:800;font-size:11px;color:#c9fae9}h1{margin:9px 0;font-size:clamp(22px,3vw,29px)}header p{margin:0;color:#d0f4e6;font-size:13px}.district{background:#073e31;border:1px solid #52cda6;border-radius:11px;padding:12px 17px;font-weight:800;white-space:nowrap}.panel{background:#063329;border:1px solid #236c57;border-radius:15px;padding:22px;margin-bottom:18px}h2{font-size:18px;margin:0 0 19px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}label{display:flex;flex-direction:column;gap:8px;font-weight:700;font-size:13px}input,select{width:100%;box-sizing:border-box;background:#f6fffb;border:1px solid #bcded1;color:#173c30;border-radius:9px;padding:12px;min-height:44px;font:inherit}input[type=file]{font-size:12px}label small{font-weight:400;color:#9fe4ca}.help{font-size:12px;color:#b9e4d4;line-height:1.5;margin:15px 0}.primary{background:#14a779;border:1px solid #53dbb0;color:white;border-radius:10px;padding:13px 23px;font-size:14px;font-weight:800;cursor:pointer}.primary:disabled{opacity:.5;cursor:not-allowed}.action{align-self:end}.dim{color:#bbdecd;font-size:13px}.alert{padding:13px 17px;border-radius:10px;margin:0 0 16px}.error{background:#752c2c;border:1px solid #ef9a9a}.success{background:#145d45;border:1px solid #44bd8e}.tabletitle{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:14px}.tabletitle h2{margin-bottom:5px}.tabletitle p{font-size:13px;color:#acdcca;margin:0}.tabletitle input{max-width:360px}.tablewrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:970px;font-size:13px}th{background:#0c5d47;color:#e1fff3;text-align:left;white-space:nowrap}th,td{padding:12px;border-bottom:1px solid #255e4d;vertical-align:top}td a{color:#69e6b5}td summary{cursor:pointer;white-space:nowrap;color:#b4f9db}.series{max-height:180px;overflow:auto;min-width:250px;line-height:1.7;font-size:12px}.pill{display:inline-block;padding:5px 8px;border-radius:8px;background:#176b49}.warn{background:#805a1b}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:630px){.grid{grid-template-columns:1fr}.recu-page{padding:12px}.panel{padding:17px}header{padding:20px;align-items:flex-start;flex-direction:column}.tabletitle{align-items:stretch;flex-direction:column}.tabletitle input{max-width:none}}
    `}</style></main>
  )
}
