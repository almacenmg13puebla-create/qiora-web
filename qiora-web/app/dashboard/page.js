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
  ['faltantes','Piezas faltantes por entregar'],
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
    ['faltantes','PIEZAS FALTANTES POR ENTREGAR',fmt(k.faltantesPiezas),'Diferencia recibidas − enviadas; costo sin conciliar'],
    ['auditorias','AUDITORÍAS REALIZADAS',fmt(k.auditoriasRealizadas),'Faltantes: sin meta definida'],
    ['valor','VALOR EN CAJUELA',mxn(k.valorCajuela),'Solo stock_tecnicos de técnicos activos'],
    ['valorCentro','VALOR POR CENTRO',mxn(k.valorCentro),'Solo stock_almacen'],
    ['valorTotal','VALOR TOTAL',mxn(k.valorTotal),'Cajuela + centro'],
    ['traspasos','TRASPASOS',fmt(k.traspasos),'Por técnico / almacén'],
    ['criticos','CRÍTICOS +30 DÍAS',fmt(k.criticos),`Más antiguo: ${fmt(k.maxDiasCriticos)} días`],
  ]

  return <main className="dash"><div className="shell">
    <div className="top"><button className="back" onClick={()=>router.push('/')}>← Regresar al menú</button><div><h1>📊 Dashboard QIORA</h1><p>{data?.distrito||perfil.distrito} · Actualizado {data?.generado?new Date(data.generado).toLocaleString('es-MX'):'—'}</p></div></div>
    <form className="filters" onSubmit={e=>{e.preventDefault();cargar()}}><label>Fecha inicial<input type="date" value={desde} onChange={e=>setDesde(e.target.value)}/></label><label>Fecha final<input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}/></label><button disabled={busy}>{busy?'Buscando...':'🔎 Buscar'}</button><button type="button" className="secondary" onClick={()=>copiarHtml('dashboardAll')}>📋 Copiar Todo</button></form>
    {error&&<div className="error" role="alert">{error}</div>}
    {data?.advertencias?.length>0&&<details className="warnings"><summary>Advertencias de datos ({data.advertencias.length})</summary><ul>{data.advertencias.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
    <div id="dashboardAll"><div className="kpis">{cards.map(([id,title,value,sub])=><button key={id} className={`kpi ${id==='criticos'?'red':id==='recoleccionesPendientes'?'lime':''}`} onClick={()=>{setSection(id);setSearch('');setDetail(null)}}><span>{title}</span><b>{value}</b><small>{sub}</small></button>)}</div>
    <section className="tableCard" aria-label="Resumen por distrito">
      <div className="tableHead"><h2>Resumen por distrito</h2><small>Inventario actual; movimientos según fechas seleccionadas. Costo faltante y meta de auditorías pendientes de conciliación.</small></div>
      <div className="tableWrap"><table><thead><tr><th>Distrito</th><th>Recibidas (piezas)</th><th>Costo recibidas</th><th>Entregadas TP (piezas)</th><th>Costo entregadas</th><th>Pendientes (piezas)</th><th>Costo pendientes</th><th>Faltantes estimadas (piezas)</th><th>Costo faltantes</th><th>Auditorías realizadas</th><th>Auditorías faltantes</th><th>Valor cajuela</th><th>Valor centro</th></tr></thead>
      <tbody>{(data?.porDistrito||[]).map(g=><tr key={g.distrito}><td>{g.distrito}</td><td>{fmt(g.recibidasPiezas)}</td><td>{mxn(g.recibidasCosto)}{g.recibidasSinCosto?' *':''}</td><td>{fmt(g.entregadasPiezas)}</td><td>{mxn(g.entregadasCosto)}{g.entregadasSinCosto?' *':''}</td><td>{fmt(g.pendientesPiezas)}</td><td>{mxn(g.pendientesCosto)}{g.pendientesSinCosto?' *':''}</td><td>{fmt(g.faltantesPiezas)}</td><td>Sin conciliar</td><td>{fmt(g.auditoriasRealizadas)}</td><td>Sin meta</td><td>{mxn(g.valorCajuela)}</td><td>{mxn(g.valorCentro)}</td></tr>)}{!(data?.porDistrito||[]).length&&<tr><td colSpan="13" className="empty">Sin información por distrito.</td></tr>}</tbody></table></div>
      <small>* Importe parcial: hay piezas sin costo conocido. Las auditorías faltantes requieren una meta definida.</small>
    </section>
    <section className="tableCard" aria-label="Reportes de recolecciones">
      <div className="tableHead"><div><h2>Recolecciones por día, mes o año</h2><small>Se aplican también las fechas seleccionadas arriba.</small></div>
        <div className="tools"><label>Desglose <select value={periodoReco} onChange={e=>setPeriodoReco(e.target.value)}><option value="dia">Por día</option><option value="mes">Por mes</option><option value="anio">Por año</option></select></label></div>
      </div>
      <div className="recoGrid">{[
        ['recibidas','RECOLECCIONES RECIBIDAS'],
        ['enviadasTP','RECOLECCIONES ENVIADAS A TOTALPLAY'],
      ].map(([tipo,titulo])=>{
        const reporte=data?.reporteRecolecciones?.[tipo]||{registros:[],cantidad:0,costoConocido:0,sinCosto:0}
        const grupos=agruparRecolecciones(reporte.registros)
        return <div className="recoPanel" key={tipo}><div className="tableHead"><div><h2>{titulo}</h2><small>{fmt(reporte.cantidad)} piezas · Costo identificado: {mxn(reporte.costoConocido)}</small></div><button onClick={()=>exportarRecolecciones(tipo)}>⬇ Excel</button></div>
          {reporte.sinCosto>0&&<p className="missingCost">{fmt(reporte.sinCosto)} pieza(s) sin costo registrado. El importe mostrado es parcial.</p>}
          <div className="tableWrap"><table><thead><tr><th>Periodo</th><th>Distrito</th><th>Piezas</th><th>Costo identificado</th><th>Piezas sin costo</th></tr></thead><tbody>{grupos.map((r,i)=><tr key={`${r.periodo}-${r.distrito}-${i}`}><td>{r.periodo}</td><td>{r.distrito}</td><td>{fmt(r.cantidad)}</td><td>{mxn(r.costo)}</td><td>{fmt(r.sinCosto)}</td></tr>)}{!grupos.length&&<tr><td colSpan="5" className="empty">Sin registros para este periodo.</td></tr>}</tbody></table></div>
        </div>
      })}</div>
    </section>
    <section className="tableCard"><div className="tableHead"><div><h2>{sections.find(x=>x[0]===section)?.[1]||'Detalle'}</h2><small>{list.length.toLocaleString('es-MX')} registros</small></div><div className="tools"><input placeholder="Buscar en esta tabla..." value={search} onChange={e=>setSearch(e.target.value)}/><button onClick={()=>copiarHtml('dashTable')}>📋 Copiar tabla</button><button onClick={exportar}>⬇ Excel</button></div></div>
      <div className="tableWrap"><table id="dashTable"><thead><tr><th>#</th>{cols.map(([label])=><th key={label}>{label}</th>)}{section!=='valorTotal'&&<th>Detalle</th>}</tr></thead><tbody>{list.map((r,i)=><tr key={r.key||r.sku||i}><td>{i+1}</td>{cols.map(([label,key])=><td key={key}>{(['valor','valorCentro','valorTotal'].includes(section)||key==='valor'||key==='costo')?mxn(r[key]):(['pendientes','entregadas','realizados','error','piezas','cantidad','movimientos','maxDias','total','diferencia'].includes(key)?fmt(r[key]):(Array.isArray(r[key])?r[key].join(', '):(r[key]??'—')))}</td>)}{section!=='valorTotal'&&<td><button className="detailBtn" onClick={()=>detailFor(r,i)}>Ver detalle</button></td>}</tr>)}{!list.length&&<tr><td colSpan={cols.length+2} className="empty">{busy?'Cargando...':'No hay información para los filtros seleccionados.'}</td></tr>}</tbody></table></div>
    </section></div>
    {detail&&<div className="overlay" onClick={()=>setDetail(null)}><section className="modal" onClick={e=>e.stopPropagation()}><div className="tableHead"><h2>{detail.title}</h2><button onClick={()=>setDetail(null)}>Cerrar ×</button></div><div className="tableWrap"><table><thead><tr>{detail.columns.map(([l])=><th key={l}>{l}</th>)}</tr></thead><tbody>{detail.rows.map((r,i)=><tr key={i}>{detail.columns.map(([l,k])=><td key={k}>{typeof r[k]==='number'&&/valor|costo/i.test(k)?mxn(r[k]):(Array.isArray(r[k])?r[k].join(', '):String(r[k]??'—'))}</td>)}</tr>)}{!detail.rows.length&&<tr><td colSpan={Math.max(1,detail.columns.length)} className="empty">No hay detalle disponible.</td></tr>}</tbody></table></div></section></div>}
    <style jsx>{`
      .dash{min-height:100vh;padding:18px;background:linear-gradient(145deg,#031f19,#00372b);color:#f5fffb;font-family:Arial,sans-serif}.shell{max-width:1500px;margin:auto}.top{display:flex;gap:16px;align-items:center;margin-bottom:16px}.top h1{margin:0;font-size:25px}.top p{margin:5px 0 0;color:#9ce8c9;font-size:12px}.back,.filters button,.tools button,.tableHead button{border:0;border-radius:9px;padding:10px 14px;background:#07955f;color:white;font-weight:800;cursor:pointer}.filters{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:12px;background:#062e24;border:1px solid #176b53;border-radius:13px;margin-bottom:14px}.filters label{display:grid;gap:5px;font-size:12px;font-weight:700}.filters input,.tools input{height:39px;border:1px solid #168263;border-radius:8px;background:#f7fffb;color:#142c24;padding:0 10px}.filters button:disabled{opacity:.6;cursor:wait}.filters .secondary{background:#087be6}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpi{min-height:95px;border:1px solid #299778;border-radius:12px;padding:12px;background:linear-gradient(145deg,#087655,#16a77e);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;text-align:center}.kpi span{font-size:11px;font-weight:900}.kpi b{font-size:22px}.kpi small{font-size:10px;color:#d8fff0}.kpi.red{background:linear-gradient(145deg,#bd2727,#ef4444);border-color:#fb7777}.kpi.lime{background:linear-gradient(145deg,#0c9c59,#20c66a)}.tableCard{margin-top:14px;background:#062e24;border:1px solid #176b53;border-radius:14px;padding:12px}.tableHead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}.tableHead h2{margin:0;font-size:17px}.tableHead small{color:#a8d9c7}.tools{display:flex;gap:7px;flex-wrap:wrap}.tools input{min-width:210px}.tools select{height:39px;border:1px solid #168263;border-radius:8px;padding:0 10px;background:#f7fffb;color:#142c24}.recoGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.recoPanel{min-width:0}.recoPanel .tableWrap{max-height:360px}.recoPanel .tableWrap table{min-width:470px}.missingCost{color:#ffdb9f;font-size:12px;font-weight:700}@media(max-width:900px){.recoGrid{grid-template-columns:1fr}}.tools button{padding:9px 11px}.tableWrap{overflow:auto;max-height:65vh;background:white;border-radius:8px}.tableWrap table{border-collapse:collapse;width:100%;min-width:750px;color:#164638;font-size:12px}.tableWrap th{position:sticky;top:0;background:#118b6b;color:#fff;padding:9px;text-align:center;white-space:nowrap}.tableWrap td{padding:8px;border:1px solid #d6e8e0;text-align:center;background:#f8fcfa;white-space:nowrap}.tableWrap tr:nth-child(even) td{background:#eaf5f0}.detailBtn{border:0;border-radius:7px;background:#126b82;color:#fff;padding:6px 9px;font-weight:700;cursor:pointer}.empty{text-align:center;padding:24px!important;color:#64748b}.error{padding:11px;background:#7f252b;border:1px solid #c6535b;border-radius:9px;color:white;margin:12px 0}.warnings{padding:10px 13px;margin:10px 0;background:#4a3511;border:1px solid #a87924;border-radius:9px;color:#ffe6a8;font-size:12px}.overlay{position:fixed;inset:0;z-index:1000;background:#000b;display:flex;align-items:center;justify-content:center;padding:18px}.modal{width:min(1100px,100%);max-height:85vh;overflow:auto;background:#073629;border:1px solid #238365;border-radius:14px;padding:15px}.modal .tableHead button{background:#a52b32}@media(max-width:900px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.dash{padding:8px}.top{align-items:flex-start;flex-direction:column}.top h1{font-size:21px}.kpis{grid-template-columns:1fr 1fr}.kpi{min-height:88px}.kpi b{font-size:18px}.filters label{width:100%}.filters input,.filters button{width:100%}.tools,.tools input,.tools button{width:100%}}
    `}</style>
  </div></main>
}
