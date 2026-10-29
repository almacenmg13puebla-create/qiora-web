'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const texto = (v) => String(v ?? '').trim()
const mayus = (v) => texto(v).toUpperCase()

function fechaHora(valor) {
  if (!valor) return '-'

  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(valor))
  } catch {
    return String(valor)
  }
}

function celdaExcel(valor) {
  let s = String(valor ?? '')

  // Evita que Excel interprete contenido como fórmulas.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s

  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default function ValidacionesBrmPage() {
  const router = useRouter()

  const [perfil, setPerfil] = useState(null)
  const [centro, setCentro] = useState('')
  const [serie, setSerie] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [folio, setFolio] = useState('')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [inicializando, setInicializando] = useState(true)
  const [validandoId, setValidandoId] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const puesto = mayus(perfil?.puesto)
  const esAdministrador =
    puesto === 'ADMIN_PADRE' || puesto.startsWith('ADMIN_')
  const esTecnico = puesto === 'TECNICO'

  /*
   * CARGAR PERFIL ACTIVO.
   * El centro se obtiene del perfil autenticado, no de un filtro
   * que el usuario pueda cambiar desde la pantalla.
   */
  useEffect(() => {
    let vivo = true

    async function iniciar() {
      try {
        const { data, error: perfilError } =
          await supabase.rpc('qiora_mi_perfil')

        if (perfilError) throw perfilError

        if (!data || data.activo !== true) {
          throw new Error('No existe un perfil activo.')
        }

        const puestoPerfil = mayus(data.puesto)
        const admin =
          puestoPerfil === 'ADMIN_PADRE' ||
          puestoPerfil.startsWith('ADMIN_')

        if (!admin && data.ver_brm !== true) {
          throw new Error('No tienes permiso para Ver Validaciones BRM.')
        }

        const centroPerfil = mayus(data.distrito)

        if (puestoPerfil !== 'ADMIN_PADRE' && !centroPerfil) {
          throw new Error('El perfil no tiene centro/distrito configurado.')
        }

        if (!vivo) return

        setPerfil(data)
        setCentro(puestoPerfil === 'ADMIN_PADRE' ? 'TODOS' : centroPerfil)

        if (puestoPerfil === 'TECNICO') {
          setAlmacen(texto(data.usuario_almacen))
        }
      } catch (e) {
        if (vivo) {
          setError(e?.message || 'No fue posible cargar el perfil.')
        }
      } finally {
        if (vivo) setInicializando(false)
      }
    }

    iniciar()

    return () => {
      vivo = false
    }
  }, [])

  /*
   * CONSULTA.
   * Filtra por el centro derivado del perfil activo.
   * Supabase también debe tener RLS por centro.
   */
  const cargarRegistros = useCallback(async (filtros = {}) => {
    if (!perfil || !centro) return

    setCargando(true)
    setError('')
    setAviso('')

    try {
      const esAdminPadre = mayus(perfil.puesto) === 'ADMIN_PADRE'
      let consulta = supabase
        .from('validaciones_brm')
        .select(`
          id,
          folio,
          fecha,
          distrito,
          centro,
          almacen,
          tecnico,
          serie,
          sku,
          descripcion,
          lote,
          cuenta,
          mac,
          ot,
          os,
          evidencia_path,
          estado,
          validado_por,
          validado_en,
          creado_por,
          creado_en
        `)
        .order('fecha', { ascending: false })

      if (!esAdminPadre) {
        consulta = consulta.eq('centro', centro)
      }

      const serieFiltro = texto(filtros.serie ?? serie)
      const almacenFiltro = texto(filtros.almacen ?? almacen)
      const folioFiltro = texto(filtros.folio ?? folio)

      if (serieFiltro) {
        consulta = consulta.ilike('serie', `%${mayus(serieFiltro)}%`)
      }

      if (almacenFiltro) {
        consulta = consulta.ilike('almacen', `%${almacenFiltro}%`)
      }

      if (folioFiltro) {
        consulta = consulta.ilike('folio', `%${mayus(folioFiltro)}%`)
      }

      const { data, error: consultaError } = await consulta

      if (consultaError) throw consultaError

      setFilas(Array.isArray(data) ? data : [])
    } catch (e) {
      setFilas([])
      setError(e?.message || 'No fue posible consultar las validaciones.')
    } finally {
      setCargando(false)
    }
  }, [perfil, centro, serie, almacen, folio])

  /*
   * CARGAR AL TENER PERFIL Y CENTRO.
   */
  useEffect(() => {
    if (perfil && centro) {
      cargarRegistros({
        serie: '',
        folio: '',
        almacen: esTecnico ? texto(perfil.usuario_almacen) : '',
      })
    }
  }, [perfil, centro, cargarRegistros, esTecnico])

  async function buscar(e) {
    e?.preventDefault()
    await cargarRegistros({ serie, almacen, folio })
  }

  async function actualizar() {
    await cargarRegistros({ serie, almacen, folio })
  }

  async function limpiarFiltros() {
    const almacenInicial = esTecnico
      ? texto(perfil?.usuario_almacen)
      : ''

    setSerie('')
    setFolio('')
    setAlmacen(almacenInicial)

    await cargarRegistros({
      serie: '',
      folio: '',
      almacen: almacenInicial,
    })
  }

  /*
   * EVIDENCIA EN BUCKET PRIVADO.
   * La política de Storage debe permitir acceso únicamente al centro.
   */
  async function verEvidencia(path) {
    if (!path) {
      setError('Este registro no tiene evidencia adjunta.')
      return
    }

    setError('')

    try {
      const { data, error: storageError } = await supabase.storage
        .from('brm-evidencias')
        .createSignedUrl(path, 120)

      if (storageError) throw storageError
      if (!data?.signedUrl) throw new Error('No se pudo generar el enlace de evidencia.')

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e?.message || 'No fue posible abrir la evidencia.')
    }
  }

  /*
   * VALIDAR REGISTRO.
   * La RPC debe comprobar nuevamente el centro y el permiso en servidor.
   */
  async function validar(fila) {
    if (mayus(fila.estado) === 'VALIDADO') return

    if (!window.confirm(`¿Validar el folio ${fila.folio}?`)) return

    setValidandoId(fila.id)
    setError('')
    setAviso('')

    try {
      const { data, error: validarError } = await supabase.rpc(
        'qiora_brm_validar',
        { p_folio: fila.folio }
      )

      if (validarError) throw validarError

      setAviso(
        `Folio ${data?.folio || fila.folio} validado en el centro ${data?.centro || centro}.`
      )

      await cargarRegistros({ serie, almacen, folio })
    } catch (e) {
      setError(e?.message || 'No fue posible validar el registro.')
    } finally {
      setValidandoId(null)
    }
  }

  /*
   * DESCARGAR EXCEL.
   * Exporta únicamente las filas que ya fueron consultadas y filtradas.
   */
  function descargarExcel() {
    if (!filas.length) {
      setError('No hay registros para descargar.')
      return
    }

    setError('')

    const columnas = [
      ['Folio', 'folio'],
      ['Fecha', 'fecha'],
      ['Centro', 'centro'],
      ['Distrito', 'distrito'],
      ['Almacén', 'almacen'],
      ['Técnico', 'tecnico'],
      ['Serie', 'serie'],
      ['SKU', 'sku'],
      ['Descripción', 'descripcion'],
      ['Lote', 'lote'],
      ['Cuenta', 'cuenta'],
      ['MAC', 'mac'],
      ['OT', 'ot'],
      ['OS', 'os'],
      ['Estado', 'estado'],
      ['Creado por', 'creado_por'],
      ['Validado por', 'validado_por'],
      ['Validado en', 'validado_en'],
    ]

    const encabezados = columnas
      .map(([titulo]) => `<th>${celdaExcel(titulo)}</th>`)
      .join('')

    const cuerpo = filas.map((fila) => {
      const celdas = columnas.map(([, campo]) => {
        const valor =
          campo === 'fecha' || campo === 'validado_en'
            ? fechaHora(fila[campo])
            : fila[campo]

        return `<td>${celdaExcel(valor)}</td>`
      }).join('')

      return `<tr>${celdas}</tr>`
    }).join('')

    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <table border="1">
            <thead><tr>${encabezados}</tr></thead>
            <tbody>${cuerpo}</tbody>
          </table>
        </body>
      </html>
    `

    const blob = new Blob(
      ['\ufeff', html],
      { type: 'application/vnd.ms-excel;charset=utf-8;' }
    )

    const url = URL.createObjectURL(blob)
    const enlace = document.createElement('a')

    enlace.href = url
    enlace.download =
      `VALIDACIONES_BRM_${centro}_${new Date().toISOString().slice(0, 10)}.xls`

    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()

    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (inicializando) {
    return (
      <main style={css.base}>
        <div style={css.marco}>
          <p>Cargando Validaciones BRM...</p>
        </div>
      </main>
    )
  }

  return (
    <main style={css.base}>
      <div style={css.marco}>

        <button
          type="button"
          style={css.regresar}
          onClick={() => router.push('/')}
        >
          ← Regresar
        </button>

        <header style={css.hero}>
          <h1 style={css.titulo}>Ver Validaciones BRM</h1>
          <p style={css.subtitulo}>
            Consulta, descarga y valida registros · Centro {centro || '-'}
          </p>
        </header>

        <div style={css.estadoFila}>
          <span style={css.etiquetaCentro}>
            Centro activo: {centro || 'SIN CENTRO'}
          </span>
        </div>

        {error && (
          <div role="alert" style={css.error}>
            {error}
          </div>
        )}

        {aviso && (
          <div role="status" style={css.exito}>
            {aviso}
          </div>
        )}

        <section style={css.panel}>

          <form onSubmit={buscar} style={css.filtros}>

            <label style={css.label}>
              Serie
              <input
                style={css.input}
                value={serie}
                placeholder="Buscar serie"
                onChange={(e) => setSerie(mayus(e.target.value))}
              />
            </label>

            <label style={css.label}>
              Almacén
              <input
                style={{
                  ...css.input,
                  ...(esTecnico ? css.readonly : {}),
                }}
                value={almacen}
                readOnly={esTecnico}
                placeholder="0000"
                onChange={(e) => setAlmacen(texto(e.target.value))}
              />
            </label>

            <label style={css.label}>
              Folio
              <input
                style={css.input}
                value={folio}
                placeholder="BRM-..."
                onChange={(e) => setFolio(mayus(e.target.value))}
              />
            </label>

            <button
              type="submit"
              style={css.buscar}
              disabled={cargando}
            >
              {cargando ? 'Buscando...' : 'Buscar'}
            </button>

          </form>

          <div style={css.acciones}>
            <button
              type="button"
              style={css.botonPrincipal}
              disabled={cargando}
              onClick={actualizar}
            >
              {cargando ? 'Actualizando...' : 'Actualizar'}
            </button>

            <button
              type="button"
              style={css.botonPrincipal}
              onClick={descargarExcel}
            >
              Descargar Excel
            </button>

            <button
              type="button"
              style={css.botonSecundario}
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </button>
          </div>

          <div style={css.resumen}>
            <div style={css.resumenCaja}>
              <span>Centro</span>
              <strong>{centro || '-'}</strong>
            </div>

            <div style={css.resumenCaja}>
              <span>Registros encontrados</span>
              <strong>{filas.length}</strong>
            </div>

            <div style={css.resumenCaja}>
              <span>Pendientes</span>
              <strong>
                {filas.filter((f) => mayus(f.estado) !== 'VALIDADO').length}
              </strong>
            </div>

            <div style={css.resumenCaja}>
              <span>Validados</span>
              <strong>
                {filas.filter((f) => mayus(f.estado) === 'VALIDADO').length}
              </strong>
            </div>
          </div>

          <div style={css.scroll}>
            <table style={css.tabla}>
              <thead>
                <tr>
                  {[
                    'Folio',
                    'Fecha',
                    'Centro',
                    'Serie',
                    'SKU',
                    'Almacén',
                    'Técnico',
                    'Cuenta',
                    'MAC',
                    'OT',
                    'OS',
                    'Evidencia',
                    'Estado',
                    'Acción',
                  ].map((titulo) => (
                    <th key={titulo} style={css.th}>{titulo}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filas.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={css.sinResultados}>
                      {cargando ? 'Consultando registros...' : 'Sin resultados para este centro y filtros.'}
                    </td>
                  </tr>
                ) : (
                  filas.map((fila) => {
                    const yaValidado = mayus(fila.estado) === 'VALIDADO'

                    return (
                      <tr key={fila.id}>
                        <td style={css.tdFolio}>{fila.folio || '-'}</td>
                        <td style={css.td}>{fechaHora(fila.fecha)}</td>
                        <td style={css.tdCentro}>{fila.centro || '-'}</td>
                        <td style={css.td}>{fila.serie || '-'}</td>
                        <td style={css.td}>{fila.sku || '-'}</td>
                        <td style={css.td}>{fila.almacen || '-'}</td>
                        <td style={css.td}>{fila.tecnico || '-'}</td>
                        <td style={css.td}>{fila.cuenta || '-'}</td>
                        <td style={css.td}>{fila.mac || '-'}</td>
                        <td style={css.td}>{fila.ot || '-'}</td>
                        <td style={css.td}>{fila.os || '-'}</td>

                        <td style={css.td}>
                          {fila.evidencia_path ? (
                            <button
                              type="button"
                              style={css.botonTabla}
                              onClick={() => verEvidencia(fila.evidencia_path)}
                            >
                              Ver imagen
                            </button>
                          ) : '-'}
                        </td>

                        <td style={css.td}>
                          <span style={yaValidado ? css.validado : css.pendiente}>
                            {fila.estado || 'PENDIENTE'}
                          </span>
                        </td>

                        <td style={css.td}>
                          {yaValidado ? (
                            <span style={css.textoValidado}>Validado</span>
                          ) : (
                            <button
                              type="button"
                              style={css.botonValidar}
                              disabled={validandoId === fila.id}
                              onClick={() => validar(fila)}
                            >
                              {validandoId === fila.id ? 'Validando...' : 'Validar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

        </section>

        <p style={css.pie}>
          Las consultas y operaciones deben estar protegidas también por las políticas RLS y las funciones de Supabase.
        </p>

      </div>
    </main>
  )
}

const css = {
  base: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    background: 'linear-gradient(180deg, #062d23, #031d17)',
    color: '#fff',
    padding: 16,
    fontFamily: 'Arial, Helvetica, sans-serif',
  },

  marco: {
    maxWidth: 1500,
    margin: '0 auto',
    border: '1px solid #407567',
    borderRadius: 16,
    padding: 16,
    background: '#04251d',
  },

  regresar: {
    border: 0,
    borderRadius: 25,
    padding: '9px 16px',
    background: '#128365',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 14,
  },

  hero: {
    background: 'linear-gradient(120deg, #10533f, #18a67b)',
    border: '1px solid #43a184',
    padding: 24,
    borderRadius: 15,
    textAlign: 'center',
  },

  titulo: {
    margin: 0,
    fontSize: 30,
  },

  subtitulo: {
    margin: '7px 0 0',
    color: '#e4fff6',
  },

  estadoFila: {
    display: 'flex',
    justifyContent: 'flex-end',
    margin: '14px 0',
  },

  etiquetaCentro: {
    display: 'inline-block',
    background: '#117a5e',
    borderRadius: 25,
    padding: '8px 14px',
    fontWeight: 700,
  },

  panel: {
    border: '1px solid #376f60',
    background: '#082e25',
    borderRadius: 14,
    padding: 16,
  },

  filtros: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
    alignItems: 'end',
  },

  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 13,
    fontWeight: 700,
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #c8d7d2',
    borderRadius: 8,
    padding: 11,
    background: '#fff',
    color: '#19332a',
  },

  readonly: {
    background: '#e3e8e6',
    cursor: 'not-allowed',
  },

  buscar: {
    border: 0,
    borderRadius: 9,
    padding: 12,
    background: '#19a77e',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  acciones: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
    marginTop: 14,
  },

  botonPrincipal: {
    width: '100%',
    border: 0,
    borderRadius: 10,
    padding: 12,
    background: '#16a67d',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  botonSecundario: {
    width: '100%',
    border: '1px solid #5c9b89',
    borderRadius: 10,
    padding: 10,
    background: '#0d513f',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  resumen: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 10,
    margin: '14px 0',
  },

  resumenCaja: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    background: '#0d5f49',
    border: '1px solid #347d68',
    borderRadius: 10,
    padding: 12,
    textAlign: 'center',
  },

  scroll: {
    marginTop: 12,
    width: '100%',
    overflowX: 'auto',
    borderRadius: 9,
  },

  tabla: {
    width: '100%',
    minWidth: 1400,
    borderCollapse: 'collapse',
    background: '#f7fbf9',
    color: '#18352b',
  },

  th: {
    background: '#117a5e',
    color: '#fff',
    padding: 9,
    border: '1px solid #abd1c4',
    whiteSpace: 'nowrap',
    fontSize: 12,
  },

  td: {
    padding: 8,
    border: '1px solid #d0e0da',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },

  tdFolio: {
    padding: 8,
    border: '1px solid #d0e0da',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },

  tdCentro: {
    padding: 8,
    border: '1px solid #d0e0da',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },

  botonTabla: {
    border: 0,
    borderRadius: 7,
    background: '#147a69',
    color: '#fff',
    padding: '7px 10px',
    cursor: 'pointer',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },

  botonValidar: {
    border: 0,
    borderRadius: 7,
    background: '#159b63',
    color: '#fff',
    padding: '7px 10px',
    cursor: 'pointer',
    fontWeight: 700,
  },

  validado: {
    display: 'inline-block',
    background: '#d9f7e8',
    color: '#08714c',
    padding: '5px 9px',
    borderRadius: 20,
    fontWeight: 700,
  },

  pendiente: {
    display: 'inline-block',
    background: '#fff1c7',
    color: '#7b5b0f',
    padding: '5px 9px',
    borderRadius: 20,
    fontWeight: 700,
  },

  textoValidado: {
    color: '#08714c',
    fontWeight: 700,
  },

  sinResultados: {
    textAlign: 'center',
    padding: 20,
    color: '#53675f',
  },

  error: {
    background: '#ffe0e0',
    color: '#8e2525',
    padding: 12,
    borderRadius: 8,
    margin: '14px 0',
  },

  exito: {
    background: '#dff9e9',
    color: '#17623e',
    padding: 12,
    borderRadius: 8,
    margin: '14px 0',
  },

  pie: {
    color: '#b9d7cd',
    fontSize: 12,
    marginTop: 14,
  },
}
