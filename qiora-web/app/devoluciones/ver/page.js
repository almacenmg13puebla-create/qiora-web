'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()
const normalizarAlmacen = (v) => {
  const n = clean(v).replace(/\D/g, '')
  return n ? n.padStart(4, '0').slice(-4) : ''
}

function fechaHora(valor) {
  if (!valor) return '—'
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return String(valor)
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function fechaInput(valor) {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function csvValue(value) {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}

export default function VerDevolucionesPage() {
  const [perfil, setPerfil] = useState(null)
  const [centro, setCentro] = useState('')
  const [esAdminPadre, setEsAdminPadre] = useState(false)

  const [fechaInicial, setFechaInicial] = useState('')
  const [fechaFinal, setFechaFinal] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [folio, setFolio] = useState('')
  const [serie, setSerie] = useState('')

  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargarRegistros(perfilActual, filtros = {}) {
    setCargando(true)
    setError('')
    setMensaje('')

    try {
      const centroPerfil = upper(perfilActual?.distrito)
      const adminNacional = upper(perfilActual?.puesto) === 'ADMIN_PADRE'

      let q = supabase
        .from('devoluciones_equipos')
        .select('id, creado_en, folio, distrito, tipo, almacen, tecnico, recibe, material, descripcion, serie, lote, dias_en_cajuela')
        .eq('tipo', 'CRITICA')
        .order('creado_en', { ascending: false })
        .limit(2000)

      // ADMIN_PADRE puede consultar todos los centros; los demás quedan
      // limitados al distrito de su perfil autenticado.
      if (!adminNacional) {
        if (!centroPerfil) throw new Error('El perfil no tiene centro/distrito configurado.')
        q = q.eq('distrito', centroPerfil)
      }

      const fi = filtros.fechaInicial ?? fechaInicial
      const ff = filtros.fechaFinal ?? fechaFinal
      const alm = normalizarAlmacen(filtros.almacen ?? almacen)
      const fol = upper(filtros.folio ?? folio)
      const ser = upper(filtros.serie ?? serie)

      if (fi) q = q.gte('creado_en', `${fi}T00:00:00`)
      if (ff) q = q.lte('creado_en', `${ff}T23:59:59.999`)
      if (alm) q = q.eq('almacen', alm)
      if (fol) q = q.ilike('folio', `%${fol}%`)
      if (ser) q = q.ilike('serie', `%${ser}%`)

      const { data, error: consultaError } = await q
      if (consultaError) throw consultaError

      setFilas(Array.isArray(data) ? data : [])
      setMensaje(`Consulta completada. ${Array.isArray(data) ? data.length : 0} registro(s).`)
    } catch (e) {
      setFilas([])
      setError(e?.message || 'No fue posible consultar las devoluciones.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    let vivo = true

    async function iniciar() {
      try {
        const { data, error: perfilError } = await supabase.rpc('qiora_mi_perfil')
        if (perfilError) throw perfilError
        if (!data || data.activo !== true) throw new Error('No se encontró un perfil activo.')

        const adminNacional = upper(data.puesto) === 'ADMIN_PADRE'
        if (!adminNacional && data.devoluciones !== true) {
          throw new Error('Tu usuario no tiene permiso para consultar devoluciones.')
        }

        if (!vivo) return
        setPerfil(data)
        setCentro(upper(data.distrito))
        setEsAdminPadre(adminNacional)

        await cargarRegistros(data, {
          fechaInicial: '',
          fechaFinal: '',
          almacen: '',
          folio: '',
          serie: '',
        })
      } catch (e) {
        if (vivo) {
          setError(e?.message || 'No fue posible iniciar la consulta.')
          setCargando(false)
        }
      }
    }

    iniciar()
    return () => { vivo = false }
  }, [])

  async function buscar(e) {
    e?.preventDefault()
    if (!perfil) return
    await cargarRegistros(perfil, { fechaInicial, fechaFinal, almacen, folio, serie })
  }

  async function limpiar() {
    setFechaInicial('')
    setFechaFinal('')
    setAlmacen('')
    setFolio('')
    setSerie('')
    if (perfil) {
      await cargarRegistros(perfil, {
        fechaInicial: '',
        fechaFinal: '',
        almacen: '',
        folio: '',
        serie: '',
      })
    }
  }

  function descargarExcel() {
    if (!filas.length) {
      setError('No hay registros para descargar.')
      return
    }

    const columnas = [
      ['Folio', 'folio'],
      ['Fecha recibida', 'creado_en'],
      ['Centro', 'distrito'],
      ['Almacén', 'almacen'],
      ['Técnico', 'tecnico'],
      ['Recibió', 'recibe'],
      ['Serie', 'serie'],
      ['Material', 'material'],
      ['Descripción', 'descripcion'],
      ['Lote', 'lote'],
      ['Días', 'dias_en_cajuela'],
      ['Tipo', 'tipo'],
    ]

    const contenido = [
      columnas.map(([t]) => csvValue(t)).join(','),
      ...filas.map((f) => columnas.map(([, k]) => {
        const valor = k === 'creado_en' ? fechaHora(f[k]) : f[k]
        return csvValue(valor)
      }).join(',')),
    ].join('\r\n')

    const blob = new Blob(['\ufeff', contenido], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DEVOLUCIONES_CRITICAS_${centro || 'TODOS'}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const totalFolios = new Set(filas.map((f) => f.folio).filter(Boolean)).size
  const filtroFolio = clean(folio) || 'TODAS'
  const filtroAlmacen = normalizarAlmacen(almacen) || (esAdminPadre ? 'TODOS' : 'TODOS')

  return (
    <main style={s.base}>
      <div style={s.shell}>
        <Link href="/devoluciones" style={s.back}>← Regresar a Devoluciones</Link>

        <header style={s.hero}>
          <h1 style={s.title}>Ver devoluciones</h1>
          <p style={s.subtitle}>
            Consulta por fecha, folio, almacén o serie y descarga Excel. Centro activo: {esAdminPadre ? 'TODOS' : (centro || '—')}.
          </p>
        </header>

        {error && <div role="alert" style={s.error}>{error}</div>}
        {mensaje && !error && <div role="status" style={s.notice}>{mensaje}</div>}

        <section style={s.panel}>
          <form onSubmit={buscar}>
            <div style={s.filters}>
              <label style={s.label}>Fecha inicial
                <input type="date" value={fechaInicial} onChange={e => setFechaInicial(e.target.value)} style={s.input} />
              </label>
              <label style={s.label}>Fecha final
                <input type="date" value={fechaFinal} onChange={e => setFechaFinal(e.target.value)} style={s.input} />
              </label>
              <label style={s.label}>Almacén
                <input value={almacen} maxLength={4} placeholder="0008" onChange={e => setAlmacen(e.target.value.replace(/\D/g, '').slice(0, 4))} style={s.input} />
              </label>
              <label style={s.label}>Folio
                <input value={folio} placeholder="DVC-" onChange={e => setFolio(e.target.value)} style={s.input} />
              </label>
            </div>

            <div style={s.stats}>
              <article style={s.stat}><span>Total devoluciones</span><strong>{totalFolios}</strong></article>
              <article style={s.stat}><span>Folio filtrado</span><strong>{filtroFolio}</strong></article>
              <article style={s.stat}><span>Almacén filtrado</span><strong>{filtroAlmacen}</strong></article>
            </div>

            <div style={s.searchRow}>
              <label style={{ ...s.label, flex: 1 }}>Serie
                <input value={serie} placeholder="Buscar serie" onChange={e => setSerie(e.target.value)} style={s.input} />
              </label>
              <button type="submit" style={s.button} disabled={cargando}>{cargando ? 'Buscando...' : 'Buscar'}</button>
              <button type="button" style={s.button} onClick={descargarExcel} disabled={cargando || !filas.length}>Descargar Excel</button>
              <button type="button" style={s.buttonSecondary} onClick={limpiar} disabled={cargando}>Limpiar</button>
            </div>
          </form>
        </section>

        <section style={s.tablePanel}>
          <div style={s.tableScroll}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Folio', 'Fecha recibida', 'Almacén', 'Técnico', 'Recibió', 'Serie', 'Material', 'Descripción', 'Lote', 'Días', 'Estatus'].map(t => <th key={t} style={s.th}>{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {filas.length ? filas.map(f => (
                  <tr key={f.id}>
                    <td style={s.tdStrong}>{f.folio || '—'}</td>
                    <td style={s.td}>{fechaHora(f.creado_en)}</td>
                    <td style={s.td}>{f.almacen || '—'}</td>
                    <td style={s.td}>{f.tecnico || '—'}</td>
                    <td style={s.td}>{f.recibe || '—'}</td>
                    <td style={s.td}>{f.serie || '—'}</td>
                    <td style={s.td}>{f.material || '—'}</td>
                    <td style={s.td}>{f.descripcion || '—'}</td>
                    <td style={s.td}>{f.lote || '—'}</td>
                    <td style={s.td}>{f.dias_en_cajuela ?? '—'}</td>
                    <td style={s.td}><span style={s.badge}>Registrada</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={11} style={s.empty}>{cargando ? 'Consultando devoluciones...' : 'Sin resultados.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={s.footer}>Registros mostrados: {filas.length}. La consulta se limita al centro autorizado por el perfil.</p>
        </section>
      </div>
    </main>
  )
}

const s = {
  base: { minHeight: '100vh', padding: 16, boxSizing: 'border-box', color: '#f0fff8', background: 'linear-gradient(145deg,#031f19,#052f25)', fontFamily: 'Arial, sans-serif' },
  shell: { maxWidth: 1500, margin: '0 auto', padding: 16, border: '1px solid #356f5d', borderRadius: 16, background: 'rgba(2,28,22,.82)' },
  back: { display: 'inline-block', marginBottom: 14, padding: '9px 15px', borderRadius: 24, background: '#117b5d', color: '#fff', textDecoration: 'none', fontWeight: 700 },
  hero: { padding: '22px 16px', border: '1px solid #379579', borderRadius: 15, textAlign: 'center', background: 'linear-gradient(110deg,#10553f,#16a47b)' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { margin: '7px 0 0', fontSize: 14 },
  panel: { marginTop: 14, padding: 14, border: '1px solid #356f5d', borderRadius: 12, background: '#082e25' },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 700 },
  input: { width: '100%', boxSizing: 'border-box', minHeight: 34, padding: '8px 10px', border: '1px solid #c8d7d2', borderRadius: 7, background: '#f7fbf9', color: '#18352b', font: 'inherit', fontWeight: 400 },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(140px,1fr))', gap: 10, marginTop: 12 },
  stat: { display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', padding: 10, borderRadius: 10, background: 'linear-gradient(110deg,#11775a,#159a75)', color: '#fff', fontSize: 12 },
  searchRow: { display: 'flex', alignItems: 'end', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  button: { minHeight: 34, padding: '9px 18px', border: 0, borderRadius: 8, background: '#19a77c', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  buttonSecondary: { minHeight: 34, padding: '9px 18px', border: '1px solid #438572', borderRadius: 8, background: '#0d513f', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  tablePanel: { marginTop: 14, padding: 12, border: '1px solid #356f5d', borderRadius: 12, background: '#082e25' },
  tableScroll: { width: '100%', overflowX: 'auto', borderRadius: 8 },
  table: { width: '100%', minWidth: 1100, borderCollapse: 'collapse', background: '#f7fbf9', color: '#18352b' },
  th: { padding: '9px 8px', border: '1px solid #b7d6cb', background: '#117a5e', color: '#fff', fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' },
  td: { padding: '8px 7px', border: '1px solid #d0e0da', fontSize: 11, whiteSpace: 'nowrap' },
  tdStrong: { padding: '8px 7px', border: '1px solid #d0e0da', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  empty: { padding: 22, textAlign: 'center', color: '#5a6e65' },
  badge: { display: 'inline-block', padding: '4px 8px', borderRadius: 14, background: '#d9f7e8', color: '#08714c', fontWeight: 700 },
  error: { marginTop: 12, padding: 12, borderRadius: 8, background: '#ffe0e0', color: '#8e2525' },
  notice: { marginTop: 12, padding: 10, borderRadius: 8, background: '#dff9e9', color: '#17623e', fontSize: 12 },
  footer: { margin: '10px 2px 0', color: '#b9d7cd', fontSize: 12 },
}
