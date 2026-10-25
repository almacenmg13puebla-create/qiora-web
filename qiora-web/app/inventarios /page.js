'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const OPCIONES = [
  { id: 'STOCK_ALMACEN', titulo: 'Stock Almacén (MB52)', descripcion: 'Existencias, materiales y lotes de almacén' },
  { id: 'STOCK_TECNICOS', titulo: 'Stock Técnicos', descripcion: 'Existencias asignadas a técnicos' },
  { id: 'IQ09_EQUIPOS', titulo: 'Equipos IQ09', descripcion: 'Series, materiales y estados SAP' },
  { id: 'HERRAMIENTA_ODOO', titulo: 'Herramientas ODOO', descripcion: 'Productos, ubicaciones y cantidades' },
]
const CAMPOS = {
  STOCK_TECNICOS: [['almacen','Almacén'],['sku','SKU'],['material','Material'],['lote','Lote'],['cantidad','Cantidad'],['disponible','Disponible'],['tecnico','Técnico']],
  IQ09_EQUIPOS: [['almacen','Almacén'],['serie','Serie'],['material','Material'],['descripcion','Descripción'],['lote','Lote'],['estatus_sap','Estatus SAP'],['denom_status','Denominación'],['tipo_stock','Tipo de stock']],
  STOCK_ALMACEN: [['almacen','Almacén'],['sku','SKU'],['material','Material'],['lote','Lote'],['cantidad','Cantidad'],['disponible','Disponible']],
  HERRAMIENTA_ODOO: [['producto','Producto'],['ubicacion','Ubicación'],['cantidad','Cantidad'],['almacen','Almacén']],
}
const PUEDE = (p) => ['auditoria','dashboard','traspasos','solicitud_material'].some(k=>p?.[k]===true)
const lim = 100
const mx = (x) => String(x??'').trim()
const fechaMX = () => new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'}).format(new Date())

function descargarCsv(datos, columnas, nombre) {
  const escapeCsv = (x) => { const s=String(x??''); return '"'+( /^[=+@\-\t\r]/.test(s) ? "'"+s:s ).replaceAll('"','""')+'"' }
  const csv='\uFEFF'+[columnas.map(c=>c[1]),...datos.map(row=>columnas.map(c=>row[c[0]]??''))].map(row=>row.map(escapeCsv).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=nombre+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

async function descargarExcel(datos, columnas, nombre, detalle) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const resumen=XLSX.utils.aoa_to_sheet([['QIORA CONECTA','INVENTARIOS'],['DISTRITO',detalle.distrito],['INVENTARIO',detalle.tipo],['ALMACÉN',detalle.almacen||'AUTORIZADOS'],['FECHA DE DESCARGA',fechaMX()],['REGISTROS EXPORTADOS',datos.length]])
  resumen['!cols']=[{wch:26},{wch:45}]
  XLSX.utils.book_append_sheet(wb,resumen,'RESUMEN')
  const hoja=XLSX.utils.aoa_to_sheet([columnas.map(c=>c[1]),...datos.map(f=>columnas.map(([campo])=>{
    const v=f[campo]??''
    return ['almacen','sku','serie','lote'].includes(campo)?String(v):v
  }))])
  hoja['!cols']=columnas.map(([campo,et])=>({wch: Math.min(50,Math.max(16,et.length+8, campo==='descripcion'||campo==='material'||campo==='producto'?38:18))}))
  XLSX.utils.book_append_sheet(wb,hoja,'INVENTARIO')
  XLSX.writeFile(wb,nombre+'.xlsx')
}

async function descargarPdf(datos, columnas, nombre, detalle) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'})
  const width=doc.internal.pageSize.getWidth()
  doc.setFillColor(6,78,59);doc.rect(0,0,width,77,'F')
  doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);doc.setFontSize(20);doc.text('QIORA CONECTA',35,34)
  doc.setFontSize(11);doc.text((detalle.distrito==='MG13'?'PUEBLA':detalle.distrito)+' | ALMACENES',35,54)
  doc.setTextColor(17,24,39);doc.setFontSize(14);doc.text(OPCIONES.find(o=>o.id===detalle.tipo)?.titulo||'INVENTARIOS',35,107)
  doc.setFontSize(9);doc.text('Distrito: '+detalle.distrito+'    Almacén: '+(detalle.almacen||'Autorizados')+'    Fecha: '+fechaMX()+'    Registros: '+datos.length,35,126)
  autoTable(doc,{startY:143,margin:{left:35,right:35,bottom:48},head:[columnas.map(c=>c[1])],body:datos.map(r=>columnas.map(c=>String(r[c[0]]??''))),theme:'grid',styles:{fontSize:7,cellPadding:5,overflow:'linebreak'},headStyles:{fillColor:[6,78,59],textColor:255},didDrawPage:(d)=>{doc.setFontSize(8);doc.setTextColor(90);doc.text('QIORA CONECTA | Consulta de inventario | Página '+d.pageNumber,35,doc.internal.pageSize.getHeight()-20)}})
  doc.save(nombre+'.pdf')
}

export default function InventariosPage(){
  const router=useRouter()
  const [perfil,setPerfil]=useState(null),[validando,setValidando]=useState(true)
  const [tipo,setTipo]=useState(''),[almacen,setAlmacen]=useState(''),[busqueda,setBusqueda]=useState('')
  const [pagina,setPagina]=useState(1),[respuesta,setRespuesta]=useState(null)
  const [cargando,setCargando]=useState(false),[exportando,setExportando]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let vivo=true;(async()=>{try{
    const {data:{user},error:e}=await supabase.auth.getUser();if(e||!user){router.replace('/');return}
    const {data,error:r}=await supabase.rpc('qiora_mi_perfil');if(r)throw r
    if(!data?.activo||!PUEDE(data))throw Error('Tu usuario no tiene permiso para consultar Inventarios.')
    if(vivo)setPerfil(data)
  }catch(e){if(vivo)setError(e.message||'No fue posible iniciar Inventarios.')}finally{if(vivo)setValidando(false)}})();return()=>{vivo=false}},[router])
  const consultar=useCallback(async(p=1,f=busqueda,t=tipo)=>{setCargando(true);setError('');try{
    const {data,error:e}=await supabase.rpc('qiora_consultar_inventario_v2',{p_tipo:t,p_almacen:f||null,p_pagina:p,p_limite:lim})
    if(e)throw e;if(!data?.ok)throw Error(data?.mensaje||'Supabase no confirmó la consulta.')
    setRespuesta(data);setPagina(p);setBusqueda(f)
  }catch(e){setRespuesta(null);setError(e.message||'No fue posible consultar el inventario.')}finally{setCargando(false)}},[tipo,busqueda])
  const exportar=async(formato)=>{if(!respuesta||!tipo)return;setExportando(true);setError('');try{
    // Descargar todas las páginas, sin confiar en que Supabase permita resultados ilimitados.
    const datos=[];const total=Number(respuesta.total||0);const paginas=Math.ceil(total/200)
    if(total>50000)throw Error('La exportación supera el máximo de 50,000 registros; filtre por almacén.')
    for(let p=1;p<=paginas;p++){
      const {data,error:e}=await supabase.rpc('qiora_consultar_inventario_v2',{p_tipo:tipo,p_almacen:busqueda||null,p_pagina:p,p_limite:200})
      if(e)throw e;if(!data?.ok)throw Error('No se pudo descargar la página '+p)
      datos.push(...(data.filas||[]))
    }
    const cols=CAMPOS[tipo],nom='QIORA_'+tipo+'_'+perfil.distrito+'_'+new Date().toISOString().slice(0,10)
    const detalle={tipo,distrito:perfil.distrito,almacen:busqueda}
    if(formato==='Excel')await descargarExcel(datos,cols,nom,detalle)
    else if(formato==='PDF')await descargarPdf(datos,cols,nom,detalle)
    else descargarCsv(datos,cols,nom)
  }catch(e){setError(e.message||'No se pudo exportar.')}finally{setExportando(false)}}
  if(validando)return <main style={s.pagina}><p>Validando sesión...</p></main>
  if(!perfil)return <main style={s.pagina}><h1>Inventarios</h1><p role="alert">{error}</p><button style={s.sec} onClick={()=>router.push('/')}>Volver</button></main>
  const totalPaginas=Math.max(1,Math.ceil(Number(respuesta?.total||0)/lim))
  return <main style={s.pagina}><div style={s.marco}>
    <button style={s.regresar} onClick={()=>tipo?(setTipo(''),setRespuesta(null),setError(''),setAlmacen(''),setBusqueda('')):router.push('/')}>← {tipo?'Regresar a Inventarios':'Regresar al menú principal'}</button>
    {!tipo?<><header style={s.hero}><h1 style={{margin:0,fontSize:30}}>INVENTARIOS</h1><p style={{margin:'7px 0 0'}}>Seleccione una opción de inventarios</p></header><section style={s.menu}>{OPCIONES.map(o=><button style={s.opcion} key={o.id} onClick={()=>{setTipo(o.id);setRespuesta(null);setError('')}}><strong>{o.titulo}</strong><small style={{display:'block',marginTop:10,opacity:.85}}>{o.descripcion}</small></button>)}</section></>:
    <><header style={s.hero}><h1 style={{margin:0}}>{OPCIONES.find(o=>o.id===tipo)?.titulo}</h1><p style={{marginBottom:0}}>Distrito {perfil.distrito} · {perfil.nombre}</p></header>
    <section style={s.card}><label style={s.label}>Almacén (vacío = almacenes autorizados del distrito)<input style={s.input} placeholder="Ej. 0026" maxLength={10} value={almacen} onChange={e=>setAlmacen(e.target.value.toUpperCase())}/></label>
    <div style={s.acciones}><button style={s.principal} disabled={cargando} onClick={()=>consultar(1,almacen.trim(),tipo)}>{cargando?'Consultando...':'Consultar inventario'}</button><button style={s.sec} onClick={()=>{setAlmacen('');setRespuesta(null);setBusqueda('');setError('')}}>Limpiar</button></div>
    <p style={s.nota}>Consulta de solo lectura. El servidor valida el distrito y los permisos de tu usuario.</p></section>
    {error&&<p role="alert" style={s.error}>{error}</p>}
    {respuesta&&<section style={s.card}><div style={s.encabezado}><div><h2 style={{margin:0}}>Resultados</h2><p style={s.nota}>Distrito: {respuesta.distrito} · Almacén: {respuesta.almacen||'Autorizados'} · Registros: {respuesta.total}</p></div><div style={s.acciones}><button style={s.principal} disabled={exportando} onClick={()=>exportar('Excel')}>Excel</button><button style={s.sec} disabled={exportando} onClick={()=>exportar('PDF')}>PDF</button><button style={s.sec} disabled={exportando} onClick={()=>exportar('CSV')}>CSV</button></div></div>
    <div style={{overflowX:'auto'}}><table style={s.tabla}><thead><tr>{CAMPOS[tipo].map(([k,label])=><th key={k} style={s.th}>{label}</th>)}</tr></thead><tbody>{(respuesta.filas||[]).map((f,i)=><tr key={i}>{CAMPOS[tipo].map(([k])=><td key={k} style={s.td}>{String(f[k]??'-')}</td>)}</tr>)}</tbody></table></div>
    {!respuesta.filas?.length&&<p>No hay registros para estos filtros. En Stock Almacén, verifica la asignación de ubicaciones a distritos.</p>}
    <div style={s.paginacion}><button style={s.sec} disabled={cargando||pagina<=1} onClick={()=>consultar(pagina-1)}>Anterior</button><span>Página {pagina} de {totalPaginas}</span><button style={s.sec} disabled={cargando||pagina>=totalPaginas} onClick={()=>consultar(pagina+1)}>Siguiente</button></div></section>}
    </>}
  </div></main>
}
const s={pagina:{background:'#07271e',minHeight:'100vh',padding:'18px 4%',fontFamily:'Arial,sans-serif',color:'#effaf5'},marco:{maxWidth:1450,margin:'0 auto',padding:20,border:'1px solid #467d6c',borderRadius:20,background:'#06251c'},regresar:{color:'#fff',background:'#137b5d',padding:'10px 17px',border:0,borderRadius:11,cursor:'pointer',marginBottom:18,fontWeight:700},hero:{background:'linear-gradient(110deg,#0c523e,#17a780)',border:'1px solid #4fa88c',padding:28,textAlign:'center',borderRadius:16,marginBottom:20},menu:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:15},opcion:{border:0,borderRadius:14,background:'linear-gradient(110deg,#108566,#20b78b)',padding:'28px 17px',fontWeight:700,fontSize:17,textAlign:'left',color:'#fff',cursor:'pointer'},card:{background:'#fff',color:'#172a22',padding:20,borderRadius:14,marginBottom:18},label:{fontWeight:700},input:{display:'block',width:'100%',padding:12,marginTop:8,border:'1px solid #b6c7c1',borderRadius:9,fontSize:16},acciones:{display:'flex',gap:9,flexWrap:'wrap',marginTop:15},principal:{background:'#117e61',color:'#fff',padding:'10px 18px',fontWeight:700,border:0,borderRadius:9,cursor:'pointer'},sec:{background:'#fff',color:'#19372d',padding:'10px 16px',fontWeight:700,border:'1px solid #9dafaa',borderRadius:9,cursor:'pointer'},nota:{fontSize:13,color:'#597168',fontWeight:400},error:{background:'#fee9e9',color:'#9f1717',padding:13,borderRadius:10},encabezado:{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'},tabla:{width:'100%',minWidth:850,borderCollapse:'collapse'},th:{background:'#e6f0eb',padding:10,textAlign:'left',borderBottom:'2px solid #a3c4b6'},td:{padding:10,borderBottom:'1px solid #d6e4dc'},paginacion:{display:'flex',gap:9,justifyContent:'space-between',alignItems:'center',marginTop:16}}
