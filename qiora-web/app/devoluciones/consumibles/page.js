'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const t = (v) => String(v ?? '').trim()
const up = (v) => t(v).toUpperCase()

export default function DevolucionConsumiblesPage() {
  const [perfil, setPerfil] = useState(null)
  const [centro, setCentro] = useState('')
  const [recibe, setRecibe] = useState('')
  const [material, setMaterial] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    async function init() {
      try {
        const { data, error: e } = await supabase.rpc('qiora_mi_perfil')
        if (e) throw e
        if (!data || data.activo !== true) throw new Error('No hay perfil activo.')
        const puesto = up(data.puesto)
        if (puesto !== 'ADMIN_PADRE' && !puesto.startsWith('ADMIN_') && data.devoluciones !== true) {
          throw new Error('Tu usuario no tiene permiso para Devoluciones.')
        }
        if (!up(data.distrito)) throw new Error('El perfil no tiene centro configurado.')
        if (!alive) return
        setPerfil(data); setCentro(up(data.distrito)); setRecibe(t(data.nombre))
      } catch (e) { if (alive) setError(e?.message || 'Error cargando perfil.') }
      finally { if (alive) setLoading(false) }
    }
    init()
    return () => { alive = false }
  }, [])

  function agregar(e) {
    e.preventDefault(); setError(''); setAviso('')
    const m = t(material), c = Number(cantidad)
    if (!m) return setError('Captura el material o SKU.')
    if (!Number.isFinite(c) || c <= 0) return setError('La cantidad debe ser mayor que cero.')
    setItems((prev) => [...prev, { material: m, descripcion: t(descripcion), lote: t(lote), cantidad: c }])
    setMaterial(''); setDescripcion(''); setLote(''); setCantidad('1')
  }

  async function guardar() {
    if (!items.length) return setError('Agrega al menos un consumible.')
    if (!recibe) return setError('Captura quien recibe.')
    setSaving(true); setError(''); setAviso('')
    try {
      const { data, error: e } = await supabase.rpc('qiora_devolucion_guardar_consumibles', {
        p_distrito: centro,
        p_recibe: recibe,
        p_items: items,
      })
      if (e) throw e
      if (data?.ok === false) throw new Error(data.mensaje || 'No se pudo guardar.')
      setAviso(data?.mensaje || `Devolucion de consumibles guardada para ${centro}.`)
      setItems([])
    } catch (e) { setError(e?.message || 'No se pudo guardar la devolucion.') }
    finally { setSaving(false) }
  }

  return (
    <main style={s.base}><section style={s.shell}>
      <Link href="/devoluciones" style={s.back}>Regresar a Devoluciones</Link>
      <header style={s.hero}><h1 style={s.title}>DEVOLUCION DE CONSUMIBLES</h1><p>Centro activo: {centro || '-'}</p></header>
      {error && <div role="alert" style={s.error}>{error}</div>}{aviso && <div role="status" style={s.success}>{aviso}</div>}
      {loading ? <p>Cargando perfil...</p> : <>
        <section style={s.panel}><div style={s.fields}>
          <label style={s.label}>Centro<input style={s.input} value={centro} readOnly /></label>
          <label style={s.label}>Recibe<input style={s.input} value={recibe} onChange={(e)=>setRecibe(e.target.value)} /></label>
          <label style={s.label}>Material / SKU<input style={s.input} value={material} onChange={(e)=>setMaterial(e.target.value)} /></label>
          <label style={s.label}>Descripcion<input style={s.input} value={descripcion} onChange={(e)=>setDescripcion(e.target.value)} /></label>
          <label style={s.label}>Lote<input style={s.input} value={lote} onChange={(e)=>setLote(e.target.value)} /></label>
          <label style={s.label}>Cantidad<input style={s.input} type="number" min="0.01" step="any" value={cantidad} onChange={(e)=>setCantidad(e.target.value)} /></label>
        </div><button type="button" style={s.primary} onClick={agregar}>Agregar consumible</button></section>
        <section style={s.panel}><h2 style={s.h2}>Consumibles agregados ({items.length})</h2><div style={s.tableWrap}><table style={s.table}><thead><tr>{['Material','Descripcion','Lote','Cantidad','Accion'].map((x)=><th key={x} style={s.th}>{x}</th>)}</tr></thead><tbody>
          {items.length ? items.map((x,i)=><tr key={`${x.material}-${i}`}><td style={s.td}>{x.material}</td><td style={s.td}>{x.descripcion || '-'}</td><td style={s.td}>{x.lote || '-'}</td><td style={s.td}>{x.cantidad}</td><td style={s.td}><button style={s.remove} onClick={()=>setItems((p)=>p.filter((_,j)=>j!==i))}>Eliminar</button></td></tr>) : <tr><td style={s.empty} colSpan={5}>Sin consumibles agregados.</td></tr>}
        </tbody></table></div><button type="button" style={s.primary} disabled={saving} onClick={guardar}>{saving ? 'Guardando...' : 'Guardar devolucion'}</button></section>
      </>}
    </section></main>
  )
}

const s = {
  base:{minHeight:'100vh',padding:16,boxSizing:'border-box',background:'linear-gradient(145deg,#031f19,#052f25)',color:'#effff8',fontFamily:'Arial,sans-serif'},shell:{maxWidth:1200,margin:'0 auto',padding:18,border:'1px solid #356f5d',borderRadius:16,background:'#05281f'},back:{display:'inline-block',marginBottom:14,padding:'9px 15px',borderRadius:24,background:'#117b5d',color:'#fff',textDecoration:'none',fontWeight:800},hero:{padding:22,borderRadius:14,border:'1px solid #3b987b',background:'linear-gradient(110deg,#10553f,#16a47b)',textAlign:'center'},title:{margin:0,fontSize:26},panel:{marginTop:14,padding:14,border:'1px solid #2d6655',borderRadius:13,background:'#082f25'},fields:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:12},label:{display:'flex',flexDirection:'column',gap:6,fontSize:12,fontWeight:800},input:{boxSizing:'border-box',width:'100%',padding:11,border:'1px solid #cbd8d3',borderRadius:8,background:'#f7faf9',color:'#17372c'},primary:{marginTop:12,border:0,borderRadius:9,padding:'12px 15px',background:'#16a77b',color:'#fff',fontWeight:800,cursor:'pointer'},h2:{fontSize:16,margin:'0 0 12px'},tableWrap:{overflowX:'auto',borderRadius:8},table:{width:'100%',minWidth:600,borderCollapse:'collapse',background:'#f8fbf9',color:'#18382c',marginBottom:10},th:{padding:10,textAlign:'left',whiteSpace:'nowrap',fontSize:12,background:'#08795c',color:'#fff',border:'1px solid #a8d1c2'},td:{padding:9,border:'1px solid #d2e0da',fontSize:12},empty:{padding:18,textAlign:'center',color:'#49675b'},remove:{padding:'7px 10px',border:0,borderRadius:7,background:'#dc3545',color:'#fff',fontWeight:700},error:{marginTop:12,padding:12,borderRadius:8,background:'#ffe0e0',color:'#9c2525'},success:{marginTop:12,padding:12,borderRadius:8,background:'#dcfce7',color:'#166534'}
}
