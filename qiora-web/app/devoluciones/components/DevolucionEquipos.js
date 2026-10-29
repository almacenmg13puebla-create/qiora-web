'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const txt = (v) => String(v ?? '').trim()
const up = (v) => txt(v).toUpperCase()
const alm4 = (v) => txt(v).replace(/\D/g, '').slice(0, 4).padStart(4, '0')

function parseFechaMod(v) {
  const s = txt(v).split(' ')[0]
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return null
}

function diasEnCajuela(v) {
  const f = parseFechaMod(v)
  if (!f || Number.isNaN(f.getTime())) return null
  const hoy = new Date()
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.floor((h.getTime() - f.getTime()) / 86400000)
}

export default function DevolucionEquipos({ tipo }) {
  const critica = tipo === 'CRITICA'
  const [perfil, setPerfil] = useState(null)
  const [centro, setCentro] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [recibe, setRecibe] = useState('')
  const [serieInput, setSerieInput] = useState('')
  const [criticas, setCriticas] = useState([])
  const [series, setSeries] = useState([])
  const [folio, setFolio] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    async function init() {
      try {
        const { data, error: pErr } = await supabase.rpc('qiora_mi_perfil')
        if (pErr) throw pErr
        if (!data || data.activo !== true) throw new Error('No se encontro un perfil activo.')
        const p = up(data.puesto)
        const admin = p === 'ADMIN_PADRE' || p.startsWith('ADMIN_')
        if (!admin && data.devoluciones !== true) throw new Error('Tu usuario no tiene permiso para Devoluciones.')
        const d = up(data.distrito)
        if (!d) throw new Error('El perfil no tiene centro/distrito configurado.')
        if (!alive) return
        setPerfil(data)
        setCentro(d)
        setRecibe(txt(data.nombre))
        const folioPrefijo = critica ? 'DVC-' : 'DVN-'
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        setFolio(folioPrefijo + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()))
        if (p === 'TECNICO') {
          setAlmacen(alm4(data.usuario_almacen))
          setTecnico(txt(data.nombre))
        }
      } catch (e) {
        if (alive) setError(e?.message || 'No fue posible cargar el perfil.')
      } finally {
        if (alive) setLoadingProfile(false)
      }
    }
    init()
    return () => { alive = false }
  }, [critica])

  const adminPadre = up(perfil?.puesto) === 'ADMIN_PADRE'
  const esTecnico = up(perfil?.puesto) === 'TECNICO'

  const obtenerTecnico = useCallback(async (almacenValor) => {
    const a = alm4(almacenValor)
    if (!/^\d{4}$/.test(a) || !centro) return
    setError('')
    const { data, error: qErr } = await supabase.rpc('qiora_devolucion_tecnico_almacen', {
      p_distrito: centro,
      p_almacen: a,
    })
    if (qErr) throw qErr
    const nombre = typeof data === 'string' ? data : data?.nombre
    if (!nombre) throw new Error(`El almacen ${a} no existe o no esta activo en ${centro}.`)
    setTecnico(txt(nombre))
  }, [centro])

  const cargarCriticas = useCallback(async () => {
    if (!centro || !almacen) {
      setError('Captura un almacen de cuatro digitos antes de cargar series.')
      return
    }
    setLoading(true); setError(''); setNotice('')
    try {
      await obtenerTecnico(almacen)
      let result = []
      if (critica) {
        const { data, error: qErr } = await supabase.rpc('qiora_devolucion_series_criticas', {
          p_distrito: centro,
          p_almacen: alm4(almacen),
        })
        if (qErr) throw qErr
        result = (data || []).map((r) => ({ ...r, dias: Number(r.dias) }))
      }
      setCriticas(result)
      setNotice(`${result.length} serie(s) disponibles para ${centro}, almacen ${alm4(almacen)}.`)
    } catch (e) {
      setError(e?.message || 'No fue posible cargar las series del centro.')
      setCriticas([])
    } finally { setLoading(false) }
  }, [centro, almacen, critica, obtenerTecnico])

  const escanear = async (e) => {
    e?.preventDefault()
    const s = up(serieInput)
    if (!s) return
    setError(''); setNotice('')
    if (series.some((x) => up(x.serie) === s)) { setError('La serie ya esta en la devolucion.'); return }
    try {
      let obj = criticas.find((x) => up(x.serie) === s)
      if (!obj) {
        const { data, error: qErr } = await supabase.rpc('qiora_devolucion_buscar_serie', {
          p_distrito: centro,
          p_almacen: alm4(almacen),
          p_serie: s,
        })
        if (qErr) throw qErr
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new Error(`La serie ${s} no existe en IQ09 del centro y almacen seleccionados.`)
        obj = { ...row, dias: row.dias == null ? null : Number(row.dias) }
      }
      if (up(obj.distrito) !== centro || alm4(obj.almacen) !== alm4(almacen)) throw new Error('La serie no pertenece al centro y almacen seleccionados.')
      if (critica && !(Number.isFinite(obj.dias) && obj.dias > 30)) throw new Error('La serie no cumple el requisito de mas de 30 dias en cajuela.')
      setSeries((prev) => [...prev, obj])
      setSerieInput('')
      setNotice(`Serie ${s} agregada.`)
    } catch (err) { setError(err?.message || 'No fue posible buscar la serie.') }
  }

  const guardar = async () => {
    if (!series.length) { setError('No hay series escaneadas para guardar.'); return }
    if (!almacen || !tecnico || !recibe) { setError('Completa almacen, tecnico y recibe.'); return }
    setLoading(true); setError(''); setNotice('')
    try {
      const payload = {
        p_tipo: critica ? 'CRITICA' : 'NORMAL',
        p_distrito: centro,
        p_folio: folio,
        p_almacen: alm4(almacen),
        p_tecnico: tecnico,
        p_recibe: recibe,
        p_series: series.map((x) => ({ serie: x.serie, material: x.material, descripcion: x.descripcion, lote: x.lote, dias: x.dias })),
      }
      const { data, error: saveErr } = await supabase.rpc('qiora_devolucion_guardar_equipos', payload)
      if (saveErr) throw saveErr
      if (data?.ok === false) throw new Error(data.mensaje || 'No se pudo guardar la devolucion.')
      const folioGuardado = data?.folio || folio
      setNotice(data?.mensaje || `Devolucion guardada. Folio ${folioGuardado}.`)
      setSeries([]); setCriticas([]); setSerieInput('')
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (token) {
        try {
          const resp = await fetch('/api/devoluciones/notificar', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ distrito: centro, almacen: alm4(almacen), folio: folioGuardado, tipo: critica ? 'CRITICA' : 'NORMAL' }),
          })
          const n = await resp.json().catch(() => ({}))
          if (!resp.ok) setNotice((data?.mensaje || 'Devolucion guardada.') + ' Notificacion: ' + (n.error || 'no confirmada'))
          else if (n.sent) setNotice((data?.mensaje || 'Devolucion guardada.') + ' Notificacion de Telegram enviada.')
        } catch { /* El guardado no se revierte si falla Telegram. */ }
      }
      const now = new Date(); const pad = (n) => String(n).padStart(2, '0')
      setFolio((critica ? 'DVC-' : 'DVN-') + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()))
    } catch (e) { setError(e?.message || 'Error al guardar la devolucion.') }
    finally { setLoading(false) }
  }

  const quitar = (serie) => setSeries((prev) => prev.filter((x) => up(x.serie) !== up(serie)))
  const pendientes = useMemo(() => criticas.filter((x) => !series.some((y) => up(y.serie) === up(x.serie))), [criticas, series])

  if (loadingProfile) return <main style={st.base}><section style={st.shell}>Cargando perfil y centro...</section></main>

  return (
    <main style={st.base}>
      <section style={st.shell}>
        <Link href="/devoluciones" style={st.back}>Regresar a Devoluciones</Link>
        <header style={st.hero}>
          <h1 style={st.title}>{critica ? 'DEVOLUCION DE EQUIPOS CRITICOS' : 'DEVOLUCION NORMAL'}</h1>
          <p style={st.subtitle}>{critica ? 'Solo equipos con mas de 30 dias en cajuela.' : 'Escanea las series que se van a devolver.'}</p>
          <p style={st.subtitle}>Centro activo: {centro || '-'}</p>
        </header>

        {error && <div role="alert" style={st.error}>{error}</div>}
        {notice && <div role="status" style={st.success}>{notice}</div>}

        <section style={st.panel}>
          <div style={st.fields}>
            <label style={st.label}>Folio<input style={st.input} value={folio} readOnly /></label>
            <label style={st.label}>Almacen<input style={{...st.input, ...(esTecnico ? st.readonly : {})}} value={almacen} readOnly={esTecnico} maxLength={4} placeholder="0008" onChange={(e) => setAlmacen(e.target.value.replace(/\D/g, '').slice(0,4))} onBlur={() => { if (almacen.length === 4) obtenerTecnico(almacen).catch((e) => setError(e.message)) }} /></label>
            <label style={st.label}>Tecnico<input style={st.input} value={tecnico} readOnly placeholder="Se obtiene del almacen" /></label>
            <label style={st.label}>Recibe<input style={st.input} value={recibe} onChange={(e) => setRecibe(e.target.value)} /></label>
          </div>
          <button type="button" style={st.primary} disabled={loading} onClick={cargarCriticas}>{loading ? 'Cargando...' : critica ? 'Cargar series criticas' : 'Cargar series del almacen'}</button>
        </section>

        <div style={st.kpis}>
          <div style={st.kpi}><span>Series disponibles</span><strong>{criticas.length}</strong></div>
          <div style={st.kpi}><span>Escaneadas</span><strong>{series.length}</strong></div>
          <div style={st.kpi}><span>Pendientes</span><strong>{pendientes.length}</strong></div>
          <div style={st.kpi}><span>Folio</span><strong style={{fontSize:13}}>{folio}</strong></div>
        </div>

        <section style={st.panel}>
          <h2 style={st.h2}>{critica ? 'Series criticas SAP (>30 dias)' : 'Series del almacen'}</h2>
          <div style={st.tableWrap}><table style={st.table}><thead><tr>{['Material','Descripcion','Serie','Almacen','Lote','Dias','Accion'].map((x)=><th style={st.th} key={x}>{x}</th>)}</tr></thead><tbody>
            {criticas.length ? criticas.map((x)=><tr key={x.id || x.serie}><td style={st.td}>{x.material || '-'}</td><td style={st.td}>{x.descripcion || '-'}</td><td style={st.td}>{x.serie}</td><td style={st.td}>{x.almacen}</td><td style={st.td}>{x.lote || '-'}</td><td style={st.td}>{x.dias ?? '-'}</td><td style={st.td}><button style={st.smallButton} type="button" disabled={series.some((y)=>up(y.serie)===up(x.serie))} onClick={()=>setSeries((p)=>[...p,x])}>Agregar</button></td></tr>) : <tr><td style={st.empty} colSpan={7}>No hay series cargadas. Capture el almacen y seleccione Cargar.</td></tr>}
          </tbody></table></div>
        </section>

        <section style={st.panel}>
          <h2 style={st.h2}>Escanear serie</h2>
          <form onSubmit={escanear} style={st.scanRow}>
            <input style={{...st.input, flex:1}} value={serieInput} onChange={(e)=>setSerieInput(e.target.value)} placeholder="Escanee serie y presione Enter" />
            <button style={st.primary} type="submit">Agregar serie</button>
          </form>
          <div style={st.tableWrap}><table style={st.table}><thead><tr>{['Material','Descripcion','Serie','Almacen','Lote','Dias','Accion'].map((x)=><th style={st.th} key={x}>{x}</th>)}</tr></thead><tbody>
            {series.length ? series.map((x)=><tr key={x.serie}><td style={st.td}>{x.material || '-'}</td><td style={st.td}>{x.descripcion || '-'}</td><td style={st.td}>{x.serie}</td><td style={st.td}>{x.almacen}</td><td style={st.td}>{x.lote || '-'}</td><td style={st.td}>{x.dias ?? '-'}</td><td style={st.td}><button style={st.removeButton} type="button" onClick={()=>quitar(x.serie)}>Eliminar</button></td></tr>) : <tr><td style={st.empty} colSpan={7}>Sin series escaneadas.</td></tr>}
          </tbody></table></div>
          <div style={st.actions}><button type="button" style={st.primary} disabled={loading} onClick={guardar}>{loading ? 'Guardando...' : 'Guardar devolucion'}</button><button type="button" style={st.secondary} onClick={()=>{setSeries([]);setSerieInput('');setError('');setNotice('Captura limpiada.')}}>Limpiar</button></div>
        </section>
        <p style={st.footer}>Las comprobaciones de centro y almacén también se realizan en Supabase; el filtro visual no es una barrera de seguridad.</p>
      </section>
    </main>
  )
}

const st = {
  base:{minHeight:'100vh',padding:16,boxSizing:'border-box',background:'linear-gradient(145deg,#031f19,#052f25)',color:'#effff8',fontFamily:'Arial,sans-serif'},
  shell:{maxWidth:1400,margin:'0 auto',padding:18,border:'1px solid #356f5d',borderRadius:16,background:'#05281f'},
  back:{display:'inline-block',marginBottom:14,padding:'9px 15px',borderRadius:24,background:'#117b5d',color:'#fff',textDecoration:'none',fontWeight:800},
  hero:{padding:22,borderRadius:14,border:'1px solid #3b987b',background:'linear-gradient(110deg,#10553f,#16a47b)',textAlign:'center'},
  title:{margin:0,fontSize:26},subtitle:{margin:'6px 0 0',fontSize:13},panel:{marginTop:14,padding:14,border:'1px solid #2d6655',borderRadius:13,background:'#082f25'},
  fields:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12},label:{display:'flex',flexDirection:'column',gap:6,fontSize:12,fontWeight:800},input:{boxSizing:'border-box',width:'100%',minWidth:0,padding:11,border:'1px solid #cbd8d3',borderRadius:8,background:'#f7faf9',color:'#17372c',fontSize:14},readonly:{background:'#e1e9e5'},primary:{border:0,borderRadius:9,padding:'12px 15px',background:'#16a77b',color:'#fff',fontWeight:800,cursor:'pointer'},secondary:{border:'1px solid #498b75',borderRadius:9,padding:'12px 15px',background:'#0d5944',color:'#fff',fontWeight:800,cursor:'pointer'},
  kpis:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:14},kpi:{display:'flex',flexDirection:'column',gap:5,padding:13,borderRadius:10,textAlign:'center',background:'#e9f7f0',color:'#11674d',fontSize:12,fontWeight:700},h2:{fontSize:16,margin:'0 0 12px'},tableWrap:{overflowX:'auto',borderRadius:8},table:{width:'100%',minWidth:800,borderCollapse:'collapse',background:'#f8fbf9',color:'#18382c'},th:{padding:10,textAlign:'left',whiteSpace:'nowrap',fontSize:12,background:'#08795c',color:'#fff',border:'1px solid #a8d1c2'},td:{padding:9,border:'1px solid #d2e0da',fontSize:12,whiteSpace:'nowrap'},empty:{padding:18,textAlign:'center',color:'#49675b'},smallButton:{padding:'7px 10px',border:0,borderRadius:7,background:'#148663',color:'#fff',fontWeight:700,cursor:'pointer'},removeButton:{padding:'7px 10px',border:0,borderRadius:7,background:'#dc3545',color:'#fff',fontWeight:700,cursor:'pointer'},scanRow:{display:'flex',gap:10,flexWrap:'wrap'},actions:{display:'flex',gap:10,flexWrap:'wrap',marginTop:14},error:{marginTop:12,padding:12,borderRadius:8,background:'#ffe0e0',color:'#9c2525'},success:{marginTop:12,padding:12,borderRadius:8,background:'#dcfce7',color:'#166534'},footer:{marginTop:14,fontSize:12,color:'#b8d7ca',lineHeight:1.5}
}
