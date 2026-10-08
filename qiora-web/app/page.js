'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// IMPORTANTE:
// El usuario sigue escribiendo exactamente su clave normal de QIORA.
// Esta transformación solo se utiliza internamente para Supabase Auth.
function passwordSupabase(clave) {
  return `QIORA#${String(clave ?? '')}`
}

export default function Home() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [perfil, setPerfil] = useState(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          console.error('ERROR OBTENIENDO SESIÓN:', error)
        }

        if (session?.user?.id) {
          await cargarPerfil(session.user.id)
        }
      } catch (error) {
        console.error('ERROR VALIDANDO SESIÓN:', error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function cargarPerfil(uid) {
    try {
      const { data, error } = await supabase
        .from('almacen_usuarios')
        .select('*')
        .eq('auth_user_id', uid)
        .maybeSingle()

      if (error) {
        console.error('ERROR CARGANDO PERFIL:', error)

        await supabase.auth.signOut()
        setPerfil(null)
        setMsg(`No se encontró el perfil vinculado: ${error.message}`)

        return false
      }

      if (!data) {
        await supabase.auth.signOut()
        setPerfil(null)
        setMsg('No se encontró el perfil vinculado.')

        return false
      }

      if (data.activo !== true) {
        await supabase.auth.signOut()
        setPerfil(null)
        setMsg('Usuario inactivo.')

        return false
      }

      setPerfil(data)
      setMsg('')

      return true
    } catch (error) {
      console.error('ERROR CARGANDO PERFIL:', error)

      await supabase.auth.signOut()
      setPerfil(null)
      setMsg('Error al cargar el perfil del usuario.')

      return false
    }
  }

  async function login(e) {
    e.preventDefault()

    if (loading) {
      return
    }

    setMsg('')
    setLoading(true)

    try {
      const u = String(usuario ?? '').trim()
      const claveNormal = String(clave ?? '')

      if (!u || !claveNormal) {
        setMsg('Captura usuario y clave.')
        return
      }

      const email = `${u.toLowerCase()}@qiora.local`

      // El usuario escribe su clave normal.
      // Supabase recibe la versión transformada.
      const password = passwordSupabase(claveNormal)

      const { data, error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        })

      if (error) {
        console.error('ERROR LOGIN SUPABASE:', error)

        setMsg('Usuario o clave incorrectos.')
        return
      }

      if (!data?.user?.id) {
        setMsg('No fue posible iniciar sesión.')
        return
      }

      const perfilCargado =
        await cargarPerfil(data.user.id)

      if (!perfilCargado) {
        return
      }

      setClave('')
    } catch (error) {
      console.error('ERROR LOGIN:', error)

      setMsg('No fue posible iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  async function salir() {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error('ERROR CERRANDO SESIÓN:', error)
    }

    setPerfil(null)
    setUsuario('')
    setClave('')
    setMsg('')
  }

  if (loading) {
    return (
      <main className="center">
        <div className="card">
          <div className="brand">Q</div>

          <h1>QIORA</h1>

          <p className="sub">
            Validando sesión...
          </p>
        </div>
      </main>
    )
  }

  if (!perfil) {
    return (
      <main className="center">
        <form
          className="card"
          onSubmit={login}
        >
          <div className="brand">Q</div>

          <h1>QIORA</h1>

          <p className="sub">
            Sistema de gestión de almacén
          </p>

          <label>
            USUARIO / ALMACÉN
          </label>

          <input
            value={usuario}
            onChange={(e) =>
              setUsuario(e.target.value)
            }
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="1903"
            disabled={loading}
          />

          <label>
            CLAVE
          </label>

          <input
            type="password"
            value={clave}
            onChange={(e) =>
              setClave(e.target.value)
            }
            autoComplete="current-password"
            placeholder="********"
            disabled={loading}
          />

          {msg && (
            <div className="error">
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? 'INGRESANDO...'
              : 'INICIAR SESIÓN'}
          </button>
        </form>
      </main>
    )
  }

  const modulos = [
    ['auditoria', 'Auditorías'],
    ['ver_auditorias', 'Ver auditorías'],
    ['recolecciones', 'Recolecciones'],
    [
      'solicitud_material',
      'Solicitud de material',
    ],
    ['devoluciones', 'Devoluciones'],
    ['asignaciones', 'Asignaciones'],
    ['bajas', 'Bajas'],
    ['traspasos', 'Traspasos'],
    ['dashboard', 'Dashboard'],
  ].filter(([permiso]) => perfil[permiso] === true)

  return (
    <main className="dash">
      <header>
        <div>
          <b>QIORA</b>

          <span>
            {perfil.nombre}
          </span>
        </div>

        <button
          type="button"
          className="out"
          onClick={salir}
        >
          Cerrar sesión
        </button>
      </header>

      <section className="welcome">
        <h2>
          Panel principal
        </h2>

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
        {modulos.length > 0 ? (
          modulos.map(
            ([permiso, nombre]) => (
              <article key={permiso}>
                <h3>
                  {nombre}
                </h3>

                <p>
                  Módulo habilitado por permiso.
                </p>

                <button
                  type="button"
                  disabled
                >
                  Abrir próximamente
                </button>
              </article>
            )
          )
        ) : (
          <article>
            <h3>
              Sin módulos habilitados
            </h3>

            <p>
              El usuario inició sesión
              correctamente, pero no tiene
              permisos activos en los módulos
              iniciales.
            </p>
          </article>
        )}
      </section>
    </main>
  )
}
