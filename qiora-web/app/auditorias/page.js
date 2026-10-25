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
  return 'COINCIDE'
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

// Deduplicación visual: únicamente filas idénticas en sus datos operativos.
// No elimina ni modifica registros de Supabase.
function sinDuplicadosHistoricos(filas, tipo) {
  const campos = tipo === 'MATERIALES'
    ? ['sku', 'material', 'lote', 'sistema', 'fisico', 'diferencia', 'observacion']
    : tipo === 'HERRAMIENTAS'
      ? ['producto', 'ubicacion', 'sistema', 'fisico', 'diferencia', 'observacion']
      : ['serie', 'material', 'descripcion', 'lote', 'estado']
  const vistos = new Set()
  return filas.filter((fila) => {
    const clave = JSON.stringify([fila.folio, fila.almacen, ...campos.map((c) => fila[c] ?? null)])
    if (vistos.has(clave)) return false
    vistos.add(clave)
    return true
  })
}

function resumenFaltantesHistoricos(resultados) {
  const r = { materiales: 0, herramientas: 0, equipos: 0, unidadesMateriales: 0, unidadesHerramientas: 0 }
  for (const g of resultados) {
    r.materiales += g.materiales.length
    r.herramientas += g.herramientas.length
    r.equipos += g.equipos.length
    for (const x of g.materiales) r.unidadesMateriales += Math.max(0, -numero(x.diferencia))
    for (const x of g.herramientas) r.unidadesHerramientas += Math.max(0, -numero(x.diferencia))
  }
  return r
}


// Generador PDF autonomo: sin dependencias ni servicios externos.
// Emite PDF A4 multipagina con tipografia Helvetica (WinAnsi).
// PDF A4, estilo del reporte QIORA original. No requiere dependencias externas.
function crearPdfAuditoria(info) {
  const normal = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
  const ansi = (s) => normal(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\xa1-\xff]/g, '?')
  const esc = (s) => ansi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const anchoTexto = (s, tam = 8) => ansi(s).length * tam * 0.61
  const ajustar = (valor, ancho, tam = 8) => {
    const palabras = ansi(valor).split(' '), partes = []
    let linea = ''
    for (const palabra of palabras) {
      if (anchoTexto((linea ? linea + ' ' : '') + palabra, tam) <= ancho - 7) {
        linea += (linea ? ' ' : '') + palabra
      } else {
        if (linea) partes.push(linea)
        linea = ''
        for (const c of palabra) {
          if (anchoTexto(linea + c, tam) > ancho - 7 && linea) { partes.push(linea); linea = '' }
          linea += c
        }
      }
    }
    if (linea) partes.push(linea)
    return partes.length ? partes : ['']
  }
  const verde = [0.025, 0.32, 0.25], verdeClaro = [0.92, 0.98, 0.95]
  const rgb = (c) => c.join(' ')
  const paginas = []
  let ops = [], y = 812
  const rect = (x, abajo, w, h, color, borde = null) => {
    if (color) ops.push(`${rgb(color)} rg ${x} ${abajo} ${w} ${h} re f`)
    if (borde) ops.push(`${rgb(borde)} RG 0.6 w ${x} ${abajo} ${w} ${h} re S`)
  }
  const linea = (x1, y1, x2, y2, color = verde) => ops.push(`${rgb(color)} RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`)
  const txt = (s, x, yy, tam = 8, bold = false, color = [0.1, 0.18, 0.15], centrar = false) => {
    const val = ansi(s)
    const pos = centrar ? x - anchoTexto(val, tam) / 2 : x
    ops.push(`${rgb(color)} rg BT /${bold ? 'F2' : 'F1'} ${tam} Tf ${pos.toFixed(1)} ${yy.toFixed(1)} Td (${esc(val)}) Tj ET`)
  }
  const encabezado = (seccion, continuacion = false) => {
    rect(28, 767, 539, 57, verde)
    txt('QIORA CONECTA', 297, 797, 16, true, [1, 1, 1], true)
    // PUEBLA se conoce para MG13. Para otros, mostrar codigo sin inventar una sede.
    const sede = String(info.distrito || '').toUpperCase() === 'MG13'
      ? 'PUEBLA | ALMACENES' : `${normal(info.distrito) || 'DISTRITO'} | ALMACENES`
    txt(sede, 297, 780, 10, true, [1, 1, 1], true)
    txt(`REPORTE DE AUDITORIA - ${seccion}${continuacion ? ' (CONTINUACION)' : ''}`, 297, 742, 13, true, verde, true)
    y = 720
  }
  const datos = () => {
    const labels = [
      ['Folio', info.folio], ['Fecha', info.fecha], ['Tipo de auditoria', info.tipo],
      ['Distrito', info.distrito], ['Almacen', info.almacen], ['Tecnico', info.tecnico],
      ['Auditor', info.auditor], ['Usuario', info.usuario],
      ['Observaciones', info.comentario || 'Sin observaciones']
    ]
    let alto = 15 * labels.length + 15
    rect(28, y - alto, 539, alto, verdeClaro, [0.25, 0.57, 0.46])
    let yy = y - 17
    labels.forEach(([k,v]) => { txt(`${k}: ${normal(v)}`, 38, yy, 8, false); yy -= 15 })
    y -= alto + 14
  }
  const nueva = (seccion, continuacion = false) => {
    if (ops.length) paginas.push(ops.join('\n') + '\n')
    ops = []; encabezado(seccion, continuacion)
    if (!continuacion) datos()
  }
  const columnasMat = [
    { k:'sku', n:'SKU', w:58 }, { k:'material', n:'Material', w:145 },
    { k:'lote', n:'Lote', w:67 }, { k:'sistema', n:'Sistema', w:55 },
    { k:'fisico', n:'Fisico', w:50 }, { k:'diferencia', n:'Diferencia', w:65 },
    { k:'observacion', n:'Observacion', w:99 }
  ]
  const columnasHer = [
    { k:'producto', n:'Producto', w:157 }, { k:'ubicacion', n:'Ubicacion', w:160 },
    { k:'sistema', n:'Sistema', w:49 }, { k:'fisico', n:'Fisico', w:49 },
    { k:'diferencia', n:'Diferencia', w:55 }, { k:'observacion', n:'Observacion', w:69 }
  ]
  const columnasEq = [
    { k:'serie', n:'Serie', w:133 }, { k:'material', n:'Material', w:65 },
    { k:'descripcion', n:'Descripcion', w:166 }, { k:'lote', n:'Lote', w:84 },
    { k:'estado', n:'Estado', w:91 }
  ]
  const cabTabla = (cols) => {
    rect(28, y - 26, 539, 26, verde)
    let x = 28
    cols.forEach(c => { txt(c.n, x + c.w/2, y - 17, 8, true, [1,1,1], true); x += c.w })
    y -= 26
  }
  const tabla = (nombre, filas, cols) => {
    nueva(nombre)
    cabTabla(cols)
    for (const item of filas) {
      const datosFila = {...item}
      if (nombre !== 'EQUIPOS') {
        const d = Number(item.fisico || 0) - Number(item.sistema || 0)
        datosFila.diferencia = d
        datosFila.observacion = d < 0 ? 'FALTANTE' : d > 0 ? 'SOBRANTE' : 'COINCIDE'
      }
      const wraps = cols.map(c => ajustar(datosFila[c.k] ?? '', c.w, 7.3))
      const altura = Math.max(23, 9 + Math.max(...wraps.map(r => r.length)) * 10)
      if (y - altura < 70) { nueva(nombre, true); cabTabla(cols) }
      rect(28, y - altura, 539, altura, [1,1,1], [0.25,0.57,0.46])
      let x = 28
      cols.forEach((c, i) => {
        linea(x, y, x, y - altura)
        const color = datosFila[c.k] === 'FALTANTE' || (c.k === 'observacion' && datosFila.observacion === 'FALTANTE') || (c.k === 'estado' && normal(datosFila.estado) === 'FALTANTE') ? [0.68,0.12,0.12] : [0.1,0.2,0.17]
        const colorFinal = (c.k === 'observacion' || c.k === 'estado') ? color : [0.1,0.2,0.17]
        wraps[i].forEach((p, k) => txt(p, x + c.w/2, y - 14 - k * 10, 7.3, c.k === 'observacion' || c.k === 'estado', colorFinal, true))
        x += c.w
      })
      linea(567, y, 567, y - altura)
      y -= altura
    }
  }
  if (info.materiales?.length) tabla('MATERIALES', info.materiales, columnasMat)
  if (info.herramientas?.length) tabla('HERRAMIENTAS', info.herramientas, columnasHer)
  if (info.equipos?.length) tabla('EQUIPOS', info.equipos, columnasEq)
  if (!ops.length) nueva('AUDITORIA')
  if (y < 125) nueva('FIRMAS', true)
  const firmas = [
    {x: 28, nom: 'AUDITOR', persona: info.auditor},
    {x: 211, nom: 'TECNICO', persona: info.tecnico},
    {x: 394, nom: 'SUPERVISOR', persona: ''},
  ]
  firmas.forEach(({x,nom,persona}) => {
    linea(x + 8, y - 37, x + 168, y - 37)
    txt(nom, x + 88, y - 54, 9, true, verde, true)
    if (persona) ajustar(persona, 172, 7).forEach((t,i) => txt(t, x + 88, y - 68 - 9*i, 7, false, [0.15,0.15,0.15], true))
  })
  paginas.push(ops.join('\n') + '\n')
  const objetos = [null]
  const objeto = (v) => { objetos.push(v); return objetos.length - 1 }
  const catalogId = objeto(''), pagesId = objeto('')
  const regularId = objeto('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const boldId = objeto('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const ids = []
  paginas.forEach((cmd, i) => {
    const pie = `BT /F1 8 Tf 28 36 Td (QIORA CONECTA - Pagina ${i+1} de ${paginas.length}) Tj ET\n`
    const stream = cmd + pie
    const contentId = objeto(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
    ids.push(objeto(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`))
  })
  objetos[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objetos[pagesId] = `<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count ${ids.length} >>`
  let pdf = '%PDF-1.4\n', offsets = [0]
  for (let i=1; i<objetos.length; i++) { offsets[i] = pdf.length; pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`
  for(let i=1; i<objetos.length; i++) pdf += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([Uint8Array.from(pdf, c => c.charCodeAt(0) & 255)], { type:'application/pdf' })
}

function descargarPdfAuditoria(info) {
  const pdf = crearPdfAuditoria(info)
  const url = URL.createObjectURL(pdf)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = ('AUDITORIA_' + String(info.folio).replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf')
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  // Se revoca despues de permitir que el navegador procese la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export default function AuditoriasPage() {
  const router = useRouter()

  const [cargandoInicio, setCargandoInicio] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const [perfil, setPerfil] = useState(null)
  const [vista, setVista] = useState('MENU')

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
  const [ultimoPdf, setUltimoPdf] = useState(null)

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

      // Copia exacta de los datos que Supabase acaba de confirmar.
      const pdfInfo = {
        folio: data.folio,
        fecha: data.fecha || new Date().toLocaleString('es-MX'),
        distrito: perfil?.distrito || '',
        almacen: normalizarAlmacen(almacen),
        tecnico: tecnico.nombre || '',
        auditor: perfil?.nombre || '',
        usuario: perfil?.usuario_almacen || '',
        tipo,
        materiales: payloadMateriales,
        herramientas: payloadHerramientas,
        equipos: payloadEquipos,
        comentario: comentarioGeneral,
      }
      setUltimoPdf(pdfInfo)

      // La auditoria YA esta guardada. Limpiar sin borrar el mensaje de confirmacion.
      setAlmacen('')
      setTecnico(null)
      setMateriales([])
      setHerramientas([])
      setEquipos([])
      setSerie('')
      setSoloFaltantes(false)
      setComentarioGeneral('')
      setTipo(TIPOS.TODO)

      try {
        descargarPdfAuditoria(pdfInfo)
        setMensaje(`Auditoría guardada correctamente. Folio: ${data.folio}. PDF generado y descarga iniciada. Formulario limpio.`)
      } catch (pdfError) {
        setMensaje(`Auditoría guardada correctamente. Folio: ${data.folio}. Formulario limpio.`)
        setError('No se inició la descarga del PDF. Usa el botón «Descargar último PDF»; NO vuelvas a guardar la auditoría.')
      }
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

      // Leer todas las páginas para evitar que un límite de 1,000 filas
      // produzca faltantes globales incompletos.
      for (const cfg of tablas) {
        const filas = []
        const tamano = 500
        for (let inicio = 0; ; inicio += tamano) {
          let q = supabase.from(cfg.nombre).select('*')
            .order('fecha', { ascending: false })
            .range(inicio, inicio + tamano - 1)
          if (almacenFiltro) q = q.eq('almacen', almacenFiltro)
          if (folioFiltro) q = q.eq('folio', folioFiltro)
          if (mesFiltro) q = q.eq('mes', mesFiltro)
          const { data, error: qError } = await q
          if (qError) throw qError
          filas.push(...(data || []))
          if (!data || data.length < tamano) break
        }
        for (const fila of sinDuplicadosHistoricos(filas, cfg.tipo)) {
          const folio = texto(fila.folio)
          if (!folio) continue
          const claveGrupo = `${folio}|${texto(fila.almacen)}`
          if (!grupos.has(claveGrupo)) {
            grupos.set(claveGrupo, {
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
          const g = grupos.get(claveGrupo)
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
      setVista(verFaltanteGlobal ? 'FALTANTE_GLOBAL' : 'HISTORICO')
      window.scrollTo({ top: 0, behavior: 'instant' })
      setMensaje(`${resultados.length} auditoria(s) encontrada(s).`)
    } catch (e) {
      setError(e?.message || 'No fue posible consultar las auditorias realizadas.')
    } finally {
      setHistCargando(false)
    }
  }

  function abrirDetalleHistorico(item) {
    setHistDetalle(item)
    setVista(vista === 'FALTANTE_GLOBAL' ? 'DETALLE_FALTANTE' : 'DETALLE_HISTORICO')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function regresarDesdeFaltante() {
    setHistDetalle(null)
    setVista('HISTORICO')
    window.scrollTo({ top: 0, behavior: 'instant' })
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
        {vista === 'MENU' ? (
          <section style={styles.menuShell}>
            <button type="button" style={styles.menuVolver} onClick={() => router.push('/')}>← Regresar al menú</button>
            <div style={styles.menuHero}>
              <h1 style={styles.menuTitulo}>▤ AUDITORÍAS</h1>
              <p style={styles.menuDescripcion}>Seleccione una opción de auditorías</p>
            </div>
            <div style={styles.menuGrid}>
              <button type="button" style={styles.menuOpcion} onClick={() => setVista('CAPTURA')}>▤ Auditorías Técnicos</button>
              <button type="button" style={styles.menuOpcion} onClick={() => setVista('HISTORICO')}>☑ Auditorías realizadas</button>
              <button type="button" style={styles.menuOpcion} onClick={() => setVista('PROGRAMACION')}>▤ Programar Auditorías por Semana</button>
            </div>
          </section>
        ) : (
          <div style={styles.encabezado}>
            <div>
              <h1 style={styles.titulo}>{vista === 'CAPTURA' ? 'Auditorías Técnicos' : vista === 'HISTORICO' ? 'Auditorías realizadas' : vista === 'FALTANTE_GLOBAL' ? 'Faltante global' : vista === 'DETALLE_FALTANTE' ? 'Detalle de faltantes' : vista === 'DETALLE_HISTORICO' ? 'Detalle de auditoría' : 'Programar Auditorías por Semana'}</h1>
              <div style={styles.subtitulo}>QIORA CONECTA · {perfil?.distrito || ''}</div>
            </div>
            <button type="button" style={styles.botonSecundario} onClick={() => (vista === 'DETALLE_FALTANTE' ? setVista('FALTANTE_GLOBAL') : ['FALTANTE_GLOBAL', 'DETALLE_HISTORICO'].includes(vista) ? regresarDesdeFaltante() : setVista('MENU'))}>{vista === 'DETALLE_FALTANTE' ? '← Regresar al faltante global' : ['FALTANTE_GLOBAL', 'DETALLE_HISTORICO'].includes(vista) ? '← Regresar al historial' : '← Regresar a Auditorías'}</button>
          </div>
        )}

        {perfil && vista !== 'MENU' && (
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

        {error && vista !== 'MENU' && (
          <div style={styles.error}>{error}</div>
        )}

        {mensaje && ['CAPTURA', 'HISTORICO', 'FALTANTE_GLOBAL', 'PROGRAMACION'].includes(vista) && (
          <div style={styles.ok}>{mensaje}</div>
        )}
        {ultimoPdf && vista === 'CAPTURA' && (
          <div style={{ marginBottom: 16 }}>
            <button type="button" style={styles.botonPrincipal} onClick={() => {
              try { descargarPdfAuditoria(ultimoPdf) }
              catch (e) { setError('No se pudo descargar el PDF: ' + (e.message || e)) }
            }}>Descargar último PDF: {ultimoPdf.folio}</button>
          </div>
        )}

        {vista === 'HISTORICO' && (
          <section style={styles.tarjeta}>
            <h2 style={styles.seccionTitulo}>Auditorías realizadas</h2>
            <p style={{color:'#53675e'}}>Consulta por mes, almacén o folio. El faltante global se abre en una pantalla independiente.</p>
          <div style={styles.formulario}>
            <label style={styles.campo}><span>Mes</span><input type="month" style={{...styles.input, colorScheme: 'light', minHeight: 46}} value={histMes} onChange={(e)=>setHistMes(e.target.value)} /></label>
            <label style={styles.campo}><span>Almacen</span><input style={styles.input} value={histAlmacen} onChange={(e)=>setHistAlmacen(e.target.value.toUpperCase())} placeholder="Ej. 0045" /></label>
            <label style={styles.campo}><span>Folio</span><input style={styles.input} value={histFolio} onChange={(e)=>setHistFolio(e.target.value.toUpperCase())} placeholder="AUD-PUE-..." /></label>
          </div>
          <div style={styles.botones}>
            <button type="button" style={styles.botonPrincipal} disabled={histCargando} onClick={()=>buscarAuditoriasRealizadas(false)}>{histCargando ? 'Buscando...' : 'Buscar auditorias'}</button>
            <button type="button" style={styles.botonFaltantes} disabled={histCargando} onClick={()=>buscarAuditoriasRealizadas(true)}>Ver faltante global</button>
            <button type="button" style={styles.botonSecundario} onClick={limpiarHistoricos}>Limpiar filtros</button>
          </div>
            {histResultados.length > 0 && <div style={styles.tablaWrap}>
            <table style={styles.tabla}><thead><tr><th style={styles.th}>Folio</th><th style={styles.th}>Fecha</th><th style={styles.th}>Mes</th><th style={styles.th}>Almacen</th><th style={styles.th}>Tecnico</th><th style={styles.th}>Auditor</th><th style={styles.th}>Mat.</th><th style={styles.th}>Herr.</th><th style={styles.th}>Eq.</th><th style={styles.th}>Accion</th></tr></thead>
            <tbody>{histResultados.map((x)=><tr key={`${x.folio}|${x.almacen}`}><td style={styles.td}>{x.folio}</td><td style={styles.td}>{texto(x.fecha)}</td><td style={styles.td}>{x.mes}</td><td style={styles.td}>{x.almacen}</td><td style={styles.td}>{x.tecnico}</td><td style={styles.td}>{x.auditor}</td><td style={styles.td}>{x.materiales.length}</td><td style={styles.td}>{x.herramientas.length}</td><td style={styles.td}>{x.equipos.length}</td><td style={styles.td}><button type="button" style={styles.botonSecundario} onClick={()=>abrirDetalleHistorico(x)}>Ver detalle</button></td></tr>)}</tbody></table>
          </div>}
          </section>
        )}

        {vista === 'FALTANTE_GLOBAL' && (
          <section style={styles.tarjeta}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
              <div>
                <h2 style={styles.seccionTitulo}>Faltante global de auditorías</h2>
                <p style={{color:'#53675e',margin:'4px 0 12px'}}>Mes: <strong>{histMes || 'Todos'}</strong> · Almacén: <strong>{normalizarAlmacen(histAlmacen) || 'Todos'}</strong> · Folio: <strong>{histFolio || 'Todos'}</strong></p>
              </div>
              <button type="button" style={styles.botonSecundario} onClick={regresarDesdeFaltante}>← Regresar al historial</button>
            </div>
{histFaltanteGlobal && (
            <div style={styles.tecnico}>
              <strong>Faltante global · Resultados sin filas idénticas repetidas</strong>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginTop:12}}>
                {[
                  ['Materiales faltantes', resumenFaltantesHistoricos(histResultados).materiales],
                  ['Unidades materiales', resumenFaltantesHistoricos(histResultados).unidadesMateriales],
                  ['Herramientas faltantes', resumenFaltantesHistoricos(histResultados).herramientas],
                  ['Unidades herramientas', resumenFaltantesHistoricos(histResultados).unidadesHerramientas],
                  ['Equipos faltantes', resumenFaltantesHistoricos(histResultados).equipos],
                ].map(([nombre, valor]) => (
                  <div key={nombre} style={{background:'#e6f3ed',border:'1px solid #b7d9cb',borderRadius:10,padding:14}}>
                    <div style={{fontSize:13,color:'#344c41'}}>{nombre}</div>
                    <strong style={{fontSize:25,color:'#095538'}}>{valor}</strong>
                  </div>
                ))}
              </div>
              <p style={{fontSize:12,color:'#53675e',marginBottom:0}}>
                Se cuentan registros únicos por folio y almacén. Los datos originales no se modifican.
                Para reportes multidistrito es necesario verificar la atribución histórica de cada almacén.
              </p>
            </div>
          )}
            <h3 style={{marginTop:22}}>Auditorías con faltantes ({histResultados.length})</h3>
{histResultados.length > 0 && <div style={styles.tablaWrap}>
            <table style={styles.tabla}><thead><tr><th style={styles.th}>Folio</th><th style={styles.th}>Fecha</th><th style={styles.th}>Mes</th><th style={styles.th}>Almacen</th><th style={styles.th}>Tecnico</th><th style={styles.th}>Auditor</th><th style={styles.th}>Mat.</th><th style={styles.th}>Herr.</th><th style={styles.th}>Eq.</th><th style={styles.th}>Accion</th></tr></thead>
            <tbody>{histResultados.map((x)=><tr key={`${x.folio}|${x.almacen}`}><td style={styles.td}>{x.folio}</td><td style={styles.td}>{texto(x.fecha)}</td><td style={styles.td}>{x.mes}</td><td style={styles.td}>{x.almacen}</td><td style={styles.td}>{x.tecnico}</td><td style={styles.td}>{x.auditor}</td><td style={styles.td}>{x.materiales.length}</td><td style={styles.td}>{x.herramientas.length}</td><td style={styles.td}>{x.equipos.length}</td><td style={styles.td}><button type="button" style={styles.botonSecundario} onClick={()=>abrirDetalleHistorico(x)}>Ver detalle</button></td></tr>)}</tbody></table>
          </div>}
            {histResultados.length === 0 && <p>No se encontraron faltantes con los filtros seleccionados.</p>}
          </section>
        )}

        {(vista === 'DETALLE_FALTANTE' || vista === 'DETALLE_HISTORICO') && (
          <section style={styles.tarjeta}>
            <button type="button" style={styles.botonSecundario} onClick={() => { setVista(vista === 'DETALLE_FALTANTE' ? 'FALTANTE_GLOBAL' : 'HISTORICO'); window.scrollTo({top:0,behavior:'instant'}) }}>
              ← {vista === 'DETALLE_FALTANTE' ? 'Regresar al faltante global' : 'Regresar al historial'}
            </button>
{histDetalle && <div style={{marginTop:'18px'}}>
            <h3 style={{marginBottom:8}}>Detalle: {histDetalle.folio}</h3>
            <p style={{color:'#53675e',margin:'0 0 16px'}}>Almacén: <strong>{histDetalle.almacen}</strong> · Técnico: <strong>{histDetalle.tecnico || '-'}</strong> · Mes: <strong>{histDetalle.mes || '-'}</strong></p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:12,marginBottom:20}}>
              {[
                ['Materiales', histDetalle.materiales.length],
                ['Herramientas', histDetalle.herramientas.length],
                ['Equipos', histDetalle.equipos.length],
              ].map(([etiqueta,cantidad]) => (
                <div key={etiqueta} style={{border:'1px solid #b7d9cb',borderRadius:10,padding:14,background:'#eaf5ef'}}>
                  <span style={{display:'block',color:'#406053',fontSize:13}}>{vista === 'DETALLE_FALTANTE' ? `${etiqueta} faltantes` : etiqueta}</span>
                  <strong style={{fontSize:25,color:'#07553d'}}>{cantidad}</strong>
                </div>
              ))}
            </div>
            {histDetalle.materiales.length > 0 && <><h4>Materiales</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>SKU</th><th style={styles.th}>Material</th><th style={styles.th}>Lote</th><th style={styles.th}>Sistema</th><th style={styles.th}>Fisico</th><th style={styles.th}>Diferencia</th><th style={styles.th}>Observacion</th></tr></thead><tbody>{histDetalle.materiales.map((x,i)=><tr key={i}><td style={styles.td}>{x.sku}</td><td style={styles.td}>{x.material}</td><td style={styles.td}>{x.lote}</td><td style={styles.td}>{x.sistema}</td><td style={styles.td}>{x.fisico}</td><td style={styles.td}>{x.diferencia}</td><td style={styles.td}>{x.observacion}</td></tr>)}</tbody></table></div></>}
            {histDetalle.herramientas.length > 0 && <><h4>Herramientas</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>Producto</th><th style={styles.th}>Ubicacion</th><th style={styles.th}>Sistema</th><th style={styles.th}>Fisico</th><th style={styles.th}>Diferencia</th><th style={styles.th}>Observacion</th></tr></thead><tbody>{histDetalle.herramientas.map((x,i)=><tr key={i}><td style={styles.td}>{x.producto}</td><td style={styles.td}>{x.ubicacion}</td><td style={styles.td}>{x.sistema}</td><td style={styles.td}>{x.fisico}</td><td style={styles.td}>{x.diferencia}</td><td style={styles.td}>{x.observacion}</td></tr>)}</tbody></table></div></>}
            {histDetalle.equipos.length > 0 && <><h4>Equipos</h4><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr><th style={styles.th}>Serie</th><th style={styles.th}>Material</th><th style={styles.th}>Descripcion</th><th style={styles.th}>Lote</th><th style={styles.th}>Estado</th></tr></thead><tbody>{histDetalle.equipos.map((x,i)=><tr key={i}><td style={styles.td}>{x.serie}</td><td style={styles.td}>{x.material}</td><td style={styles.td}>{x.descripcion}</td><td style={styles.td}>{x.lote}</td><td style={styles.td}>{x.estado}</td></tr>)}</tbody></table></div></>}
          </div>}
          </section>
        )}

        {vista === 'CAPTURA' && (<>
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
        </>)}

        {vista === 'PROGRAMACION' && (
          <section style={styles.tarjeta}>
            <h2 style={styles.seccionTitulo}>Programación semanal de auditorías</h2>
            <p>Esta pantalla está separada como en el sistema original. La programación, asignación de técnicos, asistencias y reprogramaciones requieren migrar las funciones de Code.gs a Supabase.</p>
            <p><strong>No se guardarán programaciones hasta que el servicio de Supabase esté implementado y validado.</strong></p>
          </section>
        )}
      </div>
    </main>
  )
}

const styles = {
  pagina: {
    minHeight: '100vh',
    background: '#063126',
    padding: '12px',
    fontFamily: 'Arial, sans-serif',
    color: '#17211d',
  },

  centrado: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'Arial, sans-serif',
  },

  menuShell: {background:'linear-gradient(135deg,#092b22,#061f18)', border:'2px solid #416b5c', borderRadius:22, padding:20, color:'#fff', maxWidth:1200, boxShadow:'0 15px 40px #0005'},
  menuVolver: {border:0, borderRadius:12, background:'#107859', color:'#fff', fontWeight:700, padding:'9px 16px', cursor:'pointer', marginBottom:15},
  menuHero: {background:'linear-gradient(105deg,#0d5440,#1aa67e)', border:'2px solid #498d78', borderRadius:17, textAlign:'center', padding:'23px 15px', marginBottom:20},
  menuTitulo: {margin:'0 0 10px', fontSize:30, fontWeight:900},
  menuDescripcion: {margin:0, fontSize:13, color:'#e5fff4'},
  menuGrid: {display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14},
  menuOpcion: {minHeight:86,background:'linear-gradient(120deg,#138665,#1ab38a)',color:'#fff',border:0,borderRadius:13,padding:18,fontWeight:800,textAlign:'left',fontSize:15,cursor:'pointer',boxShadow:'0 6px 14px #0002'},
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
    color: '#f2fff8',
    fontWeight: 800,
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
    color: '#17211d',
    colorScheme: 'light',
  },

  inputTabla: {
    width: '100%',
    minWidth: '90px',
    boxSizing: 'border-box',
    border: '1px solid #c7d0cc',
    borderRadius: '6px',
    padding: '7px',
    background: '#fff',
    color: '#17211d',
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
    background: '#fff',
    color: '#17211d',
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
