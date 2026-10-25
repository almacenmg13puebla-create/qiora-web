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
  STOCK_TECNICOS: [['almacen','Almacén'],['sku','SKU'],['material','Material'],['lote','Lote'],['tecnico','Técnico'],['cantidad','Cantidad'],['disponible','Cantidad disponible']],
  IQ09_EQUIPOS: [['almacen','Almacén'],['serie','Serie'],['material','Material'],['descripcion','Descripción'],['lote','Lote'],['estatus_sap','Estatus SAP'],['denom_status','Denominación'],['tipo_stock','Tipo de stock']],
  STOCK_ALMACEN: [['almacen','Almacén'],['sku','SKU'],['material','Material'],['lote','Lote'],['cantidad','Cantidad'],['disponible','Disponible']],
  HERRAMIENTA_ODOO: [['producto','Producto'],['ubicacion','Ubicación'],['cantidad','Cantidad'],['almacen','Almacén']],
}
const PUEDE = (p) => ['auditoria','dashboard','traspasos','solicitud_material'].some(k=>p?.[k]===true)
const lim = 200
const mx = (x) => String(x??'').trim()
const normalizar = x => mx(x).toLocaleUpperCase('es-MX')
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

export default function InventariosPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [validando, setValidando] = useState(true)
  const [tipo, setTipo] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [buscador, setBuscador] = useState('')
  const [estado, setEstado] = useState('')
  const [serie, setSerie] = useState('')
  const [pagina, setPagina] = useState(1)
  const [respuesta, setRespuesta] = useState(null)
  const [filtroAplicado, setFiltroAplicado] = useState('')
  const [soloCoincidencias, setSoloCoincidencias] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')
  const esMateriales = tipo === 'STOCK_TECNICOS'
  const esEquipos = tipo === 'IQ09_EQUIPOS'
  const columnas = esMateriales
    ? [['almacen','Almacén'],['tecnico','Técnico'],['sku','SKU'],['material','Material'],['lote','Lote'],['disponible','Cantidad disponible']]
    : esEquipos
      ? [['almacen','Almacén'],['material','Material'],['descripcion','Descripción'],['serie','Serie'],['lote','Lote'],['estatus_sap','Estado SAP']]
      : CAMPOS[tipo] || []

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) { router.replace('/'); return }
        const { data, error: profileError } = await supabase.rpc('qiora_mi_perfil')
        if (profileError) throw profileError
        if (!data?.activo || !PUEDE(data)) throw new Error('Tu usuario no tiene permiso para Inventarios.')
        if (vivo) setPerfil(data)
      } catch(e) { if(vivo) setError(e?.message || 'No se pudo validar el acceso.') }
      finally { if(vivo) setValidando(false) }
    })()
    return () => { vivo = false }
  }, [router])

  function regresar() {
    if (!tipo) return router.push('/')
    setTipo(''); setAlmacen(''); setTecnico(''); setBuscador('')
    setEstado(''); setSerie(''); setRespuesta(null); setError(''); setFiltroAplicado('')
  }

  function abrir(modulo) {
    setTipo(modulo); setRespuesta(null); setError(''); setAlmacen('')
    setTecnico(''); setBuscador(''); setEstado(''); setSerie(''); setFiltroAplicado('')
    setPagina(1); setSoloCoincidencias(false)
  }

  const consultar = useCallback(async (nuevaPagina = 1, filtroAlmacen = almacen, filtroTexto = null) => {
    if (!tipo) return
    setCargando(true); setError('')
    try {
      const f = mx(filtroAlmacen).toUpperCase()
      const { data, error: queryError } = await supabase.rpc('qiora_consultar_inventario_v2', {
        p_tipo: tipo,
        p_almacen: f || null,
        p_pagina: nuevaPagina,
        p_limite: lim,
      })
      if (queryError) throw queryError
      if (!data?.ok) throw new Error(data?.mensaje || 'No se pudo consultar el inventario.')
      setRespuesta(data); setPagina(nuevaPagina); setFiltroAplicado(f)
      if (filtroTexto !== null) setSoloCoincidencias(Boolean(mx(filtroTexto)))
    } catch(e) {
      setRespuesta(null)
      setError(e?.message || 'No fue posible consultar Inventarios.')
    } finally { setCargando(false) }
  }, [tipo, almacen])

  // Estos filtros se aplican a la página devuelta por Supabase (hasta 200 filas).
  // No se afirma que hayan buscado en todo el histórico del distrito.
  const filas = (respuesta?.filas || []).filter(f => {
    if (tecnico && !normalizar(f.tecnico).includes(normalizar(tecnico)) && !normalizar(f.almacen).includes(normalizar(tecnico))) return false
    if (esMateriales && soloCoincidencias && buscador) {
      if (![f.sku, f.material, f.grupo].some(x => normalizar(x).includes(normalizar(buscador)))) return false
    }
    if (esEquipos && estado) {
      if (![f.estatus_sap,f.denom_status,f.tipo_stock].some(x => normalizar(x).includes(normalizar(estado)))) return false
    }
    if (esEquipos && serie && !normalizar(f.serie).includes(normalizar(serie))) return false
    return true
  })
  const totalPaginas = Math.max(1, Math.ceil(Number(respuesta?.total || 0) / lim))

  async function obtenerTodo() {
    if (!respuesta) throw new Error('Primero consulta el inventario.')
    const total = Number(respuesta.total || 0)
    if (total > 50000) throw new Error('Hay más de 50,000 registros. Filtra por almacén para exportar.')
    const salida = []
    for (let n=1; n<=Math.ceil(total / lim); n++) {
      const { data, error: e } = await supabase.rpc('qiora_consultar_inventario_v2', {
        p_tipo: tipo, p_almacen: filtroAplicado || null, p_pagina:n, p_limite:lim
      })
      if (e) throw e
      if (!data?.ok) throw new Error('Error al descargar página ' + n)
      salida.push(...(data.filas || []))
    }
    return salida
  }

  async function exportar(formato) {
    setExportando(true); setError('')
    try {
      const todos = await obtenerTodo()
      const filtro = todos.filter(f => {
        if (tecnico && !normalizar(f.tecnico).includes(normalizar(tecnico)) && !normalizar(f.almacen).includes(normalizar(tecnico))) return false
        if (esMateriales && soloCoincidencias && buscador && ![f.sku,f.material,f.grupo].some(x => normalizar(x).includes(normalizar(buscador)))) return false
        if (esEquipos && estado && ![f.estatus_sap,f.denom_status,f.tipo_stock].some(x => normalizar(x).includes(normalizar(estado)))) return false
        if (esEquipos && serie && !normalizar(f.serie).includes(normalizar(serie))) return false
        return true
      })
      const nom = 'QIORA_' + tipo + '_' + perfil.distrito + '_' + new Date().toISOString().slice(0,10)
      const det = { tipo, distrito: perfil.distrito, almacen:filtroAplicado }
      if (formato === 'Excel') await descargarExcel(filtro, columnas, nom, det)
      else if (formato === 'PDF') await descargarPdf(filtro, columnas, nom, det)
      else descargarCsv(filtro, columnas, nom)
    } catch(e) { setError(e?.message || 'Error al exportar.') }
    finally { setExportando(false) }
  }

  function compartirWhatsapp() {
    if (!respuesta) { setError('Primero realiza la consulta.'); return }
    // WhatsApp usa solamente las filas actualmente mostradas para evitar enlaces demasiado grandes.
    const primeros = filas.slice(0,20)
    const txt = [
      'QIORA CONECTA | EQUIPOS',
      'Distrito: ' + perfil.distrito,
      'Almacén: ' + (filtroAplicado || 'Autorizados'),
      'Página: ' + pagina,
      'Resultados mostrados: ' + filas.length,
      ...primeros.map(x => [x.almacen,x.material,x.serie,x.estatus_sap || x.denom_status].map(mx).join(' | ')),
      filas.length > 20 ? 'Se muestran los primeros 20 equipos; utiliza Excel para el reporte completo.' : '',
    ].filter(Boolean).join('\n')
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener,noreferrer')
  }

  const btn = (etiqueta, accion, secundario = false, disabled = false) =>
    <button type="button" style={secundario ? s.secVerde : s.principal} disabled={disabled} onClick={accion}>{etiqueta}</button>

  if (validando) return <main style={s.pagina}>Validando sesión...</main>
  if (!perfil) return <main style={s.pagina}><p role="alert">{error}</p><button onClick={() => router.push('/')}>Regresar</button></main>

  return <main style={s.pagina}><div style={s.marco}>
    <button type="button" style={s.regresar} onClick={regresar}>← {tipo ? 'Regresar a Inventarios' : 'Regresar al menú principal'}</button>
    <header style={s.hero}><h1 style={{margin:0,fontSize:29}}>{tipo ? (esMateriales ? 'Técnicos - Materiales' : esEquipos ? 'Equipos' : OPCIONES.find(o=>o.id===tipo)?.titulo) : 'INVENTARIOS'}</h1><p style={{margin:'8px 0 0'}}>{!tipo ? 'Seleccione una opción de inventarios' : esMateriales ? 'Consulta de materiales cargados por técnico y almacén.' : esEquipos ? 'Consulta general de equipos por almacén o todos los almacenes.' : 'Consulta de existencias del distrito ' + perfil.distrito}</p></header>
    {!tipo ? <section style={s.menu}>{OPCIONES.map(o => <button type="button" key={o.id} style={s.opcion} onClick={() => abrir(o.id)}><strong>{o.id==='STOCK_TECNICOS'?'Técnicos - Materiales':o.id==='IQ09_EQUIPOS'?'Equipos':o.titulo}</strong><small style={{display:'block',marginTop:9}}>{o.descripcion}</small></button>)}</section> : <>
      <section style={s.panelOscuro}>
        <div style={s.filtros}>
          <label style={s.campo}>Almacén (opcional)<input style={s.input} value={almacen} placeholder="Vacío = todos los autorizados" maxLength={10} onChange={e=>setAlmacen(e.target.value.toUpperCase())}/></label>
          {(esMateriales || esEquipos) && <label style={s.campo}>{esMateriales?'Técnico':'Técnico responsable / almacén'}<input style={s.input} value={tecnico} placeholder="Todos los técnicos (según filtro)" onChange={e=>setTecnico(e.target.value)}/></label>}
          {esEquipos && <label style={s.campo}>Estado<select style={s.input} value={estado} onChange={e=>setEstado(e.target.value)}><option value="">Todos</option><option value="DISPONIBLE">Disponible</option><option value="FALTANTE">Faltante</option><option value="ENTREGADO">Entregado</option><option value="04">Tipo stock 04</option></select></label>}
          {esMateriales && <label style={s.campo}>SKU, material o grupo<input style={s.input} value={buscador} placeholder="Escribe SKU, material o grupo" onChange={e=>setBuscador(e.target.value)}/></label>}
          {esEquipos && <label style={{...s.campo,gridColumn:'1 / -1'}}>Serie (opcional)<input style={s.input} value={serie} placeholder="Escanea o captura la serie" onChange={e=>setSerie(e.target.value.toUpperCase())}/></label>}
        </div>
        <div style={s.acciones}>
          {esMateriales ? <>{btn('Buscar todo',()=>{setSoloCoincidencias(false); consultar(1,almacen,'')},false,cargando)}{btn('Buscar material o grupo',()=>{setSoloCoincidencias(true);consultar(1,almacen,buscador)},false,cargando)} </> : btn('Buscar',()=>consultar(1,almacen),false,cargando)}
          {esEquipos && <>{btn('Enviar por WhatsApp',compartirWhatsapp,true,!respuesta)}{btn('Descargar Excel',()=>exportar('Excel'),true,!respuesta||exportando)}</>}
          {!esEquipos && respuesta && <>{btn('Excel',()=>exportar('Excel'),true,exportando)}{btn('PDF',()=>exportar('PDF'),true,exportando)}</>}
        </div>
        <p style={s.aviso}>Los filtros de técnico, SKU, serie y estado se aplican sobre la página consultada (hasta 200 filas). Para exportar, se consultan todas las páginas autorizadas. Los permisos y el distrito se comprueban en Supabase.</p>
      </section>
      {error && <p role="alert" style={s.error}>{error}</p>}
      <section style={s.panelOscuro}>
        {respuesta && <p style={{...s.aviso,marginTop:0}}>Almacén: {respuesta.almacen || 'Autorizados'} · {respuesta.total} registros en la consulta · {filas.length} visibles en esta página</p>}
        <div style={s.tablaWrap}><table style={s.tabla}><thead><tr>{columnas.map(([k,t])=><th key={k} style={s.th}>{t}</th>)}</tr></thead><tbody>
        {respuesta ? filas.map((fila,i)=><tr key={i}>{columnas.map(([campo])=><td style={s.td} key={campo}>{String(fila[campo] ?? '-')}</td>)}</tr>) : <tr><td colSpan={columnas.length} style={s.vacio}>Sin consulta realizada.</td></tr>}
        {respuesta && !filas.length && <tr><td colSpan={columnas.length} style={s.vacio}>Sin resultados en esta página con los filtros seleccionados.</td></tr>}
        </tbody></table></div>
        {respuesta && <div style={s.paginacion}><button style={s.secVerde} disabled={cargando||pagina<=1} onClick={()=>consultar(pagina-1,filtroAplicado)}>Anterior</button><span>Página {pagina} de {totalPaginas}</span><button style={s.secVerde} disabled={cargando||pagina>=totalPaginas} onClick={()=>consultar(pagina+1,filtroAplicado)}>Siguiente</button></div>}
      </section>
    </>}
  </div></main>
}

const s = {
  pagina:{minHeight:'100vh',background:'#062d23',padding:'12px 3%',fontFamily:'Arial,Helvetica,sans-serif',color:'#f4fff9'},
  marco:{maxWidth:1320,margin:'0 auto',background:'#06261e',border:'2px solid #477b6b',borderRadius:22,padding:20},
  regresar:{background:'#117f60',border:0,borderRadius:24,padding:'10px 18px',fontWeight:700,color:'#fff',cursor:'pointer',marginBottom:16},
  hero:{textAlign:'center',border:'2px solid #59aa91',background:'linear-gradient(120deg,#0c4f3d,#1aad83)',borderRadius:17,padding:'21px 15px',marginBottom:17},
  menu:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:14},
  opcion:{padding:25,minHeight:106,textAlign:'left',border:0,borderRadius:12,background:'linear-gradient(120deg,#087e5c,#22b58d)',color:'#fff',fontSize:17,cursor:'pointer'},
  panelOscuro:{background:'linear-gradient(#0e4034,#071e1a)',border:'1px solid #477d6a',borderRadius:18,padding:18,marginBottom:15},
  filtros:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:14},
  campo:{fontSize:13,fontWeight:700,color:'#fff'},
  input:{boxSizing:'border-box',display:'block',width:'100%',background:'#f8fcfa',color:'#14261e',marginTop:7,border:'1px solid #a8c6ba',borderRadius:11,padding:'12px 11px',fontSize:15},
  acciones:{display:'flex',flexWrap:'wrap',gap:9,marginTop:17},
  principal:{border:0,borderRadius:12,background:'#129e78',color:'#fff',fontWeight:700,padding:'11px 17px',cursor:'pointer'},
  secVerde:{border:0,borderRadius:12,background:'#0b785c',color:'#fff',fontWeight:700,padding:'11px 17px',cursor:'pointer'},
  aviso:{fontSize:12,color:'#c2ded2',lineHeight:1.5,marginTop:14},
  error:{background:'#fee8e8',color:'#8f1717',padding:12,borderRadius:8},
  tablaWrap:{overflowX:'auto'},tabla:{borderCollapse:'collapse',width:'100%',minWidth:720,background:'#f9fbfa',color:'#18352a'},
  th:{background:'#0f795b',color:'#fff',border:'1px solid #92b6a8',padding:10,fontSize:13},
  td:{borderBottom:'1px solid #c3dbd2',padding:'10px 11px',fontSize:13,wordBreak:'break-word'},
  vacio:{textAlign:'center',padding:18,color:'#41594f'},
  paginacion:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginTop:15}
}
