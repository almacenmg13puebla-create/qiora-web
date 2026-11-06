'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

const fmt = n => Number(n || 0).toLocaleString('es-MX')
const mxn = n => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const monthStart = () => { const d = new Date(); d.setDate(1); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) }
const tabs = [['resumen','Resumen','▦'],['recolecciones','Recolecciones','▣'],['auditorias','Auditorías','▤'],['equipos','Equipos','▱'],['bajas','Bajas','▥'],['cobros','Cobros','◉'],['reportes','Reportes','▥']]

export default function DashboardPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [desde, setDesde] = useState(monthStart())
  const [hasta, setHasta] = useState(today())
  const [distrito, setDistrito] = useState('')
  const [tab, setTab] = useState('resumen')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.replace('/'); return }
        const { data: p, error: e } = await supabase.rpc('qiora_mi_perfil')
        if (e) throw e
        const profile = Array.isArray(p) ? p[0] : p
        if (!profile?.activo) throw new Error('Perfil inactivo o no disponible.')
        if (String(profile.puesto || '').toUpperCase() !== 'ADMIN_PADRE' && profile.dashboard !== true) throw new Error('Tu perfil no tiene permiso para consultar el Dashboard.')
        if (live) setPerfil(profile)
      } catch (e) { if (live) setError(e.message || 'No fue posible validar el acceso.') }
      finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [router])

  const cargar = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('La sesión venció. Inicia sesión nuevamente.')
      const qs = new URLSearchParams({ desde, hasta })
      if (distrito) qs.set('distrito', distrito)
      const res = await fetch(`/api/dashboard?${qs}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar el Dashboard.')
      setData(json)
      if (!distrito && json.distrito) setDistrito(json.distrito)
    } catch (e) { setError(e.message || 'Error al consultar el Dashboard.') }
    finally { setBusy(false) }
  }, [desde, hasta, distrito])

  useEffect(() => { if (perfil) cargar() }, [perfil, cargar])

  const k = data?.kpis || {}
  const tables = data?.tablas || {}
  const recoReport = data?.reporteRecolecciones || {}
  const isParent = String(perfil?.puesto || '').toUpperCase() === 'ADMIN_PADRE'

  const summaryCards = [
    ['Recolecciones recibidas', fmt(k.recibidasPiezas), 'Piezas registradas', 'box'],
    ['Entregadas a Totalplay', fmt(k.entregadasPiezas), 'Concentrado RECUS TP', 'truck'],
    ['Pendientes por recibir', fmt(k.pendientesPiezas), 'IQ09 · TPE USADO · técnicos activos', 'clock'],
    ['Auditorías realizadas', fmt(k.auditoriasRealizadas), 'Folios auditados', 'audit'],
    ['Valor en cajuela', mxn(k.valorCajuela), 'Stock de técnicos activos', 'coins'],
    ['Valor por centro', mxn(k.valorCentro), 'Stock de almacén', 'warehouse'],
    ['Valor total', mxn(k.valorTotal), 'Cajuela + centro', 'total'],
    ['Equipos críticos', fmt(k.criticos), 'Más de 30 días · excluye TPE USADO', 'alert'],
  ]

  const received = recoReport.recibidas || { registros: [], cantidad: 0, costoConocido: 0, sinCosto: 0 }
  const sent = recoReport.enviadasTP || { registros: [], cantidad: 0, costoConocido: 0, sinCosto: 0 }
  const detailRows = tab === 'recolecciones' ? (tables.recolecciones || []) : tab === 'auditorias' ? (tables.auditorias || []) : tab === 'equipos' ? (tables.criticos || []) : tab === 'reportes' ? (data?.porDistrito || []) : []
  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('es-MX')
    if (!q) return detailRows
    return detailRows.filter(r => Object.values(r).some(v => String(v ?? '').toLocaleLowerCase('es-MX').includes(q)))
  }, [detailRows, search])

  const exportRows = (rows, name) => {
    if (!rows?.length) { setError('No hay registros para exportar.'); return }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'QIORA')
    XLSX.writeFile(wb, `QIORA_${name}_${data?.distrito || distrito}_${desde}_${hasta}.xlsx`)
  }

  const table = (rows, columns, emptyText = 'No hay registros para este periodo.') => (
    <div className="q-table-scroll"><table className="q-table"><thead><tr>{columns.map(c => <th key={c[0]}>{c[0]}</th>)}</tr></thead><tbody>
      {rows?.length ? rows.map((r, i) => <tr key={r.key || r.folio || i}>{columns.map(([label, key]) => <td key={key}>{key.toLowerCase().includes('costo') || key.toLowerCase().includes('valor') ? mxn(r[key]) : typeof r[key] === 'number' ? fmt(r[key]) : String(r[key] ?? '—')}</td>)}</tr>) : <tr><td className="q-empty" colSpan={columns.length}>{emptyText}</td></tr>}
    </tbody></table></div>
  )

  if (loading) return <main className="q-dashboard"><div className="q-loading">Validando acceso a QIORA...</div></main>
  if (!perfil) return <main className="q-dashboard"><div className="q-loading"><button onClick={() => router.push('/')}>Regresar</button><p>{error || 'Acceso no autorizado.'}</p></div></main>

  return <main className="q-dashboard">
    <aside className="q-sidebar">
      <div className="q-brand"><div className="q-mark">Q</div><div><b>QIORA</b><small>Sistema Nacional de Almacenes</small></div></div>
      <div className="q-side-label">MENÚ PRINCIPAL</div>
      {tabs.map(([id, label, icon]) => <button key={id} className={`q-side-link ${tab === id ? 'selected' : ''}`} onClick={() => { setTab(id); setSearch('') }}><span>{icon}</span>{label}</button>)}
      <div className="q-side-bottom"><small>QIORA · Gestión logística</small><small>Distrito {data?.distrito || distrito || perfil.distrito}</small></div>
    </aside>

    <section className="q-main">
      <header className="q-header">
        <div><div className="q-overline">SISTEMA NACIONAL DE ALMACENES</div><h1>Dashboard QIORA</h1><p>Vista general por distrito · {data?.distrito || distrito || perfil.distrito || 'Distrito activo'}</p></div>
        <div className="q-user"><span className="q-avatar">{String(perfil.nombre || 'U').slice(0,1).toUpperCase()}</span><div><b>{perfil.nombre || 'Usuario'}</b><small>{perfil.puesto || 'Usuario'} · {data?.distrito || distrito || perfil.distrito}</small></div><button onClick={() => router.push('/')}>Salir</button></div>
      </header>

      <div className="q-filterbar">
        <label>Distrito activo{isParent ? <select value={distrito || data?.distrito || ''} onChange={e => setDistrito(e.target.value)}>{(data?.distritosDisponibles || [data?.distrito || perfil.distrito]).filter(Boolean).map(d => <option key={d} value={d}>{d}</option>)}</select> : <input value={data?.distrito || perfil.distrito || ''} readOnly />}</label>
        <label>Fecha inicial<input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
        <label>Fecha final<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
        <button className="q-search" onClick={cargar} disabled={busy}>{busy ? 'Consultando...' : '⌕ Buscar'}</button>
      </div>

      {error && <div className="q-error">{error}</div>}
      {!!data?.advertencias?.length && <details className="q-warnings"><summary>Advertencias de datos ({data.advertencias.length})</summary><ul>{data.advertencias.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}

      <nav className="q-tabs">{tabs.map(([id, label]) => <button key={id} onClick={() => { setTab(id); setSearch('') }} className={tab === id ? 'active' : ''}>{label}</button>)}</nav>

      {tab === 'resumen' && <>
        <div className="q-title-row"><div><h2>Resumen del distrito {data?.distrito || distrito}</h2><p>Periodo: {desde} — {hasta}</p></div><span className="q-live">● Datos del distrito activo</span></div>
        <div className="q-kpi-grid">{summaryCards.map(([label, value, sub, icon], i) => <article className={`q-kpi ${icon === 'alert' ? 'critical' : ''}`} key={label}><div className="q-kpi-icon">{['▣','↗','◷','☑','▤','⌂','∑','⚠'][i]}</div><div className="q-kpi-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></article>)}</div>
        <div className="q-summary-grid">
          <section className="q-panel"><div className="q-panel-heading"><h3>Estado de equipos</h3><small>IQ09 · excluye TPE USADO</small></div><div className="q-state-content"><div className="q-donut"><div><b>{fmt(k.criticos)}</b><small>Críticos</small></div></div><div className="q-legend"><p><i className="green"/>En tiempo <b>—</b></p><p><i className="yellow"/>Fuera de tiempo <b>—</b></p><p><i className="red"/>Crítico <b>{fmt(k.criticos)}</b></p><small>El desglose completo requiere exponer las tres categorías desde la consulta IQ09.</small></div></div></section>
          <section className="q-panel"><div className="q-panel-heading"><h3>Resumen del distrito</h3><small>{data?.distrito}</small></div>{table(data?.porDistrito || [], [['Distrito','distrito'],['Recibidas','recibidasPiezas'],['Enviadas TP','entregadasPiezas'],['Pendientes','pendientesPiezas'],['Auditorías','auditoriasRealizadas'],['Valor cajuela','valorCajuela'],['Valor centro','valorCentro']])}</section>
        </div>
        <section className="q-panel q-detail-panel"><div className="q-panel-heading"><div><h3>Últimas recolecciones registradas</h3><small>Movimientos del distrito en el periodo seleccionado</small></div><button onClick={() => setTab('recolecciones')}>Ver todas →</button></div>{table((tables.recolecciones || []).slice(0,8), [['Almacén','almacen'],['Técnico','tecnico'],['Piezas','total']], 'No hay recolecciones para este periodo.')}</section>
      </>}

      {tab === 'recolecciones' && <>
        <div className="q-title-row"><div><h2>Recolecciones por distrito</h2><p>Control operativo del distrito {data?.distrito}</p></div></div>
        <div className="q-three-kpis">{[['Recolecciones recibidas', received.cantidad, received.costoConocido, 'reco'], ['Recolecciones enviadas a TP', sent.cantidad, sent.costoConocido, 'tp'], ['Pendientes por recibir', k.pendientesPiezas, k.pendientesCosto, 'pending']].map(([name, qty, cost, id]) => <article className="q-panel q-reco-kpi" key={id}><span>{name}</span><strong>{fmt(qty)}</strong><small>piezas</small><b>{mxn(cost)}</b><small>Costo identificado</small></article>)}</div>
        <div className="q-summary-grid"><section className="q-panel"><div className="q-panel-heading"><h3>Recolecciones recibidas</h3><button onClick={() => exportRows(received.registros, 'RECIBIDAS')}>Excel</button></div>{table((received.registros || []).slice(0,50), [['Fecha','fecha'],['Almacén','almacen'],['Serie','serie'],['Piezas','cantidad'],['Costo','costo']], 'Sin recepciones en el periodo.')}</section><section className="q-panel"><div className="q-panel-heading"><h3>Enviadas a Totalplay</h3><button onClick={() => exportRows(sent.registros, 'ENVIADAS_TP')}>Excel</button></div>{table((sent.registros || []).slice(0,50), [['Fecha','fecha'],['Almacén','almacen'],['Serie','serie'],['Piezas','cantidad'],['Costo','costo']], 'Sin entregas TP en el periodo.')}</section></div>
        <section className="q-panel q-detail-panel"><div className="q-panel-heading"><h3>Pendientes por recibir · TPE USADO</h3><small>Únicamente técnicos activos del distrito</small></div>{table(tables.recoleccionesPendientes || [], [['Almacén','almacen'],['Técnico','tecnico'],['Piezas','total'],['Días máximos','maxDias']], 'Sin equipos TPE USADO pendientes.')}</section>
      </>}

      {tab === 'auditorias' && <><div className="q-title-row"><div><h2>Auditorías técnicas</h2><p>Seguimiento de auditorías registradas por técnico, almacén y folio.</p></div></div><div className="q-three-kpis"><article className="q-kpi"><span>Técnicos activos</span><strong>{fmt(data?.tecnicosActivos ?? '—')}</strong><small>Almacen_usuarios</small></article><article className="q-kpi"><span>Auditorías realizadas</span><strong>{fmt(k.auditoriasRealizadas)}</strong><small>Folios auditados</small></article><article className="q-kpi"><span>Auditorías faltantes</span><strong>—</strong><small>Requiere meta/programación</small></article></div><section className="q-panel q-detail-panel"><div className="q-panel-heading"><h3>Detalle de auditorías</h3><button onClick={() => exportRows(tables.auditorias || [], 'AUDITORIAS')}>Excel</button></div>{table(tables.auditorias || [], [['Distrito','distrito'],['Almacén','almacen'],['Técnico','tecnico'],['Folio','folio'],['Fecha','fecha'],['Tipos','tipos'],['Registros','total']], 'Sin auditorías en el periodo.')}</section></>}

      {tab === 'equipos' && <><div className="q-title-row"><div><h2>Semáforo de equipos</h2><p>IQ09 · excluye lote TPE USADO · antigüedad calculada con fecha SAP</p></div></div><div className="q-three-kpis"><article className="q-kpi critical"><span>Críticos · más de 30 días</span><strong>{fmt(k.criticos)}</strong></article><article className="q-kpi amber"><span>Fuera de tiempo · 15 a 30 días</span><strong>—</strong></article><article className="q-kpi"><span>En tiempo · 0 a 14 días</span><strong>—</strong></article></div><section className="q-panel q-detail-panel"><div className="q-panel-heading"><h3>Equipos críticos identificados</h3><button onClick={() => exportRows(tables.criticos || [], 'EQUIPOS_CRITICOS')}>Excel</button></div>{table(tables.criticos || [], [['Almacén','almacen'],['Técnico','tecnico'],['Equipos','total'],['Días máximos','maxDias']], 'Sin equipos críticos.')}</section><p className="q-note">Los comparativos semanales se habilitarán al guardar fotografías históricas diarias de IQ09. No se generan datos históricos ficticios.</p></>}

      {tab === 'bajas' && <section className="q-panel q-placeholder"><h2>Bajas del distrito</h2><p>Esta pestaña mostrará bajas del mes, costos, faltantes, equipos, materiales y herramientas, con comparativo mensual. Falta identificar la tabla real de bajas en Supabase; no se muestran cifras simuladas.</p></section>}
      {tab === 'cobros' && <section className="q-panel q-placeholder"><h2>Cobros del distrito</h2><p>Esta pestaña mostrará cobros totales, realizados, pendientes, saldo y desglose por faltantes, equipos, materiales y herramientas. Falta identificar la tabla real de cobros en Supabase; no se muestran cifras simuladas.</p></section>}
      {tab === 'reportes' && <><div className="q-title-row"><div><h2>Centro de reportes</h2><p>Exportaciones del distrito {data?.distrito} y periodo seleccionado.</p></div></div><div className="q-report-grid">{[['Resumen por distrito', data?.porDistrito || []],['Recolecciones recibidas', received.registros || []],['Entregadas a Totalplay', sent.registros || []],['Auditorías', tables.auditorias || []],['Equipos críticos', tables.criticos || []],['Pendientes TPE USADO', tables.recoleccionesPendientes || []]].map(([label, rows]) => <article className="q-report-card" key={label}><h3>{label}</h3><p>{fmt(rows.length)} registros disponibles</p><button onClick={() => exportRows(rows, label.replaceAll(' ','_').toUpperCase())}>Descargar Excel</button></article>)}</div></>}

      <footer className="q-footer">QIORA · Sistema Nacional de Almacenes · Distrito activo: {data?.distrito || distrito} · Actualizado {data?.generado ? new Date(data.generado).toLocaleString('es-MX') : '—'}</footer>
    </section>

    <style jsx>{`
      .q-dashboard{min-height:100vh;display:flex;background:#eef4f2;color:#102b25;font-family:Arial,Helvetica,sans-serif}.q-sidebar{width:218px;flex:0 0 218px;background:linear-gradient(180deg,#003e30,#002c23);color:#fff;display:flex;flex-direction:column;padding:24px 12px;min-height:100vh}.q-brand{display:flex;align-items:center;gap:10px;padding:0 8px 34px}.q-mark{width:42px;height:42px;border-radius:12px;background:#08a66e;display:grid;place-items:center;font-size:27px;font-weight:900}.q-brand b{display:block;font-size:22px;letter-spacing:1px}.q-brand small{display:block;color:#a9d5c7;font-size:9px;margin-top:3px}.q-side-label{font-size:10px;letter-spacing:1.5px;color:#80b8a6;padding:0 12px 12px}.q-side-link{border:0;background:transparent;color:#dcebe6;padding:13px 12px;border-radius:10px;text-align:left;font-weight:700;margin:2px 0;display:flex;align-items:center;gap:12px;cursor:pointer}.q-side-link span{width:20px;font-size:20px;text-align:center}.q-side-link.selected,.q-side-link:hover{background:#087c59;color:white}.q-side-bottom{margin-top:auto;padding:18px 10px 4px;border-top:1px solid #286451;display:grid;gap:5px;color:#9cc7b8;font-size:11px}.q-main{min-width:0;flex:1;padding:0 24px 28px}.q-header{margin:0 -24px 18px;padding:20px 30px;background:linear-gradient(110deg,#004936,#087a54 65%,#00503b);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:20px;box-shadow:0 5px 18px #003c2b25}.q-overline{font-size:10px;letter-spacing:2px;color:#a8e2c8;font-weight:800}.q-header h1{font-size:29px;margin:5px 0}.q-header p{margin:0;color:#c6e7d9;font-size:13px}.q-user{display:flex;align-items:center;gap:10px}.q-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#13a879;font-weight:900}.q-user b,.q-user small{display:block}.q-user small{font-size:11px;color:#c6e7d9;margin-top:3px}.q-user button{border:1px solid #7ec9a9;background:transparent;color:white;border-radius:8px;padding:9px 13px;margin-left:8px}.q-filterbar{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:13px;align-items:end;padding:14px 16px;background:white;border:1px solid #d3e2dc;border-radius:13px;box-shadow:0 3px 12px #103c2b0d}.q-filterbar label{display:grid;gap:6px;font-size:12px;font-weight:800;color:#34564b}.q-filterbar input,.q-filterbar select{height:40px;border:1px solid #cbdcd5;border-radius:8px;padding:0 11px;background:#f9fcfa;color:#16382e;min-width:0}.q-search,.q-panel-heading button,.q-report-card button{height:40px;border:0;border-radius:8px;background:#008b5d;color:white;font-weight:800;padding:0 20px;cursor:pointer}.q-search:disabled{opacity:.6}.q-tabs{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin:15px 0}.q-tabs button{border:1px solid #d5e1dd;background:#e2e9ed;color:#193c32;border-radius:9px;padding:14px 6px;font-weight:800;cursor:pointer}.q-tabs button.active{background:linear-gradient(120deg,#007a4f,#079b66);border-color:#07865a;color:white;box-shadow:0 4px 12px #006b462b}.q-title-row{display:flex;justify-content:space-between;align-items:center;margin:18px 2px 13px;gap:14px}.q-title-row h2{font-size:23px;margin:0 0 4px;color:#102d24}.q-title-row p{font-size:12px;color:#60796f;margin:0}.q-live{font-size:11px;color:#008554;font-weight:800}.q-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:12px 0 16px}.q-kpi{min-width:0;min-height:112px;padding:16px;background:white;border:1px solid #d2e1da;border-radius:13px;display:flex;align-items:center;gap:13px;box-shadow:0 4px 12px #153d2b0b}.q-kpi-icon{flex:0 0 48px;height:48px;border-radius:12px;background:#e2f5eb;color:#007c50;display:grid;place-items:center;font-size:25px;font-weight:900}.q-kpi-copy{min-width:0}.q-kpi span{display:block;color:#49645a;font-size:12px;font-weight:800}.q-kpi strong{display:block;color:#073d2c;font-size:23px;margin:5px 0;overflow-wrap:anywhere}.q-kpi small{display:block;color:#71867e;font-size:10px;line-height:1.3}.q-kpi.critical{border-color:#f0b6b6}.q-kpi.critical .q-kpi-icon{background:#ffe5e5;color:#c62828}.q-kpi.critical strong{color:#bd2727}.q-kpi.amber .q-kpi-icon{background:#fff2d5;color:#a96b00}.q-summary-grid{display:grid;grid-template-columns:1fr 1.35fr;gap:14px;margin:14px 0}.q-panel{min-width:0;background:#fff;border:1px solid #d5e2dd;border-radius:14px;padding:16px;box-shadow:0 4px 13px #123a2b0a}.q-panel-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:13px}.q-panel-heading h3{margin:0;color:#173d31;font-size:16px}.q-panel-heading small{font-size:11px;color:#71877e}.q-panel-heading button{height:32px;padding:0 13px}.q-state-content{display:flex;align-items:center;justify-content:center;gap:28px;min-height:180px}.q-donut{width:145px;height:145px;border-radius:50%;background:conic-gradient(#08a65f 0 78%,#f2b51b 78% 94%,#dc3939 94% 100%);display:grid;place-items:center;flex:0 0 auto}.q-donut>div{width:88px;height:88px;border-radius:50%;background:white;display:grid;place-content:center;text-align:center}.q-donut b{font-size:23px;color:#153c2f}.q-donut small{font-size:10px;color:#60756c}.q-legend{min-width:0;flex:1}.q-legend p{display:flex;align-items:center;gap:8px;font-size:12px;color:#334f44}.q-legend p b{margin-left:auto}.q-legend i{width:10px;height:10px;border-radius:50%}.q-legend .green{background:#08a65f}.q-legend .yellow{background:#f2b51b}.q-legend .red{background:#dc3939}.q-legend>small{font-size:10px;color:#84958e;line-height:1.4}.q-table-scroll{width:100%;overflow:auto;border-radius:9px;border:1px solid #d9e5df}.q-table{width:100%;border-collapse:separate;border-spacing:0;min-width:560px;font-size:12px;color:#193b30}.q-table th{background:#006a49;color:white;text-align:center;padding:12px 10px;font-size:11px;white-space:nowrap}.q-table td{padding:11px 10px;text-align:center;border-bottom:1px solid #e0eae5;white-space:nowrap;background:#fff}.q-table tbody tr:nth-child(even) td{background:#edf7f1}.q-table tbody tr:hover td{background:#dcf1e5}.q-table tbody tr:last-child td{border-bottom:0}.q-empty{padding:25px!important;color:#74877f!important;text-align:center!important}.q-detail-panel{margin-top:14px}.q-three-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:14px 0}.q-reco-kpi{display:flex;flex-direction:column;align-items:flex-start;gap:6px;border-top:4px solid #079d67}.q-reco-kpi span{font-size:13px;font-weight:800;color:#395b4e}.q-reco-kpi strong{font-size:31px;color:#006b48}.q-reco-kpi small{font-size:11px;color:#74877f}.q-reco-kpi b{font-size:19px;color:#173c30;margin-top:6px}.q-placeholder{padding:32px;margin-top:20px;min-height:230px}.q-placeholder h2{margin:0 0 10px;color:#0b523a}.q-placeholder p,.q-note{max-width:850px;color:#637a70;line-height:1.7;font-size:13px}.q-report-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.q-report-card{background:white;border:1px solid #d4e2dc;border-radius:13px;padding:19px;box-shadow:0 4px 12px #103c2b0b}.q-report-card h3{margin:0 0 8px;font-size:15px;color:#164533}.q-report-card p{font-size:12px;color:#6a8177}.q-report-card button{margin-top:8px}.q-footer{text-align:center;color:#81958c;font-size:10px;padding:25px 0 4px}.q-error{background:#ffe7e7;color:#a52323;padding:12px 15px;border-radius:9px;margin:12px 0;border:1px solid #efbaba}.q-warnings{background:#fff4d8;border:1px solid #e7c66c;color:#79520b;border-radius:9px;padding:11px 14px;margin:12px 0;font-size:12px}.q-loading{padding:50px;text-align:center;color:#1b4939}
      @media(max-width:1100px){.q-sidebar{width:190px;flex-basis:190px}.q-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.q-summary-grid{grid-template-columns:1fr}.q-filterbar{grid-template-columns:repeat(2,minmax(0,1fr))}.q-tabs{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:700px){.q-dashboard{display:block}.q-sidebar{width:auto;min-height:auto;padding:12px;display:block}.q-brand{padding:0 5px 12px}.q-side-label,.q-side-link,.q-side-bottom{display:none}.q-main{padding:0 12px 20px}.q-header{margin:0 -12px 12px;padding:15px;align-items:flex-start;flex-direction:column}.q-header h1{font-size:23px}.q-user{width:100%}.q-filterbar{grid-template-columns:1fr 1fr;padding:10px}.q-search{grid-column:1/-1}.q-tabs{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.q-tabs button{padding:11px 5px}.q-kpi-grid{grid-template-columns:1fr 1fr;gap:8px}.q-kpi{padding:11px;min-height:105px;gap:8px}.q-kpi-icon{width:35px;height:35px;flex-basis:35px;font-size:18px}.q-kpi strong{font-size:17px}.q-kpi span{font-size:10px}.q-three-kpis{grid-template-columns:1fr}.q-state-content{gap:14px}.q-donut{width:112px;height:112px}.q-donut>div{width:70px;height:70px}.q-report-grid{grid-template-columns:1fr}.q-title-row h2{font-size:19px}}
    `}</style>
  </main>
}
