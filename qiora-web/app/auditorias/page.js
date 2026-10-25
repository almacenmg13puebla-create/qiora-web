'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const TIPOS = {
  TODO: 'TODO',
  MATERIALES: 'MATERIALES',
  HERRAMIENTAS: 'HERRAMIENTAS',
  EQUIPOS: 'EQUIPOS',
}

function texto(v) {
  return String(v ?? '').trim()
}

function numero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function observacionDiferencia(fisico, sistema) {
  const diferencia = numero(fisico) - numero(sistema)
  if (diferencia < 0) return 'FALTANTE'
  if (diferencia > 0) return 'SOBRANTE'
  return ''
}

function normalizarSerie(v) {
  return texto(v)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

async function consultarSeriesPorBloques(tabla, series, columnas = 'serie') {
  const unicas = [...new Set(series.map(normalizarSerie).filter(Boolean))]
  const salida = []
  const tamano = 100

  for (let i = 0; i < unicas.length; i += tamano) {
    const bloque = unicas.slice(i, i + tamano)
    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .in('serie', bloque)

    if (error) throw error
    salida.push(...(data || []))
  }

  return salida
}

function normalizarAlmacen(v) {
  const x = texto(v).toUpperCase()

  if (/^\d{1,4}$/.test(x)) {
    return x.padStart(4, '0')
  }

  return x
}

function bool(v) {
  return v === true ||
    v === 1 ||
    texto(v).toUpperCase() === 'SI' ||
    texto(v).toUpperCase() === 'SÍ' ||
    texto(v).toUpperCase() === 'TRUE'
}

export default function AuditoriasPage() {
  const router = useRouter()

  const [cargandoInicio, setCargandoInicio] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const [perfil, setPerfil] = useState(null)

  const [almacen, setAlmacen] = useState('')
  const [tipo, setTipo] = useState(TIPOS.TODO)
  const [tecnico, setTecnico] = useState(null)

  const [materiales, setMateriales] = useState([])
  const [herramientas, setHerramientas] = useState([])
  const [equipos, setEquipos] = useState([])

  const [serie, setSerie] = useState('')
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const [comentarioGeneral, setComentarioGeneral] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Consulta de auditorias realizadas / historicas
  const [histMes, setHistMes] = useState('')
  const [histAlmacen, setHistAlmacen] = useState('')
  const [histFolio, setHistFolio] = useState('')
  const [histCargando, setHistCargando] = useState(false)
  const [histResultados, setHistResultados] = useState([])
  const [histDetalle, setHistDetalle] = useState(null)
  const [histFaltanteGlobal, setHistFaltanteGlobal] = useState(false)

  useEffect(() => {
    iniciar()
  }, [])

  async function iniciar() {
    setCargandoInicio(true)
    setError('')

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        router.replace('/')
        return
      }

      const { data, error: perfilError } = await supabase.rpc(
        'qiora_mi_perfil'
      )

      if (perfilError) throw perfilError

      if (!data) {
        throw new Error('No se encontró el perfil del usuario.')
      }

      if (!bool(data.activo)) {
        throw new Error('El usuario se encuentra inactivo.')
      }

      if (!bool(data.auditoria)) {
        throw new Error(
          'Tu usuario no tiene permiso para realizar auditorías.'
        )
      }

      setPerfil(data)
    } catch (e) {
      setError(e?.message || 'No fue posible iniciar Auditorías.')
    } finally {
      setCargandoInicio(false)
    }
  }

  function limpiarMensajes() {
    setMensaje('')
    setError('')
  }

  function limpiarAuditoria() {
    limpiarMensajes()
    setAlmacen('')
    setTecnico(null)
    setMateriales([])
    setHerramientas([])
    setEquipos([])
    setSerie('')
    setSoloFaltantes(false)
    setComentarioGeneral('')
  }

  function conservarMateriales(nuevos) {
    const anteriores = new Map(
      materiales.map((x) => [
        `${texto(x.sku)}|${texto(x.lote)}`,
        x,
      ])
    )

    return nuevos.map((x) => {
      const key = `${texto(x.sku)}|${texto(x.lote)}`
      const anterior = anteriores.get(key)

      return {
        ...x,
        fisico: anterior ? anterior.fisico : x.fisico,
        observacion: anterior
          ? anterior.observacion
          : x.observacion,
      }
    })
  }

  function conservarHerramientas(nuevos) {
    const anteriores = new Map(
      herramientas.map((x) => [
        `${texto(x.producto)}|${texto(x.ubicacion)}`,
        x,
      ])
    )

    return nuevos.map((x) => {
      const key =
        `${texto(x.producto)}|${texto(x.ubicacion)}`

      const anterior = anteriores.get(key)

      return {
        ...x,
        fisico: anterior ? anterior.fisico : x.fisico,
        observacion: anterior
          ? anterior.observacion
          : x.observacion,
      }
    })
  }

  function conservarEquipos(nuevos) {
    const anteriores = new Map(
      equipos.map((x) => [texto(x.serie).toUpperCase(), x])
    )

    return nuevos.map((x) => {
      const anterior =
        anteriores.get(texto(x.serie).toUpperCase())

      if (!anterior) return x

      return {
        ...x,
        escaneado: anterior.escaneado,
        estado: anterior.estado,
      }
    })
  }

  async function cargarAuditoria() {
    limpiarMensajes()

    const almacen4 = normalizarAlmacen(almacen)

    if (!almacen4) {
      setError('Capture el almacén.')
      return
    }

    setAlmacen(almacen4)
    setCargando(true)

    try {
      // ================================================
      // TÉCNICO
      // ================================================

      const { data: usuarioTecnico, error: tecnicoError } =
        await supabase
          .rpc('obtener_tecnico_auditoria', {
            p_almacen: almacen4,
          })
          .maybeSingle()

      if (tecnicoError) throw tecnicoError

      if (!usuarioTecnico) {
        throw new Error(
          `No se encontró técnico para el almacén ${almacen4}.`
        )
      }

      if (!bool(usuarioTecnico.activo)) {
        throw new Error(
          `El almacén ${almacen4} pertenece a un usuario inactivo.`
        )
      }

      setTecnico(usuarioTecnico)

      // ================================================
      // MATERIALES
      // ================================================

      let nuevosMateriales = []

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.MATERIALES
      ) {
        const { data, error: matError } = await supabase
          .from('stock_tecnicos')
          .select(
            'sku,material,lote,cantidad,disponible,almacen,tecnico'
          )
          .eq('almacen', almacen4)
          .order('sku')

        if (matError) throw matError

        // En Materiales solo se auditan registros cuyo LOTE inicia con TPI.
        // El filtro se normaliza para aceptar espacios y diferencias de mayusculas/minusculas.
        const materialesTPI = (data || []).filter((x) =>
          texto(x.lote).trim().toUpperCase().startsWith('TPI')
        )

        nuevosMateriales = materialesTPI.map((x) => {
          const sistema =
            x.cantidad !== null && x.cantidad !== undefined
              ? numero(x.cantidad)
              : numero(x.disponible)

          return {
            sku: texto(x.sku),
            material: texto(x.material),
            lote: texto(x.lote),
            sistema,
            fisico: 0,
            observacion: '',
          }
        })

        nuevosMateriales =
          conservarMateriales(nuevosMateriales)
      }

      // ================================================
      // HERRAMIENTAS
      // ================================================

      let nuevasHerramientas = []

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.HERRAMIENTAS
      ) {
        const ubicacionOdoo = texto(usuarioTecnico.odoo)

        if (ubicacionOdoo) {
          const { data, error: herError } = await supabase
            .from('herramienta_odoo')
            .select('producto,ubicacion,cantidad')
            .eq('ubicacion', ubicacionOdoo)
            .gt('cantidad', 0)
            .order('producto')

          if (herError) throw herError

          nuevasHerramientas = (data || []).map((x) => ({
            producto: texto(x.producto),
            ubicacion: texto(x.ubicacion),
            sistema: numero(x.cantidad),
            fisico: 0,
            observacion: '',
          }))

          nuevasHerramientas =
            conservarHerramientas(nuevasHerramientas)
        }
      }

      // ================================================
      // EQUIPOS
      // ================================================

      let nuevosEquipos = []

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.EQUIPOS
      ) {
        const { data, error: eqError } = await supabase
          .from('iq09_equipos')
          .select(
            'serie,material,descripcion,lote,estatus_sap,denom_status,tipo_stock,almacen'
          )
          .eq('almacen', almacen4)
          .order('serie')

        if (eqError) throw eqError

        const equiposSistema = (data || []).filter((x) => texto(x.serie))
        const seriesSistema = equiposSistema.map((x) => normalizarSerie(x.serie))

        // La lógica original de QIORA clasifica por SERIE con esta prioridad:
        // VALIDACION BRM -> ENTREGADO -> ENTRADA PENDIENTE -> FALTANTE.
        const filasBRM = await consultarSeriesPorBloques(
          'validacion_brm',
          seriesSistema,
          'serie'
        )

        const filasRecolecciones = await consultarSeriesPorBloques(
          'recolecciones_equipos',
          seriesSistema,
          'serie,estado'
        )

        const seriesBRM = new Set(
          filasBRM.map((x) => normalizarSerie(x.serie))
        )

        const seriesEntregadas = new Set(
          filasRecolecciones
            .filter((x) => {
              const e = normalizarSerie(x.estado)
              return (
                e.includes('ENTREG') ||
                [
                  'RECIBIDO',
                  'RECIBIDA',
                  'FINALIZADO',
                  'FINALIZADA',
                  'CERRADO',
                  'CERRADA',
                ].includes(e)
              )
            })
            .map((x) => normalizarSerie(x.serie))
        )

        nuevosEquipos = equiposSistema.map((x) => {
          const serieNormal = normalizarSerie(x.serie)
          const tipoStock = normalizarSerie(x.tipo_stock)
          let estado = 'FALTANTE'

          if (seriesBRM.has(serieNormal)) {
            estado = 'VALIDACION BRM'
          } else if (seriesEntregadas.has(serieNormal)) {
            estado = 'ENTREGADO'
          } else if (tipoStock === '04' || tipoStock === '4') {
            estado = 'ENTRADA PENDIENTE'
          }

          return {
            serie: serieNormal,
            material: texto(x.material),
            descripcion: texto(x.descripcion),
            lote: texto(x.lote),
            estatusSAP:
              texto(x.estatus_sap) ||
              texto(x.denom_status),
            tipoStock: texto(x.tipo_stock),
            escaneado: false,
            estado,
            estadoOriginal: estado,
            existeSistema: true,
          }
        })

        nuevosEquipos =
          conservarEquipos(nuevosEquipos)
      }

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.MATERIALES
      ) {
        setMateriales(nuevosMateriales)
      } else {
        setMateriales([])
      }

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.HERRAMIENTAS
      ) {
        setHerramientas(nuevasHerramientas)
      } else {
        setHerramientas([])
      }

      if (
        tipo === TIPOS.TODO ||
        tipo === TIPOS.EQUIPOS
      ) {
        setEquipos(nuevosEquipos)
      } else {
        setEquipos([])
      }

      setSoloFaltantes(false)
      setMensaje(
        `Auditoría cargada para ${usuarioTecnico.nombre || almacen4}.`
      )
    } catch (e) {
      setError(
        e?.message ||
          'No fue posible cargar la auditoría.'
      )
    } finally {
      setCargando(false)
    }
  }

  function cambiarFisicoMaterial(index, valor) {
    setMateriales((actual) =>
      actual.map((x, i) =>
        i === index
          ? {
              ...x,
              fisico: numero(valor),
              observacion: observacionDiferencia(valor, x.sistema),
            }
          : x
      )
    )
  }


  function cambiarFisicoHerramienta(index, valor) {
    setHerramientas((actual) =>
      actual.map((x, i) =>
        i === index
          ? {
              ...x,
              fisico: numero(valor),
              observacion: observacionDiferencia(valor, x.sistema),
            }
          : x
      )
    )
  }


  function brincarSiguienteFisico(e, selector) {
    if (e.key !== 'Enter') return

    e.preventDefault()

    const campos = Array.from(
      document.querySelectorAll(selector)
    ).filter((campo) => !campo.disabled)

    const posicion = campos.indexOf(e.currentTarget)

    if (posicion >= 0 && posicion < campos.length - 1) {
      const siguiente = campos[posicion + 1]
      siguiente.focus()
      siguiente.select?.()
    }
  }

  async function guardarAuditoria() {
    limpiarMensajes()

    if (!tecnico) {
      setError('Primero carga una auditoría.')
      return
    }

    if (guardando) return

    setGuardando(true)

    try {
      const payloadMateriales =
        tipo === TIPOS.TODO || tipo === TIPOS.MATERIALES
          ? materiales.map((x) => ({
              sku: texto(x.sku),
              material: texto(x.material),
              lote: texto(x.lote),
              sistema: numero(x.sistema),
              fisico: numero(x.fisico),
            }))
          : []

      const payloadHerramientas =
        tipo === TIPOS.TODO || tipo === TIPOS.HERRAMIENTAS
          ? herramientas.map((x) => ({
              producto: texto(x.producto),
              ubicacion: texto(x.ubicacion),
              sistema: numero(x.sistema),
              fisico: numero(x.fisico),
            }))
          : []

      const payloadEquipos =
        tipo === TIPOS.TODO || tipo === TIPOS.EQUIPOS
          ? equipos.map((x) => ({
              serie: normalizarSerie(x.serie),
              material: texto(x.material),
              descripcion: texto(x.descripcion),
              lote: texto(x.lote),
              estado: texto(x.estado) || 'FALTANTE',
            }))
          : []

      const { data, error: guardarError } = await supabase.rpc(
        'guardar_auditoria',
        {
          p_almacen: normalizarAlmacen(almacen),
          p_tipo_auditoria: tipo,
          p_comentario_general: texto(comentarioGeneral),
          p_materiales: payloadMateriales,
          p_herramientas: payloadHerramientas,
          p_equipos: payloadEquipos,
        }
      )

      if (guardarError) throw guardarError
      if (!data?.ok) throw new Error('Supabase no confirmó el guardado de la auditoría.')

      setMensaje(
        `Auditoría guardada correctamente. Folio: ${data.folio}. ` +
        `Materiales: ${data.materiales || 0}, ` +
        `Herramientas: ${data.herramientas || 0}, ` +
        `Equipos: ${data.equipos || 0}.`
      )
    } catch (e) {
      setError(e?.message || 'No fue posible guardar la auditoría.')
    } finally {
      setGuardando(false)
    }
  }

  async function buscarAuditoriasRealizadas(verFaltanteGlobal = false) {
    limpiarMensajes()
    setHistCargando(true)
    setHistDetalle(null)
    setHistFaltanteGlobal(verFaltanteGlobal)

    try {
      const almacenFiltro = normalizarAlmacen(histAlmacen)
      const folioFiltro = texto(histFolio)
      const mesFiltro = texto(histMes)
      const tablas = [
        { nombre: 'auditorias_materiales', tipo: 'MATERIALES' },
        { nombre: 'auditorias_herramientas', tipo: 'HERRAMIENTAS' },
        { nombre: 'auditorias_equipos', tipo: 'EQUIPOS' },
      ]

      const grupos = new Map()

      for (const cfg of tablas) {
        let q = supabase.from(cfg.nombre).select('*').order('fecha', { ascending: false }).limit(10000)
        if (almacenFiltro) q = q.eq('almacen', almacenFiltro)
        if (folioFiltro) q = q.eq('folio', folioFiltro)
        if (mesFiltro) q = q.eq('mes', mesFiltro)
        const { data, error: qError } = await q
        if (qError) throw qError

        for (const fila of data || []) {
          const folio = texto(fila.folio)
          if (!folio) continue
          if (!grupos.has(folio)) {
            grupos.set(folio, {
              folio,
              fecha: fila.fecha,
              mes: fila.mes,
              tipoAuditoria: fila.tipo_auditoria,
              almacen: fila.almacen,
              tecnico: fila.tecnico,
              auditor: fila.auditor_nombre || fila.auditor_usuario,
              materiales: [], herramientas: [], equipos: [],
            })
          }
          const g = grupos.get(folio)
          if (cfg.tipo === 'MATERIALES') g.materiales.push(fila)
          if (cfg.tipo === 'HERRAMIENTAS') g.herramientas.push(fila)
          if (cfg.tipo === 'EQUIPOS') g.equipos.push(fila)
        }
      }

      let resultados = [...grupos.values()].sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||'')))
      if (verFaltanteGlobal) {
        resultados = resultados.map(g => ({
          ...g,
          materiales: g.materiales.filter(x => numero(x.diferencia) < 0 || texto(x.observacion).toUpperCase() === 'FALTANTE'),
          herramientas: g.herramientas.filter(x => numero(x.diferencia) < 0 || texto(x.observacion).toUpperCase() === 'FALTANTE'),
          equipos: g.equipos.filter(x => texto(x.estado).toUpperCase() === 'FALTANTE'),
        })).filter(g => g.materiales.length || g.herramientas.length || g.equipos.length)
      }

      setHistResultados(resultados)
      if (folioFiltro && resultados.length === 1) setHistDetalle(resultados[0])
      setMensaje(`${resultados.length} auditoria(s) encontrada(s).`)
    } catch (e) {
      setError(e?.message || 'No fue posible consultar las auditorias realizadas.')
    } finally {
      setHistCargando(false)
    }
  }

  function abrirDetalleHistorico(item) {
    setHistDetalle(item)
  }

  function limpiarHistoricos() {
    setHistMes('')
    setHistAlmacen('')
    setHistFolio('')
    setHistResultados([])
    setHistDetalle(null)
    setHistFaltanteGlobal(false)
  }

  function registrarSerie(e) {
    e.preventDefault()
    limpiarMensajes()

    const s = texto(serie).toUpperCase()

    if (!s) return

    const existe = equipos.some(
      (x) => texto(x.serie).toUpperCase() === s
    )

    if (existe) {
      setEquipos((actual) =>
        actual.map((x) =>
          texto(x.serie).toUpperCase() === s
            ? {
                ...x,
                escaneado: true,
                estado: [
                  'VALIDACION BRM',
                  'ENTRADA PENDIENTE',
                  'ENTREGADO',
                ].includes(x.estado)
                  ? x.estado
                  : 'COINCIDE',
              }
            : x
        )
      )

      const equipo = equipos.find(
        (x) => normalizarSerie(x.serie) === normalizarSerie(s)
      )
      const estadoResultado = [
        'VALIDACION BRM',
        'ENTRADA PENDIENTE',
        'ENTREGADO',
      ].includes(equipo?.estado)
        ? equipo.estado
        : 'COINCIDE'

      setMensaje(`Serie ${s}: ${estadoResultado}.`)
    } else {
      setEquipos((actual) => [
        ...actual,
        {
          serie: s,
          material: '-',
          descripcion: '-',
          lote: '-',
          estatusSAP: '',
          tipoStock: '',
          escaneado: true,
          estado: 'NO EXISTE EN SISTEMA',
          estadoOriginal: 'NO EXISTE EN SISTEMA',
          existeSistema: false,
        },
      ])

      setMensaje(
        `Serie ${s}: NO EXISTE EN SISTEMA.`
      )
    }

    setSerie('')
  }

  function eliminarEscaneo(serieEliminar) {
    const s = texto(serieEliminar).toUpperCase()

    setEquipos((actual) =>
      actual
        .filter(
          (x) =>
            !(
              texto(x.serie).toUpperCase() === s &&
              x.existeSistema === false
            )
        )
        .map((x) => {
          if (texto(x.serie).toUpperCase() !== s) return x

          return {
            ...x,
            escaneado: false,
            estado: x.estadoOriginal || 'FALTANTE',
          }
        })
    )

    setMensaje(`Escaneo de la serie ${s} eliminado.`)
    setError('')
  }

  const materialesVista = useMemo(() => {
    if (!soloFaltantes) return materiales

    return materiales.filter(
      (x) => numero(x.fisico) - numero(x.sistema) < 0
    )
  }, [materiales, soloFaltantes])

  const herramientasVista = useMemo(() => {
    if (!soloFaltantes) return herramientas

    return herramientas.filter(
      (x) => numero(x.fisico) - numero(x.sistema) < 0
    )
  }, [herramientas, soloFaltantes])

  const equiposVista = useMemo(() => {
    if (!soloFaltantes) return equipos

    return equipos.filter(
      (x) => x.estado === 'FALTANTE'
    )
  }, [equipos, soloFaltantes])

  if (cargandoInicio) {
    return (
      <main style={styles.centrado}>
        <div>Cargando Auditorías...</div>
      </main>
    )
  }

  return (
    <main style={styles.pagina}>
      <div style={styles.contenedor}>
        <div style={styles.encabezado}>
          <div>
            <h1 style={styles.titulo}>
              Auditorías Técnicos
            </h1>

            <div style={styles.subtitulo}>
              QIORA · Auditoría de materiales,
              herramientas y equipos
            </div>
          </div>

          <button
            style={styles.botonSecundario}
            onClick={() => router.push('/')}
          >
            Regresar
          </button>
        </div>

        {perfil && (
          <div style={styles.usuario}>
            Auditor:{' '}
            <strong>{perfil.nombre}</strong>
            {' · '}
            Usuario:{' '}
            <strong>{perfil.usuario_almacen}</strong>
            {' · '}
            Distrito:{' '}
            <strong>{perfil.distrito || '-'}</strong>
          </div>
        )}

        {error && (
          <div style={styles.error}>{error}</div>
        )}

        {mensaje && (
          <div style={styles.ok}>{mensaje}</div>
        )}

        <section style={styles.tarjeta}>
          <div style={styles.formulario}>
            <label style={styles.campo}>
              <span>Almacén del técnico</span>
              <input
                style={styles.input}
                value={almacen}
                maxLength={10}
                onChange={(e) =>
                  setAlmacen(e.target.value.toUpperCase())
                }
                placeholder="Ej. 0008"
              />
            </label>

            <label style={styles.campo}>
              <span>¿Qué se va a auditar?</span>

              <select
                style={styles.input}
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value)
                  setSoloFaltantes(false)
                }}
              >
                <option value={TIPOS.MATERIALES}>
                  Auditoría de materiales
                </option>

                <option value={TIPOS.HERRAMIENTAS}>
                  Auditoría de herramientas
                </option>

                <option value={TIPOS.EQUIPOS}>
                  Escaneo de equipos
                </option>

                <option value={TIPOS.TODO}>
                  Todo
                </option>
              </select>
            </label>
          </div>

          {tecnico && (
            <div style={styles.tecnico}>
              <strong>Técnico:</strong>{' '}
              {tecnico.nombre || '-'}
              {' · '}
              <strong>Almacén:</strong>{' '}
              {normalizarAlmacen(
                tecnico.usuario_almacen
              )}
              {' · '}
              <strong>ODoo:</strong>{' '}
              {tecnico.odoo || '-'}
            </div>
          )}

          <div style={styles.botones}>
            <button
              style={styles.botonPrincipal}
              disabled={cargando}
              onClick={cargarAuditoria}
            >
              {cargando
                ? 'Cargando...'
                : tecnico
                  ? 'Actualizar sin borrar'
                  : 'Cargar auditoría'}
            </button>

            <button
              style={styles.botonFaltantes}
              onClick={() =>
                setSoloFaltantes((v) => !v)
              }
              disabled={!tecnico}
            >
              {soloFaltantes
                ? 'Ver auditoría completa'
                : 'Ver faltantes'}
            </button>

            <button
              style={styles.botonSecundario}
              onClick={limpiarAuditoria}
            >
              Limpiar
            </button>
          </div>
        </section>

        {(tipo === TIPOS.TODO ||
          tipo === TIPOS.MATERIALES) &&
          tecnico && (
            <section style={styles.tarjeta}>
              <h2 style={styles.seccionTitulo}>
                Materiales
              </h2>

              <div style={styles.tablaWrap}>
                <table style={styles.tabla}>
                  <thead>
                    <tr>
                      <th style={styles.th}>SKU</th>
                      <th style={styles.th}>
                        Material
                      </th>
                      <th style={styles.th}>Lote</th>
                      <th style={styles.th}>
                        Sistema
                      </th>
                      <th style={styles.th}>
                        Físico
                      </th>
                      <th style={styles.th}>
                        Diferencia
                      </th>
                      <th style={styles.th}>
                        Observación
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {materialesVista.map(
                      (x, index) => {
                        const diferencia =
                          numero(x.fisico) -
                          numero(x.sistema)

                        return (
                          <tr
                            key={`${x.sku}-${x.lote}-${index}`}
                          >
                            <td style={styles.td}>
                              {x.sku}
                            </td>

                            <td style={styles.td}>
                              {x.material}
                            </td>

                            <td style={styles.td}>
                              {x.lote}
                            </td>

                            <td style={styles.td}>
                              {x.sistema}
                            </td>

                            <td style={styles.td}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                style={styles.inputTabla}
                                value={x.fisico}
                                data-fisico-material
                                onChange={(e) =>
                                  cambiarFisicoMaterial(
                                    materiales.indexOf(x),
                                    e.target.value
                                  )
                                }
                                onKeyDown={(e) =>
                                  brincarSiguienteFisico(
                                    e,
                                    '[data-fisico-material]'
                                  )
                                }
                              />
                            </td>

                            <td style={styles.td}>
                              <strong>
                                {diferencia}
                              </strong>
                            </td>

                            <td style={styles.td}>
                              <strong>{observacionDiferencia(x.fisico, x.sistema)}</strong>
                            </td>
                          </tr>
                        )
                      }
                    )}
                  </tbody>
                </table>
              </div>

              <div style={styles.contador}>
                {materialesVista.length} registros
              </div>
            </section>
          )}

        {(tipo === TIPOS.TODO ||
          tipo === TIPOS.HERRAMIENTAS) &&
          tecnico && (
            <section style={styles.tarjeta}>
              <h2 style={styles.seccionTitulo}>
                Herramientas
              </h2>

              <div style={styles.tablaWrap}>
                <table style={styles.tabla}>
                  <thead>
                    <tr>
                      <th style={styles.th}>
                        Producto
                      </th>
                      <th style={styles.th}>
                        Ubicación
                      </th>
                      <th style={styles.th}>
                        Sistema
                      </th>
                      <th style={styles.th}>
                        Físico
                      </th>
                      <th style={styles.th}>
                        Diferencia
                      </th>
                      <th style={styles.th}>
                        Observación
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {herramientasVista.map(
                      (x, index) => {
                        const diferencia =
                          numero(x.fisico) -
                          numero(x.sistema)

                        return (
                          <tr
                            key={`${x.producto}-${x.ubicacion}-${index}`}
                          >
                            <td style={styles.td}>
                              {x.producto}
                            </td>

                            <td style={styles.td}>
                              {x.ubicacion}
                            </td>

                            <td style={styles.td}>
                              {x.sistema}
                            </td>

                            <td style={styles.td}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                style={styles.inputTabla}
                                value={x.fisico}
                                data-fisico-herramienta
                                onChange={(e) =>
                                  cambiarFisicoHerramienta(
                                    herramientas.indexOf(
                                      x
                                    ),
                                    e.target.value
                                  )
                                }
                                onKeyDown={(e) =>
                                  brincarSiguienteFisico(
                                    e,
                                    '[data-fisico-herramienta]'
                                  )
                                }
                              />
                            </td>

                            <td style={styles.td}>
                              <strong>
                                {diferencia}
                              </strong>
                            </td>

                            <td style={styles.td}>
                              <strong>{observacionDiferencia(x.fisico, x.sistema)}</strong>
                            </td>
                          </tr>
                        )
                      }
                    )}
                  </tbody>
                </table>
              </div>

              <div style={styles.contador}>
                {herramientasVista.length} registros
              </div>
            </section>
          )}

        {(tipo === TIPOS.TODO ||
          tipo === TIPOS.EQUIPOS) &&
          tecnico && (
            <section style={styles.tarjeta}>
              <h2 style={styles.seccionTitulo}>
                Escaneo de equipos
              </h2>

              <form
                onSubmit={registrarSerie}
                style={styles.escaner}
              >
                <input
                  autoFocus
                  style={styles.input}
                  value={serie}
                  onChange={(e) =>
                    setSerie(
                      e.target.value.toUpperCase()
                    )
                  }
                  placeholder="Escanee o capture número de serie"
                />

                <button
                  style={styles.botonPrincipal}
                  type="submit"
                >
                  Registrar serie
                </button>
              </form>

              <div style={styles.tablaWrap}>
                <table style={styles.tabla}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Serie</th>
                      <th style={styles.th}>
                        Material
                      </th>
                      <th style={styles.th}>
                        Descripción
                      </th>
                      <th style={styles.th}>Lote</th>
                      <th style={styles.th}>
                        Estado
                      </th>
                      <th style={styles.th}>
                        Acción
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {equiposVista.map(
                      (x, index) => (
                        <tr
                          key={`${x.serie}-${index}`}
                        >
                          <td style={styles.td}>
                            {x.serie}
                          </td>

                          <td style={styles.td}>
                            {x.material}
                          </td>

                          <td style={styles.td}>
                            {x.descripcion}
                          </td>

                          <td style={styles.td}>
                            {x.lote}
                          </td>

                          <td style={styles.td}>
                            <strong>
                              {x.estado}
                            </strong>
                          </td>

                          <td style={styles.td}>
                            {x.escaneado ? (
                              <button
                                type="button"
                                style={styles.botonEliminarEscaneo}
                                onClick={() =>
                                  eliminarEscaneo(x.serie)
                                }
                              >
                                Eliminar escaneo
                              </button>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              <div style={styles.contador}>
                {equiposVista.length} equipos
              </div>
            </section>
          )}


        <section style={styles.tarjeta}>
          <h2 style={styles.seccionTitulo}>Auditorias realizadas</h2>
          <div style={styles.formulario}>
            <label style={styles.campo}><span>Mes</span><input type="month" style={styles.input} value={histMes} onChange={(e)=>setHistMes(e.target.value)} /></label>
            <label style={styles.campo}><span>Almacen</span><input style={styles.input} value={histAlmacen} onChange={(e)=>setHistAlmacen(e.target.value.toUpperCase())} placeholder="Ej. 0045" /></label>
            <label style={styles.campo}><span>Folio</span><input style={styles.input} value={histFolio} onChange={(e)=>setHistFolio(e.target.value.toUpperCase())} placeholder="AUD-PUE-..." /></label>
          </div>
          <div style={styles.botones}>
            <button type="button" style={styles.botonPrincipal} disabled={histCargando} onClick={()=>buscarAuditoriasRealizadas(false)}>{histCargando ? 'Buscando...' : 'Buscar auditorias'}</button>
            <button type="button" style={styles.botonFaltantes} disabled={histCargando} onClick={()=>buscarAuditoriasRealizadas(true)}>Ver faltante global</button>
            <button type="button" style={styles.botonSecundario} onClick={limpiarHistoricos}>Limpiar filtros</button>
          </div>
          {histFaltanteGlobal && <div style={styles.tecnico}><strong>Faltante global:</strong> se muestran solamente faltantes de las auditorias que coinciden con los filtros.</div>}

          {histResultados.length > 0 && <div style={styles.tablaWrap}>
            <table style={styles.tabla}><thead><tr><th style={styles.th}>Folio</th><th style={styles.th}>Fecha</th><th style={styles.th}>Mes</th><th style={styles.th}>Almacen</th><th style={styles.th}>Tecnico</th><th style={styles.th}>Auditor</th><th style={styles.th}>Mat.</th><th style={styles.th}>Herr.</th><th style={styles.th}>Eq.</th><th style={styles.th}>Accion</th></tr></thead>
            <tbody>{histResultados.map((x)=><tr key={x.folio}><td style={styles.td}>{x.folio}</td><td style={styles.td}>{texto(x.fecha)}</td><td style={styles.td}>{x.mes}</td><td style={styles.td}>{x.almacen}</td><td style={styles.td}>{x.tecnico}</td><td style={styles.td}>{x.auditor}</td><td style={styles.td}>{x.materiales.length}</td><td style={styles.td}>{x.herramientas.length}</td><td style={styles.td}>{x.equipos.length}</td><td style={styles.td}><button type="button" style={styles.botonSecundario} onClick={()=>abrirDetalleHistorico(x)}>Ver detalle</button></td></tr>)}</tbody></table>
          </div>}

          {histDetalle && <div style={{marginTop:'18px'}}>
            <h3>Detalle: {histDetalle.folio}</h3>
            {histDetalle.materiales.length > 0 && <><h4>Materiales</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>SKU</th><th style={styles.th}>Material</th><th style={styles.th}>Lote</th><th style={styles.th}>Sistema</th><th style={styles.th}>Fisico</th><th style={styles.th}>Diferencia</th><th style={styles.th}>Observacion</th></tr></thead><tbody>{histDetalle.materiales.map((x,i)=><tr key={i}><td style={styles.td}>{x.sku}</td><td style={styles.td}>{x.material}</td><td style={styles.td}>{x.lote}</td><td style={styles.td}>{x.sistema}</td><td style={styles.td}>{x.fisico}</td><td style={styles.td}>{x.diferencia}</td><td style={styles.td}>{x.observacion}</td></tr>)}</tbody></table></div></>}
            {histDetalle.herramientas.length > 0 && <><h4>Herramientas</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>Producto</th><th style={styles.th}>Ubicacion</th><th style={styles.th}>Sistema</th><th style={styles.th}>Fisico</th><th style={styles.th}>Diferencia</th><th style={styles.th}>Observacion</th></tr></thead><tbody>{histDetalle.herramientas.map((x,i)=><tr key={i}><td style={styles.td}>{x.producto}</td><td style={styles.td}>{x.ubicacion}</td><td style={styles.td}>{x.sistema}</td><td style={styles.td}>{x.fisico}</td><td style={styles.td}>{x.diferencia}</td><td style={styles.td}>{x.observacion}</td></tr>)}</tbody></table></div></>}
            {histDetalle.equipos.length > 0 && <><h4>Equipos</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>Serie</th><th style={styles.th}>Material</th><th style={styles.th}>Descripcion</th><th style={styles.th}>Lote</th><th style={styles.th}>Estado</th></tr></thead><tbody>{histDetalle.equipos.map((x,i)=><tr key={i}><td style={styles.td}>{x.serie}</td><td style={styles.td}>{x.material}</td><td style={styles.td}>{x.descripcion}</td><td style={styles.td}>{x.lote}</td><td style={styles.td}>{x.estado}</td></tr>)}</tbody></table></div></>}
          </div>}
        </section>
        {tecnico && (
          <section style={styles.tarjeta}>
            <h2 style={styles.subtitulo}>Observaciones generales</h2>
            <textarea
              value={comentarioGeneral}
              onChange={(e) => setComentarioGeneral(e.target.value)}
              placeholder="Observaciones generales de la auditoría..."
              rows={4}
              disabled={guardando}
              style={styles.textarea}
            />

            <button
              type="button"
              style={{
                ...styles.botonGuardar,
                opacity: guardando ? 0.65 : 1,
                cursor: guardando ? 'not-allowed' : 'pointer',
              }}
              onClick={guardarAuditoria}
              disabled={guardando}
            >
              {guardando ? 'Guardando auditoría...' : 'Guardar auditoría'}
            </button>
          </section>
        )}
      </div>
    </main>
  )
}

const styles = {
  pagina: {
    minHeight: '100vh',
    background: '#f4f7f6',
    padding: '24px',
    fontFamily: 'Arial, sans-serif',
    color: '#17211d',
  },

  centrado: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'Arial, sans-serif',
  },

  contenedor: {
    maxWidth: '1500px',
    margin: '0 auto',
  },

  encabezado: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '20px',
    alignItems: 'center',
    marginBottom: '16px',
  },

  titulo: {
    margin: 0,
    fontSize: '30px',
  },

  subtitulo: {
    marginTop: '5px',
    color: '#607069',
  },

  usuario: {
    background: '#e9f2ee',
    border: '1px solid #cadbd3',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '16px',
  },

  tarjeta: {
    background: '#ffffff',
    border: '1px solid #d9e1dd',
    borderRadius: '12px',
    padding: '18px',
    marginBottom: '18px',
    boxShadow: '0 2px 8px rgba(0,0,0,.04)',
  },

  formulario: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '14px',
  },

  campo: {
    display: 'grid',
    gap: '7px',
    fontWeight: 700,
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #b8c4be',
    borderRadius: '8px',
    padding: '11px 12px',
    fontSize: '15px',
    background: '#fff',
  },

  inputTabla: {
    width: '100%',
    minWidth: '90px',
    boxSizing: 'border-box',
    border: '1px solid #c7d0cc',
    borderRadius: '6px',
    padding: '7px',
  },

  tecnico: {
    marginTop: '15px',
    padding: '12px',
    background: '#f5f8f7',
    borderRadius: '8px',
  },

  botones: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    marginTop: '16px',
  },

  botonPrincipal: {
    border: 0,
    borderRadius: '8px',
    padding: '11px 18px',
    cursor: 'pointer',
    background: '#176b4d',
    color: '#fff',
    fontWeight: 700,
  },

  botonFaltantes: {
    border: 0,
    borderRadius: '8px',
    padding: '11px 18px',
    cursor: 'pointer',
    background: '#a36a00',
    color: '#fff',
    fontWeight: 700,
  },

  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '100px',
    padding: '12px',
    border: '1px solid #b8c6c0',
    borderRadius: '8px',
    resize: 'vertical',
    fontFamily: 'inherit',
    fontSize: '14px',
    marginBottom: '14px',
  },

  botonGuardar: {
    border: 0,
    borderRadius: '8px',
    padding: '13px 22px',
    cursor: 'pointer',
    background: '#0d5f43',
    color: '#fff',
    fontWeight: 700,
    fontSize: '16px',
  },

  botonEliminarEscaneo: {
    border: '1px solid #c94b4b',
    borderRadius: '7px',
    padding: '7px 10px',
    cursor: 'pointer',
    background: '#fff',
    color: '#a32020',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },

  botonSecundario: {
    border: '1px solid #aab8b1',
    borderRadius: '8px',
    padding: '10px 17px',
    cursor: 'pointer',
    background: '#fff',
    color: '#24332c',
    fontWeight: 700,
  },

  seccionTitulo: {
    marginTop: 0,
  },

  tablaWrap: {
    overflowX: 'auto',
  },

  tabla: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '850px',
  },

  th: {
    textAlign: 'left',
    padding: '10px',
    background: '#e8efec',
    borderBottom: '2px solid #bdcac4',
    whiteSpace: 'nowrap',
  },

  td: {
    padding: '9px 10px',
    borderBottom: '1px solid #e1e7e4',
    verticalAlign: 'middle',
  },

  contador: {
    marginTop: '10px',
    color: '#5c6b64',
    fontSize: '13px',
  },

  escaner: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '10px',
    marginBottom: '16px',
  },

  error: {
    background: '#fdecec',
    border: '1px solid #e9bcbc',
    color: '#8b1f1f',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '14px',
  },

  ok: {
    background: '#eaf6ef',
    border: '1px solid #b9ddc8',
    color: '#155b38',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '14px',
  },
}
