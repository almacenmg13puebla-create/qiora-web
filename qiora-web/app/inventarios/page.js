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
const grupoSKU = (sku, catalogo) => catalogo[String(sku??'').trim()] || 'SIN CLASIFICAR'
const etiquetaEstado = dias => dias == null ? 'SIN FECHA' : dias > 30 ? 'CRÍTICO' : dias >= 15 ? 'FUERA DE TIEMPO' : 'EN TIEMPO'
const filtrarEstado = (dias, filtro) => !filtro || (dias != null && (filtro === 'EN_TIEMPO' ? dias < 15 : filtro === 'FUERA_TIEMPO' ? (dias >= 15 && dias <= 30) : filtro === 'CRITICO' ? dias > 30 : false))

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
  const [catalogoSKU, setCatalogoSKU] = useState({})
  const [adminCatalogos, setAdminCatalogos] = useState(false)
  const [validando, setValidando] = useState(true)
  const [tipo, setTipo] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [buscador, setBuscador] = useState('')
  const [estado, setEstado] = useState('')
  const [serie, setSerie] = useState('')
  const [telefono, setTelefono] = useState('')
  const [tecnicoResuelto, setTecnicoResuelto] = useState('')
  const [advertencia, setAdvertencia] = useState('')
  const [pagina, setPagina] = useState(1)
  const [respuesta, setRespuesta] = useState(null)
  const [filtroAplicado, setFiltroAplicado] = useState('')
  const [filtrosEquiposAplicados, setFiltrosEquiposAplicados] = useState({ estado: '', serie: '' })
  const [busquedaMaterialAplicada, setBusquedaMaterialAplicada] = useState('')
  const [soloCoincidencias, setSoloCoincidencias] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')
  const esMateriales = tipo === 'STOCK_TECNICOS'
  const esEquipos = tipo === 'IQ09_EQUIPOS'
  const columnas = esMateriales
    ? [['almacen','Almacén'],['tecnico','Técnico'],['sku','SKU'],['material','Material'],['grupo','Grupo'],['lote','Lote'],['disponible','Cantidad disponible']]
    : esEquipos
      ? [['almacen','Almacén'],['material','Material'],['descripcion','Descripción'],['serie','Serie'],['lote','Lote'],['dias','Días'],['estado_tiempo','Estado']]
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

  useEffect(() => {
    if (!perfil) return
    let vivo = true
    ;(async () => {
      const {data, error: e} = await supabase.rpc('qiora_catalogos_listar')
      if (e) { if (vivo) setError('Catálogos: ' + e.message); return }
      if (vivo) setCatalogoSKU(Object.fromEntries((data?.materiales || []).filter(m=>m.activo).map(m=>[String(m.sku),m.grupo])))
      const {data: a} = await supabase.rpc('qiora_catalogos_es_admin')
      if (vivo) setAdminCatalogos(a === true)
    })()
    return () => { vivo = false }
  }, [perfil])

  // El servidor solo devuelve nombre y contacto del almacén autorizado del distrito.
  useEffect(() => {
    let cancelado = false
    const a = mx(almacen).toUpperCase()
    setTelefono(''); setTecnicoResuelto(''); setAdvertencia('')
    if (!perfil || !a || (!esMateriales && !esEquipos)) return
    ;(async () => {
      try {
        const { data, error: e } = await supabase.rpc('qiora_contacto_inventario', { p_almacen: a })
        if (e) throw e
        if (!cancelado) { setTecnicoResuelto(data?.tecnico || ''); setTelefono(data?.telefono || '') }
      } catch (e) { if (!cancelado) setAdvertencia(e.message || 'No se encontró el técnico del almacén') }
    })()
    return () => { cancelado = true }
  }, [almacen, perfil, esMateriales, esEquipos])

  // Todos los filtros IQ09 se ejecutan en Supabase ANTES de paginar.
  const consultaRpc = tipo === 'IQ09_EQUIPOS' ? 'qiora_consultar_equipos_filtrados' : tipo === 'STOCK_TECNICOS' ? 'qiora_consultar_materiales_filtrados' : 'qiora_consultar_inventario_v2'
  const preparar = filas => (filas||[]).filter(f => !esMateriales || normalizar(f.lote) !== 'TPE USADO')
  const argumentosConsulta = (numero, a, filtros) => esEquipos
    ? { p_almacen: a || null, p_estado: ({EN_TIEMPO:'EN TIEMPO', FUERA_TIEMPO:'FUERA DE TIEMPO', CRITICO:'CRÍTICO'})[filtros.estado] || 'TODOS', p_serie: filtros.serie || null, p_pagina: numero, p_limite: lim }
    : esMateriales
      ? { p_tipo: tipo, p_almacen: a || null, p_busqueda: filtros.busqueda || null, p_pagina: numero, p_limite: lim }
      : { p_tipo: tipo, p_almacen: a || null, p_pagina: numero, p_limite: lim }

  function regresar() {
    if (!tipo) return router.push('/')
    setTipo(''); setAlmacen(''); setTecnico(''); setBuscador(''); setTelefono(''); setTecnicoResuelto('')
    setEstado(''); setSerie(''); setRespuesta(null); setError(''); setFiltroAplicado(''); setFiltrosEquiposAplicados({estado:'',serie:''}); setBusquedaMaterialAplicada('')
  }

  function abrir(modulo) {
    setTipo(modulo); setRespuesta(null); setError(''); setAlmacen('')
    setTecnico(''); setBuscador(''); setEstado(''); setSerie(''); setFiltroAplicado(''); setTelefono(''); setTecnicoResuelto('')
    setPagina(1); setSoloCoincidencias(false); setFiltrosEquiposAplicados({estado:'',serie:''}); setBusquedaMaterialAplicada('')
  }

  const consultar = async (nuevaPagina = 1, filtroAlmacen = almacen, filtroTexto = null) => {
    if (!tipo) return
    setCargando(true); setError('')
    try {
      const f = mx(filtroAlmacen).toUpperCase()
      const filtros = esEquipos
        ? (nuevaPagina === 1 ? {estado, serie: mx(serie).toUpperCase()} : filtrosEquiposAplicados)
        : esMateriales
          ? {busqueda: nuevaPagina === 1 ? mx(filtroTexto ?? busquedaMaterialAplicada) : busquedaMaterialAplicada}
          : {}
      const { data, error: queryError } = await supabase.rpc(consultaRpc, argumentosConsulta(nuevaPagina, f, filtros))
      if (queryError) throw queryError
      if (!data?.ok) throw new Error(data?.mensaje || 'No se pudo consultar el inventario.')
      setRespuesta({...data,filas:preparar(data.filas)})
      setPagina(nuevaPagina)
      setFiltroAplicado(f)
      if (esEquipos) setFiltrosEquiposAplicados(filtros)
      if (esMateriales) {
        setSoloCoincidencias(Boolean(filtros.busqueda))
        setBusquedaMaterialAplicada(filtros.busqueda)
      }
    } catch(e) {
      setRespuesta(null)
      setError(e?.message || 'No fue posible consultar Inventarios.')
    } finally { setCargando(false) }
  }

  // IQ09 ya llega filtrado y paginado en Supabase.
  const filas = respuesta?.filas || []
  const totalPaginas = Math.max(1, Math.ceil(Number(respuesta?.total || 0) / lim))

  async function obtenerTodo() {
    if (!respuesta) throw new Error('Primero consulta el inventario.')
    const total = Number(respuesta.total || 0)
    if (total > 50000) throw new Error('Hay más de 50,000 registros. Filtra por almacén para exportar.')
    const salida = []
    for (let n=1; n<=Math.ceil(total / lim); n++) {
      const { data, error: e } = await supabase.rpc(consultaRpc,
        argumentosConsulta(n, filtroAplicado, esMateriales ? {busqueda: busquedaMaterialAplicada} : filtrosEquiposAplicados))
      if (e) throw e
      if (!data?.ok) throw new Error('Error al descargar página ' + n)
      salida.push(...preparar(data.filas || []))
    }
    return salida
  }

  async function exportar(formato) {
    setExportando(true); setError('')
    try {
      if (cambiosEquiposPendientes) throw new Error('Pulsa Buscar para aplicar los nuevos filtros antes de exportar.')
      const todos = await obtenerTodo()
      const filtro = todos
      const nom = 'QIORA_' + tipo + '_' + perfil.distrito + '_' + new Date().toISOString().slice(0,10)
      const det = { tipo, distrito: perfil.distrito, almacen:filtroAplicado }
      if (formato === 'Excel') await descargarExcel(filtro, columnas, nom, det)
      else if (formato === 'PDF') await descargarPdf(filtro, columnas, nom, det)
      else descargarCsv(filtro, columnas, nom)
    } catch(e) { setError(e?.message || 'Error al exportar.') }
    finally { setExportando(false) }
  }

  async function compartirWhatsapp() {
    setError('')
    if (cambiosEquiposPendientes) { setError('Pulsa Buscar para aplicar los nuevos filtros.'); return }
    if (!esEquipos || !mx(almacen)) { setError('Selecciona un almacén para determinar el destinatario.'); return }
    if (!respuesta || filtroAplicado !== mx(almacen).toUpperCase()) { setError('Primero consulta ese mismo almacén.'); return }
    if (!telefono) { setError('No hay teléfono válido autorizado para este técnico. Revisa la columna de contacto en Supabase.'); return }
    setExportando(true)
    try {
      // Whatsapp no admite adjuntar directamente Excel desde un enlace wa.me.
      // El texto se limita para no exceder la longitud de URL y se indica si queda incompleto.
      const datos = await obtenerTodo()
      if (!datos.length) throw new Error('No hay series con los filtros seleccionados.')
      const maximo = 35
      const msg = [
        '*QIORA CONECTA | EQUIPOS*',
        'Distrito: '+perfil.distrito,
        'Almacén: '+filtroAplicado,
        'Técnico: '+(tecnicoResuelto||'Sin nombre'),
        'Filtro: '+(filtrosEquiposAplicados.estado==='EN_TIEMPO'?'EN TIEMPO':filtrosEquiposAplicados.estado==='FUERA_TIEMPO'?'FUERA DE TIEMPO':filtrosEquiposAplicados.estado==='CRITICO'?'CRÍTICO':'TODOS'),
        'Total de equipos: '+datos.length,
        ...datos.slice(0,maximo).map((x,i)=> `${i+1}. Serie: ${x.serie||'-'} | Material: ${x.material||'-'} | Días: ${x.dias??'Sin fecha'} | ${x.estado_tiempo||'SIN FECHA'}`),
        datos.length>maximo ? `Se incluyen ${maximo} de ${datos.length} equipos. Descarga Excel para el listado completo.` : '',
      ].filter(Boolean).join('\n')
      window.open('https://wa.me/'+telefono+'?text='+encodeURIComponent(msg),'_blank','noopener,noreferrer')
    } catch(e) { setError(e.message||'No fue posible preparar WhatsApp.') }
    finally { setExportando(false) }
  }

  const cambiosEquiposPendientes = esEquipos && respuesta && (estado !== filtrosEquiposAplicados.estado || mx(serie).toUpperCase() !== filtrosEquiposAplicados.serie || (mx(almacen).match(/^[0-9]{1,4}$/) ? mx(almacen).padStart(4,'0') : mx(almacen).toUpperCase()) !== (filtroAplicado.match(/^[0-9]{1,4}$/) ? filtroAplicado.padStart(4,'0') : filtroAplicado))

  const btn = (etiqueta, accion, secundario = false, disabled = false) =>
    <button type="button" style={secundario ? s.secVerde : s.principal} disabled={disabled} onClick={accion}>{etiqueta}</button>

  if (validando) return <main style={s.pagina}>Validando sesión...</main>
  if (!perfil) return <main style={s.pagina}><p role="alert">{error}</p><button onClick={() => router.push('/')}>Regresar</button></main>

  return <main style={s.pagina}><div style={s.marco}>
    <button type="button" style={s.regresar} onClick={regresar}>← {tipo ? 'Regresar a Inventarios' : 'Regresar al menú principal'}</button>
    <header style={s.hero}><h1 style={{margin:0,fontSize:29}}>{tipo ? (esMateriales ? 'Técnicos - Materiales' : esEquipos ? 'Equipos' : OPCIONES.find(o=>o.id===tipo)?.titulo) : 'INVENTARIOS'}</h1><p style={{margin:'8px 0 0'}}>{!tipo ? 'Seleccione una opción de inventarios' : esMateriales ? 'Consulta de materiales cargados por técnico y almacén.' : esEquipos ? 'Consulta general de equipos por almacén o todos los almacenes.' : 'Consulta de existencias del distrito ' + perfil.distrito}</p></header>
    {!tipo ? <section style={s.menu}>{adminCatalogos && <button type="button" style={s.opcion} onClick={()=>router.push('/inventarios/catalogos')}><strong>Administrar Materiales y Grupos</strong><small style={{display:'block',marginTop:9}}>Catálogos editables de Supabase</small></button>}{OPCIONES.map(o => <button type="button" key={o.id} style={s.opcion} onClick={() => abrir(o.id)}><strong>{o.id==='STOCK_TECNICOS'?'Técnicos - Materiales':o.id==='IQ09_EQUIPOS'?'Equipos':o.titulo}</strong><small style={{display:'block',marginTop:9}}>{o.descripcion}</small></button>)}</section> : <>
      <section style={s.panelOscuro}>
        <div style={s.filtros}>
          <label style={s.campo}>Almacén (opcional)<input style={s.input} value={almacen} placeholder="Vacío = todos los autorizados" maxLength={10} onChange={e=>{setAlmacen(e.target.value.toUpperCase());setRespuesta(null);setPagina(1)}}/></label>
          {(esMateriales || esEquipos) && <label style={s.campo}>{esMateriales?'Técnico':'Técnico responsable'}<input style={s.input} readOnly value={almacen ? tecnicoResuelto : 'Todos los técnicos autorizados'} placeholder="Automático por almacén"/></label>}
          {esEquipos && <label style={s.campo}>Estado<select style={s.input} value={estado} onChange={e=>{setEstado(e.target.value);setRespuesta(null);setPagina(1)}}><option value="">Todos</option><option value="EN_TIEMPO">Equipo en Tiempo (menos de 15 días)</option><option value="FUERA_TIEMPO">Equipos fuera de tiempo (15 a 30 días)</option><option value="CRITICO">Equipo Crítico (más de 30 días)</option></select></label>}
          {esMateriales && <label style={s.campo}>SKU, material o grupo<input style={s.input} value={buscador} placeholder="Escribe SKU, material o grupo" onChange={e=>{setBuscador(e.target.value);setRespuesta(null);setPagina(1)}}/></label>}
          {esEquipos && <label style={{...s.campo,gridColumn:'1 / -1'}}>Serie (opcional)<input style={s.input} value={serie} placeholder="Escanea o captura la serie" onChange={e=>{setSerie(e.target.value.toUpperCase());setRespuesta(null);setPagina(1)}}/></label>}
        </div>
        <div style={s.acciones}>
          {esMateriales ? <>{btn('Buscar todo',()=>{setSoloCoincidencias(false); consultar(1,almacen,'')},false,cargando)}{btn('Buscar material o grupo',()=>{setSoloCoincidencias(true);consultar(1,almacen,buscador)},false,cargando)} </> : btn('Buscar',()=>consultar(1,almacen),false,cargando)}
          {esEquipos && <>{btn('Enviar por WhatsApp',compartirWhatsapp,true,!respuesta||cambiosEquiposPendientes||exportando)}{btn('Descargar Excel',()=>exportar('Excel'),true,!respuesta||cambiosEquiposPendientes||exportando)}</>}
          {!esEquipos && respuesta && <>{btn('Excel',()=>exportar('Excel'),true,exportando)}{btn('PDF',()=>exportar('PDF'),true,exportando)}</>}
        </div>
        <p style={s.aviso}>Técnicos - Materiales excluye TPE USADO; SKU, nombre y grupo se buscan en Supabase antes de paginar, con grupos del catálogo dinámico. Equipos filtra por estado y serie en Supabase antes de paginar; al cambiar un filtro se limpia la consulta anterior y debes presionar Buscar; Excel y WhatsApp respetan los filtros consultados. Los estados son excluyentes: 0 a 14 días en tiempo, 15 a 30 días fuera de tiempo y desde 31 días crítico. WhatsApp abre el mensaje para confirmar el envío.</p>{cambiosEquiposPendientes && <p style={s.aviso}>Cambiaste los filtros. Pulsa Buscar para actualizar la consulta antes de exportar o enviar.</p>}
      </section>
      {error && <p role="alert" style={s.error}>{error}</p>}{advertencia && <p style={s.aviso}>{advertencia}</p>}
      <section style={s.panelOscuro}>
        {respuesta && <p style={{...s.aviso,marginTop:0}}>Almacén: {respuesta.almacen || 'Autorizados'} · {esEquipos ? `${respuesta.total_sin_estado ?? respuesta.total} equipos de la consulta · ${respuesta.total} coinciden con el filtro · ${filas.length} en esta página` : `${respuesta.total} registros coinciden con la búsqueda · ${filas.length} en esta página`}</p>}
        <div style={s.tablaWrap}><table style={s.tabla}><thead><tr>{columnas.map(([k,t])=><th key={k} style={s.th}>{t}</th>)}</tr></thead><tbody>
        {respuesta ? filas.map((fila,i)=><tr key={i}>{columnas.map(([campo])=><td style={s.td} key={campo}>{String(fila[campo] ?? (campo==='dias'?'Sin fecha':'-'))}</td>)}</tr>) : <tr><td colSpan={columnas.length} style={s.vacio}>Sin consulta realizada.</td></tr>}
        {respuesta && !filas.length && <tr><td colSpan={columnas.length} style={s.vacio}>No hay registros que coincidan con los filtros aplicados.</td></tr>}
        </tbody></table></div>
        {respuesta && <div style={s.paginacion}><button style={s.secVerde} disabled={cargando||pagina<=1||cambiosEquiposPendientes} onClick={()=>consultar(pagina-1,filtroAplicado)}>Anterior</button><span>Página {pagina} de {totalPaginas}</span><button style={s.secVerde} disabled={cargando||pagina>=totalPaginas||cambiosEquiposPendientes} onClick={()=>consultar(pagina+1,filtroAplicado)}>Siguiente</button></div>}
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
