'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Compatibilidad temporal con el acceso actual de QIORA.
// Migrar posteriormente a contraseñas propias de Supabase Auth.
function passwordSupabase(clave) {
  return `QIORA#${String(clave ?? '')}`
}

const MODULOS = [
  { permiso: 'auditoria', nombre: 'Auditorías', descripcion: 'Captura y seguimiento de auditorías.', ruta: '/auditorias', disponible: true },
  { permiso: 'ver_auditorias', nombre: 'Ver auditorías', descripcion: 'Consulta histórica de auditorías.', disponible: false },
  { permiso: 'recolecciones', nombre: 'Recolecciones', descripcion: 'Seguimiento de equipos recolectados.', disponible: false },
  { permiso: 'solicitud_material', nombre: 'Solicitud de material', descripcion: 'Solicitudes y seguimiento de materiales.', disponible: false },
  { permiso: 'devoluciones', nombre: 'Devoluciones', descripcion: 'Registro y control de devoluciones.', disponible: false },
  { permiso: 'asignaciones', nombre: 'Asignaciones', descripcion: 'Administración de asignaciones.', disponible: false },
  { permiso: 'bajas', nombre: 'Bajas', descripcion: 'Seguimiento de bajas de inventario.', disponible: false },
  { permiso: 'traspasos', nombre: 'Traspasos', descripcion: 'Solicitudes y seguimiento de traspasos SAP.', disponible: false },
  { permiso: 'dashboard', nombre: 'Dashboard', descripcion: 'Indicadores y reportes de operación.', disponible: false },
]

export default function Home() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [perfil, setPerfil] = useState(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [menuAbierto, setMenuAbierto] = useState(false)

  useEffect(() => {
    let montado = true

    async function validarSesion() {
      try {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error || !user?.id) return
        await cargarPerfil(() => montado)
      } catch (error) {
        console.error('ERROR VALIDANDO SESIÓN:', error)
        if (montado) setMsg('Error al validar la sesión.')
      } finally {
        if (montado) setLoading(false)
      }
    }

    validarSesion()
    return () => { montado = false }
  }, [])

  async function cargarPerfil(sigueActivo = () => true) {
    try {
      const { data, error } = await supabase.rpc('qiora_mi_perfil')
      if (error || !data || data.activo !== true) {
        console.error('ERROR CARGANDO PERFIL:', error)
        await supabase.auth.signOut()
        if (sigueActivo()) {
          setPerfil(null)
          setMsg(error ? 'No fue posible cargar el perfil.' : 'No se encontró un perfil activo vinculado.')
        }
        return false
      }
      if (sigueActivo()) {
        setPerfil(data)
        setMsg('')
      }
      return true
    } catch (error) {
      console.error('ERROR CARGANDO PERFIL:', error)
      await supabase.auth.signOut()
      if (sigueActivo()) {
        setPerfil(null)
        setMsg('Error al cargar el perfil del usuario.')
      }
      return false
    }
  }

  async function login(e) {
    e.preventDefault()
    if (loading) return
    setMsg('')
    setLoading(true)
    try {
      const u = String(usuario ?? '').trim()
      const claveNormal = String(clave ?? '')
      if (!u || !claveNormal) {
        setMsg('Captura usuario y clave.')
        return
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: `${u.toLowerCase()}@qiora.local`,
        password: passwordSupabase(claveNormal),
      })
      if (error || !data?.user?.id) {
        setMsg('Usuario o clave incorrectos.')
        return
      }
      const perfilCargado = await cargarPerfil()
      if (perfilCargado) setClave('')
    } catch (error) {
      console.error('ERROR LOGIN:', error)
      setMsg('No fue posible iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  async function salir() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setPerfil(null)
      setUsuario('')
      setClave('')
      setMsg('')
      setMenuAbierto(false)
    } catch (error) {
      console.error('ERROR CERRANDO SESIÓN:', error)
      setMsg('No fue posible cerrar la sesión.')
    }
  }

  if (loading) {
    return <main className="center"><div className="card"><div className="brand">Q</div><h1>QIORA</h1><p className="sub">Validando sesión...</p></div></main>
  }

  if (!perfil) {
    return (
      <main className="center">
        <form className="card" onSubmit={login}>
          <div className="brand">Q</div>
          <h1>QIORA</h1>
          <p className="sub">Sistema de gestión de almacén</p>
          <label htmlFor="qiora-usuario">USUARIO / ALMACÉN</label>
          <input id="qiora-usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="1903" disabled={loading} required />
          <label htmlFor="qiora-clave">CLAVE</label>
          <input id="qiora-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" placeholder="********" disabled={loading} required />
          {msg && <div className="error" role="alert">{msg}</div>}
          <button type="submit" disabled={loading}>{loading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}</button>
        </form>
      </main>
    )
  }

  const modulos = MODULOS.filter((modulo) => perfil[modulo.permiso] === true)
  const disponibles = modulos.filter((modulo) => modulo.disponible)
  const inventariosPermitidos = ['auditoria', 'dashboard', 'traspasos', 'solicitud_material'].some((p) => perfil[p] === true)

  return (
    <main className="qiora-app">
      <aside className={`qiora-sidebar ${menuAbierto ? 'qiora-sidebar-open' : ''}`} aria-label="Navegación principal">
        <div className="qiora-sidebar-brand"><div className="qiora-logo">Q</div><div><strong>QIORA</strong><small>CONECTA</small></div></div>
        <div className="qiora-sidebar-section">NAVEGACIÓN</div>
        <a className="qiora-nav-item qiora-nav-active" href="/" onClick={() => setMenuAbierto(false)}>Panel principal</a>
        <div className="qiora-sidebar-section">MIS MÓDULOS</div>
        {inventariosPermitidos && <a className="qiora-nav-item" href="/inventarios" onClick={() => setMenuAbierto(false)}>Consultar inventarios</a>}
        {modulos.length ? modulos.map((modulo) => (
          modulo.disponible ?
            <a key={modulo.permiso} className="qiora-nav-item" href={modulo.ruta} onClick={() => setMenuAbierto(false)}>{modulo.nombre}</a> :
            <span key={modulo.permiso} className="qiora-nav-item qiora-nav-disabled" title="Módulo pendiente de implementación">{modulo.nombre}<small>Próximamente</small></span>
        )) : <p className="qiora-sidebar-empty">Sin módulos asignados.</p>}
        <div className="qiora-sidebar-bottom"><span>Distrito</span><strong>{perfil.distrito || '-'}</strong></div>
      </aside>
      {menuAbierto && <button type="button" className="qiora-backdrop" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)} />}
      <div className="qiora-main">
        <header className="qiora-topbar">
          <div className="qiora-top-left"><button type="button" className="qiora-menu-toggle" onClick={() => setMenuAbierto(!menuAbierto)} aria-label="Mostrar u ocultar menú">☰</button><div><strong>QIORA CONECTA</strong><span>Panel principal</span></div></div>
          <div className="qiora-top-right"><span className="qiora-user-name">{perfil.nombre}</span><button type="button" className="out" onClick={salir}>Cerrar sesión</button></div>
        </header>
        <div className="qiora-content">
          <section className="qiora-hero"><div><p className="qiora-eyebrow">BIENVENIDO A QIORA</p><h1>Panel principal</h1><p>Consulta los módulos habilitados para tu usuario y distrito.</p></div><div className="qiora-district-badge">{perfil.distrito || 'SIN DISTRITO'}</div></section>
          <section className="qiora-stats" aria-label="Información del usuario">
            <div className="qiora-stat"><span>Usuario / Almacén</span><strong>{perfil.usuario_almacen}</strong></div>
            <div className="qiora-stat"><span>Puesto</span><strong>{perfil.puesto || '-'}</strong></div>
            <div className="qiora-stat"><span>ODOO</span><strong>{perfil.odoo || '-'}</strong></div>
            <div className="qiora-stat"><span>Módulos autorizados</span><strong>{modulos.length}</strong></div>
          </section>
          {msg && <div className="error" role="alert">{msg}</div>}
          <div className="qiora-section-heading"><div><h2>Mis módulos</h2><p>Las funciones disponibles respetan los permisos de tu perfil.</p></div><span>{disponibles.length} disponible(s)</span></div>
          <section className="qiora-modules">
            {inventariosPermitidos && <article className="qiora-module"><span className="qiora-module-status qiora-status-ready">Consulta disponible</span><h3>Inventarios</h3><p>Stock técnico e IQ09 por almacén y distrito, con paginación.</p><a className="qiora-module-action" href="/inventarios">Consultar inventarios</a></article>}
            {modulos.length ? modulos.map((modulo) => (
              <article className="qiora-module" key={modulo.permiso}>
                <span className={`qiora-module-status ${modulo.disponible ? 'qiora-status-ready' : ''}`}>{modulo.disponible ? 'Ruta existente' : 'Próximamente'}</span>
                <h3>{modulo.nombre}</h3><p>{modulo.descripcion}</p>
                {modulo.disponible ? <a className="qiora-module-action" href={modulo.ruta}>Abrir módulo</a> : <button className="qiora-module-action" type="button" disabled>En preparación</button>}
              </article>
            )) : <article className="qiora-module"><h3>Sin módulos habilitados</h3><p>El usuario inició sesión correctamente, pero todavía no tiene permisos activos para estos módulos.</p></article>}
          </section>
          <p className="qiora-footnote">La navegación muestra los permisos del perfil. Cada módulo debe validar sus operaciones en Supabase antes de habilitar acciones sobre datos.</p>
        </div>
      </div>
    </main>
  )
}
