'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const VACIOS = {
  grupos: {
    grupo: '',
    tipo: 'EQUIPO',
    maximo: 0,
    activo: true
  },
  materiales: {
    sku: '',
    material: '',
    tipo: 'CONSUMIBLE',
    grupo: 'CONSUMIBLE',
    maximo: 0,
    factor_empaque: '',
    minimo_reposicion: 0,
    cantidad_reposicion: 0,
    activo: true
  }
}

const CAMPOS_MATERIAL = [
  'sku',
  'material',
  'tipo',
  'grupo',
  'maximo',
  'factor_empaque',
  'minimo_reposicion',
  'cantidad_reposicion'
]

export default function CatalogosPage() {
  const router = useRouter()

  const [tab, setTab] = useState('materiales')
  const [perfil, setPerfil] = useState(null)
  const [admin, setAdmin] = useState(false)
  const [datos, setDatos] = useState({ grupos: [], materiales: [] })
  const [form, setForm] = useState({ ...VACIOS.materiales })
  const [busca, setBusca] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function actualizar() {
    const { data, error: e } = await supabase.rpc('qiora_catalogos_listar')
    if (e) throw e

    setDatos({
      grupos: data?.grupos || [],
      materiales: data?.materiales || []
    })
  }

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'grupos' || t === 'materiales') setTab(t)
  }, [])

  useEffect(() => {
    let vivo = true

    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          router.replace('/')
          return
        }

        const { data: p, error: e } = await supabase.rpc('qiora_mi_perfil')
        if (e) throw e
        if (!p?.activo) throw new Error('Usuario inactivo')

        const { data: a, error: ae } = await supabase.rpc('qiora_catalogos_es_admin')
        if (ae) throw ae
        if (!a) throw new Error('Sin permiso para administrar catálogos')

        if (vivo) {
          setPerfil(p)
          setAdmin(true)
        }

        await actualizar()
      } catch (e) {
        if (vivo) setError(e.message)
      } finally {
        if (vivo) setCargando(false)
      }
    })()

    return () => {
      vivo = false
    }
  }, [router])

  function cambiar(t) {
    setTab(t)
    setBusca('')
    setForm({ ...VACIOS[t] })
    setError('')
    setMensaje('')
  }

  function editar(reg) {
    setForm({
      ...VACIOS[tab],
      ...reg,
      factor_empaque: reg.factor_empaque ?? '',
      minimo_reposicion: reg.minimo_reposicion ?? 0,
      cantidad_reposicion: reg.cantidad_reposicion ?? 0
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function guardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    setMensaje('')

    try {
      const payload = {
        ...form,
        maximo: Number(form.maximo) || 0,
        factor_empaque:
          tab === 'materiales'
            ? (String(form.factor_empaque).trim() === ''
                ? null
                : Number(form.factor_empaque))
            : null,
        minimo_reposicion:
          tab === 'materiales' ? Number(form.minimo_reposicion) || 0 : undefined,
        cantidad_reposicion:
          tab === 'materiales' ? Number(form.cantidad_reposicion) || 0 : undefined
      }

      if (tab === 'materiales') {
        if (payload.minimo_reposicion < 0 || payload.cantidad_reposicion < 0) {
          throw new Error('El mínimo y la cantidad de reposición no pueden ser negativos.')
        }

        if (
          (payload.minimo_reposicion > 0 && payload.cantidad_reposicion <= 0) ||
          (payload.minimo_reposicion <= 0 && payload.cantidad_reposicion > 0)
        ) {
          throw new Error(
            'Configura juntos el mínimo de reposición y la cantidad del empaque, o deja ambos en cero.'
          )
        }
      }

      const { data, error: qe } = await supabase.rpc('qiora_catalogos_guardar', {
        p_tabla: tab,
        p_datos: payload
      })

      if (qe) throw qe
      if (!data?.ok) throw new Error('Guardado no confirmado')

      await actualizar()
      setForm({ ...VACIOS[tab] })
      setMensaje('Catálogo guardado correctamente.')
    } catch (ex) {
      setError(ex.message || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const registros = (datos[tab] || []).filter(x =>
    Object.values(x).some(v =>
      String(v ?? '').toUpperCase().includes(busca.toUpperCase())
    )
  )

  if (cargando) {
    return <main style={s.main}>Cargando catálogos...</main>
  }

  return (
    <main style={s.main}>
      <div style={s.marco}>
        <button style={s.btn} onClick={() => router.push('/inventarios')}>
          ← Regresar a Inventarios
        </button>

        <header style={s.hero}>
          <h1>CATÁLOGOS DE INVENTARIOS</h1>
          <p>Materiales y grupos administrados desde Supabase</p>
        </header>

        {error && <p style={s.error}>{error}</p>}
        {mensaje && <p style={s.exito}>{mensaje}</p>}

        {admin && (
          <>
            <div style={s.tabs}>
              <button style={s.btn} onClick={() => cambiar('materiales')}>
                MATERIALES
              </button>
              <button style={s.btn} onClick={() => cambiar('grupos')}>
                GRUPOS_MATERIALES
              </button>
            </div>

            <section style={s.card}>
              <h2>
                {tab === 'materiales'
                  ? 'Agregar / editar material'
                  : 'Agregar / editar grupo'}
              </h2>

              <form onSubmit={guardar} style={s.form}>
                {(tab === 'materiales'
                  ? CAMPOS_MATERIAL
                  : ['grupo', 'tipo', 'maximo']
                ).map(k => (
                  <label key={k}>
                    {k.toUpperCase()}

                    {k === 'grupo' && tab === 'materiales' ? (
                      <select
                        style={s.input}
                        value={form.grupo}
                        onChange={e =>
                          setForm(p => ({ ...p, grupo: e.target.value }))
                        }
                      >
                        {datos.grupos
                          .filter(g => g.activo || g.grupo === form.grupo)
                          .map(g => (
                            <option key={g.grupo} value={g.grupo}>
                              {g.grupo}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <input
                        style={s.input}
                        required={!['factor_empaque', 'minimo_reposicion', 'cantidad_reposicion'].includes(k)}
                        type={
                          [
                            'maximo',
                            'factor_empaque',
                            'minimo_reposicion',
                            'cantidad_reposicion'
                          ].includes(k)
                            ? 'number'
                            : 'text'
                        }
                        min={
                          [
                            'maximo',
                            'factor_empaque',
                            'minimo_reposicion',
                            'cantidad_reposicion'
                          ].includes(k)
                            ? 0
                            : undefined
                        }
                        step={
                          [
                            'factor_empaque',
                            'minimo_reposicion',
                            'cantidad_reposicion'
                          ].includes(k)
                            ? 'any'
                            : undefined
                        }
                        value={form[k] ?? ''}
                        readOnly={
                          k === (tab === 'materiales' ? 'sku' : 'grupo') &&
                          registros.some(r => r[k] === form[k])
                        }
                        onChange={e =>
                          setForm(p => ({ ...p, [k]: e.target.value }))
                        }
                      />
                    )}
                  </label>
                ))}

                <label>
                  ACTIVO
                  <select
                    style={s.input}
                    value={String(form.activo)}
                    onChange={e =>
                      setForm(p => ({ ...p, activo: e.target.value === 'true' }))
                    }
                  >
                    <option value="true">SI</option>
                    <option value="false">NO</option>
                  </select>
                </label>

                <button disabled={guardando} style={s.btn}>
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>

                <button
                  type="button"
                  style={s.btn}
                  onClick={() => setForm({ ...VACIOS[tab] })}
                >
                  Nuevo
                </button>
              </form>

              {tab === 'materiales' && (
                <p style={s.ayuda}>
                  MINIMO_REPOSICION es el umbral de existencias del técnico.
                  CANTIDAD_REPOSICION es la cantidad física que se propone
                  entregar. FACTOR_EMPAQUE indica las unidades por empaque y
                  no debe volver a multiplicarse si la cantidad ya está en
                  unidades físicas de inventario.
                </p>
              )}
            </section>

            <section style={s.card}>
              <h2>
                {tab === 'materiales' ? 'MATERIALES' : 'GRUPOS_MATERIALES'} (
                {registros.length})
              </h2>

              <input
                style={s.input}
                placeholder="Buscar SKU, nombre o grupo"
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />

              <div style={{ overflowX: 'auto' }}>
                <table style={s.tabla}>
                  <thead>
                    <tr>
                      {(tab === 'materiales'
                        ? [
                            'SKU',
                            'MATERIAL',
                            'TIPO',
                            'GRUPO',
                            'MAXIMO',
                            'ACTIVO',
                            'FACTOR_EMPAQUE',
                            'MINIMO_REPOSICION',
                            'CANTIDAD_REPOSICION'
                          ]
                        : ['GRUPO', 'TIPO', 'MAXIMO', 'ACTIVO']
                      ).map(x => (
                        <th key={x}>{x}</th>
                      ))}
                      <th>ACCIÓN</th>
                    </tr>
                  </thead>

                  <tbody>
                    {registros.map(r => (
                      <tr key={r.sku || r.grupo}>
                        {(tab === 'materiales'
                          ? [
                              'sku',
                              'material',
                              'tipo',
                              'grupo',
                              'maximo',
                              'activo',
                              'factor_empaque',
                              'minimo_reposicion',
                              'cantidad_reposicion'
                            ]
                          : ['grupo', 'tipo', 'maximo', 'activo']
                        ).map(k => (
                          <td key={k}>
                            {typeof r[k] === 'boolean'
                              ? (r[k] ? 'SI' : 'NO')
                              : (r[k] ?? '')}
                          </td>
                        ))}
                        <td>
                          <button style={s.btn} onClick={() => editar(r)}>
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}

                    {registros.length === 0 && (
                      <tr>
                        <td colSpan={tab === 'materiales' ? 10 : 5}>
                          Sin registros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

const s = {
  main: {
    minHeight: '100vh',
    background: '#062d23',
    padding: '20px',
    color: '#fff',
    fontFamily: 'Arial,sans-serif'
  },
  marco: { maxWidth: 1300, margin: 'auto' },
  hero: {
    textAlign: 'center',
    background: 'linear-gradient(100deg,#0a5a43,#1ca782)',
    padding: 20,
    borderRadius: 16
  },
  card: {
    background: '#0b3a2d',
    padding: 20,
    borderRadius: 15,
    marginTop: 20
  },
  tabs: { display: 'flex', gap: 12, marginTop: 20 },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
    gap: 14,
    alignItems: 'end'
  },
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: 11,
    borderRadius: 8,
    marginTop: 7,
    background: 'white',
    color: '#111',
    border: 0
  },
  btn: {
    border: 0,
    background: '#169c75',
    color: 'white',
    borderRadius: 9,
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  tabla: {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'white',
    color: '#14352c',
    marginTop: 15
  },
  error: { background: '#ffe2e2', color: '#8b1111', padding: 12 },
  exito: { background: '#d4f6e5', color: '#095b37', padding: 12 },
  ayuda: {
    marginTop: 14,
    color: '#bce9db',
    fontSize: 13,
    lineHeight: 1.5
  }
}
