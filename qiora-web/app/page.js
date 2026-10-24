
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Compatibilidad temporal con las claves actuales de QIORA.
// Posteriormente se deben migrar las contraseñas.
function passwordSupabase(clave) {
  return `QIORA#${String(clave ?? '')}`
}

const MODULOS = [
  ['auditoria', 'Auditorías'],
  ['ver_auditorias', 'Ver auditorías'],
  ['recolecciones', 'Recolecciones'],
  ['solicitud_material', 'Solicitud de material'],
  ['devoluciones', 'Devoluciones'],
  ['asignaciones', 'Asignaciones'],
  ['bajas', 'Bajas'],
  ['traspasos', 'Traspasos'],
  ['dashboard', 'Dashboard'],
]

export default function Home() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [perfil, setPerfil] = useState(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let activo = true

    async function validarSesion() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()

        if (error || !user?.id) {
          if (activo) {
            setPerfil(null)
          }
          return
        }

        await cargarPerfil(() => activo)
      } catch (error) {
        console.error('ERROR VALIDANDO SESIÓN:', error)

        if (activo) {
          setPerfil(null)
          setMsg('Error al validar la sesión.')
        }
      } finally {
        if (activo) {
          setLoading(false)
        }
      }
    }

    validarSesion()

    return () => {
      activo = false
    }
  }, [])

  async function cargarPerfil(sigueActivo = () => true) {
    try {
      // La función utiliza auth.uid() dentro de Supabase.
      // No enviamos el identificador del usuario desde el navegador.
      const { data, error } = await supabase.rpc(
        'qiora_mi_perfil'
      )

      if (error) {
        console.error('ERROR CARGANDO PERFIL:', error)

        await supabase.auth.signOut()

        if (sigueActivo()) {
          setPerfil(null)
          setMsg(
            `No fue posible cargar el perfil: ${error.message}`
          )
        }

        return false
      }

      if (!data) {
        await supabase.auth.signOut()

        if (sigueActivo()) {
          setPerfil(null)
          setMsg(
            'No se encontró un perfil activo vinculado.'
          )
        }

        return false
      }

      if (data.activo !== true) {
        await supabase.auth.signOut()

        if (sigueActivo()) {
          setPerfil(null)
          setMsg('Usuario inactivo.')
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

      const perfilCargado = await cargarPerfil()

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
      const { error } = await supabase.auth.signOut()

      if (error) {
        throw error
      }

      setPerfil(null)
      setUsuario('')
      setClave('')
      setMsg('')
    } catch (error) {
      console.error('ERROR CERRANDO SESIÓN:', error)
      setMsg('No fue posible cerrar la sesión.')
    }
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
            required
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
            required
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

  const modulos = MODULOS.filter(
    ([permiso]) => perfil[permiso] === true
  )

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
          modulos.map(([permiso, nombre]) => (
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
          ))
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
