'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const dinero = v => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v || 0))
const fecha = v => {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
const normal = v => String(v ?? '').trim()
const estilo = {
  fondo: { minHeight: '100vh', padding: '18px 14px 50px', background: 'linear-gradient(135deg,#032a23,#063b30)', fontFamily: 'Arial,sans-serif', color: '#f2fff9' },
  marco: { maxWidth: 1320, margin: '0 auto', padding: 16, border: '1px solid #277e67', borderRadius: 18, background: '#042e26' },
  hero: { background: 'linear-gradient(105deg,#07503e,#0fa784)', padding: '23px 15px', textAlign: 'center', borderRadius: 17, border: '1px solid #37b396', margin: '14px 0 16px' },
  seccion: { background: '#073b30', border: '1px solid #28745f', borderRadius: 15, padding: 17, marginTop: 15 },
  campo: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700 },
  input: { width: '100%', boxSizing: 'border-box', background: '#fff', color: '#142821', border: '1px solid #b4d2c4', borderRadius: 9, fontSize: 14, padding: '10px 12px', minHeight: 42, colorScheme: 'light' },
  boton: { border: '1px solid #3ac6a0', background: 'linear-gradient(105deg,#087a5c,#14b58b)', color: '#fff', borderRadius: 11, padding: '13px 18px', fontWeight: 800, cursor: 'pointer' },
  tabla: { width: '100%', minWidth: 1000, borderCollapse: 'collapse', color: '#20352b', fontSize: 13 },
  th: { background: '#08765a', color: '#fff', padding: '11px 9px', textAlign: 'left', borderRight: '1px solid #6caf99' },
  td: { background: '#f4faf7', borderBottom: '1px solid #d3e7dc', padding: '11px 9px', verticalAlign: 'middle' },
}

export default function BajasCobrosPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tipo, setTipo] = useState('BAJAS')
  const [almacen, setAlmacen] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [fechaInicial, setFechaInicial] = useState('')
  const [fechaFinal, setFechaFinal] = useState('')
  const [registros, setRegistros] = useState([])
  const [opciones, setOpciones] = useState([])
  const [detalle, setDetalle] = useState(null)
  const [buscado, setBuscado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [inicio, setInicio] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser()
        if (authError || !auth?.user) { router.replace('/'); return }
        const { data, error: e } = await supabase.rpc('qiora_mi_perfil')
        if (e) throw e
        if (!data?.activo || !(data.auditoria || data.ver_auditorias || data.administrar_permisos)) throw new Error('Sin permisos para consultar Bajas y Cobros.')
        if (vivo) setPerfil(data)
      } catch (e) { if (vivo) setError(e.message || 'No se pudo comprobar el acceso') }
      finally { if (vivo) setInicio(false) }
    })()
    return () => { vivo = false }
  }, [router])

  async function consultar(categoria, filtros = {}, mostrar = true) {
    const { data, error: e } = await supabase.rpc('qiora_consultar_movimientos_detalle', {
      p_tipo: categoria,
      p_almacen: normal(filtros.almacen || ''),
      p_tecnico: normal(filtros.tecnico || ''),
      p_fecha_inicial: filtros.fechaInicial || null,
      p_fecha_final: filtros.fechaFinal || null,
    })
    if (e) throw e
    return Array.isArray(data) ? data : []
  }

  useEffect(() => {
    if (!perfil) return
    let vivo = true
    setCargando(true); setError(''); setDetalle(null); setBuscado(false); setRegistros([])
    consultar(tipo).then(data => {
      if (vivo) {
        setOpciones(data)
        setRegistros(data)
        setBuscado(true)
      }
    }).catch(e => { if (vivo) setError(e.message || 'No se pudo consultar') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [perfil, tipo])

  async function buscar() {
    if (!perfil || cargando) return
    if (fechaInicial && fechaFinal && fechaFinal < fechaInicial) { setError('La fecha final no puede ser anterior a la inicial.'); return }
    setCargando(true); setError(''); setDetalle(null)
    try {
      const data = await consultar(tipo, { almacen, tecnico, fechaInicial, fechaFinal })
      setRegistros(data); setBuscado(true)
    } catch (e) { setError(e.message || 'Error al buscar'); setRegistros([]) }
    finally { setCargando(false) }
  }

  function limpiar() {
    setAlmacen(''); setTecnico(''); setFechaInicial(''); setFechaFinal(''); setDetalle(null)
    setRegistros(opciones); setBuscado(true); setError('')
  }

  const tecnicos = useMemo(() => {
    const map = new Map()
    for (const r of opciones) {
      const clave = `${normal(r.almacen)}|${normal(r.tecnico)}`
      if (normal(r.tecnico) && !map.has(clave)) map.set(clave, { clave, almacen: r.almacen, tecnico: r.tecnico })
    }
    return [...map.values()].sort((a, b) => a.tecnico.localeCompare(b.tecnico, 'es'))
  }, [opciones])
  const total = useMemo(() => registros.reduce((acc, x) => ({
    materiales: acc.materiales + Number(x.materiales || 0),
    herramientas: acc.herramientas + Number(x.herramientas || 0),
    equipos: acc.equipos + Number(x.equipos || 0),
    total: acc.total + Number(x.total || 0),
  }), { materiales: 0, herramientas: 0, equipos: 0, total: 0 }), [registros])

  const tarjeta = (titulo, valor) => <div key={titulo} style={{ flex: 1, minWidth: 180, background: '#eafbf4', color: '#08533e', borderRadius: 13, padding: 20, textAlign: 'center', fontWeight: 800 }}>
    <div style={{ fontSize: 13, marginBottom: 6 }}>{titulo}</div><div style={{ fontSize: 22 }}>{dinero(valor)}</div>
  </div>

  return <main style={estilo.fondo}><div style={estilo.marco}>
    <button type="button" style={estilo.boton} onClick={() => router.push('/')}>← Regresar</button>
    <header style={estilo.hero}><h1 style={{ fontSize: 29, margin: '0 0 8px' }}>Consulta de Bajas y Cobros</h1><p style={{ margin: 0 }}>Consulta de registros enviados desde Auditorías · Distrito {perfil?.distrito || '-'}</p></header>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
      {['BAJAS', 'COBROS'].map(x => <button type="button" key={x} onClick={() => { setTipo(x); setAlmacen(''); setTecnico(''); setFechaInicial(''); setFechaFinal('') }} style={{ ...estilo.boton, background: tipo === x ? 'linear-gradient(105deg,#087e60,#15ba8c)' : '#094a3c', borderColor: tipo === x ? '#50e4b3' : '#327d67', fontSize: 18 }} aria-pressed={tipo === x}>{x === 'BAJAS' ? 'Ver Bajas' : 'Ver Cobros'}</button>)}
    </div>
    <section style={estilo.seccion}>
      <h2 style={{ fontSize: 19, margin: '0 0 16px' }}>Filtros de búsqueda</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        <label style={estilo.campo}>Almacén<input style={estilo.input} value={almacen} placeholder="Ejemplo: 1951" onChange={e => setAlmacen(e.target.value.toUpperCase())} /></label>
        <label style={estilo.campo}>Nombre del técnico<select style={estilo.input} value={tecnico} onChange={e => setTecnico(e.target.value)}><option value="">Todos los técnicos con {tipo.toLowerCase()}</option>{tecnicos.map(x => <option key={x.clave} value={x.clave}>{x.almacen} - {x.tecnico}</option>)}</select></label>
        <label style={estilo.campo}>Fecha inicial<input style={estilo.input} type="date" value={fechaInicial} onChange={e => setFechaInicial(e.target.value)} /></label>
        <label style={estilo.campo}>Fecha final<input style={estilo.input} type="date" min={fechaInicial || undefined} value={fechaFinal} onChange={e => setFechaFinal(e.target.value)} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 16 }}>
        <button type="button" style={estilo.boton} disabled={cargando || !perfil} onClick={buscar}>{cargando ? 'Buscando...' : 'Buscar'}</button>
        <button type="button" style={{ ...estilo.boton, background: '#bd242d', borderColor: '#f56d74' }} onClick={limpiar}>Limpiar</button>
      </div>
      {error && <p role="alert" style={{ color: '#ffb9bd', fontWeight: 700 }}>{error}</p>}
      {inicio && <p>Validando sesión...</p>}
      {!inicio && buscado && <p style={{ color: '#c6fce4', fontSize: 13, marginBottom: 0 }}>Se encontraron {registros.length} {tipo.toLowerCase()}.</p>}
    </section>
    <section style={estilo.seccion}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 15 }}>
        <div><strong>Almacén:</strong> {almacen || 'Todos'}<div><strong>Técnico:</strong> {tecnico ? tecnicos.find(x => x.clave === tecnico)?.tecnico || '-' : 'Todos los técnicos'}</div></div>
        <div><strong>{tipo === 'BAJAS' ? 'Bajas' : 'Cobros'} registrados:</strong> {registros.length}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{tarjeta('Herramientas', total.herramientas)}{tarjeta('Equipos', total.equipos)}{tarjeta('Materiales', total.materiales)}{tarjeta('Total', total.total)}</div>
    </section>
    <section style={estilo.seccion}>
      <h2 style={{ fontSize: 19, margin: '0 0 16px' }}>{tipo === 'BAJAS' ? 'Bajas registradas' : 'Cobros registrados'}</h2>
      <div style={{ overflowX: 'auto' }}><table style={estilo.tabla}><thead><tr>{['Folio', 'Fecha', 'Almacén', 'Técnico', 'Solicita', 'Herramientas', 'Equipos', 'Material', 'Total', 'Estado', 'Acción'].map(h => <th key={h} style={estilo.th}>{h}</th>)}</tr></thead><tbody>
        {registros.map(x => <tr key={`${tipo}-${x.id}`}>
          <td style={estilo.td}>{x.folio_movimiento || x.folio}</td><td style={estilo.td}>{fecha(x.creado_en)}</td><td style={estilo.td}>{x.almacen}</td><td style={estilo.td}>{x.tecnico || 'No registrado'}</td><td style={estilo.td}>{x.solicita || 'No registrado'}</td><td style={estilo.td}>{dinero(x.herramientas)}</td><td style={estilo.td}>{dinero(x.equipos)}</td><td style={estilo.td}>{dinero(x.materiales)}</td><td style={{ ...estilo.td, fontWeight: 800 }}>{dinero(x.total)}</td><td style={estilo.td}>{x.estado}</td>
          <td style={estilo.td}><button type="button" style={{ ...estilo.boton, padding: '9px 11px', whiteSpace: 'nowrap' }} onClick={() => setDetalle(detalle?.id === x.id ? null : x)}>Ver detalles</button></td>
        </tr>)}
        {!registros.length && <tr><td colSpan={11} style={{ ...estilo.td, textAlign: 'center' }}>{cargando ? 'Consultando...' : 'No hay registros con estos filtros.'}</td></tr>}
      </tbody></table></div>
    </section>
    {detalle && <section style={estilo.seccion}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><h2>Detalle del folio {detalle.folio_movimiento || detalle.folio}</h2><button type="button" style={estilo.boton} onClick={() => setDetalle(null)}>Cerrar</button></div>
      <p>Folio de auditoría: {detalle.folio} · Almacén: {detalle.almacen} · Técnico: {detalle.tecnico || 'No registrado'} · Estado: {detalle.estado}</p>
      <p>Materiales: {dinero(detalle.materiales)} · Herramientas: {dinero(detalle.herramientas)} · Equipos: {dinero(detalle.equipos)} · Total: {dinero(detalle.total)}</p>
      <div style={{ overflowX: 'auto' }}><table style={{ ...estilo.tabla, minWidth: 650 }}><thead><tr>{['Categoría', 'Referencia / SKU', 'Descripción', 'Cantidad', 'Importe'].map(x => <th key={x} style={estilo.th}>{x}</th>)}</tr></thead><tbody>
        {(Array.isArray(detalle.detalle) ? detalle.detalle : []).map((x, i) => <tr key={i}><td style={estilo.td}>{x.categoria || '-'}</td><td style={estilo.td}>{x.sku || x.referencia || '-'}</td><td style={estilo.td}>{x.descripcion || x.producto || x.material || '-'}</td><td style={estilo.td}>{x.cantidad ?? '-'}</td><td style={estilo.td}>{x.importe == null ? 'SIN COSTO' : dinero(x.importe)}</td></tr>)}
      </tbody></table></div>
    </section>}
  </div></main>
}
