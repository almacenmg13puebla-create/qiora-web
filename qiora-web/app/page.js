'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [perfil, setPerfil] = useState(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        await cargarPerfil(session.user.id)
      }

      setLoading(false)
    })()
  }, [])

  async function cargarPerfil(uid) {
    const { data, error } = await supabase
      .from('almacen_usuarios')
      .select('*')
      .eq('auth_user_id', uid)
      .single()

    if (error) {
      console.error('ERROR CARGANDO PERFIL:', error)
      setMsg(`No se encontró el perfil vinculado: ${error.message}`)
      return
    }

    if (!data.activo) {
      await supabase.auth.signOut()
      setMsg('Usuario inactivo.')
      return
    }

    setPerfil(data)
  }

  async function login(e) {
    e.preventDefault()

    setMsg('')
    setLoading(true)

    const u = usuario.trim()

    if (!u || !clave) {
      setMsg('Captura usuario y clave.')
      setLoading(false)
      return
    }

    const email = `${u}@qiora.local`

    console.log('Intentando iniciar sesión:', email)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: clave,
    })

    if (error) {
      console.error('ERROR LOGIN SUPABASE:', error)

      setMsg(`Error Supabase: ${error.message}`)

      setLoading(false)
      return
    }

    if (!data?.user) {
      setMsg('Supabase no devolvió un usuario autenticado.')
      setLoading(false)
      return
    }

    console.log('LOGIN CORRECTO:', data.user.id)

    await cargarPerfil(data.user.id)

    setClave('')
    setLoading(false)
  }

  async function salir() {
    await supabase.auth.signOut()

    setPerfil(null)
    setUsuario('')
    setClave('')
    setMsg('')
  }

  if (loading) {
    return (
      <main className="center">
        <div className="card">
          <h1>QIORA</h1>
          <p>Validando sesión...</p>
        </div>
      </main>
    )
  }

  if (!perfil) {
    return (
      <main className="center">
        <form className="card" onSubmit={login}>
          <div className="brand">Q</div>

          <h1>QIORA</h1>

          <p className="sub">
            Sistema de gestión de almacén
          </p>

          <label>USUARIO / ALMACÉN</label>

          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            placeholder="1903"
          />

          <label>CLAVE</label>

          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoComplete="current-password"
            placeholder="********"
          />

          {msg && (
            <div className="error">
              {msg}
            </div>
          )}

          <button disabled={loading}>
            {loading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}
          </button>
        </form>
      </main>
    )
  }

  const modulos = [
    ['auditoria', 'Auditorías'],
    ['ver_auditorias', 'Ver auditorías'],
    ['recolecciones', 'Recolecciones'],
    ['solicitud_material', 'Solicitud de material'],
    ['devoluciones', 'Devoluciones'],
    ['asignaciones', 'Asignaciones'],
    ['bajas', 'Bajas'],
    ['traspasos', 'Traspasos'],
    ['dashboard', 'Dashboard'],
  ].filter(([k]) => perfil[k] === true)

  return (
    <main className="dash">
      <header>
        <div>
          <b>QIORA</b>
          <span>{perfil.nombre}</span>
        </div>

        <button
          className="out"
          onClick={salir}
        >
          Cerrar sesión
        </button>
      </header>

      <section className="welcome">
        <h2>Panel principal</h2>

        <p>
          <b>Usuario:</b>{' '}
          {perfil.usuario_almacen}
          {' | '}
          <b>Puesto:</b>{' '}
          {perfil.puesto || '-'}
          {' | '}
          <b>Distrito:</b>{' '}
          {perfil.distrito || '-'}
        </p>

        <p>
          <b>ODOO:</b>{' '}
          {perfil.odoo || '-'}
        </p>
      </section>

      <section className="grid">
        {modulos.length ? (
          modulos.map(([k, n]) => (
            <article key={k}>
              <h3>{n}</h3>

              <p>
                Módulo habilitado por permiso.
              </p>

              <button disabled>
                Abrir próximamente
              </button>
            </article>
          ))
        ) : (
          <article>
            <h3>
              Sin módulos habilitados
            </h3>

            <p>
              El usuario inició sesión correctamente,
              pero no tiene permisos activos en los
              módulos iniciales.
            </p>
          </article>
        )}
      </section>
    </main>
  )
}
