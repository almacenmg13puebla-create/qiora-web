'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()

const formatPhone = raw => {
  const digits = clean(raw).replace(/\D/g, '')

  if (digits.length === 10) return `52${digits}`
  if (digits.length >= 11 && digits.length <= 15) return digits

  return ''
}

const formatFecha = valor => {
  if (!valor) return ''

  const fecha = new Date(valor)

  if (Number.isNaN(fecha.getTime())) {
    return clean(valor)
  }

  return fecha.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const makeText = r => {
  const series = Array.isArray(r.series) ? r.series : []
  const pendientes = Number(r.pendientes ?? 0)

  const lines = [
    '*RECOLECCIÓN RECIBIDA*',
    '',
    `Hola *${r.tecnico || ''}* 👋`,
    'Tu recolección fue recibida en almacén.',
    '',
    `📄 *Folio:* ${r.folio || ''}`,
    `🏢 *Centro:* ${r.centro || r.distrito || ''}`,
    `📦 *Almacén:* ${r.almacen || ''}`,
    `👷 *Técnico:* ${r.tecnico || ''}`,
    `👤 *Recibió:* ${r.recibe || ''}`,
    `📅 *Fecha:* ${formatFecha(r.fecha)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `📦 *EQUIPOS ENTREGADOS (${series.length})*`
  ]

  for (const equipo of series) {
    const serie = clean(equipo.serie)
    const material = clean(equipo.material)
    const descripcion = clean(equipo.descripcion)

    if (!material || !descripcion) {
      lines.push(`• ${serie} ⚠️ NO EXISTE EN SAP`)
    } else {
      lines.push(
        `• ${serie} | ${material} - ${descripcion}`
      )
    }
  }

  lines.push(
    '━━━━━━━━━━━━━━━━━━━━',
    ''
  )

  if (pendientes <= 0) {
    lines.push(
      '✅ *ENTREGA COMPLETA*',
      'No tienes equipos pendientes en esta recolección.'
    )
  } else {
    lines.push(
      '⚠️ *ENTREGA PARCIAL*',
      `Quedan ${pendientes} equipo(s) pendiente(s) por entregar.`
    )
  }

  lines.push(
    '',
    '✅ *Recepción registrada correctamente*',
    '',
    '🏢 *Sistema Nacional de Almacenes*'
  )

  return lines.join('\n')
}

export default function RecoleccionesPage() {
  const router = useRouter()

  const [folio, setFolio] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [datos, setDatos] = useState(null)

  const [recibe, setRecibe] = useState('')
  const [usuarioActivo, setUsuarioActivo] = useState('')
  const [centroActivo, setCentroActivo] = useState('')
  const [puestoActivo, setPuestoActivo] = useState('')

  const [captura, setCaptura] = useState('')
  const [entregadas, setEntregadas] = useState([])

  const [guardado, setGuardado] = useState(null)

  const [busy, setBusy] = useState(false)
  const [cargandoUsuario, setCargandoUsuario] = useState(true)

  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const inputSerie = useRef(null)
  const inputAlmacen = useRef(null)

  const catalogo = useMemo(
    () => datos?.equipos || [],
    [datos]
  )

  const pendientes = useMemo(() => {
    return catalogo.filter(
      equipo =>
        !entregadas.some(
          entregado =>
            upper(entregado.serie) === upper(equipo.serie)
        )
    )
  }, [catalogo, entregadas])

  useEffect(() => {
    let activo = true

    async function cargarUsuarioActivo() {
      setCargandoUsuario(true)

      try {
        const {
          data: { user },
          error: authError
        } = await supabase.auth.getUser()

        if (authError) throw authError

        if (!user?.id) {
          throw new Error('No existe una sesión activa.')
        }

        const {
          data,
          error: perfilError
        } = await supabase.rpc('qiora_mi_perfil')

        if (perfilError) throw perfilError

        const nombre = clean(data?.nombre)
        const centroPerfil = upper(data?.distrito)
        const puestoPerfil = upper(data?.puesto)

        if (puestoPerfil !== 'ADMIN_PADRE' && !centroPerfil) {
          throw new Error('El usuario no tiene centro/distrito configurado.')
        }

        if (!nombre) {
          throw new Error(
            'No fue posible obtener el nombre del usuario activo.'
          )
        }

        if (activo) {
          setUsuarioActivo(nombre)
          setRecibe(nombre)
          setCentroActivo(centroPerfil || 'TODOS')
          setPuestoActivo(puestoPerfil)
        }

      } catch (e) {
        console.error(
          'ERROR CARGANDO USUARIO ACTIVO:',
          e
        )

        if (activo) {
          setError(
            e?.message ||
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

  const normalizarAlmacen = valor => {
    const digitos = clean(valor).replace(/\D/g, '')
    if (!/^\d{1,4}$/.test(digitos)) {
      throw new Error('El almacén debe contener de 1 a 4 dígitos.')
    }
    return digitos.padStart(4, '0')
  }

  // Normaliza el almacén en el navegador. La validación real de
  // distrito + almacén + técnico activo se realiza dentro de las RPC
  // SECURITY DEFINER, usando auth.uid(); no se consulta el catálogo
  // desde el navegador para evitar bloqueos por RLS o cruces de distrito.
  const validarAlmacenCentro = async almacenValor => {
    const almacenLimpio = normalizarAlmacen(almacenValor)

    if (!centroActivo || centroActivo === 'TODOS') {
      throw new Error(
        'La recepción requiere un usuario con distrito específico. ADMIN_PADRE debe seleccionar un distrito autorizado.'
      )
    }

    return { almacen: almacenLimpio }
  }

  const ejecutar = async fn => {
    setError('')
    setBusy(true)

    try {
      await fn()
    } catch (e) {
      console.error('ERROR RECOLECCIONES:', e)

      setError(
        e?.message ||
        'Ocurrió un error.'
      )
    } finally {
      setBusy(false)
    }
  }

  const cargar = () =>
    ejecutar(async () => {
      const { almacen: almacenLimpio } = await validarAlmacenCentro(almacen)

      const {
        data,
        error: e
      } = await supabase.rpc(
        'qiora_rec_cargar_por_distrito',
        {
          p_almacen: almacenLimpio,
          p_distrito: centroActivo
        }
      )

      if (e) throw e

      if (!data) {
        throw new Error(
          'No se recibió información del almacén.'
        )
      }

      const centroDevuelto = upper(data.centro || data.distrito)
      if (puestoActivo !== 'ADMIN_PADRE' && centroDevuelto && centroDevuelto !== upper(centroActivo)) {
        throw new Error(`Supabase devolvió datos de ${centroDevuelto}, pero tu centro activo es ${centroActivo}. Se bloqueó la carga.`)
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

      if (usuarioActivo) {
        setRecibe(usuarioActivo)
      }

      setMensaje(
        `Técnico identificado: ${data.tecnico}. ` +
        `Equipos en SAP: ${(data.equipos || []).length}`
      )

      setTimeout(() => {
        inputSerie.current?.focus()
      }, 100)
    })

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

    if (!serie) return

    // Evitar duplicados dentro de la captura actual.
    const duplicada = entregadas.some(
      e => upper(e.serie) === serie
    )

    if (duplicada) {
      setError(`La serie ${serie} ya fue escaneada.`)
      setCaptura('')
      setTimeout(() => inputSerie.current?.focus(), 100)
      return
    }

    // IQ09 solo aporta los datos complementarios cuando encuentra la serie.
    // La serie se puede recibir aunque no exista en IQ09 ni sea TPE USADO.
    const equipoSAP = catalogo.find(
      e => upper(e.serie) === serie
    )

    const equipo = equipoSAP || {
      serie,
      material: '',
      descripcion: 'NO EXISTE EN SAP',
      lote: '',
      dias: null,
      tp_stocks: null,
      existe_iq09: false
    }

    setEntregadas(prev => [...prev, equipo])
    setCaptura('')
    setMensaje(
      equipoSAP
        ? `Serie ${serie} agregada correctamente.`
        : `Serie ${serie} agregada. No existe en IQ09.`
    )

    setTimeout(() => {
      inputSerie.current?.focus()
    }, 100)
  }

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
    }, 100)
  }

  const enviarWhatsapp = resultado => {
    const telefono = formatPhone(
      resultado.telefono
    )

    if (!telefono) {
      return false
    }

    const texto = makeText(resultado)

    const url =
      `https://wa.me/${telefono}?text=` +
      encodeURIComponent(texto)

    const ventana = window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    )

    return !!ventana
  }

  const enviarTelegramRecepcion = async resultado => {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) throw new Error('No se encontró la sesión para notificar a Telegram.')

      const response = await fetch('/api/recolecciones/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          folio: resultado.folio,
          distrito: resultado.distrito || resultado.centro || centroActivo,
          almacen: resultado.almacen || datos?.almacen || almacen,
          tecnico: resultado.tecnico || datos?.tecnico || '',
          recibe: resultado.recibe || recibe,
          fecha: resultado.fecha || new Date().toISOString(),
          series: resultado.series || []
        })
      })
      const respuesta = await response.json().catch(() => ({}))
      if (!response.ok || respuesta.ok !== true) {
        throw new Error(respuesta.error || `No se pudo notificar a Telegram (HTTP ${response.status}).`)
      }
      if (respuesta.sin_telegram) return { ok: true, mensaje: 'No hay Telegram vinculado al técnico ni al receptor.' }
      if (respuesta.destinatarios?.some(x => x.estado === 'ERROR')) {
        return { ok: false, mensaje: 'La recepción se guardó, pero hubo errores al enviar uno o más mensajes de Telegram.' }
      }
      return { ok: true, mensaje: `Avisos privados de Telegram enviados: ${respuesta.enviados || 0}.` }
    } catch (e) {
      console.error('ERROR NOTIFICANDO RECEPCION EN TELEGRAM:', e)
      return { ok: false, mensaje: `La recepción se guardó, pero Telegram no pudo confirmar el envío: ${e?.message || 'error'}` }
    }
  }

  const limpiarDespuesDeGuardar = (folioGuardado, detalleTelegram = '') => {
    setFolio('')
    setAlmacen('')
    setDatos(null)
    setCaptura('')
    setEntregadas([])
    setGuardado(null)

    setRecibe(usuarioActivo)

    setError('')

    setMensaje(
      `Recolección ${folioGuardado} guardada correctamente. ${detalleTelegram} Pantalla lista para una nueva captura.`
    )

    setTimeout(() => {
      inputAlmacen.current?.focus()
    }, 150)
  }

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

      if (!clean(recibe)) {
        throw new Error(
          'No fue posible identificar quién recibe.'
        )
      }

      if (!entregadas.length) {
        throw new Error(
          'Escanea al menos una serie.'
        )
      }

      const { almacen: almacenValidado } = await validarAlmacenCentro(datos.almacen)
      const distritoValidado = upper(datos.distrito || datos.centro || centroActivo)
      if (distritoValidado !== upper(centroActivo)) {
        throw new Error(`La recolección pertenece a ${distritoValidado}; tu distrito activo es ${centroActivo}.`)
      }

      // Solo descuentan del inventario TPE USADO las series que
      // pertenecían al catálogo SAP; las series libres no alteran ese total.
      const pendientesAntesDeGuardar = pendientes.length

      const seriesAntesDeGuardar = [...entregadas]

      const {
        data,
        error: e
      } = await supabase.rpc(
        'qiora_rec_guardar_por_distrito',
        {
          p_almacen: almacenValidado,
          p_distrito: centroActivo,
          p_recibe: clean(recibe),
          p_series: entregadas.map(
            s => upper(s.serie)
          )
        }
      )

      if (e) throw e

      const centroGuardado = upper(data?.centro || data?.distrito)
      if (puestoActivo !== 'ADMIN_PADRE' && centroGuardado && centroGuardado !== upper(centroActivo)) {
        throw new Error(`Supabase devolvió una recolección de ${centroGuardado}; se esperaba ${centroActivo}.`)
      }

      if (!data) {
        throw new Error(
          'Supabase no devolvió información después de guardar.'
        )
      }

      const seriesResultado =
        Array.isArray(data.series) &&
        data.series.length
          ? data.series.map(
              serieGuardada => {
                const original =
                  seriesAntesDeGuardar.find(
                    s =>
                      upper(s.serie) ===
                      upper(serieGuardada.serie)
                  )

                return {
                  ...original,
                  ...serieGuardada,

                  material:
                    serieGuardada.material ||
                    original?.material ||
                    '',

                  descripcion:
                    serieGuardada.descripcion ||
                    original?.descripcion ||
                    '',

                  lote:
                    serieGuardada.lote ||
                    original?.lote ||
                    '',

                  dias:
                    serieGuardada.dias ??
                    original?.dias ??
                    null
                }
              }
            )
          : seriesAntesDeGuardar

      const resultado = {
        ...data,

        fecha:
          data.fecha ||
          new Date().toISOString(),

        almacen:
          data.almacen ||
          datos.almacen ||
          almacen,

        tecnico:
          data.tecnico ||
          datos.tecnico ||
          '',

        recibe:
          data.recibe ||
          recibe,

        telefono:
          data.telefono ||
          datos.telefono ||
          '',

        centro:
          data.centro ||
          datos.centro ||
          '',

        distrito:
          data.distrito ||
          datos.distrito ||
          '',

        pendientes:
          pendientesAntesDeGuardar,

        series:
          seriesResultado
      }

      const folioGuardado =
        clean(resultado.folio)

      if (!folioGuardado) {
        throw new Error(
          'La recolección se guardó pero Supabase no devolvió el folio.'
        )
      }

      setGuardado(resultado)
      setFolio(folioGuardado)

      enviarWhatsapp(resultado)

      const avisoTelegram = await enviarTelegramRecepcion(resultado)

      limpiarDespuesDeGuardar(
        folioGuardado,
        avisoTelegram.mensaje
      )
    })

  const limpiar = () => {
    setFolio('')
    setAlmacen('')
    setDatos(null)
    setCaptura('')
    setEntregadas([])
    setGuardado(null)

    setRecibe(usuarioActivo)

    setError('')
    setMensaje('')

    setTimeout(() => {
      inputAlmacen.current?.focus()
    }, 100)
  }

  return (
    <main className="rec">
      <div className="wrap">

        <button
          type="button"
          className="back"
          onClick={() =>
            router.push('/recolecciones')
          }
        >
          ← Regresar a Recolecciones
        </button>

        <header>
          <h1>Recepción de Recolecciones</h1>

          <p>
            Solo equipos de iq09_equipos con lote TPE USADO.
          </p>
        </header>

        <section>

          <div className="fields">

            <label>
              Folio

              <input
                value={folio}
                placeholder="Se genera al guardar"
                readOnly
              />
            </label>

            <label>
              Almacén

              <input
                ref={inputAlmacen}
                placeholder="0008"
                value={almacen}
                disabled={busy || !!guardado}
                onChange={e =>
                  setAlmacen(
                    e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 4)
                  )
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') {
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
                value={datos?.tecnico || ''}
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
              type="button"
              disabled={busy || !!guardado}
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
              <strong>{pendientes.length}</strong>
            </article>

            <article>
              Series entregadas
              <strong>{entregadas.length}</strong>
            </article>

            <article>
              Total técnico
              <strong>{catalogo.length}</strong>
            </article>

          </div>

        </section>

        <section className="columns">

          <div>

            <h3>Series entregadas</h3>

            <div className="scroll">

              <table>

                <thead>
                  <tr>
                    <th>Cantidad</th>
                    <th>Serie</th>
                    <th>Material</th>
                    <th>Días</th>
                    <th>Acción</th>
                  </tr>
                </thead>

                <tbody>

                  {entregadas.length ? (
                    entregadas.map(s => (
                      <tr key={s.serie}>

                        <td>1</td>

                        <td>{s.serie}</td>

                        <td>{s.material}</td>

                        <td>{s.dias ?? '—'}</td>

                        <td>
                          {!guardado && (
                            <button
                              type="button"
                              className="delete"
                              onClick={() =>
                                eliminarSerie(s.serie)
                              }
                            >
                              Eliminar
                            </button>
                          )}
                        </td>

                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5">
                        Sin series entregadas.
                      </td>
                    </tr>
                  )}

                </tbody>

              </table>

            </div>

          </div>

          <div>

            <h3>Series en SAP</h3>

            <div className="scroll">

              <table>

                <thead>
                  <tr>
                    <th>Cantidad</th>
                    <th>Serie</th>
                    <th>Material</th>
                    <th>Días</th>
                  </tr>
                </thead>

                <tbody>

                  {!datos ? (
                    <tr>
                      <td colSpan="4">
                        Ingrese almacén y cargue recolección.
                      </td>
                    </tr>
                  ) : pendientes.length ? (
                    pendientes.map(s => (
                      <tr key={s.serie}>

                        <td>1</td>

                        <td>{s.serie}</td>

                        <td>{s.material}</td>

                        <td>{s.dias ?? '—'}</td>

                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4">
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
                  setCaptura(e.target.value)
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') {
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
              type="button"
              disabled={
                busy ||
                !!guardado ||
                !entregadas.length
              }
              onClick={guardar}
            >
              {busy
                ? 'Guardando...'
                : 'Guardar recolección'}
            </button>

            <button
              type="button"
              className="danger"
              disabled={busy}
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
          background: linear-gradient(
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
            repeat(4, minmax(0, 1fr));
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
            repeat(3, 1fr);
          gap: 12px;
        }

        .stats article {
          text-align: center;
          background: linear-gradient(
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
          grid-template-columns: 1fr 1fr;
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
              repeat(2, 1fr);
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
