'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const txt = (v) => String(v ?? '').trim()
const up = (v) => txt(v).toUpperCase()
const alm4 = (v) => txt(v).replace(/\D/g, '').slice(0, 4).padStart(4, '0')

function crearFolio(tipo) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${tipo === 'CRITICA' ? 'DVC-' : 'DVN-'}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
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
  const autoLoadedWarehouse = useRef('')
  const inputSerieRef = useRef(null)

  useEffect(() => {
    let alive = true

    async function init() {
      try {
        const { data, error: pErr } = await supabase.rpc('qiora_mi_perfil')
        if (pErr) throw pErr
        if (!data || data.activo !== true) throw new Error('No se encontró un perfil activo.')

        const puesto = up(data.puesto)
        const admin = puesto === 'ADMIN_PADRE' || puesto.startsWith('ADMIN_')
        if (!admin && data.devoluciones !== true) throw new Error('Tu usuario no tiene permiso para Devoluciones.')

        const distrito = up(data.distrito)
        if (!distrito) throw new Error('El perfil no tiene centro/distrito configurado.')
        if (!alive) return

        setPerfil(data)
        setCentro(distrito)
        setRecibe(txt(data.nombre))
        setFolio(crearFolio(critica ? 'CRITICA' : 'NORMAL'))

        if (puesto === 'TECNICO') {
          setAlmacen(alm4(data.usuario_almacen))
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

  const esTecnico = up(perfil?.puesto) === 'TECNICO'

  const obtenerTecnico = useCallback(async (almacenValor) => {
    const a = alm4(almacenValor)
    if (!/^\d{4}$/.test(a) || !centro) throw new Error('Captura un almacén válido de cuatro dígitos.')

    const { data, error: qErr } = await supabase.rpc('qiora_devolucion_tecnico_almacen', {
      p_distrito: centro,
      p_almacen: a,
    })
    if (qErr) throw qErr

    const nombre = typeof data === 'string' ? data : data?.nombre
    if (!nombre) throw new Error(`El almacén ${a} no existe o no está activo en ${centro}.`)
    setTecnico(txt(nombre))
    return txt(nombre)
  }, [centro])

  const cargarCriticas = useCallback(async (valorAlmacen = almacen) => {
    const a = alm4(valorAlmacen)
    if (!centro) {
      setError('No se encontró el centro activo del usuario.')
      return
    }
    if (!/^\d{4}$/.test(a)) {
      setError('Captura un almacén válido de cuatro dígitos.')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')

    try {
      await obtenerTecnico(a)
      let result = []

      if (critica) {
        const { data, error: qErr } = await supabase.rpc('qiora_devolucion_series_criticas', {
          p_distrito: centro,
          p_almacen: a,
        })
        if (qErr) throw qErr
        result = (data || []).map((r) => ({
          ...r,
          distrito: up(r.distrito || r.centro || centro),
          serie: up(r.serie),
          almacen: alm4(r.almacen),
          dias: Number(r.dias),
        }))
      }

      setAlmacen(a)
      setCriticas(result)
      setSeries([])
      setSerieInput('')
      setNotice(`Se cargaron ${result.length} serie(s) críticas para el almacén ${a} del centro ${centro}.`)
      setTimeout(() => inputSerieRef.current?.focus(), 100)
    } catch (e) {
      setError(e?.message || 'No fue posible cargar las series críticas.')
      setTecnico('')
      setCriticas([])
      setSeries([])
    } finally {
      setLoading(false)
    }
  }, [almacen, centro, critica, obtenerTecnico])

  useEffect(() => {
    const key = `${centro}:${almacen}`
    if (!loadingProfile && esTecnico && centro && /^\d{4}$/.test(almacen) && critica && autoLoadedWarehouse.current !== key) {
      autoLoadedWarehouse.current = key
      cargarCriticas(almacen)
    }
  }, [loadingProfile, esTecnico, centro, almacen, critica, cargarCriticas])

  const pendientes = useMemo(
    () => criticas.filter((x) => !series.some((y) => up(y.serie) === up(x.serie))),
    [criticas, series]
  )

  const escanear = async (e) => {
    e?.preventDefault()
    const s = up(serieInput)
    if (!s) return
    setError('')
    setNotice('')

    if (!/^\d{4}$/.test(alm4(almacen)) || !tecnico) {
      setError('Primero captura el almacén y presiona Enter para cargar las series críticas.')
      return
    }
    if (series.some((x) => up(x.serie) === s)) {
      setError('La serie ya está en la devolución.')
      setSerieInput('')
      return
    }

    try {
      let obj = criticas.find((x) => up(x.serie) === s)
      if (!obj) {
        throw new Error(`La serie ${s} no está en las series críticas pendientes del almacén ${alm4(almacen)}.`)
      }
      if (up(obj.distrito || obj.centro || centro) !== centro || alm4(obj.almacen) !== alm4(almacen)) {
        throw new Error('La serie no pertenece al centro y almacén seleccionados.')
      }
      if (!(Number.isFinite(Number(obj.dias)) && Number(obj.dias) > 30)) {
        throw new Error('La serie no cumple el requisito de más de 30 días en cajuela.')
      }

      setSeries((prev) => [...prev, obj])
      setSerieInput('')
      setNotice(`Serie ${s} agregada a la devolución.`)
    } catch (err) {
      setError(err?.message || 'No fue posible validar la serie.')
      setSerieInput('')
    } finally {
      setTimeout(() => inputSerieRef.current?.focus(), 0)
    }
  }

  const guardar = async () => {
    if (!series.length) {
      setError('No hay series escaneadas para guardar.')
      return
    }
    if (!almacen || !tecnico || !recibe) {
      setError('Completa almacén, técnico y recibe.')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')

    try {
      const payload = {
        p_tipo: critica ? 'CRITICA' : 'NORMAL',
        p_distrito: centro,
        p_folio: folio,
        p_almacen: alm4(almacen),
        p_tecnico: tecnico,
        p_recibe: recibe,
        p_series: series.map((x) => ({
          serie: x.serie,
          material: x.material,
          descripcion: x.descripcion,
          lote: x.lote,
          dias: x.dias,
        })),
      }

      const { data, error: saveErr } = await supabase.rpc('qiora_devolucion_guardar_equipos', payload)
      if (saveErr) throw saveErr
      if (data?.ok === false) throw new Error(data.mensaje || 'No se pudo guardar la devolución.')

      const folioGuardado = data?.folio || folio
      setNotice(data?.mensaje || `Devolución guardada. Folio ${folioGuardado}.`)
      setSeries([])
      setCriticas([])
      setSerieInput('')

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (token) {
        try {
          const resp = await fetch('/api/devoluciones/notificar', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              distrito: centro,
              almacen: alm4(almacen),
              folio: folioGuardado,
              tipo: critica ? 'CRITICA' : 'NORMAL',
            }),
          })
          const n = await resp.json().catch(() => ({}))
          if (!resp.ok) setNotice((data?.mensaje || 'Devolución guardada.') + ' Notificación: ' + (n.error || 'no confirmada'))
          else if (n.sent) setNotice((data?.mensaje || 'Devolución guardada.') + ' Notificación de Telegram enviada.')
        } catch {
          // El guardado no se revierte si falla la notificación.
        }
      }

      setFolio(crearFolio(critica ? 'CRITICA' : 'NORMAL'))
      setTimeout(() => document.getElementById('dev-almacen')?.focus(), 100)
    } catch (e) {
      setError(e?.message || 'Error al guardar la devolución.')
    } finally {
      setLoading(false)
    }
  }

  const quitar = (serie) => setSeries((prev) => prev.filter((x) => up(x.serie) !== up(serie)))

  const limpiar = () => {
    setAlmacen(esTecnico ? alm4(perfil?.usuario_almacen) : '')
    setTecnico(esTecnico ? txt(perfil?.nombre) : '')
    setCriticas([])
    setSeries([])
    setSerieInput('')
    setError('')
    setNotice('')
    autoLoadedWarehouse.current = ''
    setFolio(crearFolio(critica ? 'CRITICA' : 'NORMAL'))
    setTimeout(() => document.getElementById('dev-almacen')?.focus(), 100)
  }

  if (loadingProfile) {
    return <main style={st.base}><section style={st.shell}>Cargando perfil y centro...</section></main>
  }

  return (
    <main style={st.base}>
      <section style={st.shell}>
        <Link href="/devoluciones" style={st.back}>← Regresar a Devoluciones</Link>

        <header style={st.hero}>
          <h1 style={st.title}>{critica ? 'Devolución de Equipos Críticos' : 'Devolución Normal'}</h1>
          <p style={st.subtitle}>{critica ? 'Solo equipos de IQ09 con más de 30 días en cajuela.' : 'Escanee las series que se van a devolver.'}</p>
          <p style={st.subtitle}>Centro activo: {centro || '-'}</p>
        </header>

        {error && <div role="alert" style={st.error}>{error}</div>}
        {notice && <div role="status" style={st.success}>{notice}</div>}

        <section style={st.panel}>
          <div style={st.fields}>
            <label style={st.label}>
              Folio
              <input style={st.input} value={folio} readOnly />
            </label>

            <label style={st.label}>
              Almacén
              <input
                id="dev-almacen"
                style={{ ...st.input, ...(esTecnico ? st.readonly : {}) }}
                value={almacen}
                readOnly={esTecnico}
                maxLength={4}
                placeholder="0008"
                disabled={loading}
                onChange={(e) => {
                  const valor = e.target.value.replace(/\D/g, '').slice(0, 4)
                  setAlmacen(valor)
                  setTecnico('')
                  setCriticas([])
                  setSeries([])
                  setError('')
                  setNotice('')
                  autoLoadedWarehouse.current = ''
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    cargarCriticas(almacen)
                  }
                }}
              />
            </label>

            <label style={st.label}>
              Técnico
              <input style={{ ...st.input, ...st.readonly }} value={tecnico} readOnly placeholder="Se obtiene del almacén" />
            </label>

            <label style={st.label}>
              Recibe
              <input style={{ ...st.input, ...st.readonly }} value={recibe} readOnly />
            </label>
          </div>

          <button type="button" style={st.loadButton} disabled={loading} onClick={() => cargarCriticas(almacen)}>
            {loading ? 'Cargando series críticas...' : 'Cargar series críticas'}
          </button>
        </section>

        <div style={st.kpis}>
          <div style={st.kpi}><span>Series críticas SAP</span><strong>{criticas.length}</strong></div>
          <div style={st.kpi}><span>Series devueltas</span><strong>{series.length}</strong></div>
          <div style={st.kpi}><span>Pendientes</span><strong>{pendientes.length}</strong></div>
        </div>

        <section style={st.columns}>
          <div style={st.panelTable}>
            <h2 style={st.h2}>Series devueltas</h2>
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead><tr>{['Cantidad', 'Serie', 'Material', 'Días', 'Acción'].map((x) => <th style={st.th} key={x}>{x}</th>)}</tr></thead>
                <tbody>
                  {series.length ? series.map((x) => (
                    <tr key={x.serie}>
                      <td style={st.td}>1</td>
                      <td style={st.td}>{x.serie}</td>
                      <td style={st.td}>{x.material || '-'}</td>
                      <td style={st.td}>{x.dias ?? '-'}</td>
                      <td style={st.td}><button type="button" style={st.removeButton} disabled={loading} onClick={() => quitar(x.serie)}>Eliminar</button></td>
                    </tr>
                  )) : <tr><td style={st.empty} colSpan={5}>Sin series devueltas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={st.panelTable}>
            <h2 style={st.h2}>Series críticas SAP (&gt;30 días)</h2>
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead><tr>{['Cantidad', 'Serie', 'Material', 'Días'].map((x) => <th style={st.th} key={x}>{x}</th>)}</tr></thead>
                <tbody>
                  {pendientes.length ? pendientes.map((x) => (
                    <tr key={x.id || x.serie}>
                      <td style={st.td}>1</td>
                      <td style={st.td}>{x.serie}</td>
                      <td style={st.td}>{x.material || '-'}</td>
                      <td style={st.td}>{x.dias ?? '-'}</td>
                    </tr>
                  )) : <tr><td style={st.empty} colSpan={4}>{criticas.length ? 'No hay series pendientes.' : 'Ingrese el almacén y presione Enter para cargar las series críticas.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section style={st.panel}>
          <label style={st.scanLabel} htmlFor="dev-serie">Escanear serie</label>
          <form onSubmit={escanear} style={st.scanRow}>
            <input
              id="dev-serie"
              ref={inputSerieRef}
              style={{ ...st.input, flex: 1 }}
              value={serieInput}
              onChange={(e) => setSerieInput(up(e.target.value))}
              placeholder="Escanee serie y presione Enter"
              disabled={loading || !criticas.length}
            />
          </form>
        </section>

        <section style={st.panel}>
          <div style={st.actions}>
            <button type="button" style={st.primary} disabled={loading || !series.length} onClick={guardar}>
              {loading ? 'Guardando devolución...' : 'Guardar devolución'}
            </button>
            <button type="button" style={st.secondary} disabled={loading} onClick={limpiar}>Limpiar</button>
          </div>
        </section>

        <p style={st.footer}>Las comprobaciones de centro y almacén también se realizan en Supabase; el filtro visual no es una barrera de seguridad.</p>
      </section>
    </main>
  )
}

const st = {
  base: { minHeight: '100vh', padding: 16, boxSizing: 'border-box', background: 'linear-gradient(145deg,#031f19,#052f25)', color: '#effff8', fontFamily: 'Arial,sans-serif' },
  shell: { maxWidth: 1400, margin: '0 auto', padding: 18, border: '1px solid #356f5d', borderRadius: 16, background: '#05281f' },
  back: { display: 'inline-block', marginBottom: 14, padding: '9px 15px', borderRadius: 24, background: '#117b5d', color: '#fff', textDecoration: 'none', fontWeight: 800 },
  hero: { padding: 22, borderRadius: 14, border: '1px solid #3b987b', background: 'linear-gradient(110deg,#10553f,#16a47b)', textAlign: 'center' },
  title: { margin: 0, fontSize: 26, textTransform: 'uppercase' },
  subtitle: { margin: '6px 0 0', fontSize: 13 },
  panel: { marginTop: 12, padding: 13, border: '1px solid #2d6655', borderRadius: 13, background: '#082f25' },
  fields: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 800 },
  input: { boxSizing: 'border-box', width: '100%', minWidth: 0, padding: 10, border: '1px solid #cbd8d3', borderRadius: 8, background: '#f7faf9', color: '#17372c', fontSize: 14 },
  readonly: { background: '#e1e9e5' },
  loadButton: { width: '100%', marginTop: 9, border: 0, borderRadius: 8, padding: 11, background: '#16a77b', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginTop: 12 },
  kpi: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, minHeight: 62, padding: 10, borderRadius: 10, textAlign: 'center', background: '#e9f7f0', color: '#11674d', fontSize: 12, fontWeight: 700 },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 12, marginTop: 12 },
  panelTable: { minWidth: 0, padding: 12, border: '1px solid #2d6655', borderRadius: 13, background: '#082f25' },
  h2: { fontSize: 14, margin: '0 0 10px' },
  tableWrap: { width: '100%', overflowX: 'auto', borderRadius: 7 },
  table: { width: '100%', minWidth: 400, borderCollapse: 'collapse', background: '#f8fbf9', color: '#18382c' },
  th: { padding: 8, textAlign: 'left', whiteSpace: 'nowrap', fontSize: 11, background: '#08795c', color: '#fff', border: '1px solid #a8d1c2' },
  td: { padding: 8, border: '1px solid #d2e0da', fontSize: 11, whiteSpace: 'nowrap' },
  empty: { padding: 16, textAlign: 'center', color: '#49675b', fontSize: 12 },
  smallButton: { padding: '6px 9px', border: 0, borderRadius: 7, background: '#148663', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  removeButton: { padding: '6px 9px', border: 0, borderRadius: 7, background: '#dc3545', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  scanLabel: { display: 'block', marginBottom: 7, fontSize: 12, fontWeight: 800 },
  scanRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  primary: { border: 0, borderRadius: 8, padding: '11px 14px', background: '#16a77b', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  secondary: { border: '1px solid #498b75', borderRadius: 8, padding: '11px 14px', background: '#0d5944', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  error: { marginTop: 12, padding: 12, borderRadius: 8, background: '#ffe0e0', color: '#9c2525' },
  success: { marginTop: 12, padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' },
  footer: { marginTop: 14, fontSize: 12, color: '#b8d7ca', lineHeight: 1.5 },
}
