'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const limpiar = valor =>
  String(valor ?? '').trim()

const mayus = valor =>
  limpiar(valor).toUpperCase()

function fechaCorta(fecha) {
  if (!fecha) return ''

  try {
    return new Intl.DateTimeFormat(
      'es-MX',
      {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }
    ).format(new Date(fecha))
  } catch {
    return String(fecha)
  }
}

function fechaHora(fecha) {
  if (!fecha) return ''

  try {
    return new Intl.DateTimeFormat(
      'es-MX',
      {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }
    ).format(new Date(fecha))
  } catch {
    return String(fecha)
  }
}

function numero(valor) {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

function escaparExcel(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default function VerRecoleccionesPage() {
  const router = useRouter()

  const [fechaInicial, setFechaInicial] =
    useState('')

  const [fechaFinal, setFechaFinal] =
    useState('')

  const [almacen, setAlmacen] =
    useState('')

  const [folio, setFolio] =
    useState('')

  const [serie, setSerie] =
    useState('')

  const [resultados, setResultados] =
    useState([])

  const [cargando, setCargando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [aviso, setAviso] =
    useState('')

  const [detalle, setDetalle] =
    useState(null)

  const [perfil, setPerfil] = useState(null)
  const [centroActivo, setCentroActivo] = useState('')
  const [almacenesCentro, setAlmacenesCentro] = useState([])
  const [cargandoPerfil, setCargandoPerfil] = useState(true)

  useEffect(() => {
    let vivo = true

    async function iniciar() {
      try {
        const { data, error: perfilError } = await supabase.rpc('qiora_mi_perfil')
        if (perfilError) throw perfilError
        if (!data || data.activo !== true) throw new Error('No existe un perfil activo.')

        const puesto = limpiar(data.puesto).toUpperCase()
        const esAdminPadre = puesto === 'ADMIN_PADRE'
        const centro = limpiar(data.distrito).toUpperCase()

        if (!esAdminPadre && !centro) throw new Error('El usuario no tiene centro/distrito configurado.')

        let permitidos = []
        if (!esAdminPadre) {
          const { data: almacenesData, error: almacenesError } = await supabase
            .from('almacen_usuarios')
            .select('usuario_almacen,distrito')
            .eq('distrito', centro)

          if (almacenesError) throw almacenesError
          permitidos = (almacenesData || [])
            .filter(a => limpiar(a.distrito).toUpperCase() === centro)
            .map(a => limpiar(a.usuario_almacen))
            .filter(Boolean)
          permitidos = [...new Set(permitidos)]
        }

        if (!vivo) return
        setPerfil(data)
        setCentroActivo(esAdminPadre ? 'TODOS' : centro)
        setAlmacenesCentro(permitidos)
      } catch (e) {
        if (vivo) setError(e?.message || 'No fue posible validar el centro activo.')
      } finally {
        if (vivo) setCargandoPerfil(false)
      }
    }

    iniciar()
    return () => { vivo = false }
  }, [])

  /*
    ================================
    BUSCAR
    ================================
  */

  async function buscar() {
    if (cargando) return

    setCargando(true)
    setError('')
    setAviso('')
    setDetalle(null)

    try {
      if (cargandoPerfil) throw new Error('Espera a que se valide el usuario y su centro.')
      if (!perfil) throw new Error('No existe perfil activo.')
      const puestoActual = limpiar(perfil.puesto).toUpperCase()
      const adminPadre = puestoActual === 'ADMIN_PADRE'
      if (!adminPadre && !almacenesCentro.length) {
        setResultados([])
        setAviso(`No hay almacenes configurados para el centro ${centroActivo}.`)
        return
      }

      let consulta =
        supabase
          .from('recolecciones_equipos')
          .select(`
            id,
            folio,
            fecha,
            almacen,
            tecnico,
            recibe,
            telefono,
            serie,
            material,
            descripcion,
            lote,
            dias_en_cajuela,
            estado,
            actualizado_en
          `)
          .order(
            'fecha',
            {
              ascending: false
            }
          )
          .order(
            'folio',
            {
              ascending: false
            }
          )

      // No se confía en un filtro de centro introducido por el usuario.
      // Los almacenes permitidos proceden del perfil y catálogo del distrito.
      if (!adminPadre) {
        consulta = consulta.in('almacen', almacenesCentro)
      }

      /*
        FECHA INICIAL
      */
      if (fechaInicial) {
        consulta =
          consulta.gte(
            'fecha',
            `${fechaInicial}T00:00:00-06:00`
          )
      }

      /*
        FECHA FINAL INCLUSIVA
      */
      if (fechaFinal) {
        const fin =
          new Date(
            `${fechaFinal}T00:00:00`
          )

        fin.setDate(
          fin.getDate() + 1
        )

        const siguiente =
          [
            fin.getFullYear(),
            String(
              fin.getMonth() + 1
            ).padStart(2, '0'),
            String(
              fin.getDate()
            ).padStart(2, '0')
          ].join('-')

        consulta =
          consulta.lt(
            'fecha',
            `${siguiente}T00:00:00-06:00`
          )
      }

      /*
        ALMACÉN
      */
      if (limpiar(almacen)) {
        consulta =
          consulta.ilike(
            'almacen',
            `%${limpiar(almacen)}%`
          )
      }

      /*
        FOLIO
      */
      if (limpiar(folio)) {
        consulta =
          consulta.ilike(
            'folio',
            `%${limpiar(folio)}%`
          )
      }

      /*
        SERIE
      */
      if (limpiar(serie)) {
        consulta =
          consulta.ilike(
            'serie',
            `%${limpiar(serie)}%`
          )
      }

      const {
        data,
        error: consultaError
      } = await consulta

      if (consultaError) {
        throw consultaError
      }

      const filas =
        Array.isArray(data)
          ? data
          : []

      setResultados(filas)

      if (!filas.length) {
        setAviso(
          'No se encontraron recolecciones con los filtros seleccionados.'
        )
      }

    } catch (e) {
      console.error(
        'ERROR VER RECOLECCIONES:',
        e
      )

      setError(
        e?.message ||
        'No fue posible consultar las recolecciones.'
      )

      setResultados([])

    } finally {
      setCargando(false)
    }
  }

  /*
    ================================
    LIMPIAR
    ================================
  */

  function limpiarFiltros() {
    setFechaInicial('')
    setFechaFinal('')
    setAlmacen('')
    setFolio('')
    setSerie('')
    setResultados([])
    setDetalle(null)
    setError('')
    setAviso('')
  }

  /*
    ================================
    FOLIOS ÚNICOS
    ================================
  */

  const foliosUnicos =
    Array.from(
      new Set(
        resultados
          .map(
            fila =>
              limpiar(
                fila.folio
              )
          )
          .filter(Boolean)
      )
    )

  const totalRecolecciones =
    foliosUnicos.length

  /*
    ================================
    DETALLE DE FOLIO
    ================================
  */

  function verFolio(
    folioSeleccionado
  ) {
    const filasFolio =
      resultados.filter(
        fila =>
          limpiar(
            fila.folio
          ) ===
          limpiar(
            folioSeleccionado
          )
      )

    if (!filasFolio.length) {
      return
    }

    setDetalle({
      folio:
        folioSeleccionado,

      cabecera:
        filasFolio[0],

      equipos:
        filasFolio
    })
  }

  /*
    ================================
    EXCEL
    ================================
  */

  function descargarExcel() {
    if (!resultados.length) {
      setError(
        'No hay resultados para descargar.'
      )

      return
    }

    setError('')

    const encabezados = [
      'Folio',
      'Fecha recibido',
      'Almacén',
      'Técnico',
      'Recibió',
      'Teléfono',
      'Serie',
      'Material',
      'Descripción',
      'Lote',
      'Días en cajuela',
      'Estatus'
    ]

    const filasHtml =
      resultados
        .map(
          r => `
            <tr>
              <td>${escaparExcel(r.folio)}</td>
              <td>${escaparExcel(fechaHora(r.fecha))}</td>
              <td>${escaparExcel(r.almacen)}</td>
              <td>${escaparExcel(r.tecnico)}</td>
              <td>${escaparExcel(r.recibe)}</td>
              <td>${escaparExcel(r.telefono)}</td>
              <td>${escaparExcel(r.serie)}</td>
              <td>${escaparExcel(r.material)}</td>
              <td>${escaparExcel(r.descripcion)}</td>
              <td>${escaparExcel(r.lote)}</td>
              <td>${escaparExcel(r.dias_en_cajuela)}</td>
              <td>${escaparExcel(r.estado)}</td>
            </tr>
          `
        )
        .join('')

    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
        </head>

        <body>

          <table border="1">

            <thead>
              <tr>
                ${encabezados
                  .map(
                    h =>
                      `<th>${escaparExcel(h)}</th>`
                  )
                  .join('')}
              </tr>
            </thead>

            <tbody>
              ${filasHtml}
            </tbody>

          </table>

        </body>
      </html>
    `

    const blob =
      new Blob(
        [html],
        {
          type:
            'application/vnd.ms-excel;charset=utf-8;'
        }
      )

    const url =
      URL.createObjectURL(blob)

    const enlace =
      document.createElement('a')

    const ahora =
      new Date()

    const nombre =
      `recolecciones_${ahora
        .toISOString()
        .slice(0, 10)}.xls`

    enlace.href = url
    enlace.download = nombre

    document.body.appendChild(
      enlace
    )

    enlace.click()

    document.body.removeChild(
      enlace
    )

    URL.revokeObjectURL(url)
  }

  /*
    ================================
    RENDER
    ================================
  */

  return (
    <main style={css.base}>

      <div style={css.marco}>

        <button
          type="button"
          style={css.regresar}
          onClick={() =>
            router.push(
              '/recolecciones'
            )
          }
        >
          ← Regresar a Recolecciones
        </button>

        <header style={css.hero}>

          <h1 style={css.titulo}>
            Ver Recolecciones
          </h1>

          <p style={css.subtitulo}>
            Consulta por fecha, folio, almacén o serie y descarga Excel. Centro activo: {centroActivo || 'CARGANDO'}.
          </p>

        </header>

        {cargandoPerfil && (
          <div style={css.aviso}>Validando usuario y centro...</div>
        )}

        {error && (
          <div style={css.error}>
            {error}
          </div>
        )}

        {aviso && (
          <div style={css.aviso}>
            {aviso}
          </div>
        )}

        {/*
          ================================
          FILTROS
          ================================
        */}

        <section style={css.panel}>

          <div style={css.filtros}>

            <label style={css.label}>
              Fecha inicial

              <input
                type="date"
                style={css.input}
                value={fechaInicial}
                onChange={
                  e =>
                    setFechaInicial(
                      e.target.value
                    )
                }
              />
            </label>

            <label style={css.label}>
              Fecha final

              <input
                type="date"
                style={css.input}
                value={fechaFinal}
                onChange={
                  e =>
                    setFechaFinal(
                      e.target.value
                    )
                }
              />
            </label>

            <label style={css.label}>
              Almacén

              <input
                type="text"
                style={css.input}
                placeholder="0008"
                value={almacen}
                onChange={
                  e =>
                    setAlmacen(
                      mayus(
                        e.target.value
                      )
                    )
                }
                onKeyDown={
                  e => {
                    if (
                      e.key ===
                      'Enter'
                    ) {
                      buscar()
                    }
                  }
                }
              />
            </label>

            <label style={css.label}>
              Folio

              <input
                type="text"
                style={css.input}
                placeholder="REC-PUE-"
                value={folio}
                onChange={
                  e =>
                    setFolio(
                      mayus(
                        e.target.value
                      )
                    )
                }
                onKeyDown={
                  e => {
                    if (
                      e.key ===
                      'Enter'
                    ) {
                      buscar()
                    }
                  }
                }
              />
            </label>

          </div>

          {/*
            TARJETAS
          */}

          <div style={css.tarjetas}>

            <div style={css.tarjeta}>
              <span style={css.tarjetaLabel}>
                Total recolecciones
              </span>

              <strong style={css.tarjetaValor}>
                {totalRecolecciones}
              </strong>
            </div>

            <div style={css.tarjeta}>
              <span style={css.tarjetaLabel}>
                Folio filtrado
              </span>

              <strong style={css.tarjetaValor}>
                {
                  limpiar(folio)
                    ? mayus(folio)
                    : 'TODAS'
                }
              </strong>
            </div>

            <div style={css.tarjeta}>
              <span style={css.tarjetaLabel}>
                Almacén filtrado
              </span>

              <strong style={css.tarjetaValor}>
                {
                  limpiar(almacen)
                    ? mayus(almacen)
                    : 'TODOS'
                }
              </strong>
            </div>

          </div>

          <div style={css.serieFila}>

            <label
              style={{
                ...css.label,
                flex: 1
              }}
            >
              Serie

              <input
                type="text"
                style={css.input}
                placeholder="Buscar serie"
                value={serie}
                onChange={
                  e =>
                    setSerie(
                      mayus(
                        e.target.value
                      )
                    )
                }
                onKeyDown={
                  e => {
                    if (
                      e.key ===
                      'Enter'
                    ) {
                      buscar()
                    }
                  }
                }
              />
            </label>

            <button
              type="button"
              style={css.boton}
              disabled={cargando}
              onClick={buscar}
            >
              {
                cargando
                  ? 'Buscando...'
                  : 'Buscar'
              }
            </button>

            <button
              type="button"
              style={css.boton}
              onClick={
                descargarExcel
              }
            >
              Descargar Excel
            </button>

            <button
              type="button"
              style={css.botonSecundario}
              onClick={
                limpiarFiltros
              }
            >
              Limpiar
            </button>

          </div>

        </section>

        {/*
          ================================
          RESULTADOS
          ================================
        */}

        <section style={css.panel}>

          <div style={css.tablaScroll}>

            <table style={css.tabla}>

              <thead>

                <tr>

                  <th style={css.th}>
                    Folio
                  </th>

                  <th style={css.th}>
                    Fecha recibido
                  </th>

                  <th style={css.th}>
                    Almacén
                  </th>

                  <th style={css.th}>
                    Técnico
                  </th>

                  <th style={css.th}>
                    Recibió
                  </th>

                  <th style={css.th}>
                    Serie
                  </th>

                  <th style={css.th}>
                    Material
                  </th>

                  <th style={css.th}>
                    Descripción
                  </th>

                  <th style={css.th}>
                    Lote
                  </th>

                  <th style={css.th}>
                    Días
                  </th>

                  <th style={css.th}>
                    Estatus
                  </th>

                  <th style={css.th}>
                    Acción
                  </th>

                </tr>

              </thead>

              <tbody>

                {resultados.length ? (

                  resultados.map(
                    fila => (

                      <tr
                        key={
                          fila.id
                        }
                      >

                        <td style={css.tdFolio}>
                          {
                            fila.folio
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fechaHora(
                              fila.fecha
                            )
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.almacen
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.tecnico
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.recibe
                          }
                        </td>

                        <td style={css.tdSerie}>
                          {
                            fila.serie
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.material ||
                            '-'
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.descripcion ||
                            '-'
                          }
                        </td>

                        <td style={css.td}>
                          {
                            fila.lote ||
                            '-'
                          }
                        </td>

                        <td
                          style={{
                            ...css.td,
                            textAlign:
                              'center'
                          }}
                        >
                          {
                            numero(
                              fila.dias_en_cajuela
                            )
                          }
                        </td>

                        <td style={css.td}>

                          <span
                            style={
                              mayus(
                                fila.estado
                              ) ===
                              'RECIBIDO'
                                ? css.estadoOk
                                : css.estadoNormal
                            }
                          >
                            {
                              fila.estado ||
                              '-'
                            }
                          </span>

                        </td>

                        <td style={css.td}>

                          <button
                            type="button"
                            style={css.botonTabla}
                            onClick={() =>
                              verFolio(
                                fila.folio
                              )
                            }
                          >
                            Ver folio
                          </button>

                        </td>

                      </tr>

                    )
                  )

                ) : (

                  <tr>

                    <td
                      colSpan={12}
                      style={css.sinResultados}
                    >
                      Sin resultados.
                    </td>

                  </tr>

                )}

              </tbody>

            </table>

          </div>

        </section>

        {/*
          ================================
          DETALLE FOLIO
          ================================
        */}

        {detalle && (

          <section style={css.detallePanel}>

            <div style={css.detalleTituloFila}>

              <div>

                <h2 style={css.detalleTitulo}>
                  Detalle de Recolección
                </h2>

                <strong>
                  {detalle.folio}
                </strong>

              </div>

              <button
                type="button"
                style={css.cerrar}
                onClick={() =>
                  setDetalle(null)
                }
              >
                ✕ Cerrar
              </button>

            </div>

            <div style={css.detalleGrid}>

              <div style={css.detalleDato}>
                <span>
                  Fecha
                </span>

                <strong>
                  {
                    fechaHora(
                      detalle
                        .cabecera
                        .fecha
                    )
                  }
                </strong>
              </div>

              <div style={css.detalleDato}>
                <span>
                  Almacén
                </span>

                <strong>
                  {
                    detalle
                      .cabecera
                      .almacen
                  }
                </strong>
              </div>

              <div style={css.detalleDato}>
                <span>
                  Técnico
                </span>

                <strong>
                  {
                    detalle
                      .cabecera
                      .tecnico
                  }
                </strong>
              </div>

              <div style={css.detalleDato}>
                <span>
                  Recibió
                </span>

                <strong>
                  {
                    detalle
                      .cabecera
                      .recibe
                  }
                </strong>
              </div>

              <div style={css.detalleDato}>
                <span>
                  Teléfono
                </span>

                <strong>
                  {
                    detalle
                      .cabecera
                      .telefono ||
                    '-'
                  }
                </strong>
              </div>

              <div style={css.detalleDato}>
                <span>
                  Equipos
                </span>

                <strong>
                  {
                    detalle
                      .equipos
                      .length
                  }
                </strong>
              </div>

            </div>

            <div style={css.tablaScroll}>

              <table style={css.tabla}>

                <thead>
                  <tr>
                    <th style={css.th}>
                      Serie
                    </th>

                    <th style={css.th}>
                      Material
                    </th>

                    <th style={css.th}>
                      Descripción
                    </th>

                    <th style={css.th}>
                      Lote
                    </th>

                    <th style={css.th}>
                      Días
                    </th>

                    <th style={css.th}>
                      Estatus
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {detalle.equipos.map(
                    equipo => (

                      <tr
                        key={
                          equipo.id
                        }
                      >

                        <td style={css.tdSerie}>
                          {
                            equipo.serie
                          }
                        </td>

                        <td style={css.td}>
                          {
                            equipo.material ||
                            '-'
                          }
                        </td>

                        <td style={css.td}>
                          {
                            equipo.descripcion ||
                            '-'
                          }
                        </td>

                        <td style={css.td}>
                          {
                            equipo.lote ||
                            '-'
                          }
                        </td>

                        <td style={css.td}>
                          {
                            numero(
                              equipo.dias_en_cajuela
                            )
                          }
                        </td>

                        <td style={css.td}>
                          {
                            equipo.estado ||
                            '-'
                          }
                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          </section>

        )}

      </div>

    </main>
  )
}

const css = {
  base: {
    minHeight: '100vh',
    background:
      'linear-gradient(180deg,#062d23 0%,#031d17 100%)',
    color: '#fff',
    padding: 12,
    fontFamily:
      'Arial, Helvetica, sans-serif'
  },

  marco: {
    maxWidth: 1500,
    margin: '0 auto',
    border: '1px solid #376b5c',
    borderRadius: 16,
    padding: 16,
    background: '#04251d'
  },

  regresar: {
    border: 0,
    borderRadius: 30,
    padding: '10px 16px',
    background: '#118366',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 16
  },

  hero: {
    background:
      'linear-gradient(120deg,#0f6048,#1db184)',
    padding: '24px 18px',
    textAlign: 'center',
    borderRadius: 14,
    border: '1px solid #48a58a',
    marginBottom: 16
  },

  titulo: {
    margin: 0,
    fontSize: 30
  },

  subtitulo: {
    margin:
      '7px 0 0',
    color: '#e4fff6'
  },

  panel: {
    border: '1px solid #376b5c',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    background: '#082c23'
  },

  filtros: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(4,minmax(150px,1fr))',
    gap: 14
  },

  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 700
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cadbd5',
    borderRadius: 9,
    padding: '11px 12px',
    background: '#f7faf9',
    color: '#183229',
    outline: 'none'
  },

  tarjetas: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(3,1fr)',
    gap: 12,
    margin:
      '14px 0'
  },

  tarjeta: {
    minHeight: 72,
    borderRadius: 12,
    background:
      'linear-gradient(120deg,#107353,#159b76)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10
  },

  tarjetaLabel: {
    fontSize: 12,
    fontWeight: 700
  },

  tarjetaValor: {
    fontSize: 22,
    marginTop: 5
  },

  serieFila: {
    display: 'flex',
    alignItems: 'end',
    gap: 12,
    flexWrap: 'wrap'
  },

  boton: {
    minWidth: 175,
    border: 0,
    borderRadius: 9,
    padding: '11px 18px',
    background: '#16a37c',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer'
  },

  botonSecundario: {
    minWidth: 100,
    border:
      '1px solid #62aa94',
    borderRadius: 9,
    padding: '10px 18px',
    background: '#0b4d3b',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer'
  },

  tablaScroll: {
    width: '100%',
    overflowX: 'auto',
    borderRadius: 10,
    border: '1px solid #427667'
  },

  tabla: {
    width: '100%',
    minWidth: 1200,
    borderCollapse:
      'collapse',
    background: '#f8fbfa',
    color: '#163329'
  },

  th: {
    background: '#11795d',
    color: '#fff',
    padding: '10px 8px',
    fontSize: 12,
    borderRight:
      '1px solid #a8cfc2',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0
  },

  td: {
    borderBottom:
      '1px solid #d5e3de',
    padding: '9px 8px',
    fontSize: 12,
    verticalAlign: 'middle'
  },

  tdFolio: {
    borderBottom:
      '1px solid #d5e3de',
    padding: '9px 8px',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap'
  },

  tdSerie: {
    borderBottom:
      '1px solid #d5e3de',
    padding: '9px 8px',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap'
  },

  sinResultados: {
    textAlign: 'center',
    padding: 18,
    color: '#475b54'
  },

  botonTabla: {
    border: 0,
    borderRadius: 7,
    background: '#118e6d',
    color: '#fff',
    fontWeight: 700,
    padding: '7px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },

  estadoOk: {
    display: 'inline-block',
    background: '#d9f8e9',
    color: '#08714e',
    padding: '4px 7px',
    borderRadius: 20,
    fontWeight: 700
  },

  estadoNormal: {
    display: 'inline-block',
    background: '#e5ece9',
    color: '#344d44',
    padding: '4px 7px',
    borderRadius: 20,
    fontWeight: 700
  },

  detallePanel: {
    border: '1px solid #47907a',
    borderRadius: 14,
    background: '#0a3329',
    padding: 16,
    marginBottom: 20
  },

  detalleTituloFila: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    gap: 15,
    marginBottom: 15
  },

  detalleTitulo: {
    margin: '0 0 5px',
    fontSize: 22
  },

  cerrar: {
    border: 0,
    borderRadius: 8,
    padding: '9px 14px',
    background: '#a73535',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer'
  },

  detalleGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(170px,1fr))',
    gap: 10,
    marginBottom: 15
  },

  detalleDato: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    border: '1px solid #3d7464',
    borderRadius: 9,
    padding: 10,
    background: '#06271f'
  },

  error: {
    background: '#ffe0e0',
    color: '#8e2525',
    borderRadius: 9,
    padding: 12,
    marginBottom: 14,
    fontWeight: 700
  },

  aviso: {
    background: '#fff1c9',
    color: '#72530d',
    borderRadius: 9,
    padding: 12,
    marginBottom: 14,
    fontWeight: 700
  }
}
