'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const MENU = [
  ['Accesos especiales',null],['WhatsApp destino',null],['Actualizar máximos','catalogos'],
  ['Materiales','materiales'],['Distritos','distritos'],['Horarios',null],
  ['Costos SAP','costos_sap'],['Costos ODOO','costos_odoo'],['Herramienta ODOO','herramienta_odoo_inventario'],['Exportar fechas',null],
  ['Recarga UTP',null],['Ver cargas UTP',null],['Usuarios','usuarios'],['Permisos',null],
  ['Ver justificaciones UTP',null],['PDF equipos admin',null],['Visibilidad BRM',null],
  ['RECUS TP',null],['Actualizar macro Excel',null],['Grupos de materiales','grupos_materiales']
]
const CAMPOS = {
  costos_sap: [['sku','SKU'],['material','Material'],['costo_unitario','Costo unitario'],['activo','Activo']],
  herramienta_odoo_inventario: [['no_empleado','No. empleado'],['colaborador','Colaborador'],['referencia','Referencia'],['producto','Producto'],['cantidad','Cantidad'],['valor_compra','Valor compra (total)'],['valor_actual','Valor actual (total)'],['estado','Estado']],
  costos_odoo: [['sku','SKU'],['herramienta','Herramienta'],['costo','Costo'],['vida_util_meses','Vida útil (meses)'],['activo','Activo']],
  materiales: [['sku','SKU'],['material','Material'],['tipo','Tipo'],['grupo','Grupo'],['maximo','Máximo'],['activo','Activo']],
  grupos_materiales: [['grupo','Grupo'],['tipo','Tipo'],['maximo','Máximo'],['activo','Activo']]
}
const nombres = {distritos:'Administrar Distritos',usuarios:'Usuarios / Número de empleado',costos_sap:'Costos SAP',costos_odoo:'Costos ODOO',herramienta_odoo_inventario:'Herramienta ODOO por colaborador',materiales:'Materiales',grupos_materiales:'Grupos de materiales'}
const normal = x=>String(x??'').toLocaleUpperCase('es-MX')
const textoNumero = x=>String(x??'').trim()
const nuevo = ()=>({sku:'',material:'',herramienta:'',costo:'',vida_util_meses:'12',activo:true})

export default function ConfiguracionPage(){
  const router=useRouter()
  const desplazamientoArriba=useRef(null)
  const desplazamientoTabla=useRef(null)
  const [validando,setValidando]=useState(true)
  const [usuarios,setUsuarios]=useState([])
  const [guardandoUsuario,setGuardandoUsuario]=useState('')
  const [permitido,setPermitido]=useState(false)
  const [seccion,setSeccion]=useState('')
  const [filas,setFilas]=useState([])
  const [busqueda,setBusqueda]=useState('')
  const [pagina,setPagina]=useState(1)
  const [total,setTotal]=useState(0)
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
      const inventario=tipo==='herramienta_odoo_inventario'
      const {data,error:e}=inventario?await supabase.rpc('qiora_herramienta_odoo_listar',{p_buscar:busqueda,p_pagina:pagina,p_limite:100}):await supabase.rpc('qiora_config_listar',{p_catalogo:tipo})
      if(e)throw e
      setFilas(Array.isArray(data?.filas)?data.filas:[])
      setTotal(Number(data?.total||0))
    }catch(e){setError(e.message||'Error al cargar');setFilas([])}
    finally{setCargando(false)}
  },[busqueda,pagina])

  const [permisosDisponibles,setPermisosDisponibles]=useState([])
  const [usuarioEditando,setUsuarioEditando]=useState(null)
  const [filtroActivos,setFiltroActivos]=useState('TODOS')
  const [creandoUsuario,setCreandoUsuario]=useState(false)
  const [nuevoUsuario,setNuevoUsuario]=useState({usuario_almacen:'',clave:'',nombre:'',telefono:'',puesto:'TECNICO',numero_empleado:'',correo:'',coordinador:'',usuario_ffm:'',fecha_nacimiento:'',activo:true,permisos:{}})
  const [guardandoFicha,setGuardandoFicha]=useState(false)
  const [esPadre,setEsPadre]=useState(false)
  const [distritos,setDistritos]=useState([])
  const [distritoEditando,setDistritoEditando]=useState('')
  const [distritoForm,setDistritoForm]=useState({centro:'',nombre_region:'',token_excel:'',activo:true})
  const [guardandoDistrito,setGuardandoDistrito]=useState(false)
  async function cargarDistritos(){
    setCargando(true);setError('')
    try{
      const {data,error:e}=await supabase.rpc('qiora_distritos_listar')
      if(e)throw e
      setDistritos(Array.isArray(data)?data:[])
    }catch(e){setError(e.message||'No se pudieron cargar los distritos')}
    finally{setCargando(false)}
  }
  async function guardarDistrito(){
    if(guardandoDistrito)return
    setGuardandoDistrito(true);setError('');setAviso('')
    try{
      const centro=String(distritoForm.centro||'').trim().toUpperCase()
      const nombre=String(distritoForm.nombre_region||'').trim()
      if(!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro))throw new Error('Centro inválido. Ejemplo: MG13, ME13 o MG19.')
      if(!nombre)throw new Error('Captura Nombre o Región.')
      const {error:e}=await supabase.rpc('qiora_distritos_guardar',{
        p_centro:centro,p_nombre_region:nombre,p_token_excel:distritoForm.token_excel||null,
        p_activo:distritoForm.activo,p_centro_original:distritoEditando||null
      })
      if(e)throw e
      setDistritoEditando('');setDistritoForm({centro:'',nombre_region:'',token_excel:'',activo:true})
      await cargarDistritos()
      setAviso('Distrito guardado correctamente. El token nunca se muestra en pantalla.')
    }catch(e){setError(e.message||'No se pudo guardar el distrito')}
    finally{setGuardandoDistrito(false)}
  }
  function editarDistrito(d){
    setDistritoEditando(d.centro)
    setDistritoForm({centro:d.centro,nombre_region:d.nombre_region,token_excel:'',activo:d.activo})
    setAviso('Por seguridad, el token no se recupera. Deja TOKEN_EXCEL vacío para conservar el actual.')
  }
  async function cargarUsuarios(){
    setCargando(true);setError('');setAviso('')
    try {
      const {data,error:e}=await supabase.rpc('qiora_usuarios_administracion_listar')
      if(e)throw e
      setUsuarios(Array.isArray(data?.usuarios)?data.usuarios:[])
      setPermisosDisponibles(Array.isArray(data?.permisos)?data.permisos:[])
    } catch(e){setError(e.message||'No se pudieron cargar usuarios')}
    finally{setCargando(false)}
  }
  async function crearCuentaUsuario(){
    if(guardandoFicha)return
    setGuardandoFicha(true);setError('');setAviso('')
    try{
      if(!textoNumero(nuevoUsuario.usuario_almacen)||!nuevoUsuario.clave||!textoNumero(nuevoUsuario.nombre))throw new Error('Usuario, clave y nombre son obligatorios.')
      const {data:{session},error:sessionError}=await supabase.auth.getSession()
      if(sessionError||!session?.access_token)throw new Error('La sesión expiró. Inicia sesión nuevamente.')
      const response=await fetch('/api/usuarios/crear',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify(nuevoUsuario)
      })
      const resultado=await response.json().catch(()=>({}))
      if(!response.ok||!resultado.ok)throw new Error(resultado.error||'No se pudo crear el usuario')
      setCreandoUsuario(false)
      setNuevoUsuario({usuario_almacen:'',clave:'',nombre:'',telefono:'',puesto:'TECNICO',numero_empleado:'',correo:'',coordinador:'',usuario_ffm:'',fecha_nacimiento:'',activo:true,permisos:{}})
      await cargarUsuarios()
      setAviso('Cuenta creada en Supabase Auth y Usuarios.')
    }catch(e){setError(e.message||'No se pudo crear el usuario')}
    finally{setGuardandoFicha(false)}
  }
  const cambiarNuevo=(campo,valor)=>setNuevoUsuario(u=>({...u,[campo]:valor}))
  function editarUsuario(u){
    setUsuarioEditando({...u, permisos:{...(u.permisos||{})}})
    setError('');setAviso('')
    window.scrollTo({top:0,behavior:'smooth'})
  }
  async function guardarFichaUsuario(){
    if(!usuarioEditando||guardandoFicha)return
    setGuardandoFicha(true);setError('');setAviso('')
    try {
      const {data,error:e}=await supabase.rpc('qiora_usuarios_administracion_guardar',{
        p_id:String(usuarioEditando.id),
        p_datos:{nombre:usuarioEditando.nombre,telefono:usuarioEditando.telefono,
          puesto:usuarioEditando.puesto,correo:usuarioEditando.correo,
          coordinador:usuarioEditando.coordinador,numero_empleado:usuarioEditando.numero_empleado,
          usuario_ffm:usuarioEditando.usuario_ffm,fecha_nacimiento:usuarioEditando.fecha_nacimiento,
          activo:usuarioEditando.activo,permisos:usuarioEditando.permisos}
      })
      if(e)throw e
      if(data!==true)throw new Error('No se confirmó el guardado')
      setUsuarioEditando(null)
      await cargarUsuarios()
      setAviso('Usuario y permisos actualizados correctamente.')
    }catch(e){setError(e.message||'No se pudo guardar el usuario')}
    finally{setGuardandoFicha(false)}
  }
  async function cambiarEstadoUsuario(u){
    if(!window.confirm(`¿${u.activo?'Desactivar':'Activar'} a ${u.nombre}?`))return
    setGuardandoFicha(true);setError('')
    try{
      const {error:e}=await supabase.rpc('qiora_usuarios_administracion_guardar',{
        p_id:String(u.id),p_datos:{activo:!u.activo}
      })
      if(e)throw e
      await cargarUsuarios()
      setAviso('Estado de usuario actualizado.')
    }catch(e){setError(e.message||'No se pudo actualizar el estado')}
    finally{setGuardandoFicha(false)}
  }
  const editarCampoUsuario=(campo,valor)=>setUsuarioEditando(u=>({...u,[campo]:valor}))
  const permisosActivos=usuarioEditando?Object.values(usuarioEditando.permisos||{}).filter(Boolean).length:0
  function abrir(tipo){
    if(tipo==='catalogos'){router.push('/inventarios/catalogos');return}
    setSeccion(tipo);setForm(nuevo());setBusqueda('');setPagina(1)
    if(tipo==='usuarios')cargarUsuarios()
    else if(tipo==='distritos'){supabase.rpc('qiora_distritos_es_padre').then(({data,error:e})=>{setEsPadre(!e&&data===true);if(e)setError(e.message);else if(data===true)cargarDistritos()})}
    else if(tipo!=='herramienta_odoo_inventario')cargar(tipo)
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
  useEffect(()=>{if(seccion==='herramienta_odoo_inventario')cargar(seccion)},[seccion,cargar])
  const disponibles=filas.filter(f=>Object.values(f).some(v=>normal(v).includes(normal(busqueda))))
  const editable=seccion==='costos_sap'||seccion==='costos_odoo'
  return <main style={s.base}><div style={s.marco}>
    <div style={s.cabeceraFija}><button style={s.regresar} onClick={()=>seccion?setSeccion(''):router.push('/')}>← {seccion?'Regresar a Configuración':'Regresar a Acceso Almacén'}</button>
    <header style={s.hero}><h1 style={{margin:0}}>{seccion?nombres[seccion]:'⚙ Configuración'}</h1><p style={{margin:'6px 0 0'}}> {seccion?'Administración de catálogos en Supabase':'Configuración del módulo Acceso Almacén'}</p></header></div>
    {error&&<p role="alert" style={s.error}>{error}</p>}
    {aviso&&<p role="status" style={s.exito}>{aviso}</p>}
    {validando?<p>Validando permisos...</p>:!permitido?<p>No tienes permisos administrativos para Configuración.</p>:!seccion?
    <section style={s.panel}><h3>Menú configuración</h3><div style={s.menu}>{MENU.map(([label,tipo])=><button key={label} style={{...s.opcion,opacity:tipo?1:.68}} onClick={()=>tipo?abrir(tipo):setAviso('El módulo «'+label+'» todavía no está implementado en esta versión web.')} type="button">{label}</button>)}</div></section>:
    seccion==='distritos' ? <section style={s.panel}>
      <h2>Administrar Distritos</h2>
      {!esPadre?<p style={s.error}>Acceso restringido. Solo ADMIN_PADRE puede consultar y configurar distritos.</p>:<>
        <p style={s.nota}>Centro, Nombre o Región y TOKEN_EXCEL. Los tokens existentes se mantienen ocultos. Los usuarios y sus distritos actuales se conservan.</p>
        <div style={s.cuadriculaUsuarios}>
          <label>Centro<input style={{...s.input,width:'100%',boxSizing:'border-box'}} maxLength={10} placeholder="MG13" value={distritoForm.centro} disabled={!!distritoEditando} onChange={e=>setDistritoForm(f=>({...f,centro:e.target.value.toUpperCase()}))}/></label>
          <label>Nombre o Región<input style={{...s.input,width:'100%',boxSizing:'border-box'}} maxLength={150} value={distritoForm.nombre_region} onChange={e=>setDistritoForm(f=>({...f,nombre_region:e.target.value}))}/></label>
          <label>TOKEN_EXCEL (oculto al guardar)<input style={{...s.input,width:'100%',boxSizing:'border-box'}} type="password" autoComplete="new-password" placeholder={distritoEditando?'Dejar vacío para conservar token':'Ingresar token'} value={distritoForm.token_excel} onChange={e=>setDistritoForm(f=>({...f,token_excel:e.target.value}))}/></label>
          <label>Estado<select style={s.input} value={distritoForm.activo?'SI':'NO'} onChange={e=>setDistritoForm(f=>({...f,activo:e.target.value==='SI'}))}><option value="SI">ACTIVO</option><option value="NO">NO ACTIVO</option></select></label>
        </div>
        <div style={s.herramientas}>
          <button style={s.boton} disabled={guardandoDistrito} onClick={guardarDistrito}>{guardandoDistrito?'Guardando...':distritoEditando?'Guardar cambios':'Crear distrito'}</button>
          <button style={s.regresar} onClick={()=>{setDistritoEditando('');setDistritoForm({centro:'',nombre_region:'',token_excel:'',activo:true})}}>Limpiar / Nuevo</button>
          <button style={s.boton} onClick={cargarDistritos}>Actualizar lista</button>
        </div>
        <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'60vh'}}><table style={{...s.tabla,minWidth:850}}><thead><tr>{['Centro','Nombre o Región','Activo','TOKEN_EXCEL','Acciones'].map(h=><th style={s.th} key={h}>{h}</th>)}</tr></thead><tbody>
          {distritos.map(d=><tr key={d.centro}><td style={s.td}>{d.centro}</td><td style={s.td}>{d.nombre_region}</td><td style={s.td}>{d.activo?'SI':'NO ACTIVO'}</td><td style={s.td}>{d.tiene_token?'CONFIGURADO (OCULTO)':'SIN CONFIGURAR'}</td><td style={s.td}><button style={s.boton} onClick={()=>editarDistrito(d)}>Editar</button></td></tr>)}
          {!distritos.length&&<tr><td colSpan={5} style={s.td}>No hay distritos registrados.</td></tr>}
        </tbody></table></div>
      </>}
    </section> : seccion==='usuarios' ? <section style={s.panel}>
      <h2>Gestión de Usuarios</h2>
      <p style={s.nota}>Consulta, edita y administra los permisos por módulo. Se conservan los usuarios y el inventario existente. Los usuarios dados de baja permanecen visibles.</p>
      <div style={s.herramientas}><button type="button" style={s.boton} onClick={()=>{setCreandoUsuario(x=>!x);setUsuarioEditando(null)}}>{creandoUsuario?'Cancelar creación':'＋ Crear usuario'}</button></div>
      {creandoUsuario&&<div style={{...s.panel,marginBottom:18}}>
        <h3>Crear nuevo usuario</h3>
        <p style={s.nota}>El usuario se crea en Supabase Auth y en ALMACEN_USUARIOS. El distrito se asigna desde la sesión del administrador.</p>
        <div style={s.cuadriculaUsuarios}>
          {[['usuario_almacen','Usuario / Almacén'],['clave','Clave de acceso'],['nombre','Nombre completo'],['telefono','Teléfono'],['puesto','Puesto'],['numero_empleado','Número de empleado'],['correo','Correo de contacto'],['coordinador','Coordinador'],['usuario_ffm','Usuario FFM']].map(([campo,label])=><label key={campo}>{label}<input style={{...s.input,width:'100%',boxSizing:'border-box'}} type={campo==='clave'?'password':'text'} autoComplete={campo==='clave'?'new-password':'off'} value={nuevoUsuario[campo]} onChange={e=>cambiarNuevo(campo,e.target.value)}/></label>)}
          {[['fecha_nacimiento','Fecha de nacimiento']].map(([campo,label])=><label key={campo}>{label}<input type="date" style={{...s.input,width:'100%',boxSizing:'border-box'}} value={nuevoUsuario[campo]} onChange={e=>cambiarNuevo(campo,e.target.value)}/></label>)}
          <label>Activo<select style={s.input} value={nuevoUsuario.activo?'SI':'NO'} onChange={e=>cambiarNuevo('activo',e.target.value==='SI')}><option value="SI">SI</option><option value="NO">NO</option></select></label>
        </div>
        <h3>Permisos del nuevo usuario</h3>
        <div style={s.permisosGrid}>{permisosDisponibles.map(p=><label key={p.campo} style={s.permiso}><input type="checkbox" checked={nuevoUsuario.permisos?.[p.campo]===true} onChange={e=>setNuevoUsuario(u=>({...u,permisos:{...u.permisos,[p.campo]:e.target.checked}}))}/>{p.nombre}</label>)}</div>
        <div style={s.herramientas}><button type="button" style={s.boton} disabled={guardandoFicha} onClick={crearCuentaUsuario}>{guardandoFicha?'Creando cuenta...':'Guardar nuevo usuario'}</button><button type="button" style={s.regresar} onClick={()=>setCreandoUsuario(false)}>Cancelar</button></div>
      </div>}
      {usuarioEditando&&<div style={{...s.panel,marginBottom:18}}>
        <h3>Editar usuario: {usuarioEditando.usuario_almacen}</h3>
        <div style={s.cuadriculaUsuarios}>
          <label>Usuario / Almacén<input style={s.input} value={usuarioEditando.usuario_almacen||''} readOnly /></label>
          <label>Activo<select style={s.input} value={usuarioEditando.activo?'SI':'NO'} onChange={e=>editarCampoUsuario('activo',e.target.value==='SI')}><option value="SI">SI</option><option value="NO">NO</option></select></label>
          {[['nombre','Nombre'],['telefono','Teléfono'],['puesto','Puesto'],['numero_empleado','Número de empleado'],['correo','Correo'],['coordinador','Coordinador'],['usuario_ffm','Usuario FFM']].map(([campo,nombre])=><label key={campo}>{nombre}<input style={{...s.input,width:'100%',boxSizing:'border-box'}} value={usuarioEditando[campo]||''} onChange={e=>editarCampoUsuario(campo,e.target.value)}/></label>)}
          <label>Distrito<input readOnly style={s.input} value={usuarioEditando.distrito||''}/></label>
          {[['fecha_nacimiento','Fecha de nacimiento']].map(([campo,nombre])=><label key={campo}>{nombre}<input type="date" style={{...s.input,width:'100%',boxSizing:'border-box'}} value={usuarioEditando[campo]||''} onChange={e=>editarCampoUsuario(campo,e.target.value)}/></label>)}
        </div>
        <h3>Permisos por botón / columnas ALMACEN_USUARIOS</h3>
        <p style={s.nota}>Permisos seleccionados: {permisosActivos} de {permisosDisponibles.length}. Solo se muestran permisos existentes en tu base de datos.</p>
        <div style={s.permisosGrid}>{permisosDisponibles.map(p=><label key={p.campo} style={s.permiso}><input type="checkbox" checked={usuarioEditando.permisos?.[p.campo]===true} onChange={e=>setUsuarioEditando(u=>({...u,permisos:{...u.permisos,[p.campo]:e.target.checked}}))}/>{p.nombre}</label>)}</div>
        <div style={s.herramientas}><button type="button" style={s.boton} disabled={guardandoFicha} onClick={guardarFichaUsuario}>{guardandoFicha?'Guardando...':'Guardar usuario y permisos'}</button><button type="button" style={s.regresar} onClick={()=>setUsuarioEditando(null)}>Cancelar</button></div>
      </div>}
      <div style={s.herramientas}>
        <input style={s.input} placeholder="Buscar usuario, número de empleado, nombre o almacén" value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
        <select style={s.input} value={filtroActivos} onChange={e=>setFiltroActivos(e.target.value)}><option value="TODOS">Todos los usuarios</option><option value="SI">Activos</option><option value="NO">No activos</option></select>
        <button type="button" style={s.boton} disabled={cargando} onClick={cargarUsuarios}>Buscar / Actualizar</button>
      </div>
      <p style={s.nota}>{usuarios.filter(u=>(filtroActivos==='TODOS'||(u.activo?'SI':'NO')===filtroActivos)&&normal([u.usuario_almacen,u.nombre,u.numero_empleado,u.usuario_ffm,u.telefono,u.puesto].join(' ')).includes(normal(busqueda))).length} usuario(s) encontrados.</p>
      <div ref={desplazamientoArriba} style={s.barraSuperior} onScroll={e=>{if(desplazamientoTabla.current)desplazamientoTabla.current.scrollLeft=e.currentTarget.scrollLeft}}><div style={{width:2100,height:1}}/></div>
      <div ref={desplazamientoTabla} style={s.tablaDesplazable} onScroll={e=>{if(desplazamientoArriba.current)desplazamientoArriba.current.scrollLeft=e.currentTarget.scrollLeft}}><table style={s.tabla}><thead><tr>
        {['Usuario / Almacén','Nombre','Teléfono','Puesto','Distrito','Número de empleado','Usuario FFM','Nacimiento','Correo','Activo','Permisos','Acción'].map(h=><th key={h} style={s.th}>{h}</th>)}
      </tr></thead><tbody>
      {usuarios.filter(u=>(filtroActivos==='TODOS'||(u.activo?'SI':'NO')===filtroActivos)&&normal([u.usuario_almacen,u.nombre,u.numero_empleado,u.usuario_ffm,u.telefono,u.puesto].join(' ')).includes(normal(busqueda))).map(u=><tr key={u.id}>
        {[u.usuario_almacen,u.nombre,u.telefono,u.puesto,u.distrito,u.numero_empleado,u.usuario_ffm,u.fecha_nacimiento,u.correo].map((v,i)=><td style={s.td} key={i}>{v||'-'}</td>)}
        <td style={s.td}><strong style={{color:u.activo?'#087e55':'#b91c1c'}}>{u.activo?'SI':'NO ACTIVO'}</strong></td>
        <td style={s.td}>{Object.values(u.permisos||{}).filter(Boolean).length} permisos</td>
        <td style={s.td}><div style={{display:'flex',gap:6}}><button type="button" style={s.boton} onClick={()=>editarUsuario(u)}>Editar</button><button type="button" disabled={guardandoFicha} style={{...s.boton,background:u.activo?'#b91c1c':'#176b4d'}} onClick={()=>cambiarEstadoUsuario(u)}>{u.activo?'Desactivar':'Activar'}</button></div></td>
      </tr>)}
      </tbody></table></div>
      <p style={s.nota}>Las cuentas nuevas requieren la variable SUPABASE_SERVICE_ROLE_KEY exclusivamente en Vercel. No se exponen claves administrativas al navegador. La desactivación conserva el historial.</p>
    </section> : <section style={s.panel}>
      <div style={s.herramientas}><input style={s.input} value={busqueda} onChange={e=>{setBusqueda(e.target.value);setPagina(1)}} placeholder="Buscar SKU, descripción o grupo"/><button style={s.boton} disabled={cargando} onClick={()=>cargar(seccion)}>Actualizar</button></div>
      <p style={s.nota}>{seccion==='herramienta_odoo_inventario'?`${total} registros del inventario. Página ${pagina}. Valores de compra y actual corresponden al renglón, no al costo unitario.`:`${filas.length} registros del catálogo.`} {editable?'Los cambios se guardan en Supabase.':seccion==='herramienta_odoo_inventario'?'Inventario de consulta, importado desde Excel.':'Para editar este catálogo utiliza la pantalla de Materiales y Grupos ya instalada.'}</p>
      {editable&&<form onSubmit={guardar} style={s.formulario}>
        <label>SKU<input required style={s.input} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></label>
        <label>{seccion==='costos_sap'?'Material':'Herramienta'}<input style={s.input} value={seccion==='costos_sap'?form.material:form.herramienta} onChange={e=>setForm({...form,[seccion==='costos_sap'?'material':'herramienta']:e.target.value})}/></label>
        <label>Costo<input required min="0" step="0.0001" type="number" style={s.input} value={form.costo} onChange={e=>setForm({...form,costo:e.target.value})}/></label>
        {seccion==='costos_odoo'&&<label>Vida útil en meses<input required min="0" type="number" style={s.input} value={form.vida_util_meses} onChange={e=>setForm({...form,vida_util_meses:e.target.value})}/></label>}
        <label style={{alignSelf:'center'}}>Activo <input type="checkbox" checked={form.activo} onChange={e=>setForm({...form,activo:e.target.checked})}/></label>
        <button disabled={cargando} type="submit" style={s.boton}>{cargando?'Guardando...':'Guardar costo'}</button>
        <button type="button" style={s.boton} onClick={()=>setForm(nuevo())}>Nuevo</button>
      </form>}
      <div style={{overflowX:'auto'}}><table style={s.tabla}><thead><tr>{(CAMPOS[seccion]||[]).map(([key,n])=><th style={s.th} key={key}>{n}</th>)}{editable&&<th style={s.th}>Acción</th>}</tr></thead><tbody>
      {disponibles.map((f,i)=><tr key={(f.sku||f.grupo||'')+i}>{(CAMPOS[seccion]||[]).map(([key])=><td style={s.td} key={key}>{key==='activo'?(f.activo?'Sí':'No'):String(f[key]??'')}</td>)}{editable&&<td style={s.td}><button style={s.boton} onClick={()=>editar(f)}>Editar</button></td>}</tr>)}
      {disponibles.length===0&&<tr><td style={s.td} colSpan={(CAMPOS[seccion]||[]).length+1}>No hay registros.</td></tr>}
      </tbody></table></div>
      {seccion==='herramienta_odoo_inventario'&&<div style={s.herramientas}><button style={s.boton} disabled={pagina<=1} onClick={()=>setPagina(x=>x-1)}>Anterior</button><span>Página {pagina} de {Math.max(1,Math.ceil(total/100))}</span><button style={s.boton} disabled={pagina>=Math.ceil(total/100)} onClick={()=>setPagina(x=>x+1)}>Siguiente</button></div>}
      {!editable&&seccion!=='herramienta_odoo_inventario'&&<button style={s.boton} onClick={()=>router.push('/inventarios/catalogos')}>Abrir administración de materiales y grupos</button>}
    </section>}
  </div></main>
}
const s={
 base:{minHeight:'100vh',background:'#062d23',color:'#fff',padding:16,fontFamily:'Arial,sans-serif'},
 marco:{maxWidth:1400,margin:'auto',border:'1px solid #487d6c',borderRadius:16,padding:20,background:'#06271f',minWidth:0},
 cabeceraFija:{position:'sticky',top:0,zIndex:30,background:'#06271f',paddingTop:8,paddingBottom:8,borderBottom:'1px solid #487d6c',marginBottom:18},
 barraSuperior:{overflowX:'auto',overflowY:'hidden',height:18,marginBottom:3},
 tablaDesplazable:{overflowX:'auto',overflowY:'auto',maxHeight:'65vh',position:'relative',scrollbarGutter:'stable',border:'1px solid #427466',borderRadius:9},
 regresar:{border:0,borderRadius:30,padding:'10px 15px',background:'#118366',color:'#fff',fontWeight:700,cursor:'pointer',marginBottom:12},
 hero:{background:'linear-gradient(120deg,#10533f,#18a67b)',padding:25,textAlign:'center',borderRadius:14,marginBottom:18},
 panel:{border:'1px solid #406f62',padding:16,borderRadius:14,background:'#0b3028'},
 menu:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12},
 opcion:{background:'#159b76',color:'#fff',minHeight:70,border:0,borderRadius:11,fontWeight:700,cursor:'pointer'},
 herramientas:{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'},
 formulario:{display:'flex',flexWrap:'wrap',alignItems:'end',gap:12,margin:'18px 0'},
 input:{display:'block',padding:10,minWidth:160,background:'#fff',color:'#142f24',borderRadius:7,border:'1px solid #bdd4ca',marginTop:5},
 boton:{padding:'10px 14px',background:'#118e6d',color:'#fff',border:0,borderRadius:8,fontWeight:700,cursor:'pointer'},
 tabla:{borderCollapse:'collapse',width:'100%',minWidth:2100,background:'#f8fdfa',color:'#143126',marginBottom:12},
 th:{padding:9,background:'#0d7659',color:'#fff',border:'1px solid #add0c1',position:'sticky',top:0,zIndex:2,whiteSpace:'nowrap'},
 td:{padding:9,border:'1px solid #c8ded4'},
 nota:{color:'#cce5dc',fontSize:13},error:{background:'#ffe1e1',color:'#822',padding:12,borderRadius:8},
 exito:{background:'#dbffdf',color:'#174a25',padding:12,borderRadius:8},
 cuadriculaUsuarios:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:14,marginBottom:22},
 permisosGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:9,marginBottom:20},
 permiso:{display:'flex',alignItems:'center',gap:8,background:'#07291f',border:'1px solid #42685b',padding:9,borderRadius:7}
}
