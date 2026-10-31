'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Compatibilidad temporal con el acceso actual de QIORA.
// Migrar posteriormente a contraseñas propias de Supabase Auth.
function passwordSupabase(clave) {
  return `QIORA#${String(clave ?? '')}`
}

/*
  ============================================================
  MODULOS QIORA
  ============================================================

  REGLA:
  - ADMIN_PADRE ve todos.
  - ADMIN_MG11 / ADMIN_MG13 / ADMIN_MG18 / etc. ven todos.
  - Los demás usuarios ven únicamente los módulos autorizados.
  - El aislamiento de datos por centro se valida dentro de cada
    módulo y en Supabase/RPC/RLS.

  MG11 -> SOLO MG11
  MG13 -> SOLO MG13
  MG18 -> SOLO MG18
  etc.
*/

const MODULOS = [
  {
    permiso: 'auditoria',
    nombre: 'Auditorías',
    descripcion: 'Captura y seguimiento de auditorías.',
    ruta: '/auditorias',
    disponible: true,
  },

  {
    permisos: ['stock_tecnicos', 'equipos', 'materiales'],
    nombre: 'Inventarios',
    descripcion: 'Consulta de materiales, equipos IQ09 y catálogos.',
    ruta: '/inventarios',
    disponible: true,
  },

  {
    permiso: 'carga_stocks',
    nombre: 'Cargar stocks',
    descripcion: 'Carga y reemplazo de STOCK_ALMACEN, STOCK_TECNICOS, herramienta e IQ09 por distrito.',
    ruta: '/cargar-stocks',
    disponible: true,
  },

  {
    permisos: ['configuracion', 'usuarios', 'administrar_permisos'],
    nombre: 'Configuración',
    descripcion: 'Usuarios, números de empleado y catálogos de costos.',
    ruta: '/configuracion',
    disponible: true,
  },

  {
    permiso: 'ver_auditorias',
    nombre: 'Ver auditorías',
    descripcion: 'Consulta histórica de auditorías.',
    ruta: '/ver-auditorias',
    disponible: false,
  },

  {
    permiso: 'recolecciones',
    nombre: 'Recolecciones',
    descripcion: 'Seguimiento de equipos recolectados.',
    ruta: '/recolecciones',
    disponible: true,
  },

  {
    permiso: 'validacion_brm',
    nombre: 'Validación BRM',
    descripcion: 'Captura y validación BRM por centro.',
    ruta: '/validacion-brm',
    disponible: true,
  },

  {
    permiso: 'ver_brm',
    nombre: 'Ver Validaciones BRM',
    descripcion: 'Consulta, valida y descarga registros BRM de tu centro.',
    ruta: '/validaciones-brm',
    disponible: true,
  },

  {
    permiso: 'solicitud_material',
    nombre: 'Solicitud de material',
    descripcion: 'Solicitudes y seguimiento de materiales.',
    ruta: '/solicitud-material',
    disponible: true,
  },

  {
    permiso: 'ver_solicitud',
    nombre: 'Ver Solicitudes',
    descripcion: 'Consultar solicitudes de material y abrir la pantalla de entrega.',
    ruta: '/ver-solicitudes',
    disponible: true,
  },

  {
    permiso: 'devoluciones',
    nombre: 'Devoluciones',
    descripcion: 'Registro y control de devoluciones.',
    ruta: '/devoluciones',
    disponible: true,
  },

  {
    permiso: 'asignaciones',
    nombre: 'Asignaciones',
    descripcion: 'Administración de asignaciones.',
    ruta: '/asignaciones',
    disponible: false,
  },

  {
    permiso: 'bajas',
    nombre: 'Bajas',
    descripcion: 'Seguimiento de bajas de inventario.',
    ruta: '/bajas-cobros',
    disponible: true,
  },

  {
    permiso: 'traspasos',
    nombre: 'Traspasos',
    descripcion: 'Solicitudes y seguimiento de traspasos SAP.',
    ruta: '/traspasos',
    disponible: true,
  },

  {
    permiso: 'dashboard',
    nombre: 'Dashboard',
    descripcion: 'Indicadores y reportes de operación.',
    ruta: '/dashboard',
    disponible: false,
  },
]

export default function Home() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [perfil, setPerfil] = useState(null)
  const [numeroEmpleado, setNumeroEmpleado] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [busquedaModulo, setBusquedaModulo] = useState('')

  useEffect(() => {
    let montado = true

    async function validarSesion() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()

        if (error || !user?.id) {
          return
        }

        await cargarPerfil(() => montado)
      } catch (error) {
        console.error('ERROR VALIDANDO SESIÓN:', error)

        if (montado) {
          setMsg('Error al validar la sesión.')
        }
      } finally {
        if (montado) {
          setLoading(false)
        }
      }
    }

    validarSesion()

    return () => {
      montado = false
    }
  }, [])

  async function cargarPerfil(
    sigueActivo = () => true
  ) {
    try {
      const {
        data,
        error,
      } = await supabase.rpc(
        'qiora_mi_perfil'
      )

      if (
        error ||
        !data ||
        data.activo !== true
      ) {
        console.error(
          'ERROR CARGANDO PERFIL:',
          error
        )

        await supabase.auth.signOut()

        if (sigueActivo()) {
          setPerfil(null)

          setMsg(
            error
              ? 'No fue posible cargar el perfil.'
              : 'No se encontró un perfil activo vinculado.'
          )
        }

        return false
      }

      const {
        data: empleadoNumero,
        error: empleadoError,
      } = await supabase.rpc(
        'qiora_mi_numero_empleado'
      )

      if (empleadoError) {
        console.error(
          'ERROR NUMERO EMPLEADO:',
          empleadoError
        )
      }

      if (sigueActivo()) {
        setPerfil(data)

        setNumeroEmpleado(
          empleadoError
            ? ''
            : String(
                empleadoNumero ?? ''
              ).trim()
        )

        setMsg('')
      }

      return true

    } catch (error) {
      console.error(
        'ERROR CARGANDO PERFIL:',
        error
      )

      await supabase.auth.signOut()

      if (sigueActivo()) {
        setPerfil(null)

        setMsg(
          'Error al cargar el perfil del usuario.'
        )
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
      const u =
        String(
          usuario ?? ''
        ).trim()

      const claveNormal =
        String(
          clave ?? ''
        )

      if (
        !u ||
        !claveNormal
      ) {
        setMsg(
          'Captura usuario y clave.'
        )

        return
      }

      const {
        data,
        error,
      } =
        await supabase.auth
          .signInWithPassword({
            email:
              `${u.toLowerCase()}@qiora.local`,

            password:
              passwordSupabase(
                claveNormal
              ),
          })

      if (
        error ||
        !data?.user?.id
      ) {
        setMsg(
          'Usuario o clave incorrectos.'
        )

        return
      }

      const perfilCargado =
        await cargarPerfil()

      if (perfilCargado) {
        setClave('')
      }

    } catch (error) {
      console.error(
        'ERROR LOGIN:',
        error
      )

      setMsg(
        'No fue posible iniciar sesión.'
      )

    } finally {
      setLoading(false)
    }
  }

  async function salir() {
    try {
      const {
        error,
      } =
        await supabase.auth
          .signOut()

      if (error) {
        throw error
      }

      setPerfil(null)
      setNumeroEmpleado('')
      setUsuario('')
      setClave('')
      setMsg('')
      setMenuAbierto(false)

    } catch (error) {
      console.error(
        'ERROR CERRANDO SESIÓN:',
        error
      )

      setMsg(
        'No fue posible cerrar la sesión.'
      )
    }
  }

  if (loading) {
    return (
      <main className="sat-login-page">
        <section className="sat-login-card sat-login-loading">
          <header className="sat-login-header">
            <img src="/logo-sat.png" alt="SAT — Sistema de Automatización de Traspasos" className="sat-login-logo" />
          </header>
          <div className="sat-login-body">
            <p className="sat-login-subtitle">Validando sesión...</p>
          </div>
        </section>
        <style jsx global>{`
          .sat-login-page {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            padding: 24px 16px; box-sizing: border-box; color: #f4fff9;
            background: radial-gradient(ellipse at 50% 0%, #0b654b 0%, #063d2f 42%, #031f19 100%);
            font-family: Arial, Helvetica, sans-serif;
          }
          .sat-login-card {
            width: min(100%, 460px); overflow: hidden; border: 1px solid rgba(183,255,224,.72);
            border-radius: 22px; background: linear-gradient(180deg, rgba(4,54,41,.98), rgba(2,37,29,.99));
            box-shadow: 0 22px 70px rgba(0,0,0,.38);
          }
          .sat-login-header {
            min-height: 220px; display: flex; justify-content: center; align-items: center; padding: 20px;
            box-sizing: border-box; border-bottom: 1px solid rgba(153,239,205,.5);
            background: repeating-radial-gradient(circle at 50% 80%, transparent 0 13px, rgba(194,255,226,.09) 14px 15px),
              radial-gradient(ellipse at 50% 0%, #eafff4 0%, #5d9b84 34%, #07533e 72%, #033326 100%);
          }
          .sat-login-logo { display: block; width: min(100%, 310px); max-height: 200px; object-fit: contain; }
          .sat-login-body { padding: 24px 28px 28px; }
          .sat-login-subtitle { text-align: center; margin: 0 0 24px; color: #e1f4eb; font-size: 14px; }
          @media (max-width: 480px) {
            .sat-login-header { min-height: 180px; }
            .sat-login-body { padding: 22px 20px 24px; }
          }
        `}</style>
      </main>
    )
  }

  if (!perfil) {
    return (
      <main className="sat-login-page">
        <form className="sat-login-card" onSubmit={login}>
          <header className="sat-login-header">
            <img
              src="/logo-sat.png"
              alt="SAT — Sistema de Automatización de Traspasos"
              className="sat-login-logo"
            />
          </header>

          <div className="sat-login-body">
            <p className="sat-login-subtitle">
              Ingrese su usuario y contraseña para acceder
            </p>

            <label className="sat-login-label" htmlFor="qiora-usuario">
              Usuario
            </label>
            <div className="sat-login-input-wrap">
              <span aria-hidden="true">👤</span>
              <input
                id="qiora-usuario"
                className="sat-login-input"
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Usuario"
                disabled={loading}
                required
              />
            </div>

            <label className="sat-login-label" htmlFor="qiora-clave">
              Contraseña
            </label>
            <div className="sat-login-input-wrap">
              <span aria-hidden="true">🔒</span>
              <input
                id="qiora-clave"
                className="sat-login-input"
                type="password"
                value={clave}
                onChange={e => setClave(e.target.value)}
                autoComplete="current-password"
                placeholder="Contraseña"
                disabled={loading}
                required
              />
            </div>

            {msg && (
              <div className="sat-login-error" role="alert">
                {msg}
              </div>
            )}

            <button className="sat-login-submit" type="submit" disabled={loading}>
              {loading ? 'INGRESANDO...' : 'Ingresar'}
            </button>

            <div className="sat-login-security">
              <div className="sat-login-lock" aria-hidden="true">🔒</div>
              <div>
                <strong>Plataforma protegida</strong>
                <p>Acceso restringido a personal autorizado.</p>
                <strong>Desarrollado y administrado por:</strong>
                <p>Jaime Acosta</p>
              </div>
            </div>
          </div>
        </form>

        <style jsx global>{`
          .sat-login-page {
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            padding: 24px 16px; box-sizing: border-box; color: #f4fff9;
            background: radial-gradient(ellipse at 50% 0%, #0b654b 0%, #063d2f 42%, #031f19 100%);
            font-family: Arial, Helvetica, sans-serif;
          }
          .sat-login-card {
            width: min(100%, 460px); overflow: hidden; border: 1px solid rgba(183,255,224,.72);
            border-radius: 22px; background: linear-gradient(180deg, rgba(4,54,41,.98), rgba(2,37,29,.99));
            box-shadow: 0 22px 70px rgba(0,0,0,.38); color: #f4fff9;
          }
          .sat-login-header {
            min-height: 220px; display: flex; justify-content: center; align-items: center; padding: 20px;
            box-sizing: border-box; border-bottom: 1px solid rgba(153,239,205,.5);
            background: repeating-radial-gradient(circle at 50% 80%, transparent 0 13px, rgba(194,255,226,.09) 14px 15px),
              radial-gradient(ellipse at 50% 0%, #eafff4 0%, #5d9b84 34%, #07533e 72%, #033326 100%);
          }
          .sat-login-logo { display: block; width: min(100%, 310px); max-height: 200px; object-fit: contain; }
          .sat-login-body { padding: 24px 28px 28px; }
          .sat-login-subtitle { text-align: center; margin: 0 0 24px; color: #e1f4eb; font-size: 14px; line-height: 1.5; }
          .sat-login-label { display: block; margin: 16px 0 7px; color: #f7fffb; font-size: 14px; font-weight: 700; }
          .sat-login-input-wrap {
            display: flex; align-items: center; gap: 10px; padding: 0 13px; min-height: 48px;
            border: 1px solid #168f69; border-radius: 13px; background: rgba(0,25,19,.5);
            box-shadow: inset 0 1px 7px rgba(0,0,0,.22);
          }
          .sat-login-input-wrap span { flex: 0 0 auto; font-size: 17px; }
          .sat-login-input {
            display: block; min-width: 0; width: 100%; border: 0; outline: 0; background: transparent;
            color: #f4fff9; font: inherit; font-size: 15px; padding: 12px 0;
          }
          .sat-login-input::placeholder { color: #a7c0b6; opacity: 1; }
          .sat-login-input-wrap:focus-within { border-color: #39dba2; box-shadow: 0 0 0 3px rgba(57,219,162,.12); }
          .sat-login-submit {
            display: block; width: 100%; margin-top: 22px; padding: 13px 16px; border: 1px solid #31d69e;
            border-radius: 13px; color: white; font-size: 18px; font-weight: 800; cursor: pointer;
            background: linear-gradient(110deg, #08b77e, #4ccda1); box-shadow: 0 6px 18px rgba(0,0,0,.2);
          }
          .sat-login-submit:disabled { opacity: .7; cursor: wait; }
          .sat-login-error { margin-top: 14px; padding: 11px 12px; color: #ffe5e5; background: #7d252b; border: 1px solid #b94b50; border-radius: 9px; font-size: 13px; }
          .sat-login-security {
            display: flex; gap: 13px; align-items: flex-start; margin-top: 22px; padding-top: 18px;
            border-top: 1px solid rgba(120,201,169,.25); font-size: 12px; line-height: 1.5;
          }
          .sat-login-lock {
            display: grid; place-items: center; flex: 0 0 48px; height: 48px; border: 1px solid #0eaa79;
            border-radius: 12px; background: rgba(0,110,76,.2); font-size: 22px;
          }
          .sat-login-security strong { color: #25d99c; display: block; margin-bottom: 3px; }
          .sat-login-security p { margin: 0 0 8px; color: #e1f4eb; }
          @media (max-width: 480px) {
            .sat-login-header { min-height: 180px; }
            .sat-login-body { padding: 22px 20px 24px; }
          }
        `}</style>
      </main>
    )
  }

  const puestoActual = String(perfil.puesto ?? '').trim().toUpperCase()
  const esAdminPadre = puestoActual === 'ADMIN_PADRE'

  const centroActivo = String(perfil.distrito ?? '').trim().toUpperCase()

  const tienePermisoModulo = modulo => {
    if (esAdminPadre) return true
    if (modulo.permiso) return perfil[modulo.permiso] === true
    if (Array.isArray(modulo.permisos)) {
      return modulo.permisos.some(permiso => perfil[permiso] === true)
    }
    return false
  }

  // Los administradores de distrito NO reciben todos los módulos automáticamente.
  // Solo ADMIN_PADRE tiene acceso general; ADMIN_MG depende de permisos delegados.
  const modulos = MODULOS.filter(tienePermisoModulo)
  const modulosAutorizados = modulos

  const disponibles =
    modulos.filter(
      modulo =>
        modulo.disponible ===
        true
    )

  const modulosFiltrados = modulos.filter(modulo => {
    const termino = busquedaModulo.trim().toLocaleLowerCase('es-MX')
    if (!termino) return true
    return `${modulo.nombre} ${modulo.descripcion}`
      .toLocaleLowerCase('es-MX')
      .includes(termino)
  })

  return (
    <main className="qiora-app">

      <aside
        className={`qiora-sidebar ${
          menuAbierto
            ? 'qiora-sidebar-open'
            : ''
        }`}
        aria-label="Navegación principal"
      >

        <div className="qiora-sidebar-brand">

          <div className="qiora-logo">
            SAT
          </div>

          <div>
            <strong>
              SAT
            </strong>

            <small>
              Sistema de Automatización de Traspasos
            </small>
          </div>

        </div>

        <div className="qiora-sidebar-section">
          NAVEGACIÓN
        </div>

        <a
          className="qiora-nav-item qiora-nav-active"
          href="/"
          onClick={() =>
            setMenuAbierto(false)
          }
        >
          Panel principal
        </a>

        <div className="qiora-sidebar-section">
          MIS MÓDULOS
        </div>

        {modulos.length ? (

          modulos.map(
            modulo =>
              modulo.disponible ? (

                <a
                  key={
                    modulo.ruta ||
                    modulo.permiso ||
                    modulo.nombre
                  }
                  className="qiora-nav-item"
                  href={
                    modulo.ruta
                  }
                  onClick={() =>
                    setMenuAbierto(
                      false
                    )
                  }
                >
                  {modulo.nombre}
                </a>

              ) : (

                <span
                  key={
                    modulo.ruta ||
                    modulo.permiso ||
                    modulo.nombre
                  }
                  className="qiora-nav-item qiora-nav-disabled"
                  title="Módulo pendiente de implementación"
                >
                  {modulo.nombre}

                  <small>
                    Próximamente
                  </small>
                </span>

              )
          )

        ) : (

          <p className="qiora-sidebar-empty">
            Sin módulos asignados.
          </p>

        )}

        <div className="qiora-sidebar-bottom">

          <span>
            Centro
          </span>

          <strong>
            {
              centroActivo ||
              '-'
            }
          </strong>

        </div>

      </aside>

      {menuAbierto && (

        <button
          type="button"
          className="qiora-backdrop"
          aria-label="Cerrar menú"
          onClick={() =>
            setMenuAbierto(false)
          }
        />

      )}

      <div className="qiora-main">

        <header className="qiora-topbar">

          <div className="qiora-top-left">

            <button
              type="button"
              className="qiora-menu-toggle"
              onClick={() =>
                setMenuAbierto(
                  !menuAbierto
                )
              }
              aria-label="Mostrar u ocultar menú"
            >
              ☰
            </button>

            <div>

              <strong>
                SAT — Sistema de Automatización de Traspasos
              </strong>

              <span>
                Panel principal
              </span>

            </div>

          </div>

          <div className="qiora-top-right">

            <span className="qiora-user-name">
              {perfil.nombre}
            </span>

            <button
              type="button"
              className="out"
              onClick={salir}
            >
              Cerrar sesión
            </button>

          </div>

        </header>

        <div className="qiora-content">

          <style jsx global>{`
            /* Panel principal más compacto */
            .qiora-hero { padding: 18px 22px !important; min-height: 0 !important; }
            .qiora-hero h1 { font-size: clamp(22px, 2.2vw, 29px) !important; margin: 5px 0 !important; }
            .qiora-hero .qiora-eyebrow { font-size: 10px !important; margin: 0 0 5px !important; letter-spacing: 1.2px; }
            .qiora-hero p:not(.qiora-eyebrow) { font-size: 12px !important; margin: 5px 0 0 !important; }
            .qiora-district-badge { padding: 10px 15px !important; font-size: 14px !important; }
            .qiora-stats { gap: 10px !important; margin-top: 12px !important; }
            .qiora-stat { padding: 11px 14px !important; min-height: 0 !important; }
            .qiora-stat span { font-size: 10px !important; }
            .qiora-stat strong { font-size: 15px !important; }
            .qiora-module-search { display:flex; align-items:center; gap:10px; margin: 12px 0 16px; max-width: 520px; }
            .qiora-module-search input { width:100%; min-width:0; box-sizing:border-box; padding:11px 14px; border:1px solid rgba(75,190,150,.45); border-radius:10px; background:#f7fbf9; color:#123b30; font-size:14px; outline:none; }
            .qiora-module-search input:focus { border-color:#19b887; box-shadow:0 0 0 3px rgba(25,184,135,.14); }
            .qiora-module-search-count { color:#b8e8d6; font-size:12px; white-space:nowrap; }
            @media (max-width: 700px) { .qiora-hero { padding:15px !important; } .qiora-stats { grid-template-columns: repeat(2,minmax(0,1fr)) !important; } }
          `}</style>

          <section className="qiora-hero">

            <div>

              <p className="qiora-eyebrow">
                SAT — SISTEMA DE AUTOMATIZACIÓN DE TRASPASOS
              </p>

              <h1>
                Panel principal
              </h1>

              <p>
                Consulta los módulos habilitados para tu usuario y centro.
              </p>

            </div>

            <div className="qiora-district-badge">
              {
                centroActivo ||
                'SIN CENTRO'
              }
            </div>

          </section>

          <section
            className="qiora-stats"
            aria-label="Información del usuario"
          >

            <div className="qiora-stat">

              <span>
                Usuario / Almacén
              </span>

              <strong>
                {
                  perfil.usuario_almacen
                }
              </strong>

            </div>

            <div className="qiora-stat">

              <span>
                Puesto
              </span>

              <strong>
                {
                  perfil.puesto ||
                  '-'
                }
              </strong>

            </div>

            <div className="qiora-stat">

              <span>
                Número de empleado
              </span>

              <strong>
                {
                  numeroEmpleado ||
                  'NO REGISTRADO'
                }
              </strong>

            </div>

            <div className="qiora-stat">

              <span>
                Módulos autorizados
              </span>

              <strong>
                {
                  modulosAutorizados.length
                }
              </strong>

            </div>

          </section>

          {msg && (

            <div
              className="error"
              role="alert"
            >
              {msg}
            </div>

          )}

          <div className="qiora-section-heading">

            <div>

              <h2>
                Mis módulos
              </h2>

              <p>
                Las funciones disponibles respetan los permisos y el centro de tu perfil.
              </p>

            </div>

            <span>
              {
                disponibles.length
              } disponible(s)
            </span>

          </div>

          <div className="qiora-module-search">
            <input
              type="search"
              value={busquedaModulo}
              onChange={e => setBusquedaModulo(e.target.value)}
              placeholder="Buscar módulo..."
              aria-label="Buscar módulos"
            />
            <span className="qiora-module-search-count">
              {modulosFiltrados.length} de {modulos.length}
            </span>
          </div>

          <section className="qiora-modules">

            {modulosFiltrados.length ? (

              modulosFiltrados.map(
                modulo => (

                  <article
                    className="qiora-module"
                    key={
                      modulo.ruta ||
                      modulo.permiso ||
                      modulo.nombre
                    }
                  >

                    <span
                      className={`qiora-module-status ${
                        modulo.disponible
                          ? 'qiora-status-ready'
                          : ''
                      }`}
                    >
                      {
                        modulo.disponible
                          ? 'Ruta existente'
                          : 'Próximamente'
                      }
                    </span>

                    <h3>
                      {modulo.nombre}
                    </h3>

                    <p>
                      {
                        modulo.descripcion
                      }
                    </p>

                    {
                      modulo.permiso === 'ver_solicitud' &&
                      modulo.disponible
                        ? (
                          <a
                            className="qiora-module-action"
                            href="/ver-solicitudes"
                          >
                            Ver solicitudes
                          </a>
                        )
                        : modulo.disponible
                          ? (
                            <a
                              className="qiora-module-action"
                              href={modulo.ruta}
                            >
                              Abrir módulo
                            </a>
                          )
                          : (
                            <button
                              className="qiora-module-action"
                              type="button"
                              disabled
                            >
                              En preparación
                            </button>
                          )
                    }

                  </article>

                )
              )

            ) : (

              <article className="qiora-module">

                <h3>
                  {modulos.length ? 'No se encontraron módulos' : 'Sin módulos habilitados'}
                </h3>

                <p>
                  {modulos.length
                    ? 'No hay módulos que coincidan con tu búsqueda.'
                    : 'El usuario inició sesión correctamente, pero todavía no tiene permisos activos para estos módulos.'}
                </p>

              </article>

            )}

          </section>

          <p className="qiora-footnote">

            Centro activo: {
              centroActivo ||
              'SIN CENTRO'
            }.

            {' '}

            Cada módulo valida sus operaciones en Supabase antes de consultar o modificar datos.

          </p>

        </div>

      </div>

    </main>
  )
}
