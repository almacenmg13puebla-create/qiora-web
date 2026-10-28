'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()

const formatPhone = raw => {
  const digits = clean(raw).replace(/\D/g, '')

  if (digits.length === 10) return `52${digits}`

  if (digits.length >= 11 && digits.length <= 15) {
    return digits
  }

  return ''
}

const makeText = r => {
  const lines = [
    'RECEPCIÓN DE RECOLECCIONES',
    `Folio: ${r.folio}`,
    `Distrito: ${r.distrito || ''}`,
    `Almacén: ${r.almacen}`,
    `Técnico: ${r.tecnico}`,
    `Recibe: ${r.recibe}`,
    `Series recibidas: ${(r.series || []).length}`,
    ''
  ]

  for (const m of (r.series || [])) {
    lines.push(
      `${m.serie} | ${m.sku || m.material || ''} | ${m.material || ''} | ${m.lote || ''} | ${m.dias ?? 0} días`
    )
  }

  return lines.join('\n')
}

export default function RecoleccionesPage() {
  const router = useRouter()

  const [folio, setFolio] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [datos, setDatos] = useState(null)

  const [recibe, setRecibe] = useState('')
  const [usuarioActivo, setUsuarioActivo] = useState('')

  const [captura, setCaptura] = useState('')
  const [entregadas, setEntregadas] = useState([])

  const [guardado, setGuardado] = useState(null)

  const [busy, setBusy] = useState(false)
  const [cargandoUsuario, setCargandoUsuario] = useState(true)

  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const inputSerie = useRef(null)

  /*
    Catálogo completo cargado desde IQ09_EQUIPOS.
  */
  const catalogo = useMemo(
    () => datos?.equipos || [],
    [datos]
  )

  /*
    Solo los equipos que todavía NO han sido
    escaneados / entregados.
  */
  const pendientes = useMemo(() => {
    return catalogo.filter(
      equipo =>
        !entregadas.some(
          entregado =>
            upper(entregado.serie) === upper(equipo.serie)
        )
    )
  }, [catalogo, entregadas])

  /*
    Obtener usuario activo.

    RECIBE debe ser el usuario que inició sesión,
    no el técnico cuyo almacén estamos cargando.
  */
  useEffect(() => {
    let activo = true

    async function cargarUsuarioActivo() {
      setCargandoUsuario(true)

      try {
        const {
          data: { user },
          error: authError
        } = await supabase.auth.getUser()

        if (authError) {
          throw authError
        }

        if (!user?.id) {
          throw new Error('No existe una sesión activa.')
        }

        const {
          data,
          error: perfilError
        } = await supabase.rpc('qiora_mi_perfil')

        if (perfilError) {
          throw perfilError
        }

        const nombre = clean(data?.nombre)

        if (!nombre) {
          throw new Error(
            'No fue posible identificar el nombre del usuario activo.'
          )
        }

        if (activo) {
          setUsuarioActivo(nombre)
          setRecibe(nombre)
        }
      } catch (e) {
        console.error(
          'ERROR CARGANDO USUARIO ACTIVO:',
          e
        )

        if (activo) {
          setError(
            e.message ||
            'No fue posible identificar al usuario activo.'
          )
        }
      } finally {
        if (activo) {
          setCargandoUsuario(false)
        }
      }
    }

    cargarUsuarioActivo()

    return () => {
      activo = false
    }
  }, [])

  const ejecutar = async fn => {
    setError('')
    setMensaje('')
    setBusy(true)

    try {
      await fn()
    } catch (e) {
      console.error('ERROR RECOLECCIONES:', e)

      setError(
        e.message ||
        'Ocurrió un error.'
      )
    } finally {
      setBusy(false)
    }
  }

  /*
    Cargar los equipos TPE USADO del técnico.
  */
  const cargar = () =>
    ejecutar(async () => {
      const almacenLimpio = clean(almacen)

      if (!almacenLimpio) {
        throw new Error(
          'Ingresa el almacén del técnico.'
        )
      }

      if (!usuarioActivo) {
        throw new Error(
          'No se ha identificado al usuario que recibe.'
        )
      }

      const {
        data,
        error: e
      } = await supabase.rpc(
        'qiora_rec_cargar',
        {
          p_almacen: almacenLimpio
        }
      )

      if (e) {
        throw e
      }

      if (!data) {
        throw new Error(
          'No se recibió información del almacén.'
        )
      }

      if (!clean(data.tecnico)) {
        throw new Error(
          'No se encontró el técnico correspondiente al almacén.'
        )
      }

      setDatos(data)
      setEntregadas([])
      setGuardado(null)
      setFolio('')
      setCaptura('')

      /*
        RECIBE permanece siendo el usuario activo.
      */
      setRecibe(usuarioActivo)

      setMensaje(
        `Técnico identificado: ${data.tecnico}. ` +
        `Equipos en SAP: ${(data.equipos || []).length}`
      )

      setTimeout(() => {
        inputSerie.current?.focus()
      }, 0)
    })

  /*
    Agregar una serie a Series entregadas.

    Al entrar a entregadas desaparece automáticamente
    de pendientes / Series en SAP.
  */
  const agregar = () => {
    setError('')
    setMensaje('')

    const serie = upper(captura)

    if (!datos) {
      setError(
        'Primero carga el almacén del técnico.'
      )
      return
    }

    if (guardado) {
      setError(
        'Esta recolección ya fue guardada.'
      )
      return
    }

    if (!serie) {
      return
    }

    const equipo = catalogo.find(
      e => upper(e.serie) === serie
    )

    if (!equipo) {
      setError(
        `La serie ${serie} no pertenece a este técnico con lote TPE USADO.`
      )
      return
    }

    const yaEntregada = entregadas.some(
      e => upper(e.serie) === serie
    )

    if (yaEntregada) {
      setError(
        `La serie ${serie} ya fue escaneada.`
      )

      setCaptura('')

      inputSerie.current?.focus()

      return
    }

    setEntregadas(prev => [
      ...prev,
      equipo
    ])

    setCaptura('')

    setTimeout(() => {
      inputSerie.current?.focus()
    }, 0)
  }

  /*
    Eliminar de Series entregadas.

    No necesitamos agregarla manualmente a Series en SAP:
    al salir de entregadas vuelve automáticamente a
    "pendientes".
  */
  const eliminarSerie = serie => {
    if (guardado) return

    setEntregadas(prev =>
      prev.filter(
        item =>
          upper(item.serie) !== upper(serie)
      )
    )

    setError('')
    setMensaje('')

    setTimeout(() => {
      inputSerie.current?.focus()
    }, 0)
  }

  const enviarWhatsapp = r => {
    const telefono = formatPhone(
      r.telefono
    )

    if (!telefono) {
      setMensaje(
        `Recolección ${r.folio} guardada. ` +
        'El técnico no tiene un teléfono válido registrado; ' +
        'no se abrió WhatsApp.'
      )
      return
    }

    const url =
      `https://wa.me/${telefono}?text=` +
      encodeURIComponent(
        makeText(r)
      )

    const ventana = window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    )

    if (!ventana) {
      setMensaje(
        `Guardado: ${r.folio}. ` +
        `El navegador bloqueó WhatsApp. ` +
        `Ábrelo desde este enlace: ${url}`
      )
    } else {
      setMensaje(
        `Guardado: ${r.folio}. ` +
        'WhatsApp abierto; confirma manualmente el envío.'
      )
    }
  }

  /*
    Guardar la recolección.

    qiora_rec_guardar es responsable de insertar
    cada serie en public.recolecciones_equipos.
  */
  const guardar = () =>
    ejecutar(async () => {
      if (guardado) {
        throw new Error(
          'Esta recolección ya está guardada.'
        )
      }

      if (!datos) {
        throw new Error(
          'Primero carga el técnico.'
        )
      }

      if (!usuarioActivo) {
        throw new Error(
          'No fue posible identificar al usuario que recibe.'
        )
      }

      if (!entregadas.length) {
        throw new Error(
          'Escanea al menos una serie.'
        )
      }

      const series = entregadas.map(
        s => upper(s.serie)
      )

      const {
        data,
        error: e
      } = await supabase.rpc(
        'qiora_rec_guardar',
        {
          p_almacen: datos.almacen,
          p_recibe: usuarioActivo,
          p_series: series
        }
      )

      if (e) {
        throw e
      }

      if (!data?.folio) {
        throw new Error(
          'Supabase guardó la operación sin devolver un folio válido.'
        )
      }

      setGuardado(data)
      setFolio(data.folio)

      /*
        Conservamos exactamente las series guardadas.
      */
      setEntregadas(
        Array.isArray(data.series)
          ? data.series
          : entregadas
      )

      setRecibe(
        data.recibe ||
        usuarioActivo
      )

      enviarWhatsapp(data)
    })

  /*
    Limpiar captura pero conservar el usuario activo
    en RECIBE.
  */
  const limpiar = () => {
    setFolio('')
    setAlmacen('')
    setDatos(null)

    setRecibe(
      usuarioActivo
    )

    setCaptura('')
    setEntregadas([])
    setGuardado(null)
    setError('')
    setMensaje('')
  }

  return (
    <main className="rec">
      <div className="wrap">

        <button
          className="back"
          onClick={() =>
            router.push('/acceso-almacen')
          }
        >
          ← Regresar a Acceso Almacén
        </button>

        <header>
          <h1>
            Recepción de Recolecciones
          </h1>

          <p>
            Solo equipos de iq09_equipos
            con lote TPE USADO.
          </p>
        </header>

        <section>

          <div className="fields">

            <label>
              Folio

              <input
                placeholder="Se genera al guardar"
                value={folio}
                readOnly
              />
            </label>

            <label>
              Almacén

              <input
                placeholder="0008"
                value={almacen}
                disabled={
                  busy ||
                  !!guardado
                }
                onChange={e =>
                  setAlmacen(
                    e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 4)
                  )
                }
                onKeyDown={e => {
                  if (
                    e.key === 'Enter'
                  ) {
                    e.preventDefault()
                    cargar()
                  }
                }}
              />
            </label>

            <label>
              Técnico

              <input
                readOnly
                value={
                  datos?.tecnico ||
                  ''
                }
              />
            </label>

            <label>
              Recibe

              <input
                value={
                  cargandoUsuario
                    ? 'Cargando usuario...'
                    : recibe
                }
                readOnly
              />
            </label>

          </div>

          <div className="controls">

            <button
              disabled={
                busy ||
                !!guardado ||
                cargandoUsuario
              }
              onClick={cargar}
            >
              {busy
                ? 'Cargando...'
                : 'Cargar recolección'}
            </button>

          </div>

          <div className="stats">

            <article>
              Series en SAP

              <strong>
                {pendientes.length}
              </strong>
            </article>

            <article>
              Series entregadas

              <strong>
                {entregadas.length}
              </strong>
            </article>

            <article>
              Total técnico

              <strong>
                {catalogo.length}
              </strong>
            </article>

          </div>

        </section>

        <section className="columns">

          {/* SERIES ENTREGADAS */}

          <div>

            <h3>
              Series entregadas
            </h3>

            <div className="scroll">

              <table>

                <thead>
                  <tr>
                    <th>
                      Cantidad
                    </th>

                    <th>
                      Serie
                    </th>

                    <th>
                      Material
                    </th>

                    <th>
                      Días
                    </th>

                    <th>
                      Acción
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {entregadas.length ? (

                    entregadas.map(
                      s => (
                        <tr
                          key={s.serie}
                        >

                          <td>
                            1
                          </td>

                          <td>
                            {s.serie}
                          </td>

                          <td>
                            {s.material}
                          </td>

                          <td>
                            {s.dias ?? '—'}
                          </td>

                          <td>

                            {!guardado && (
                              <button
                                className="delete"
                                onClick={() =>
                                  eliminarSerie(
                                    s.serie
                                  )
                                }
                              >
                                Eliminar
                              </button>
                            )}

                          </td>

                        </tr>
                      )
                    )

                  ) : (

                    <tr>
                      <td
                        colSpan="5"
                      >
                        Sin series entregadas.
                      </td>
                    </tr>

                  )}

                </tbody>

              </table>

            </div>

          </div>

          {/* SERIES PENDIENTES EN SAP */}

          <div>

            <h3>
              Series en SAP
            </h3>

            <div className="scroll">

              <table>

                <thead>
                  <tr>
                    <th>
                      Cantidad
                    </th>

                    <th>
                      Serie
                    </th>

                    <th>
                      Material
                    </th>

                    <th>
                      Días
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {!datos ? (

                    <tr>
                      <td
                        colSpan="4"
                      >
                        Ingrese almacén y cargue recolección.
                      </td>
                    </tr>

                  ) : pendientes.length ? (

                    pendientes.map(
                      s => (
                        <tr
                          key={s.serie}
                        >

                          <td>
                            1
                          </td>

                          <td>
                            {s.serie}
                          </td>

                          <td>
                            {s.material}
                          </td>

                          <td>
                            {s.dias ?? '—'}
                          </td>

                        </tr>
                      )
                    )

                  ) : (

                    <tr>
                      <td
                        colSpan="4"
                      >
                        Sin series pendientes.
                      </td>
                    </tr>

                  )}

                </tbody>

              </table>

            </div>

          </div>

        </section>

        {!guardado && (

          <section>

            <label>
              Escanear serie

              <input
                ref={inputSerie}
                placeholder="Escanee serie y presione Enter"
                value={captura}
                disabled={!datos || busy}
                onChange={e =>
                  setCaptura(
                    e.target.value
                  )
                }
                onKeyDown={e => {
                  if (
                    e.key === 'Enter'
                  ) {
                    e.preventDefault()
                    agregar()
                  }
                }}
              />

            </label>

          </section>

        )}

        <section>

          <div className="actions">

            <button
              disabled={
                busy ||
                !!guardado ||
                !entregadas.length ||
                !usuarioActivo
              }
              onClick={guardar}
            >
              {busy
                ? 'Guardando...'
                : 'Guardar recolección'}
            </button>

            <button
              className="danger"
              onClick={limpiar}
            >
              Limpiar
            </button>

          </div>

          {error && (
            <p className="error">
              {error}
            </p>
          )}

          {mensaje && (
            <p className="msg">
              {mensaje}
            </p>
          )}

          {mensaje.includes(
            'https://wa.me/'
          ) && (

            <a
              href={
                mensaje.split(
                  'https://wa.me/'
                )[1]
                  ? 'https://wa.me/' +
                    mensaje.split(
                      'https://wa.me/'
                    )[1]
                  : '#'
              }
              target="_blank"
              rel="noreferrer"
            >
              Abrir WhatsApp
            </a>

          )}

        </section>

      </div>

      <style jsx>{`

        .rec {
          min-height: 100vh;
          background: #042a23;
          color: #fff;
          padding: 18px;
          font-family: Arial, sans-serif;
        }

        .wrap {
          max-width: 1100px;
          margin: auto;
        }

        .back,
        button {
          border: 0;
          color: white;
          background: #109a7c;
          border-radius: 9px;
          padding: 11px 15px;
          cursor: pointer;
          font-weight: 700;
        }

        button:disabled {
          opacity: .5;
          cursor: not-allowed;
        }

        .back {
          margin-bottom: 14px;
          font-size: 12px;
        }

        header {
          text-align: center;
          border: 1px solid #2a826c;
          border-radius: 15px;
          padding: 23px;
          background:
            linear-gradient(
              115deg,
              #0b5545,
              #17a581
            );
          margin-bottom: 15px;
        }

        h1 {
          margin: 0;
          font-size: 28px;
        }

        header p {
          margin: 6px 0 0;
          font-size: 12px;
        }

        section {
          background: #07382f;
          border: 1px solid #256254;
          border-radius: 15px;
          padding: 16px;
          margin-bottom: 14px;
        }

        .fields {
          display: grid;
          grid-template-columns:
            repeat(
              4,
              minmax(0, 1fr)
            );
          gap: 12px;
        }

        label {
          display: flex;
          flex-direction: column;
          font-weight: 700;
          font-size: 12px;
          gap: 7px;
        }

        input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #c9dfda;
          background: #f5f8fa;
          color: #173c38;
          border-radius: 8px;
          height: 38px;
          padding: 9px;
          font-size: 14px;
        }

        input:read-only {
          background: #e5eded;
        }

        .controls {
          display: flex;
          gap: 10px;
          margin: 12px 0;
        }

        .controls button {
          flex: 1;
        }

        .stats {
          display: grid;
          grid-template-columns:
            repeat(
              3,
              1fr
            );
          gap: 12px;
        }

        .stats article {
          text-align: center;
          background:
            linear-gradient(
              110deg,
              #09624f,
              #119e7d
            );
          border-radius: 12px;
          padding: 14px;
          font-weight: 700;
          font-size: 12px;
        }

        .stats strong {
          font-size: 23px;
          display: block;
          margin-top: 5px;
        }

        .columns {
          display: grid;
          grid-template-columns:
            1fr 1fr;
          gap: 15px;
        }

        h3 {
          font-size: 15px;
          margin: 6px 0 10px;
        }

        .scroll {
          overflow: auto;
          max-height: 300px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          background: #f8fbfa;
          color: #183831;
        }

        th {
          background: #007e60;
          color: white;
          padding: 11px 5px;
        }

        td {
          border: 1px solid #c5d0ce;
          padding: 9px 5px;
          text-align: center;
        }

        td:nth-child(2) {
          word-break: break-all;
        }

        .delete {
          background: #d83235;
          font-size: 10px;
          padding: 7px;
        }

        .actions {
          display: flex;
          gap: 10px;
        }

        .danger {
          background: #df343a;
        }

        .error,
        .msg {
          padding: 12px;
          border-radius: 8px;
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .error {
          background: #fce0e0;
          color: #a51b25;
        }

        .msg {
          background: #dbf6e9;
          color: #09543e;
        }

        @media (max-width: 720px) {

          .fields {
            grid-template-columns:
              repeat(
                2,
                1fr
              );
          }

          .columns {
            grid-template-columns: 1fr;
          }

          h1 {
            font-size: 22px;
          }

        }

      `}</style>

    </main>
  )
}
