'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const MENU = [
  ['Accesos especiales',null],['WhatsApp destino',null],['Actualizar máximos','catalogos'],
  ['Materiales','materiales'],['Distritos',null],['Horarios',null],
  ['Costos SAP','costos_sap'],['Costos ODOO','costos_odoo'],['Exportar fechas',null],
  ['Recarga UTP',null],['Ver cargas UTP',null],['Usuarios',null],['Permisos',null],
  ['Ver justificaciones UTP',null],['PDF equipos admin',null],['Visibilidad BRM',null],
  ['RECUS TP',null],['Actualizar macro Excel',null],['Grupos de materiales','grupos_materiales']
]
const CAMPOS = {
  costos_sap: [['sku','SKU'],['material','Material'],['costo_unitario','Costo unitario'],['activo','Activo']],
  costos_odoo: [['sku','SKU'],['herramienta','Herramienta'],['costo','Costo'],['vida_util_meses','Vida útil (meses)'],['activo','Activo']],
  materiales: [['sku','SKU'],['material','Material'],['tipo','Tipo'],['grupo','Grupo'],['maximo','Máximo'],['activo','Activo']],
  grupos_materiales: [['grupo','Grupo'],['tipo','Tipo'],['maximo','Máximo'],['activo','Activo']]
}
const nombres = {costos_sap:'Costos SAP',costos_odoo:'Costos ODOO',materiales:'Materiales',grupos_materiales:'Grupos de materiales'}
const normal = x=>String(x??'').toLocaleUpperCase('es-MX')
const nuevo = ()=>({sku:'',material:'',herramienta:'',costo:'',vida_util_meses:'12',activo:true})

export default function ConfiguracionPage(){
  const router=useRouter()
  const [validando,setValidando]=useState(true)
  const [permitido,setPermitido]=useState(false)
  const [seccion,setSeccion]=useState('')
  const [filas,setFilas]=useState([])
  const [busqueda,setBusqueda]=useState('')
  const [form,setForm]=useState(nuevo())
  const [cargando,setCargando]=useState(false)
  const [error,setError]=useState('')
  const [aviso,setAviso]=useState('')

  useEffect(()=>{let vivo=true;(async()=>{
    try {
      const {data:{user},error:a}=await supabase.auth.getUser()
      if(a||!user){router.replace('/');return}
      const {data,error:e}=await supabase.rpc('qiora_config_es_admin')
      if(e)throw e
      if(vivo)setPermitido(data===true)
    }catch(e){if(vivo)setError(e.message||'No se pudo validar el acceso')}
    finally{if(vivo)setValidando(false)}
  })();return()=>{vivo=false}},[router])

  const cargar=useCallback(async(tipo)=>{
    if(!tipo)return
    setCargando(true);setError('');setAviso('')
    try{
      const {data,error:e}=await supabase.rpc('qiora_config_listar',{p_catalogo:tipo})
      if(e)throw e
      setFilas(Array.isArray(data?.filas)?data.filas:[])
    }catch(e){setError(e.message||'Error al cargar');setFilas([])}
    finally{setCargando(false)}
  },[])

  function abrir(tipo){
    if(tipo==='catalogos'){router.push('/inventarios/catalogos');return}
    setSeccion(tipo);setForm(nuevo());setBusqueda('');cargar(tipo)
  }
  function editar(f){setForm({sku:f.sku||'',material:f.material||'',herramienta:f.herramienta||'',costo:String(f.costo_unitario??f.costo??''),vida_util_meses:String(f.vida_util_meses??12),activo:f.activo!==false})}
  async function guardar(e){
    e.preventDefault();setError('');setAviso('');setCargando(true)
    try{
      if(!form.sku.trim())throw new Error('Captura SKU')
      if(form.costo===''||!Number.isFinite(Number(form.costo))||Number(form.costo)<0)throw new Error('Captura un costo válido')
      const {error:x}=await supabase.rpc('qiora_config_guardar_costo',{p_catalogo:seccion,p_registro:form})
      if(x)throw x
      setAviso('Registro guardado en Supabase')
      setForm(nuevo())
      await cargar(seccion)
    }catch(x){setError(x.message||'No se pudo guardar')}
    finally{setCargando(false)}
  }
  const disponibles=filas.filter(f=>Object.values(f).some(v=>normal(v).includes(normal(busqueda))))
  const editable=seccion==='costos_sap'||seccion==='costos_odoo'
  return <main style={s.base}><div style={s.marco}>
    <button style={s.regresar} onClick={()=>seccion?setSeccion(''):router.push('/')}>← {seccion?'Regresar a Configuración':'Regresar a Acceso Almacén'}</button>
    <header style={s.hero}><h1 style={{margin:0}}>{seccion?nombres[seccion]:'⚙ Configuración'}</h1><p style={{margin:'6px 0 0'}}> {seccion?'Administración de catálogos en Supabase':'Configuración del módulo Acceso Almacén'}</p></header>
    {error&&<p role="alert" style={s.error}>{error}</p>}
    {aviso&&<p role="status" style={s.exito}>{aviso}</p>}
    {validando?<p>Validando permisos...</p>:!permitido?<p>No tienes permisos administrativos para Configuración.</p>:!seccion?
    <section style={s.panel}><h3>Menú configuración</h3><div style={s.menu}>{MENU.map(([label,tipo])=><button key={label} style={{...s.opcion,opacity:tipo?1:.68}} onClick={()=>tipo?abrir(tipo):setAviso('El módulo «'+label+'» todavía no está implementado en esta versión web.')} type="button">{label}</button>)}</div></section>:
    <section style={s.panel}>
      <div style={s.herramientas}><input style={s.input} value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar SKU, descripción o grupo"/><button style={s.boton} disabled={cargando} onClick={()=>cargar(seccion)}>Actualizar</button></div>
      <p style={s.nota}>{filas.length} registros del catálogo. {editable?'Los cambios se guardan en Supabase.':'Para editar este catálogo utiliza la pantalla de Materiales y Grupos ya instalada.'}</p>
      {editable&&<form onSubmit={guardar} style={s.formulario}>
        <label>SKU<input required style={s.input} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></label>
        <label>{seccion==='costos_sap'?'Material':'Herramienta'}<input style={s.input} value={seccion==='costos_sap'?form.material:form.herramienta} onChange={e=>setForm({...form,[seccion==='costos_sap'?'material':'herramienta']:e.target.value})}/></label>
        <label>Costo<input required min="0" step="0.0001" type="number" style={s.input} value={form.costo} onChange={e=>setForm({...form,costo:e.target.value})}/></label>
        {seccion==='costos_odoo'&&<label>Vida útil en meses<input required min="1" type="number" style={s.input} value={form.vida_util_meses} onChange={e=>setForm({...form,vida_util_meses:e.target.value})}/></label>}
        <label style={{alignSelf:'center'}}>Activo <input type="checkbox" checked={form.activo} onChange={e=>setForm({...form,activo:e.target.checked})}/></label>
        <button disabled={cargando} type="submit" style={s.boton}>{cargando?'Guardando...':'Guardar costo'}</button>
        <button type="button" style={s.boton} onClick={()=>setForm(nuevo())}>Nuevo</button>
      </form>}
      <div style={{overflowX:'auto'}}><table style={s.tabla}><thead><tr>{(CAMPOS[seccion]||[]).map(([key,n])=><th style={s.th} key={key}>{n}</th>)}{editable&&<th style={s.th}>Acción</th>}</tr></thead><tbody>
      {disponibles.map((f,i)=><tr key={(f.sku||f.grupo||'')+i}>{(CAMPOS[seccion]||[]).map(([key])=><td style={s.td} key={key}>{key==='activo'?(f.activo?'Sí':'No'):String(f[key]??'')}</td>)}{editable&&<td style={s.td}><button style={s.boton} onClick={()=>editar(f)}>Editar</button></td>}</tr>)}
      {disponibles.length===0&&<tr><td style={s.td} colSpan={(CAMPOS[seccion]||[]).length+1}>No hay registros.</td></tr>}
      </tbody></table></div>
      {!editable&&<button style={s.boton} onClick={()=>router.push('/inventarios/catalogos')}>Abrir administración de materiales y grupos</button>}
    </section>}
  </div></main>
}
const s={
 base:{minHeight:'100vh',background:'#062d23',color:'#fff',padding:16,fontFamily:'Arial,sans-serif'},
 marco:{maxWidth:1200,margin:'auto',border:'1px solid #487d6c',borderRadius:16,padding:20,background:'#06271f'},
 regresar:{border:0,borderRadius:30,padding:'10px 15px',background:'#118366',color:'#fff',fontWeight:700,cursor:'pointer',marginBottom:12},
 hero:{background:'linear-gradient(120deg,#10533f,#18a67b)',padding:25,textAlign:'center',borderRadius:14,marginBottom:18},
 panel:{border:'1px solid #406f62',padding:16,borderRadius:14,background:'#0b3028'},
 menu:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12},
 opcion:{background:'#159b76',color:'#fff',minHeight:70,border:0,borderRadius:11,fontWeight:700,cursor:'pointer'},
 herramientas:{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'},
 formulario:{display:'flex',flexWrap:'wrap',alignItems:'end',gap:12,margin:'18px 0'},
 input:{display:'block',padding:10,minWidth:160,background:'#fff',color:'#142f24',borderRadius:7,border:'1px solid #bdd4ca',marginTop:5},
 boton:{padding:'10px 14px',background:'#118e6d',color:'#fff',border:0,borderRadius:8,fontWeight:700,cursor:'pointer'},
 tabla:{borderCollapse:'collapse',width:'100%',background:'#f8fdfa',color:'#143126',marginBottom:12},
 th:{padding:9,background:'#0d7659',color:'#fff',border:'1px solid #add0c1'},
 td:{padding:9,border:'1px solid #c8ded4'},
 nota:{color:'#cce5dc',fontSize:13},error:{background:'#ffe1e1',color:'#822',padding:12,borderRadius:8},
 exito:{background:'#dbffdf',color:'#174a25',padding:12,borderRadius:8}
}
