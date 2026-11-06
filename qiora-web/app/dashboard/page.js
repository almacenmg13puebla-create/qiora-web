'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

const fmt = n => Number(n || 0).toLocaleString('es-MX')
const mxn = n => n == null ? 'Sin dato' : Number(n || 0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})
const norm = v => String(v ?? '').trim().toUpperCase()
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const firstDay = () => { const d=new Date(); d.setDate(1); return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(d) }
const tabs = [
  ['resumen','⌂','Resumen'],['recolecciones','⬡','Recolecciones'],['auditorias','▤','Auditorías'],
  ['equipos','▣','Equipos'],['bajas','▤','Bajas'],['cobros','◉','Cobros'],['reportes','▥','Reportes']
]

function Card({label,value,sub,tone='green'}) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div> }
function Table({columns,rows,empty='No hay registros para este periodo.'}) {
 const items = Array.isArray(rows) ? rows : []
 return <div className="table-scroll"><table className="qiora-data-table"><thead><tr>{columns.map(c=><th key={c[0]}>{c[0]}</th>)}</tr></thead><tbody>{items.length?items.map((r,i)=><tr key={r.key||r.folio||r.serie||i}>{columns.map(c=><td key={c[1]} title={String(r[c[1]]??'')}>{c[2]?c[2](r[c[1]],r):String(r[c[1]]??'—')}</td>)}</tr>):<tr><td className="empty" colSpan={columns.length}>{empty}</td></tr>}</tbody></table><div className="table-foot">{fmt(items.length)} {items.length===1?'registro':'registros'}</div></div>
}

export default function DashboardPage(){
 const router=useRouter()
 const [perfil,setPerfil]=useState(null),[distritos,setDistritos]=useState([]),[distrito,setDistrito]=useState('')
 const [desde,setDesde]=useState(firstDay()),[hasta,setHasta]=useState(today())
 const [tab,setTab]=useState('resumen'),[data,setData]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('')
 useEffect(()=>{let live=true;(async()=>{try{const {data:{user}}=await supabase.auth.getUser();if(!user){router.replace('/');return}const {data:p,error:e}=await supabase.rpc('qiora_mi_perfil');if(e)throw e;const profile=Array.isArray(p)?p[0]:p;if(!profile?.activo)throw new Error('Perfil inactivo o no disponible.');if(norm(profile.puesto)!=='ADMIN_PADRE'&&profile.dashboard!==true)throw new Error('Tu perfil no tiene permiso para consultar el Dashboard.');if(live){setPerfil(profile);if(norm(profile.puesto)!=='ADMIN_PADRE'){setDistrito(norm(profile.distrito));setDistritos([norm(profile.distrito)])}}}catch(e){if(live)setError(e.message||'No fue posible validar el acceso.')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[router])
 const cargar=useCallback(async()=>{if(!perfil)return;setBusy(true);setError('');try{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('La sesión venció. Inicia sesión nuevamente.');const qs=new URLSearchParams({desde,hasta});if(distrito)qs.set('distrito',distrito);const res=await fetch(`/api/dashboard?${qs}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});const json=await res.json().catch(()=>({}));if(!res.ok||!json.ok)throw new Error(json.error||'No se pudo cargar el Dashboard.');setData(json);if(Array.isArray(json.distritosAutorizados))setDistritos(json.distritosAutorizados);if(json.distrito)setDistrito(json.distrito)}catch(e){setError(e.message||'Error al consultar el Dashboard.')}finally{setBusy(false)}},[perfil,desde,hasta,distrito])
 useEffect(()=>{if(perfil)cargar()},[perfil,cargar])
 const k=data?.kpis||{},t=data?.tablas||{},r=data?.reporteRecolecciones||{},sem=k.semaforoEquipos||{}
 const district=data?.distrito||distrito||perfil?.distrito||'—'
 const recibidas=r.recibidas?.registros||[],enviadas=r.enviadasTP?.registros||[],pendientes=t.recoleccionesPendientes||[],audits=t.auditorias||[],crit=t.criticos||[]
 const auditTecnicos=useMemo(()=>new Set(audits.map(x=>x.almacen).filter(Boolean)).size,[audits])
 const activeTechs=data?.tecnicosActivos ?? null
 const rowsReco=useMemo(()=>[
  ...recibidas.map(x=>({...x,tipo:'Recibida'})),...enviadas.map(x=>({...x,tipo:'Enviada a TP'}))
 ].sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||''))),[recibidas,enviadas])
 const exportar=()=>{let rows=[];let name=tab;if(tab==='recolecciones')rows=rowsReco;else if(tab==='auditorias')rows=audits;else if(tab==='equipos')rows=crit;else if(tab==='resumen')rows=data?.porDistrito||[];else rows=t[tab]||[];if(!rows.length){setError('No hay registros disponibles para exportar en esta pestaña.');return}const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'QIORA');XLSX.writeFile(wb,`QIORA_${tab}_${district}_${desde}_${hasta}.xlsx`)}
 if(loading)return <main className="dash"><div className="loading">Validando acceso a QIORA…</div></main>
 if(!perfil)return <main className="dash"><div className="loading"><button onClick={()=>router.push('/')}>Regresar</button><p>{error||'Acceso no autorizado.'}</p></div></main>
 const title=tabs.find(x=>x[0]===tab)?.[2]||'Resumen'
 return <main className="dash"><div className="app">
  <header className="brand"><div className="brandmark">QIORA<span>®</span><small>Sistema Nacional de Almacenes</small></div><div className="brandtitle">Dashboard Operativo</div><div className="userbox"><span>◉</span><div>{perfil.nombre||'Usuario'}<small>{perfil.puesto||''}</small></div></div></header>
  <nav className="tabs">{tabs.map(([id,icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setError('')}}><b>{icon}</b>{label}</button>)}</nav>
  <section className="filters"><div className="district"><small>Distrito activo</small>{norm(perfil.puesto)==='ADMIN_PADRE'?<select value={distrito} onChange={e=>setDistrito(e.target.value)}><option value="">Selecciona distrito</option>{distritos.map(d=><option key={d} value={d}>{d}</option>)}</select>:<strong>{district}</strong>}</div><label>Fecha inicial<input type="date" value={desde} onChange={e=>setDesde(e.target.value)}/></label><label>Fecha final<input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}/></label><button className="apply" disabled={busy||!distrito} onClick={cargar}>{busy?'Consultando…':'⌕ Aplicar'}</button></section>
  {error&&<div className="error">{error}</div>}{data?.advertencias?.length>0&&<details className="warnings"><summary>Advertencias de datos ({data.advertencias.length})</summary>{data.advertencias.map((x,i)=><p key={i}>{x}</p>)}</details>}
  <section className="pagehead"><div><h1>{tab==='resumen'?'Resumen General':title}</h1><p>Información correspondiente únicamente al distrito <b>{district}</b> · {desde} al {hasta}</p></div><button className="export" onClick={exportar}>↓ Excel</button></section>
  {tab==='resumen'&&<>
   <div className="metrics five"><Card label="Recolecciones recibidas" value={fmt(k.recibidasPiezas)} sub={`Costo identificado ${mxn(k.recibidasCosto)}`}/><Card label="Enviadas a Totalplay" value={fmt(k.entregadasPiezas)} sub={`Costo identificado ${mxn(k.entregadasCosto)}`} tone="blue"/><Card label="Pendientes por recibir" value={fmt(k.pendientesPiezas)} sub={`Costo identificado ${mxn(k.pendientesCosto)}`} tone="amber"/><Card label="Auditorías realizadas" value={fmt(k.auditoriasRealizadas)} sub="Folios auditados" tone="blue"/><Card label="Equipos críticos" value={fmt(sem.criticos??k.criticos)} sub={`De ${fmt(sem.total)} equipos`} tone="red"/></div>
   <div className="metrics four"><Card label="Equipos en tiempo" value={fmt(sem.enTiempo)} sub="0 a 14 días"/><Card label="Fuera de tiempo" value={fmt(sem.fueraTiempo)} sub="15 a 30 días" tone="amber"/><Card label="Valor en cajuela" value={mxn(k.valorCajuela)}/><Card label="Valor total" value={mxn(k.valorTotal)} tone="blue"/></div>
   <div className="grid2"><article className="panel"><h2>Estado de equipos</h2><div className="statusbars">{[['En tiempo',sem.enTiempo,'#08a66b'],['Fuera de tiempo',sem.fueraTiempo,'#e5a51a'],['Crítico',sem.criticos,'#df4545']].map(([label,n,color])=><div className="barrow" key={label}><span>{label}</span><div className="bar"><i style={{width:`${sem.total?Math.max(0,Number(n||0)/sem.total*100):0}%`,background:color}}/></div><b>{fmt(n)}</b></div>)}</div></article><article className="panel"><h2>Resumen del distrito</h2><Table columns={[["Distrito","distrito"],["Recibidas","recibidasPiezas"],["Enviadas TP","entregadasPiezas"],["Pendientes","pendientesPiezas"],["Auditorías","auditoriasRealizadas"],["Valor cajuela","valorCajuela",mxn]]} rows={data?.porDistrito||[]}/></article></div>
   <article className="panel"><h2>Últimas recolecciones registradas</h2><Table columns={[["Fecha","fecha"],["Distrito","distrito"],["Almacén","almacen"],["Serie","serie"],["Piezas","cantidad"],["Costo","costo",mxn]]} rows={[...recibidas].slice(-8).reverse()}/></article>
  </>}
  {tab==='recolecciones'&&<><div className="metrics three"><Card label="Recolecciones recibidas" value={fmt(r.recibidas?.cantidad)} sub={`Costo ${mxn(r.recibidas?.costoConocido)}`}/><Card label="Recolecciones enviadas a TP" value={fmt(r.enviadasTP?.cantidad)} sub={`Costo ${mxn(r.enviadasTP?.costoConocido)}`} tone="blue"/><Card label="Pendientes por recibir · IQ09 TPE USADO" value={fmt(k.pendientesPiezas)} sub={`Costo identificado ${mxn(k.pendientesCosto)}`} tone="amber"/></div><div className="grid2"><article className="panel"><h2>Series TPE USADO pendientes por recibir</h2><Table columns={[["Almacén","almacen"],["Técnico","tecnico"],["Piezas","total",fmt],["Días máximos","maxDias",fmt]]} rows={pendientes}/></article><article className="panel"><h2>Costos de recolecciones</h2><Table columns={[["Concepto","concepto"],["Piezas","piezas",fmt],["Costo","costo",mxn]]} rows={[{concepto:'Recibidas',piezas:r.recibidas?.cantidad,costo:r.recibidas?.costoConocido},{concepto:'Enviadas a TP',piezas:r.enviadasTP?.cantidad,costo:r.enviadasTP?.costoConocido},{concepto:'Pendientes TPE USADO',piezas:k.pendientesPiezas,costo:k.pendientesCosto}]}/></article></div><article className="panel"><h2>Movimientos de recolección</h2><Table columns={[["Fecha","fecha"],["Tipo","tipo"],["Distrito","distrito"],["Almacén / Pedido","almacen"],["Serie","serie"],["Piezas","cantidad",fmt],["Costo","costo",mxn]]} rows={rowsReco}/></article></>}
  {tab==='auditorias'&&<><div className="metrics three"><Card label="Técnicos activos del distrito" value="Consultar padrón" sub="El total requiere validar técnicos activos"/><Card label="Auditorías realizadas" value={fmt(audits.length)} sub="Folios agrupados"/><Card label="Auditorías faltantes" value="Sin meta" sub="Requiere calendario o meta de auditoría" tone="amber"/></div><article className="panel"><h2>Auditorías realizadas</h2><Table columns={[["Almacén","almacen"],["Técnico","tecnico"],["Folio","folio"],["Fecha","fecha"],["Tipos","tipos",v=>Array.isArray(v)?v.join(', '):v],["Registros","total",fmt]]} rows={audits}/></article></>}
  {tab==='equipos'&&<><div className="metrics three"><Card label="En tiempo · 0–14 días" value={fmt(sem.enTiempo)}/><Card label="Fuera de tiempo · 15–30 días" value={fmt(sem.fueraTiempo)} tone="amber"/><Card label="Críticos · +30 días" value={fmt(sem.criticos)} tone="red"/></div><div className="panel note">Semáforo calculado desde IQ09 actual del distrito. Se excluye TPE USADO. No hay comparativo histórico semanal disponible hasta guardar fotografías diarias del inventario.</div><article className="panel"><h2>Equipos críticos</h2><Table columns={[["Almacén","almacen"],["Técnico","tecnico"],["Piezas","total",fmt],["Días máximos","maxDias",fmt]]} rows={crit}/></article></>}
  {(tab==='bajas'||tab==='cobros')&&<section className="panel empty-state"><div className="empty-icon">{tab==='bajas'?'▤':'◉'}</div><h2>{tab==='bajas'?'Bajas del distrito':'Cobros del distrito'}</h2><p>La pestaña está preparada visualmente, pero no se muestran importes ni cantidades hasta identificar y conectar la tabla real de {tab} en Supabase.</p><strong>Sin datos conectados · No se inventan cifras</strong></section>}
  {tab==='reportes'&&<><div className="report-grid">{[['Recolecciones','recolecciones'],['Auditorías','auditorias'],['Equipos críticos','equipos'],['Pendientes TPE USADO','pendientes'],['Inventario en cajuela','valor'],['Traspasos','traspasos']].map(([label,id])=><button key={id} onClick={()=>setTab(id==='pendientes'?'recolecciones':id==='valor'?'resumen':id)}><span>▤</span>{label}<small>Ver reporte del distrito</small></button>)}</div><article className="panel"><h2>Exportar información del distrito {district}</h2><p>El archivo Excel respetará el rango de fechas y el distrito activo.</p><button className="apply" onClick={exportar}>↓ Exportar pestaña actual a Excel</button></article></>}
  <footer>QIORA · Sistema Nacional de Almacenes · Distrito activo: {district} · Actualizado {data?.generado?new Date(data.generado).toLocaleString('es-MX'):'—'}</footer>
 </div><style jsx>{`
 main.dash{min-height:100vh;background:#eef4f1;color:#102f27;font-family:Arial,Helvetica,sans-serif;padding:0 24px 34px}
 main.dash .app{max-width:1680px;margin:0 auto}
 main.dash .brand{min-height:108px;height:auto;background:linear-gradient(110deg,#003b2c,#00251e);color:#fff;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:22px;padding:18px 30px;border-radius:0 0 16px 16px;box-shadow:0 5px 18px #002d221c}
 main.dash .brandmark{font-size:39px;line-height:1;font-weight:900;letter-spacing:-1px;white-space:nowrap}
 main.dash .brandmark span{font-size:12px;vertical-align:top}
 main.dash .brandmark small{display:block;font-size:13px;font-weight:500;letter-spacing:.2px;margin-top:7px;color:#c4e5d9}
 main.dash .brandtitle{font-size:30px;font-weight:800;text-align:center;white-space:nowrap}
 main.dash .userbox{justify-self:end;display:flex;gap:12px;align-items:center;font-weight:800;font-size:15px;white-space:nowrap}
 main.dash .userbox>span{font-size:29px}
 main.dash .userbox small{display:block;color:#a7d9c7;font-size:12px;margin-top:4px}
 main.dash .tabs{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin:14px 0}
 main.dash .tabs button{min-height:60px;border:1px solid #cbd9d5;border-radius:10px;background:#fff;color:#153c32;padding:12px 8px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 2px 5px #003b2c0a;transition:background .15s,transform .15s}
 main.dash .tabs button:hover{background:#e5f3ed;transform:translateY(-1px)}
 main.dash .tabs button b{font-size:20px;margin-right:8px}
 main.dash .tabs button.active{background:#078b5a;color:#fff;border-color:#078b5a}
 main.dash .filters{display:grid;grid-template-columns:1.1fr 1fr 1fr auto;align-items:end;gap:14px;background:#fff;border:1px solid #d4e1dc;border-radius:13px;padding:16px 18px;margin-bottom:15px;box-shadow:0 3px 10px #003b2c0b}
 main.dash .filters label,main.dash .district{display:grid;gap:7px;font-size:12px;font-weight:800;min-width:0}
 main.dash .filters small{font-size:12px;color:#52736a}
 main.dash .district strong,main.dash .filters input,main.dash .filters select{width:100%;height:44px;border:1px solid #cbdad5;border-radius:9px;background:#f8fbfa;padding:0 13px;display:flex;align-items:center;font-size:15px;color:#163e32;min-width:0}
 main.dash .filters .apply{min-width:130px;height:44px;border:0;border-radius:9px;background:#008b59;color:white;padding:0 22px;font-weight:800;cursor:pointer}
 main.dash .pagehead{display:flex;justify-content:space-between;align-items:center;gap:15px;margin:19px 2px 14px}
 main.dash .pagehead h1{font-size:28px;margin:0 0 6px;color:#073e30}
 main.dash .pagehead p{margin:0;color:#61776f;font-size:13px}
 main.dash .export{border:0;border-radius:9px;background:#075c43;color:#fff;padding:12px 19px;font-weight:800;cursor:pointer;white-space:nowrap}
 main.dash .metrics{display:grid;gap:13px;margin:13px 0}
 main.dash .metrics.five{grid-template-columns:repeat(5,minmax(0,1fr))}
 main.dash .metrics.four{grid-template-columns:repeat(4,minmax(0,1fr))}
 main.dash .metrics.three{grid-template-columns:repeat(3,minmax(0,1fr))}
 main.dash .metric{min-height:132px;min-width:0;border-radius:14px;padding:19px 20px;background:linear-gradient(135deg,#00553d,#00895d);color:#fff;display:flex;flex-direction:column;justify-content:center;box-shadow:0 5px 14px #003b2c19}
 main.dash .metric span{font-size:14px;font-weight:800;line-height:1.35}
 main.dash .metric strong{font-size:31px;line-height:1.15;margin:8px 0 4px;overflow-wrap:anywhere}
 main.dash .metric small{font-size:12px;line-height:1.4;color:#d5f4e7}
 main.dash .metric.blue{background:linear-gradient(135deg,#07546b,#087e8a)}
 main.dash .metric.amber{background:linear-gradient(135deg,#94600a,#d99a17)}
 main.dash .metric.red{background:linear-gradient(135deg,#9c292d,#d94646)}
 main.dash .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin:15px 0}
 main.dash .panel{background:#fff;border:1px solid #d2e0db;border-radius:14px;padding:19px;margin:14px 0;box-shadow:0 4px 14px #003b2c0d;min-width:0;overflow:hidden}
 main.dash .panel h2{font-size:19px;line-height:1.3;color:#123e32;margin:0 0 16px;font-weight:800}
 main.dash .panel p{color:#526b62}
 main.dash .statusbars{display:grid;gap:20px;padding:12px 4px}
 main.dash .barrow{display:grid;grid-template-columns:135px minmax(80px,1fr) 65px;align-items:center;gap:13px;font-size:13px}
 main.dash .bar{height:14px;background:#e8efec;border-radius:20px;overflow:hidden}
 main.dash .bar i{height:100%;display:block;border-radius:20px}
 main.dash .table-scroll{width:100%;overflow-x:auto;overflow-y:hidden;border:1px solid #d6e3de;border-radius:11px;background:#fff;box-shadow:inset 0 1px 2px #003b2c08}
 main.dash table.qiora-data-table{width:100%;min-width:820px;border-collapse:separate;border-spacing:0;table-layout:auto;font-size:13px;color:#173d32}
 main.dash table.qiora-data-table thead th{position:sticky;top:0;z-index:1;background:#006b4c;color:#fff;padding:14px 13px;text-align:left;font-size:12px;font-weight:800;letter-spacing:.15px;white-space:nowrap;border-bottom:2px solid #0b9a70}
 main.dash table.qiora-data-table thead th:first-child{border-top-left-radius:8px}
 main.dash table.qiora-data-table thead th:last-child{border-top-right-radius:8px}
 main.dash table.qiora-data-table tbody td{padding:13px;border-bottom:1px solid #e0eae5;color:#183c32;background:#fff;vertical-align:middle;line-height:1.4;white-space:normal;overflow-wrap:anywhere;max-width:300px}
 main.dash table.qiora-data-table tbody tr:nth-child(even) td{background:#f1f7f4}
 main.dash table.qiora-data-table tbody tr:hover td{background:#e2f3eb}
 main.dash table.qiora-data-table tbody tr:last-child td{border-bottom:0}
 main.dash table.qiora-data-table td.empty{text-align:center;padding:30px 16px;color:#75877f;font-style:italic}
 main.dash .table-foot{padding:9px 12px;background:#f6faf8;border-top:1px solid #e0eae5;text-align:right;color:#647b71;font-size:11px;font-weight:700}
 main.dash .note{background:#fff8e6;color:#745314;font-size:14px;border:1px solid #f0dca8}
 main.dash .empty-state{text-align:center;padding:55px 24px}
 main.dash .empty-state p{max-width:650px;margin:12px auto 20px;line-height:1.6}
 main.dash .empty-state strong{color:#8b6413}
 main.dash .empty-icon{font-size:40px;color:#078b5a}
 main.dash .report-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
 main.dash .report-grid button{border:1px solid #d1e0da;border-radius:12px;background:#fff;padding:22px;text-align:left;font-size:17px;font-weight:800;color:#124434;cursor:pointer;box-shadow:0 3px 10px #003b2c0a}
 main.dash .report-grid button:hover{border-color:#078b5a;background:#f5fbf8}
 main.dash .report-grid span{display:block;font-size:28px;color:#078b5a;margin-bottom:8px}
 main.dash .report-grid small{display:block;color:#71847c;font-weight:400;margin-top:6px;line-height:1.45}
 main.dash .error,main.dash .warnings{background:#fff0ef;border:1px solid #efc3c0;color:#9a2828;padding:13px;border-radius:9px;margin:10px 0}
 main.dash .warnings{background:#fff7df;color:#745314}
 main.dash .loading{max-width:900px;margin:80px auto;background:white;padding:30px;border-radius:12px;color:#163e32}
 main.dash footer{text-align:center;color:#668077;padding:20px;font-size:12px}
 @media(max-width:1150px){main.dash .metrics.five{grid-template-columns:repeat(3,minmax(0,1fr))}main.dash .brandtitle{font-size:24px}main.dash .tabs button{font-size:13px}}
 @media(max-width:760px){main.dash{padding:0 9px 22px}main.dash .brand{grid-template-columns:1fr auto;gap:10px;padding:16px}.brandtitle{grid-column:1/-1;grid-row:2;text-align:left!important;font-size:21px!important}.brandmark{font-size:29px}.userbox{font-size:12px}.tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px}.filters .apply{grid-column:1/-1;width:100%}.metrics.five,.metrics.four,.metrics.three{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{padding:14px;min-height:112px}.metric strong{font-size:24px}.grid2{grid-template-columns:1fr}.report-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pagehead h1{font-size:23px}}
 @media(max-width:480px){main.dash .brand{grid-template-columns:1fr}.userbox{justify-self:start}.tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{grid-template-columns:1fr}.filters .apply{grid-column:auto}.metrics.five,.metrics.four,.metrics.three{grid-template-columns:1fr 1fr}.barrow{grid-template-columns:100px minmax(50px,1fr) 45px;gap:8px}.report-grid{grid-template-columns:1fr}}
 `}</style></main>
}
