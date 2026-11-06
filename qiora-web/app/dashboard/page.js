'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { supabase } from '../../lib/supabase'

const verde = '#087b5b'
const fmt = n => Number(n || 0).toLocaleString('es-MX')
const mxn = n => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const monthAgo = () => { const d=new Date(); d.setDate(1); return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(d) }

const sections = [
  ['recolecciones','Recolecciones recibidas'],
  ['recoleccionesEntregadasTP','Recolecciones entregadas a Totalplay'],
  ['recoleccionesPendientes','Recolecciones pendientes'],
  ['auditorias','Auditorías realizadas'],
  ['valor','Valor en cajuela (solo técnicos activos)'],
  ['valorCentro','Valor por centro'],
  ['valorTotal','Valor total'],
  ['traspasos','Traspasos'],
  ['criticos','Críticos +30 días'],
]

export default function DashboardPage() {
  const router = useRouter()
  const [perfil,setPerfil] = useState(null)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [data,setData] = useState(null)
  const [desde,setDesde] = useState(monthAgo())
  const [hasta,setHasta] = useState(today())
  const [section,setSection] = useState('recolecciones')
  const [activeTab,setActiveTab] = useState('resumen')
  const [detail,setDetail] = useState(null)
  const [search,setSearch] = useState('')
  const [periodoReco,setPeriodoReco] = useState('dia')

  useEffect(()=>{let live=true;(async()=>{
    try {
      const {data:{user}}=await supabase.auth.getUser()
      if(!user){router.replace('/');return}
      const {data:p,error:e}=await supabase.rpc('qiora_mi_perfil')
      if(e)throw e
      const profile=Array.isArray(p)?p[0]:p
      if(!profile?.activo)throw new Error('Perfil inactivo o no disponible.')
      if(String(profile.puesto||'').toUpperCase()!=='ADMIN_PADRE' && profile.dashboard!==true)throw new Error('Tu perfil no tiene permiso para consultar el Dashboard.')
      if(live)setPerfil(profile)
    } catch(e) { if(live)setError(e.message||'No fue posible validar el acceso.') }
    finally { if(live)setLoading(false) }
  })();return()=>{live=false}},[router])

  const cargar = useCallback(async()=>{
    setBusy(true);setError('')
    try {
      const {data:{session}}=await supabase.auth.getSession()
      if(!session?.access_token)throw new Error('La sesión venció. Inicia sesión nuevamente.')
      const qs=new URLSearchParams({desde,hasta})
      const res=await fetch(`/api/dashboard?${qs}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'})
      const json=await res.json().catch(()=>({}))
      if(!res.ok||!json.ok)throw new Error(json.error||'No se pudo cargar el dashboard.')
      setData(json)
    } catch(e) {setError(e.message||'Error al consultar el dashboard.')} finally {setBusy(false)}
  },[desde,hasta])

  useEffect(()=>{if(perfil)cargar()},[perfil,cargar])

  const agruparRecolecciones = useCallback((eventos=[]) => {
    const grupos = new Map()
    for (const r of eventos) {
      const clave = periodoReco==='anio' ? r.fecha.slice(0,4) : periodoReco==='mes' ? r.fecha.slice(0,7) : r.fecha
      const distrito = r.distrito || ''
      const key = `${clave}|${distrito}`
      const x = grupos.get(key) || { periodo: clave, distrito, cantidad: 0, costo: 0, sinCosto: 0 }
      x.cantidad += Number(r.cantidad || 0)
      if (r.costoConocido) x.costo += Number(r.costo || 0)
      else x.sinCosto += Number(r.cantidad || 0)
      grupos.set(key, x)
    }
    return [...grupos.values()].sort((a,b)=>b.periodo.localeCompare(a.periodo) || a.distrito.localeCompare(b.distrito))
  }, [periodoReco])
  const exportarRecolecciones = (tipo) => {
    const eventos=data?.reporteRecolecciones?.[tipo]?.registros||[]
    const resumen=agruparRecolecciones(eventos)
    if(!resumen.length){setError('No hay registros de recolecciones para exportar.');return}
    const filas=resumen.map(r=>({PERIODO:r.periodo,DISTRITO:r.distrito,PIEZAS:r.cantidad,
      'COSTO CONOCIDO MXN':Math.round(r.costo*100)/100,'PIEZAS SIN COSTO':r.sinCosto}))
    const libro=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro,XLSX.utils.json_to_sheet(filas),'Resumen')
    XLSX.writeFile(libro,`QIORA_RECOLECCIONES_${tipo}_${periodoReco}.xlsx`)
  }
  const k=data?.kpis||{}
  const tables=data?.tablas||{}
  const list=useMemo(()=>{
    const rows=section==='valorTotal'?[{concepto:'Valor en cajuela',total:k.valorCajuela},{concepto:'Valor por centro',total:k.valorCentro},{concepto:'VALOR TOTAL',total:k.valorTotal}]:section==='faltantes'?(data?.porDistrito||[]).map(g=>({distrito:g.distrito,piezas:g.faltantesPiezas,costo:'Sin conciliar'})):tables[section]||[]
    const q=search.trim().toLocaleLowerCase('es-MX')
    return rows.filter(r=>!q||Object.values(r).some(v=>String(v??'').toLocaleLowerCase('es-MX').includes(q)))
  },[section,tables,k,search])

  const cols = useMemo(()=>{
    const maps={

      traspasos:[['Almacén','almacen'],['Técnico','tecnico'],['Pend.','pendientes'],['Realizados','realizados'],['Error','error'],['Total','total'],['Piezas','piezas']],
      recolecciones:[['Almacén','almacen'],['Técnico','tecnico'],['Piezas','total']],
      recoleccionesEntregadasTP:[['Distrito','distrito'],['Pedido / almacén','almacen'],['Salida / técnico','tecnico'],['Piezas','total']],
      auditorias:[['Distrito','distrito'],['Almacén','almacen'],['Técnico','tecnico'],['Folio','folio'],['Fecha','fecha'],['Tipos','tipos'],['Registros','total']],

      valor:[['Almacén','almacen'],['Técnico','tecnico'],['Piezas','piezas'],['Valor','total']],
      valorCentro:[['Distrito','distrito'],['Centro','almacen'],['Concepto','tecnico'],['Piezas','piezas'],['Valor','total']],
      valorTotal:[['Concepto','concepto'],['Valor','total']],
      criticos:[['Almacén','almacen'],['Técnico','tecnico'],['Piezas','total'],['Días máx.','maxDias']],
      recoleccionesPendientes:[['Almacén','almacen'],['Técnico','tecnico'],['Piezas pendientes','total'],['Días máx.','maxDias']],

      faltantes:[['Distrito','distrito'],['Piezas','piezas'],['Costo','costo']],
    }
    return maps[section]||[]
  },[section])

  function detailFor(row,index){
    if(section==='faltantes'){setDetail({title:'Faltantes estimados por distrito',rows:[row],columns:[['Distrito','distrito'],['Piezas','piezas'],['Costo','costo']]});return}
    if(section==='valorTotal'){setDetail({title:'Composición del valor total',rows:[{concepto:'Valor en cajuela',total:k.valorCajuela},{concepto:'Valor por centro',total:k.valorCentro},{concepto:'Total',total:k.valorTotal}],columns:[['Concepto','concepto'],['Valor','total']]});return}
    const key=row.key||row.sku||String(index)
    const rows=(data?.detalles?.[section]||{})[key]||[]
    setDetail({title:`Detalle · ${row.tecnico||row.material||row.almacen||key}`,rows,columns:rows.length?Object.keys(rows[0]).map(k=>[k.replace(/_/g,' '),k]):[]})
  }

  async function copiarHtml(id){
    try {
      const el=document.getElementById(id)
      if(!el)throw new Error('No se encontró el contenido que deseas copiar.')
      if(!navigator.clipboard?.write || !window.ClipboardItem)throw new Error('El navegador no permite copiar imágenes desde esta página.')
      const canvas=await html2canvas(el,{scale:2,backgroundColor:'#062e24',useCORS:true,scrollX:0,scrollY:0,width:el.scrollWidth,height:el.scrollHeight,windowWidth:Math.max(document.documentElement.scrollWidth,el.scrollWidth),windowHeight:Math.max(document.documentElement.scrollHeight,el.scrollHeight)})
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo generar la imagen.')),'image/png'))
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})])
    } catch(e){setError(`No se pudo copiar la imagen: ${e.message}`)}
  }
  function exportar(){
    const rows=list.map(r=>({...r}))
    if(!rows.length){setError('No hay registros para exportar.');return}
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,section.slice(0,31))
    XLSX.writeFile(wb,`QIORA_DASHBOARD_${section}_${desde}_${hasta}.xlsx`)
  }

  if(loading)return <main className="dash"><div className="shell">Validando acceso...</div></main>
  if(!perfil)return <main className="dash"><div className="shell"><button className="back" onClick={()=>router.push('/')}>← Regresar</button><p className="error">{error||'Acceso no autorizado.'}</p></div></main>

  const cards=[
    ['recolecciones','RECOLECCIONES RECIBIDAS',fmt(k.recibidasPiezas),`Piezas · Costo identificado: ${mxn(k.recibidasCosto)}`],
    ['recoleccionesEntregadasTP','ENTREGADAS A TOTALPLAY',fmt(k.entregadasPiezas),`Piezas · Costo identificado: ${mxn(k.entregadasCosto)}`],
    ['recoleccionesPendientes','RECOLECCIONES PENDIENTES',fmt(k.pendientesPiezas),`Piezas · Costo identificado: ${mxn(k.pendientesCosto)}`],
    ['auditorias','AUDITORÍAS REALIZADAS',fmt(k.auditoriasRealizadas),'Faltantes: sin meta definida'],
    ['valor','VALOR EN CAJUELA',mxn(k.valorCajuela),'Solo stock_tecnicos de técnicos activos'],
    ['valorCentro','VALOR POR CENTRO',mxn(k.valorCentro),'Solo stock_almacen'],
    ['valorTotal','VALOR TOTAL',mxn(k.valorTotal),'Cajuela + centro'],
    ['traspasos','TRASPASOS',fmt(k.traspasos),'Por técnico / almacén'],
    ['criticos','CRÍTICOS +30 DÍAS',fmt(k.criticos),`Más antiguo: ${fmt(k.maxDiasCriticos)} días`],
  ]

  const tabs = [
    ['resumen','Resumen'],['recolecciones','Recolecciones'],['auditorias','Auditorías'],
    ['equipos','Equipos'],['bajas','Bajas'],['cobros','Cobros'],['reportes','Reportes']
  ]
  const recoKpis = [
    ['RECOLECCIONES RECIBIDAS', fmt(k.recibidasPiezas), mxn(k.recibidasCosto)],
    ['ENVIADAS A TOTALPLAY', fmt(k.entregadasPiezas), mxn(k.entregadasCosto)],
    ['PENDIENTES POR RECIBIR', fmt(k.pendientesPiezas), mxn(k.pendientesCosto)],
  ]
  const auditKpis = [
    ['AUDITORÍAS REALIZADAS',fmt(k.auditoriasRealizadas),'Folios registrados'],
    ['TÉCNICOS ACTIVOS',fmt(data?.tecnicosActivos ?? '—'),'Dato pendiente de exponer por API'],
    ['AUDITORÍAS FALTANTES','—','Requiere meta/programación de auditorías'],
  ]
  const equipoKpis = [
    ['EQUIPOS CRÍTICOS',fmt(k.criticos),'Más de 30 días · excluye TPE USADO'],
    ['FUERA DE TIEMPO','—','Requiere desglose de antigüedad en API'],
    ['EN TIEMPO','—','Requiere desglose de antigüedad en API'],
  ]
  const currentRows = list
  const renderTable = (rows, columns, empty) => <div className="tableWrap"><table><thead><tr>{columns.map(([label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.key||r.folio||i}>{columns.map(([label,key])=><td key={key}>{key.toLowerCase().includes('costo')||key==='total'&&typeof r[key]==='number'&&label.toLowerCase().includes('valor')?mxn(r[key]):(typeof r[key]==='number'?fmt(r[key]):String(r[key]??'—'))}</td>)}</tr>)}{!rows.length&&<tr><td className="empty" colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>

  return <main className="dash"><div className="shell">
    <header className="top"><button className="back" onClick={()=>router.push('/')}>← Regresar al menú</button><div><h1>Dashboard QIORA</h1><p>Vista general por distrito · {data?.distrito||perfil.distrito} · Actualizado {data?.generado?new Date(data.generado).toLocaleString('es-MX'):'—'}</p></div></header>
    <form className="filters" onSubmit={e=>{e.preventDefault();cargar()}}>
      <label>Fecha inicial<input type="date" value={desde} onChange={e=>setDesde(e.target.value)}/></label>
      <label>Fecha final<input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}/></label>
      <button disabled={busy}>{busy?'Buscando...':'🔎 Buscar'}</button>
      <button type="button" className="secondary" onClick={()=>copiarHtml('tabContent')}>📋 Copiar pestaña</button>
    </form>
    {error&&<div className="error" role="alert">{error}</div>}
    {data?.advertencias?.length>0&&<details className="warnings"><summary>Advertencias de datos ({data.advertencias.length})</summary><ul>{data.advertencias.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
    <nav className="tabs" aria-label="Secciones del dashboard">{tabs.map(([id,label])=><button key={id} className={activeTab===id?'active':''} onClick={()=>{setActiveTab(id);setSearch('');setDetail(null)}}>{label}</button>)}</nav>
    <div id="tabContent">
      {activeTab==='resumen'&&<>
        <div className="kpis">{cards.map(([id,title,value,sub])=><button key={id} className={`kpi ${id==='criticos'?'red':id==='recoleccionesPendientes'?'lime':''}`} onClick={()=>{setSection(id);setActiveTab(id==='auditorias'?'auditorias':id==='criticos'?'equipos':'recolecciones');setSearch('');setDetail(null)}}><span>{title}</span><b>{value}</b><small>{sub}</small></button>)}</div>
        <section className="tableCard"><div className="tableHead"><h2>Resumen por distrito</h2><small>Movimientos según fechas seleccionadas; inventario actual.</small></div>{renderTable(data?.porDistrito||[],[['Distrito','distrito'],['Recibidas','recibidasPiezas'],['Costo recibidas','recibidasCosto'],['Enviadas TP','entregadasPiezas'],['Costo enviadas','entregadasCosto'],['Pendientes','pendientesPiezas'],['Costo pendientes','pendientesCosto'],['Auditorías','auditoriasRealizadas'],['Valor cajuela','valorCajuela'],['Valor centro','valorCentro']],'Sin información por distrito.')}</section>
        <section className="tableCard"><div className="tableHead"><div><h2>Recolecciones por periodo</h2><small>Desglose diario, mensual o anual.</small></div><select value={periodoReco} onChange={e=>setPeriodoReco(e.target.value)}><option value="dia">Por día</option><option value="mes">Por mes</option><option value="anio">Por año</option></select></div><div className="recoGrid">{[['recibidas','RECOLECCIONES RECIBIDAS'],['enviadasTP','RECOLECCIONES ENVIADAS A TOTALPLAY']].map(([tipo,titulo])=>{const rep=data?.reporteRecolecciones?.[tipo]||{registros:[],cantidad:0,costoConocido:0,sinCosto:0};const grupos=agruparRecolecciones(rep.registros);return <div className="recoPanel" key={tipo}><div className="tableHead"><div><h3>{titulo}</h3><small>{fmt(rep.cantidad)} piezas · {mxn(rep.costoConocido)} identificado</small></div><button onClick={()=>exportarRecolecciones(tipo)}>Excel</button></div>{renderTable(grupos,[['Periodo','periodo'],['Distrito','distrito'],['Piezas','cantidad'],['Costo','costo'],['Sin costo','sinCosto']],'Sin registros en el periodo.')}</div>})}</div></section>
      </>}
      {activeTab==='recolecciones'&&<>
        <div className="sectionTitle"><h2>Recolecciones por distrito</h2><p>Recibidas desde recolecciones_equipos; enviadas a Totalplay desde RECUS TP; pendientes desde IQ09 con lote TPE USADO de técnicos activos.</p></div>
        <div className="kpis three">{recoKpis.map(([t,v,sub],i)=><div className={`kpi ${i===2?'lime':''}`} key={t}><span>{t}</span><b>{v}</b><small>Costo identificado: {sub}</small></div>)}</div>
        <section className="tableCard"><div className="tableHead"><h2>Recibidas y enviadas a Totalplay</h2><small>El costo no identificado se informa por separado.</small></div><div className="recoGrid">{[['recibidas','RECOLECCIONES RECIBIDAS'],['enviadasTP','RECOLECCIONES ENVIADAS A TOTALPLAY']].map(([tipo,titulo])=>{const rep=data?.reporteRecolecciones?.[tipo]||{registros:[],cantidad:0,costoConocido:0,sinCosto:0};const grupos=agruparRecolecciones(rep.registros);return <div className="recoPanel" key={tipo}><div className="tableHead"><h3>{titulo}</h3><button onClick={()=>exportarRecolecciones(tipo)}>Excel</button></div><p>{fmt(rep.cantidad)} piezas · {mxn(rep.costoConocido)} costo identificado · {fmt(rep.sinCosto)} sin costo</p>{renderTable(grupos,[['Periodo','periodo'],['Distrito','distrito'],['Piezas','cantidad'],['Costo','costo'],['Sin costo','sinCosto']],'Sin registros.')}</div>})}</div></section>
        <section className="tableCard"><div className="tableHead"><h2>Pendientes por recibir · TPE USADO</h2><small>Exclusivamente técnicos activos del distrito.</small></div>{renderTable(tables.recoleccionesPendientes||[],[['Almacén','almacen'],['Técnico','tecnico'],['Piezas','total'],['Días máximos','maxDias']],'Sin equipos TPE USADO pendientes.')}</section>
      </>}
      {activeTab==='auditorias'&&<><div className="sectionTitle"><h2>Auditorías técnicas</h2><p>Seguimiento por distrito y periodo. Las faltantes requieren una meta de auditorías definida.</p></div><div className="kpis three">{auditKpis.map(([t,v,sub])=><div className="kpi" key={t}><span>{t}</span><b>{v}</b><small>{sub}</small></div>)}</div><section className="tableCard"><div className="tableHead"><h2>Auditorías realizadas</h2><button onClick={()=>{setSection('auditorias');exportar()}}>Excel</button></div>{renderTable(tables.auditorias||[],[['Distrito','distrito'],['Almacén','almacen'],['Técnico','tecnico'],['Folio','folio'],['Fecha','fecha'],['Tipos','tipos'],['Registros','total']],'Sin auditorías en el periodo.')}</section></>}
      {activeTab==='equipos'&&<><div className="sectionTitle"><h2>Semáforo de equipos IQ09</h2><p>Excluye lote TPE USADO. El estado se calcula con la fecha de modificación disponible en IQ09.</p></div><div className="kpis three"><div className="kpi red"><span>CRÍTICOS · MÁS DE 30 DÍAS</span><b>{fmt(k.criticos)}</b><small>Equipos · excluye TPE USADO</small></div><div className="kpi amber"><span>FUERA DE TIEMPO · 15 A 30 DÍAS</span><b>—</b><small>Desglose aún no expuesto por API</small></div><div className="kpi lime"><span>EN TIEMPO · 0 A 14 DÍAS</span><b>—</b><small>Desglose aún no expuesto por API</small></div></div><section className="tableCard"><div className="tableHead"><h2>Equipos críticos identificados</h2></div>{renderTable(tables.criticos||[],[['Almacén','almacen'],['Técnico','tecnico'],['Equipos','total'],['Días máximos','maxDias']],'Sin equipos críticos.')}</section><p className="note">Los comparativos semanales requieren fotografías históricas de IQ09; no se inventan datos históricos a partir de la carga actual.</p></>}
      {activeTab==='bajas'&&<section className="tableCard emptyPanel"><h2>Bajas por distrito</h2><p>La interfaz de esta pestaña está preparada. Falta identificar la tabla real de bajas en Supabase para mostrar cantidades, categorías, costos y comparativos mensuales.</p></section>}
      {activeTab==='cobros'&&<section className="tableCard emptyPanel"><h2>Cobros por distrito</h2><p>La interfaz de esta pestaña está preparada. Falta identificar la tabla real de cobros para mostrar importes cobrados, pendientes, saldos y comparativos mensuales.</p></section>}
      {activeTab==='reportes'&&<><div className="sectionTitle"><h2>Centro de reportes</h2><p>Exportaciones de la información disponible para el distrito y rango de fechas seleccionados.</p></div><div className="reportGrid">{[['Recolecciones','recolecciones'],['Auditorías','auditorias'],['Traspasos','traspasos'],['Equipos críticos','criticos'],['Pendientes TPE USADO','recoleccionesPendientes'],['Valor en cajuela','valor']].map(([label,id])=><button key={id} className="reportTile" onClick={()=>{setSection(id);setSearch('');setActiveTab('detalle')}}><strong>{label}</strong><small>Consultar y exportar</small></button>)}</div><section className="tableCard"><div className="tableHead"><h2>Exportar resumen por distrito</h2><button onClick={()=>{const ws=XLSX.utils.json_to_sheet(data?.porDistrito||[]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Resumen');XLSX.writeFile(wb,`QIORA_RESUMEN_${desde}_${hasta}.xlsx`)}}>Descargar Excel</button></div><p>El archivo respeta el rango de fechas y los distritos autorizados por la API.</p></section></>}
      {activeTab==='detalle'&&<section className="tableCard"><div className="tableHead"><h2>{sections.find(x=>x[0]===section)?.[1]||'Detalle'}</h2><div className="tools"><input placeholder="Buscar en esta tabla..." value={search} onChange={e=>setSearch(e.target.value)}/><button onClick={exportar}>Excel</button></div></div>{renderTable(currentRows,cols,'No hay registros para los filtros seleccionados.')}</section>}
    </div>
    {detail&&<div className="overlay" onClick={()=>setDetail(null)}><section className="modal" onClick={e=>e.stopPropagation()}><div className="tableHead"><h2>{detail.title}</h2><button onClick={()=>setDetail(null)}>Cerrar ×</button></div><div className="tableWrap"><table><thead><tr>{detail.columns.map(([l])=><th key={l}>{l}</th>)}</tr></thead><tbody>{detail.rows.map((r,i)=><tr key={i}>{detail.columns.map(([l,k])=><td key={k}>{String(r[k]??'—')}</td>)}</tr>)}{!detail.rows.length&&<tr><td colSpan={Math.max(1,detail.columns.length)} className="empty">No hay detalle disponible.</td></tr>}</tbody></table></div></section></div>}
    <style jsx>{`
      .dash{min-height:100vh;padding:18px;background:linear-gradient(145deg,#031f19,#00372b);color:#f5fffb;font-family:Arial,sans-serif}.shell{max-width:1500px;margin:auto}.top{display:flex;gap:18px;align-items:center;margin-bottom:16px}.top h1{margin:0;font-size:28px}.top p{margin:5px 0 0;color:#9ce8c9;font-size:12px}.back,.filters button,.tools button,.tableHead button{border:0;border-radius:9px;padding:10px 14px;background:#07955f;color:white;font-weight:800;cursor:pointer}.filters{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:12px;background:#062e24;border:1px solid #176b53;border-radius:13px;margin-bottom:12px}.filters label{display:grid;gap:5px;font-size:12px;font-weight:700}.filters input,.tools input,.tableHead select{height:39px;border:1px solid #168263;border-radius:8px;background:#f7fffb;color:#142c24;padding:0 10px}.filters .secondary{background:#087be6}.tabs{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin:12px 0;padding:7px;background:#06271f;border:1px solid #176b53;border-radius:13px}.tabs button{border:1px solid #26765f;border-radius:9px;padding:13px 8px;background:#104536;color:#d9f6e9;font-weight:800;cursor:pointer}.tabs button.active{background:linear-gradient(120deg,#087b5b,#16a77e);color:#fff;box-shadow:0 3px 12px #0005}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpis.three{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}.kpi{min-height:104px;border:1px solid #299778;border-radius:12px;padding:14px;background:linear-gradient(145deg,#087655,#16a77e);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center}.kpi span{font-size:12px;font-weight:900}.kpi b{font-size:25px}.kpi small{font-size:11px;color:#d8fff0}.kpi.red{background:linear-gradient(145deg,#bd2727,#ef4444);border-color:#fb7777}.kpi.lime{background:linear-gradient(145deg,#0c9c59,#20c66a)}.kpi.amber{background:linear-gradient(145deg,#a96a08,#e7a51e);border-color:#ffd16a}.tableCard{margin-top:14px;background:#062e24;border:1px solid #176b53;border-radius:14px;padding:14px}.tableHead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}.tableHead h2{margin:0;font-size:18px}.tableHead h3{margin:0}.tableHead small,.sectionTitle p{color:#a8d9c7}.sectionTitle{padding:12px 3px}.sectionTitle h2{font-size:24px;margin:0 0 5px}.sectionTitle p{margin:0;font-size:13px}.tableWrap{overflow:auto;max-height:65vh;background:white;border-radius:8px}.tableWrap table{border-collapse:collapse;width:100%;min-width:750px;color:#164638;font-size:12px}.tableWrap th{position:sticky;top:0;background:#118b6b;color:#fff;padding:10px;text-align:center;white-space:nowrap}.tableWrap td{padding:9px;border:1px solid #d6e8e0;text-align:center;background:#f8fcfa;white-space:nowrap}.tableWrap tr:nth-child(even) td{background:#eaf5f0}.empty{text-align:center;padding:24px!important;color:#64748b}.recoGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.recoPanel{min-width:0}.recoPanel p{font-size:12px;color:#c8eadc}.recoPanel .tableWrap{max-height:340px}.reportGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.reportTile{display:flex;flex-direction:column;gap:8px;text-align:left;padding:22px;border-radius:12px;border:1px solid #299778;background:linear-gradient(145deg,#0b6049,#0d8b67);color:white;cursor:pointer}.reportTile strong{font-size:16px}.reportTile small{color:#c8eadc}.emptyPanel{padding:35px}.emptyPanel p,.note{color:#c3e4d7;line-height:1.6}.error{padding:11px;background:#7f252b;border:1px solid #c6535b;border-radius:9px;color:white;margin:12px 0}.warnings{padding:10px 13px;margin:10px 0;background:#4a3511;border:1px solid #a87924;border-radius:9px;color:#ffe6a8;font-size:12px}.overlay{position:fixed;inset:0;z-index:1000;background:#000b;display:flex;align-items:center;justify-content:center;padding:18px}.modal{width:min(1100px,100%);max-height:85vh;overflow:auto;background:#073629;border:1px solid #238365;border-radius:14px;padding:15px}.modal .tableHead button{background:#a52b32}@media(max-width:900px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpis.three{grid-template-columns:repeat(3,minmax(0,1fr))}.recoGrid{grid-template-columns:1fr}.reportGrid{grid-template-columns:repeat(2,1fr)}.tabs{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:560px){.dash{padding:8px}.top{align-items:flex-start;flex-direction:column}.top h1{font-size:21px}.kpis,.kpis.three{grid-template-columns:1fr 1fr}.tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.filters label,.filters input,.filters button{width:100%}.reportGrid{grid-template-columns:1fr}}
    `}</style>
  </div></main>
}
