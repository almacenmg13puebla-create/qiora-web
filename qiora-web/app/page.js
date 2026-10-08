'use client'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'

export default function Home(){
 const [usuario,setUsuario]=useState('')
 const [clave,setClave]=useState('')
 const [perfil,setPerfil]=useState(null)
 const [msg,setMsg]=useState('')
 const [loading,setLoading]=useState(true)

 useEffect(()=>{(async()=>{
   const {data:{session}}=await supabase.auth.getSession()
   if(session) await cargarPerfil(session.user.id)
   setLoading(false)
 })()},[])

 async function cargarPerfil(uid){
   const {data,error}=await supabase.from('almacen_usuarios').select('*').eq('auth_user_id',uid).single()
   if(error){setMsg('No se encontro el perfil vinculado.');return}
   if(!data.activo){await supabase.auth.signOut();setMsg('Usuario inactivo.');return}
   setPerfil(data)
 }

 async function login(e){
   e.preventDefault(); setMsg(''); setLoading(true)
   const u=usuario.trim()
   if(!u||!clave){setMsg('Captura usuario y clave.');setLoading(false);return}
   const {data,error}=await supabase.auth.signInWithPassword({email:`${u}@qiora.local`,password:clave})
   if(error){setMsg('Usuario o clave incorrectos.');setLoading(false);return}
   await cargarPerfil(data.user.id); setClave(''); setLoading(false)
 }
 async function salir(){await supabase.auth.signOut();setPerfil(null);setUsuario('');setClave('');setMsg('')}

 if(loading) return <main className="center"><div className="card"><h1>QIORA</h1><p>Validando sesion...</p></div></main>
 if(!perfil) return <main className="center"><form className="card" onSubmit={login}><div className="brand">Q</div><h1>QIORA</h1><p className="sub">Sistema de gestion de almacen</p><label>USUARIO / ALMACEN</label><input value={usuario} onChange={e=>setUsuario(e.target.value)} autoComplete="username" placeholder="1903"/><label>CLAVE</label><input type="password" value={clave} onChange={e=>setClave(e.target.value)} autoComplete="current-password" placeholder="********"/>{msg&&<div className="error">{msg}</div>}<button disabled={loading}>{loading?'INGRESANDO...':'INICIAR SESION'}</button></form></main>

 const modulos=[['auditoria','Auditorias'],['ver_auditorias','Ver auditorias'],['recolecciones','Recolecciones'],['solicitud_material','Solicitud de material'],['devoluciones','Devoluciones'],['asignaciones','Asignaciones'],['bajas','Bajas'],['traspasos','Traspasos'],['dashboard','Dashboard']].filter(([k])=>perfil[k]===true)
 return <main className="dash"><header><div><b>QIORA</b><span>{perfil.nombre}</span></div><button className="out" onClick={salir}>Cerrar sesion</button></header><section className="welcome"><h2>Panel principal</h2><p><b>Usuario:</b> {perfil.usuario_almacen} &nbsp; <b>Puesto:</b> {perfil.puesto||'-'} &nbsp; <b>Distrito:</b> {perfil.distrito||'-'}</p><p><b>ODOO:</b> {perfil.odoo||'-'}</p></section><section className="grid">{modulos.length?modulos.map(([k,n])=><article key={k}><h3>{n}</h3><p>Modulo habilitado por permiso.</p><button disabled>Abrir proximamente</button></article>):<article><h3>Sin modulos habilitados</h3><p>El usuario inicio sesion correctamente, pero no tiene permisos activos en los modulos iniciales.</p></article>}</section></main>
}
