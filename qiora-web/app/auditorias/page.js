'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { createClient } from '@supabase/supabase-js'

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


// Exportacion XLSX local sin dependencias nuevas. No consulta ni modifica la base.
function xmlExcel(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'')
}
function colExcel(n) {
  let s = ''
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + (x - 1) % 26) + s
  return s
}
function crc32Qiora(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0)
  }
  return (c ^ -1) >>> 0
}
function crearZipXlsx(archivos) {
  const encoder = new TextEncoder()
  const partes = [], central = []
  let desplazamiento = 0
  const u16 = (v) => [v & 255, (v >>> 8) & 255]
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
  for (const [nombre, contenido] of archivos) {
    const nombreBytes = encoder.encode(nombre), datos = encoder.encode(contenido)
    const crc = crc32Qiora(datos)
    const local = new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(datos.length),...u32(datos.length),...u16(nombreBytes.length),0,0])
    partes.push(local,nombreBytes,datos)
    const centro = new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(datos.length),...u32(datos.length),...u16(nombreBytes.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(desplazamiento)])
    central.push(centro,nombreBytes)
    desplazamiento += local.length + nombreBytes.length + datos.length
  }
  const tamCentral = central.reduce((n,x)=>n+x.length,0)
  const end = new Uint8Array([80,75,5,6,0,0,0,0,...u16(archivos.length),...u16(archivos.length),...u32(tamCentral),...u32(desplazamiento),0,0])
  return new Blob([...partes,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}
function hojaXmlQiora(filas, indicesNumericos=[]) {
  const ancho = Math.max(1,...filas.map(x=>x.length)), fin = colExcel(ancho-1)
  const cuerpo = filas.map((fila, ri) => '<row r="'+(ri+1)+'">'+fila.map((valor,ci)=>{
    if (valor === null || valor === undefined || valor === '') return ''
    const celda = colExcel(ci)+(ri+1)
    if (ri>0 && indicesNumericos.includes(ci) && typeof valor==='number' && Number.isFinite(valor)) return '<c r="'+celda+'"><v>'+valor+'</v></c>'
    return '<c r="'+celda+'" t="inlineStr"><is><t xml:space="preserve">'+xmlExcel(valor)+'</t></is></c>'
  }).join('')+'</row>').join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+fin+Math.max(1,filas.length)+'"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetData>'+cuerpo+'</sheetData></worksheet>'
}
function hojaResumenEstiloQiora(filas) {
  const contenido = filas.map((fila, index) => '<row r="'+(index+1)+'" ht="23" customHeight="1">' +
    fila.map((valor,columna) => '<c r="'+(columna===0?'A':'B')+(index+1)+'" s="'+(columna===0?'1':'2')+'" t="inlineStr"><is><t xml:space="preserve">'+xmlExcel(valor)+'</t></is></c>').join('') + '</row>').join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B'+filas.length+'"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="43" customWidth="1"/></cols><sheetData>'+contenido+'</sheetData></worksheet>'
}
function estilosExcelQiora() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF07543F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD4EAE1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
}
function fechaCortaMx(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? texto(iso) : new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)
}
function fechaHoraMx(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? texto(iso) : new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d)
}
function excelAuditoriaFolio(g) {
  const meta = (fila) => [g.folio, texto(g.fecha), texto(g.mes), texto(g.tipoAuditoria || 'TODO'), texto(g.almacen), texto(g.tecnico), texto(fila?.auditor_usuario || ''), texto(g.auditor),]
  const mat = ['FOLIO','FECHA','MES','TIPO_AUDITORIA','ALMACEN','TECNICO','AUDITOR_USUARIO','AUDITOR_NOMBRE','SKU','MATERIAL','LOTE','SISTEMA','FISICO','DIFERENCIA','OBSERVACION','COMENTARIO_GENERAL']
  const her = ['FOLIO','FECHA','MES','TIPO_AUDITORIA','ALMACEN','TECNICO','AUDITOR_USUARIO','AUDITOR_NOMBRE','PRODUCTO','UBICACION','SISTEMA','FISICO','DIFERENCIA','OBSERVACION','COMENTARIO_GENERAL']
  const eq = ['FOLIO','FECHA','MES','TIPO_AUDITORIA','ALMACEN','TECNICO','AUDITOR_USUARIO','AUDITOR_NOMBRE','SERIE','MATERIAL','DESCRIPCION','LOTE','ESTADO','COMENTARIO_GENERAL']
  const materiales = [mat,...g.materiales.map(r=>[...meta(r),texto(r.sku),texto(r.material),texto(r.lote),numero(r.sistema),numero(r.fisico),numero(r.diferencia),texto(r.observacion)||observacionDiferencia(r.fisico,r.sistema),texto(r.comentario_general)])]
  const herramientas = [her,...g.herramientas.map(r=>[...meta(r),texto(r.producto),texto(r.ubicacion),numero(r.sistema),numero(r.fisico),numero(r.diferencia),texto(r.observacion)||observacionDiferencia(r.fisico,r.sistema),texto(r.comentario_general)])]
  const equipos = [eq,...g.equipos.map(r=>[...meta(r),texto(r.serie),texto(r.material),texto(r.descripcion),texto(r.lote),texto(r.estado),texto(r.comentario_general)])]
  const total = g.materiales.length+g.herramientas.length+g.equipos.length
  const resumen = [['FOLIO',g.folio],['FECHA',fechaCortaMx(g.fecha)],['MES',texto(g.mes)],['TIPO AUDITORIA',texto(g.tipoAuditoria||'TODO')],['ALMACEN',texto(g.almacen)],['TECNICO',texto(g.tecnico)],['AUDITOR',texto(g.auditor)],['TOTAL RENGLONES',total],['FECHA DESCARGA',fechaHoraMx(new Date().toISOString())]]
  const hojas = [hojaResumenEstiloQiora(resumen),hojaXmlQiora(materiales,[11,12,13]),hojaXmlQiora(equipos),hojaXmlQiora(herramientas,[10,11,12])]
  const lista = [
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+hojas.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+['RESUMEN','MATERIALES','EQUIPOS','HERRAMIENTAS'].map((n,i)=>'<sheet name="'+n+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+hojas.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+'</Relationships>'],
    ['xl/styles.xml',estilosExcelQiora()],
    ...hojas.map((x,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',x]),
  ]
  return crearZipXlsx(lista)
}
function descargarExcelAuditoria(g) {
  const blob = excelAuditoriaFolio(g)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'AUDITORIA_REALIZADA_'+texto(g.folio).replace(/[^A-Z0-9_-]/gi,'_')+'.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
}


function fechaQiora(valor) {
  if (!valor) return '-'
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return '-'
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(fecha)
}
function fechaDiaMexico(valor) {
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
function esHoyMexico(valor) { return !!valor && fechaDiaMexico(valor) === fechaDiaMexico(new Date()) }
function gruposEdicion(g) {
  return {
    materiales: (g?.materiales || []).map(x => ({ ...x, fisico: Number(x.fisico ?? 0) })),
    herramientas: (g?.herramientas || []).map(x => ({ ...x, fisico: Number(x.fisico ?? 0) })),
    equipos: (g?.equipos || []).map(x => ({ ...x, estado: String(x.estado || 'FALTANTE') })),
  }
}


// Solo se agregan faltantes; los sobrantes y coincidencias no tienen costo de faltante.
function faltanteCantidad(f) {
  const diferencia = Number(f?.diferencia)
  if (Number.isFinite(diferencia) && diferencia < 0) return Math.abs(diferencia)
  if (String(f?.observacion || '').toUpperCase().trim() === 'FALTANTE') {
    const sis = Number(f?.sistema), fis = Number(f?.fisico)
    if (Number.isFinite(sis) && Number.isFinite(fis)) return Math.max(0,sis-fis)
  }
  return 0
}
function mesesEntre(a, b) {
  if (!a || !b || b < a) return null
  const inicio = new Date(`${a}T12:00:00`)
  const fin = new Date(`${b}T12:00:00`)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null
  // Años exactos = múltiplos exactos de 12 meses (no aproximar por 30 días).
  let meses = (fin.getFullYear() - inicio.getFullYear()) * 12 + fin.getMonth() - inicio.getMonth()
  if (fin.getDate() < inicio.getDate()) meses -= 1
  const ancla = new Date(inicio)
  const diaInicial = inicio.getDate()
  ancla.setDate(1)
  ancla.setMonth(ancla.getMonth() + meses)
  ancla.setDate(Math.min(diaInicial, new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0).getDate()))
  const siguiente = new Date(ancla)
  siguiente.setDate(1)
  siguiente.setMonth(siguiente.getMonth() + 1)
  siguiente.setDate(Math.min(diaInicial, new Date(siguiente.getFullYear(), siguiente.getMonth() + 1, 0).getDate()))
  const fraccion = (fin - ancla) / (siguiente - ancla)
  return Math.max(0, meses + Math.max(0, Math.min(1, fraccion)))
}
function precioMoneda(x) { return x==null ? 'SIN COSTO REGISTRADO' : '$'+Number(x).toFixed(2) }

// Mostrar solamente el nombre; conservar la referencia en los datos para el guardado y los costos.
function nombreHerramienta(valor) {
  const nombre = texto(valor)
  const separador = nombre.indexOf(' | ')
  return separador >= 0 ? nombre.slice(separador + 3).trim() : nombre
}

export default function AuditoriasPage() {
  const router = useRouter()

  const [cargandoInicio, setCargandoInicio] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [avisoOdoo, setAvisoOdoo] = useState('')
  const [error, setError] = useState('')

  const [perfil, setPerfil] = useState(null)
  const [vista, setVista] = useState('MENU')

  const [almacen, setAlmacen] = useState('')
  const [tipo, setTipo] = useState(TIPOS.TODO)
  const [tipoAuditoriaPanel, setTipoAuditoriaPanel] = useState('Mensual')
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
  const [costosFaltantes, setCostosFaltantes] = useState({sap:{},odoo:{}})
  const [inventarioOdooCostos, setInventarioOdooCostos] = useState([])
  const [costosCargando, setCostosCargando] = useState(false)
  const [fechaAsignacion, setFechaAsignacion] = useState('')
  const [fechaSiniestro, setFechaSiniestro] = useState('')
  const [movimientoGuardando, setMovimientoGuardando] = useState(false)
  const [costosGuardados, setCostosGuardados] = useState(false)
  const [documentosEnviados, setDocumentosEnviados] = useState({})
  const [edicion, setEdicion] = useState(null)
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)
  const [padreUsuario, setPadreUsuario] = useState('')
  const [padreClave, setPadreClave] = useState('')
  const [padreAutorizado, setPadreAutorizado] = useState(false)
  const [validandoPadre, setValidandoPadre] = useState(false)
  const [edicionComentario, setEdicionComentario] = useState('')

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
    setAvisoOdoo('')
    setTipoAuditoriaPanel('Mensual')
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
        capturado: anterior ? anterior.capturado === true : false,
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
        capturado: anterior ? anterior.capturado === true : false,
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
    setAvisoOdoo('')

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

      // Se establece el técnico solamente después de cargar correctamente las categorías.

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
            capturado: false,
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
        // Nueva fuente: inventario ODOO POR COLABORADOR (no la tabla obsoleta).
        // El RPC verifica distrito y permisos en Supabase; nunca lista datos de otros distritos.
        // Número de empleado administrado desde Configuración > Usuarios.
        // Este RPC valida sesión, distrito y permisos en el servidor.
        const { data: numeroEmpleado, error: numeroError } = await supabase.rpc(
          'qiora_numero_empleado', { p_almacen: almacen4 }
        )
        if (numeroError) throw numeroError
        const identificadorEmpleado = texto(numeroEmpleado)
        // Si existe número, buscar exclusivamente por él; el nombre no debe
        // unir inventarios de colaboradores distintos.
        const { data, error: herError } = await supabase.rpc('qiora_herramientas_auditoria', {
          p_colaborador: identificadorEmpleado ? '' : texto(usuarioTecnico.nombre || usuarioTecnico.tecnico),
          p_identificador: identificadorEmpleado,
        })
        if (herError) throw herError
        const filas = Array.isArray(data) ? data : (data?.filas || [])
        if (!filas.length) {
          // La ausencia de inventario ODOO NO bloquea Materiales ni Equipos.
          // No se crean filas de herramientas ficticias.
          setAvisoOdoo(`Sin herramientas ODOO asignadas a ${texto(usuarioTecnico.nombre || usuarioTecnico.tecnico)}. ${identificadorEmpleado ? 'Número de empleado: ' + identificadorEmpleado + '.' : 'Configura el número de empleado en Usuarios.'} Puedes continuar con Materiales y Equipos.`)
        }
        nuevasHerramientas = filas.map(x => ({
          sku: texto(x.referencia),
          // La referencia viaja en PRODUCTO para persistirla sin modificar guardar_auditoria.
          producto: `${texto(x.referencia)} | ${texto(x.producto)}`,
          ubicacion: texto(x.colaborador),
          sistema: numero(x.cantidad),
          fisico: 0,
          capturado: false,
          observacion: '',
        }))
        nuevasHerramientas = conservarHerramientas(nuevasHerramientas)
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

      // Solo impedir auditorías completamente vacías; no exigir herramientas ODOO.
      if (!nuevosMateriales.length && !nuevasHerramientas.length && !nuevosEquipos.length) {
        setTecnico(null)
        throw new Error(`No existen materiales, herramientas ODOO ni equipos para auditar en el almacén ${almacen4}. No se creará una auditoría vacía.`)
      }
      setTecnico(usuarioTecnico)
      setSoloFaltantes(false)
      setMensaje(
        `Auditoría cargada para ${usuarioTecnico.nombre || almacen4}. Materiales: ${nuevosMateriales.length}; Herramientas ODOO: ${nuevasHerramientas.length}; Equipos: ${nuevosEquipos.length}.`
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
              capturado: true,
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
              capturado: true,
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

    const tieneMateriales = (tipo === TIPOS.TODO || tipo === TIPOS.MATERIALES) && materiales.length > 0
    const tieneHerramientas = (tipo === TIPOS.TODO || tipo === TIPOS.HERRAMIENTAS) && herramientas.length > 0
    const tieneEquipos = (tipo === TIPOS.TODO || tipo === TIPOS.EQUIPOS) && equipos.length > 0
    if (!tieneMateriales && !tieneHerramientas && !tieneEquipos) {
      setError('No hay materiales, herramientas ODOO ni equipos en la selección actual. No se guardará una auditoría vacía.')
      return
    }

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

      // El alcance (TODO/MATERIALES/...) y el tipo (MENSUAL/BAJA/...) son distintos.
      // La auditoría original ya quedó guardada al llegar aquí.
      const { error: tipoError } = await supabase.rpc('qiora_tipo_auditoria_guardar', {
        p_folio: data.folio, p_almacen: normalizarAlmacen(almacen),
        p_tipo: tipoAuditoriaPanel.toUpperCase(), p_alcance: tipo,
      })
      if (tipoError) {
        setError('Auditoría guardada con folio ' + data.folio + ', pero no se registró el tipo: ' + tipoError.message + '. No vuelvas a guardar; corrige el tipo sobre el folio existente.')
        // No se repite guardar_auditoria, evitando generar un folio duplicado.
      }

      // Copia exacta de los datos que Supabase acaba de confirmar.
      const pdfInfo = {
        folio: data.folio,
        fecha: data.fecha || new Date().toLocaleString('es-MX'),
        distrito: perfil?.distrito || '',
        almacen: normalizarAlmacen(almacen),
        tecnico: tecnico.nombre || '',
        auditor: perfil?.nombre || '',
        usuario: perfil?.usuario_almacen || '',
        tipo: tipoAuditoriaPanel.toUpperCase(),
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
      setAvisoOdoo('')
      setTipo(TIPOS.TODO)
      setTipoAuditoriaPanel('Mensual')

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

      // Restaurar tipo de auditoría persistido en el registro separado.
      const foliosBuscados = [...grupos.values()].map(g => g.folio)
      if (foliosBuscados.length) {
        const {data:tiposData,error:tiposError}=await supabase.rpc('qiora_tipos_auditoria_consultar',{p_folios:foliosBuscados})
        if (tiposError) throw tiposError
        const tiposMap=new Map((tiposData||[]).map(x=>[x.folio,x]))
        for(const g of grupos.values()) {
          const c=tiposMap.get(g.folio)
          if(c) {g.tipoAuditoria=c.tipo_auditoria;g.alcance=c.alcance}
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

  async function abrirDetalleHistorico(item) {
    setHistDetalle(item)
    setVista('DETALLE_COSTOS')
    setCostosFaltantes({sap:{},odoo:{}})
    setInventarioOdooCostos([])
    setCostosCargando(true)
    setFechaAsignacion('')
    setFechaSiniestro('')
    setCostosGuardados(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
    try {
      const m=(item.materiales||[]).filter(f=>faltanteCantidad(f)>0)
      const h=(item.herramientas||[]).filter(f=>faltanteCantidad(f)>0)
      const e=(item.equipos||[]).filter(f=>String(f.estado||'').toUpperCase().includes('FALTANTE'))
      const skusSAP=[...new Set([...m.map(x=>String(x.sku||'')),...e.map(x=>String(x.material||x.sku||''))].filter(Boolean))]
      const skusODOO=[...new Set(h.map(x=>texto(x.sku || String(x.producto||'').split(' | ')[0])).filter(Boolean))]
      const {data,error:err}=await supabase.rpc('qiora_costos_para_faltantes',{p_skus_sap:skusSAP,p_skus_odoo:skusODOO})
      if(err) throw err
      setCostosFaltantes({sap:data?.sap||{},odoo:data?.odoo||{}})
      // Inventario real por colaborador, para valorar existencias sin suponer que
      // los precios del catálogo ODOO equivalen al valor actual inventariado.
      const {data:filasInv,error:errInv}=await supabase.rpc('qiora_herramientas_auditoria',{
        p_colaborador:texto(item.tecnico),p_identificador:'',
      })
      if(errInv) throw errInv
      setInventarioOdooCostos(Array.isArray(filasInv)?filasInv:(filasInv?.filas||[]))
    } catch(e) {setError('Costos: '+(e.message||e))}
    finally {setCostosCargando(false)}
  }
  const detalleCosteado = useMemo(() => {
    const d=histDetalle||{}
    const sap=costosFaltantes.sap||{}, odoo=costosFaltantes.odoo||{}
    const invPorRef = new Map(inventarioOdooCostos.map(x => [texto(x.referencia).toUpperCase(),x]))
    const invPorNombre = new Map()
    for(const x of inventarioOdooCostos) {
      const k=texto(x.producto).toUpperCase()
      if(!invPorNombre.has(k)) invPorNombre.set(k,x)
      else if(invPorNombre.get(k)?.referencia !== x.referencia) invPorNombre.set(k,null)
    }
    const mats=(d.materiales||[]).filter(x=>faltanteCantidad(x)>0).map(x=>{
      const qty=faltanteCantidad(x), item=sap[String(x.sku||'')]
      const costo=item?.costo==null?null:Number(item.costo)
      return {...x,qty,costo,importe:costo==null?null:qty*costo}
    })
    const meses=mesesEntre(fechaAsignacion,fechaSiniestro)
    const herr=(d.herramientas||[]).filter(x=>faltanteCantidad(x)>0).map(x=>{
      const qty=faltanteCantidad(x)
      const parts=texto(x.producto).split(' | ')
      const ref=texto(x.sku || (parts.length>1?parts[0]:'' )).toUpperCase()
      const nombre=texto(parts.length>1?parts.slice(1).join(' | '):x.producto).toUpperCase()
      const inv=ref?invPorRef.get(ref):invPorNombre.get(nombre)
      const clave=ref||texto(inv?.referencia)
      const item=odoo[clave]
      const vida=item?.vida_util_meses==null?null:Number(item.vida_util_meses)
      // COSTO ORIGINAL del inventario por colaborador; valor_actual NO entra
      // en la fórmula porque la depreciación se calcula desde las fechas.
      const cantidadInv = Number(inv?.cantidad)
      const compraInv = Number(inv?.valor_compra)
      const costoInv = inv && Number.isFinite(cantidadInv) && cantidadInv > 0 &&
        inv.valor_compra != null && Number.isFinite(compraInv) && compraInv >= 0
          ? compraInv / cantidadInv : null
      const costoCatalogo = item?.costo == null ? null : Number(item.costo)
      const costo = costoInv != null ? costoInv :
        (costoCatalogo != null && Number.isFinite(costoCatalogo) && costoCatalogo >= 0 ? costoCatalogo : null)
      // Vida útil 0 o vacía: no hay pauta de depreciación, por lo que se
      // conserva el costo original y se informa el motivo.
      const fechasValidas = meses !== null
      const vidaValida = vida !== null && Number.isFinite(vida) && vida > 0
      const depreciacion = costo == null || !fechasValidas ? null :
        vidaValida ? Math.min(costo, Math.max(0, costo * meses / vida)) : 0
      const unitario = costo == null || depreciacion == null ? null : Math.max(0, costo - depreciacion)
      return {...x,sku:clave,qty,costo,vida,depreciacion,unitario,
        importe:unitario==null?null:qty*unitario,
        observacionCosto:costo==null?'Sin costo de compra original':
          !fechasValidas?'Captura fechas válidas':
          !vidaValida?'Sin vida útil positiva: sin depreciación':'Depreciación lineal según fechas'}
    })
    const eq=(d.equipos||[]).filter(x=>String(x.estado||'').toUpperCase().includes('FALTANTE')).map(x=>{
      const sku=String(x.material||x.sku||''),item=sap[sku],costo=item?.costo==null?null:Number(item.costo)
      return {...x,sku,qty:1,costo,importe:costo}
    })
    const sumar=a=>a.reduce((s,x)=>s+(x.importe??0),0)
    return {mats,herr,eq,meses,totM:sumar(mats),totH:sumar(herr),totE:sumar(eq),sinCosto:[...mats,...herr,...eq].filter(x=>x.importe==null).length}
  },[histDetalle,costosFaltantes,inventarioOdooCostos,fechaAsignacion,fechaSiniestro])
  function detalleParaGuardar() {
    const r = detalleCosteado
    return [
      ...r.mats.map(x => ({ categoria:'MATERIAL', referencia:texto(x.sku), descripcion:texto(x.material), lote:texto(x.lote), cantidad:x.qty, costo_unitario:x.costo, importe:x.importe == null ? null : Math.round(x.importe*100)/100 })),
      ...r.herr.map(x => ({ categoria:'HERRAMIENTA', referencia:texto(x.sku), descripcion:nombreHerramienta(x.producto), ubicacion:texto(x.ubicacion), fecha_asignacion:fechaAsignacion||null, fecha_siniestro:fechaSiniestro||null, cantidad:x.qty, costo_original:x.costo, vida_util_meses:x.vida, depreciacion_unitaria:x.depreciacion, costo_unitario:x.unitario, importe:x.importe == null ? null : Math.round(x.importe*100)/100 })),
      ...r.eq.map(x => ({ categoria:'EQUIPO', referencia:texto(x.sku), descripcion:texto(x.descripcion), serie:texto(x.serie), lote:texto(x.lote), cantidad:1, costo_unitario:x.costo, importe:x.importe == null ? null : Math.round(x.importe*100)/100 }))
    ]
  }

  async function registrarMovimiento(accion) {
    if (!histDetalle || movimientoGuardando || costosCargando) return
    setError('')
    setMensaje('')
    const r = detalleCosteado
    if (r.herr.length && (!fechaAsignacion || !fechaSiniestro || r.meses == null)) {
      setError('Captura las fechas válidas de asignación y siniestro para calcular las herramientas.')
      return
    }
    if (accion !== 'GUARDAR_COSTOS' && r.sinCosto > 0) {
      setError('Hay '+r.sinCosto+' renglones sin costo. Completa los costos antes de enviar a cobro o baja.')
      return
    }
    if (accion === 'BAJA' && String(histDetalle.tipoAuditoria || '').toUpperCase() !== 'BAJA') {
      setError('El botón Baja se permite solamente para auditorías de tipo BAJA.')
      return
    }
    if (accion !== 'GUARDAR_COSTOS' && !costosGuardados) {
      setError('Primero presiona Guardar costos.')
      return
    }
    setMovimientoGuardando(true)
    try {
      const {data,error:rpcError} = await supabase.rpc('qiora_movimiento_faltantes', {
        p_folio:histDetalle.folio, p_accion:accion,
        p_fecha_asignacion:fechaAsignacion || null,
        p_fecha_siniestro:fechaSiniestro || null,
        p_detalle:detalleParaGuardar()
      })
      if (rpcError) throw rpcError
      if (!data?.ok) throw new Error('Supabase no confirmó la operación.')
      if (accion === 'GUARDAR_COSTOS') {
        setCostosGuardados(true)
        setMensaje('Costos guardados para el folio '+histDetalle.folio)
      } else {
        setDocumentosEnviados(actual => ({...actual,[histDetalle.folio+'|'+accion]:true}))
        setMensaje('Folio '+histDetalle.folio+' enviado a '+(accion==='BAJA'?'BAJAS':'COBROS')+'. Registro #'+data.id)
      }
    } catch(e) { setError(e?.message || 'No se pudo registrar el movimiento') }
    finally { setMovimientoGuardando(false) }
  }

  async function exportarFaltantesCosto(formato) {
    if(!histDetalle || costosCargando) return
    const r=detalleCosteado, d=histDetalle
    const filas=[...r.mats.map(x=>['MATERIAL',x.sku,x.material,x.lote,x.qty,x.costo??'SIN COSTO',x.importe??'SIN COSTO']),
      ...r.herr.map(x=>['HERRAMIENTA',x.sku||x.producto,nombreHerramienta(x.producto),x.ubicacion,x.qty,x.unitario??'SIN COSTO',x.importe??'SIN COSTO']),
      ...r.eq.map(x=>['EQUIPO',x.sku,x.descripcion,x.serie,x.qty,x.costo??'SIN COSTO',x.importe??'SIN COSTO'])]
    const cab=['Tipo','SKU','Descripción','Lote / Serie / Ubicación','Cantidad faltante','Costo unitario','Importe']
    const nombre='QIORA_FALTANTES_'+String(d.folio||'AUDITORIA').replace(/[^a-zA-Z0-9_-]/g,'_')
    if(formato==='Excel') {
      const XLSX=await import('xlsx')
      const wb=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['QIORA CONECTA - FALTANTES CON COSTO'],['Folio',d.folio],['Almacén',d.almacen],['Tipo auditoría',d.tipoAuditoria||'NO REGISTRADO'],['Nota','Herramientas: depreciacion lineal por fechas; costos vigentes no congelados'],['Fecha asignacion',fechaAsignacion||'PENDIENTE'],['Fecha siniestro',fechaSiniestro||'PENDIENTE'],['Meses de uso',r.meses??'PENDIENTE'],['Faltantes sin costo',r.sinCosto],[],cab,...filas]),'FALTANTES')
      XLSX.writeFile(wb,nombre+'.xlsx')
    } else {
      const {jsPDF}=await import('jspdf')
      const {default:autoTable}=await import('jspdf-autotable')
      const pdf=new jsPDF({orientation:'landscape'})
      pdf.setFontSize(16);pdf.text('QIORA CONECTA | FALTANTES CON COSTO',14,16)
      pdf.setFontSize(9);pdf.text('Folio: '+String(d.folio||'')+' | Almacen: '+String(d.almacen||''),14,24)
      pdf.text('Herramientas: depreciacion lineal segun fechas. Sin importe: '+r.sinCosto,14,30)
      autoTable(pdf,{startY:37,head:[cab],body:filas,styles:{fontSize:7},headStyles:{fillColor:[12,105,78]}})
      pdf.save(nombre+'.pdf')
    }
  }

  function regresarDesdeFaltante() {
    setHistDetalle(null)
    setVista('HISTORICO')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }


  function abrirEditor(item) {
    limpiarMensajes()
    setEdicion({ ...item, ...gruposEdicion(item) })
    setEdicionComentario(item?.materiales?.[0]?.comentario_general ?? item?.herramientas?.[0]?.comentario_general ?? item?.equipos?.[0]?.comentario_general ?? '')
    setPadreUsuario('')
    setPadreClave('')
    setPadreAutorizado(false)
    setVista('EDITAR')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  async function autorizarUsuarioPadre() {
    if (!edicion || validandoPadre) return
    setError('')
    setValidandoPadre(true)
    let clienteTemporal = null
    try {
      const usuario = padreUsuario.trim().toLowerCase()
      if (!usuario || !padreClave) throw new Error('Capture usuario y contraseña del Usuario Padre.')
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      clienteTemporal = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data: sesion, error: authError } = await clienteTemporal.auth.signInWithPassword({
        email: `${usuario}@qiora.local`,
        password: `QIORA#${padreClave}`,
      })
      if (authError || !sesion?.user) throw new Error('Usuario Padre o contraseña inválidos.')
      // La membresía de Usuario Padre es validada de nuevo por el RPC
      // qiora_editar_auditoria al GUARDAR. Aquí también se verifica antes
      // de mostrar las cantidades, sin usar tablas sensibles directamente.
      const { data: autorizado, error: permisoError } = await clienteTemporal.rpc(
        'qiora_validar_padre_auditoria', { p_distrito: perfil?.distrito || '' }
      )
      if (permisoError) throw permisoError
      if (autorizado !== true) throw new Error('La cuenta no tiene autorización de Usuario Padre para este distrito.')
      setPadreAutorizado(true)
    } catch (e) {
      setPadreAutorizado(false)
      setError(e?.message || 'No se pudo autorizar la edición.')
    } finally {
      if (clienteTemporal) await clienteTemporal.auth.signOut().catch(() => {})
      setValidandoPadre(false)
    }
  }

  function cambiarFilaEdicion(grupo, indice, campo, valor) {
    setEdicion(actual => ({ ...actual, [grupo]: actual[grupo].map((item,i) =>
      i === indice ? { ...item, [campo]: valor } : item) }))
  }
  async function guardarEdicion() {
    if (!edicion || guardandoEdicion) return
    if (!esHoyMexico(edicion.fecha) && !padreAutorizado) {
      setError('Primero debe autorizar el Usuario Padre.'); return
    }
    setGuardandoEdicion(true)
    setError('')
    setMensaje('')
    let clientePadre = null
    try {
      const antiguo = !esHoyMexico(edicion.fecha)
      let cliente = supabase
      if (antiguo) {
        const usuario = padreUsuario.trim().toLowerCase()
        if (!usuario || !padreClave) throw new Error('Capture usuario y contraseña del Usuario Padre.')
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        clientePadre = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
        const { error: credencialError } = await clientePadre.auth.signInWithPassword({
          email: `${usuario}@qiora.local`, password: `QIORA#${padreClave}`,
        })
        if (credencialError) throw new Error('Usuario Padre o contraseña inválidos.')
        cliente = clientePadre
      }
      const payload = {
        p_folio: edicion.folio,
        p_almacen: edicion.almacen,
        p_comentario: edicionComentario,
        p_materiales: edicion.materiales.map(x => ({ sku: x.sku, lote: x.lote, fisico: Number(x.fisico) })),
        p_herramientas: edicion.herramientas.map(x => ({ producto: x.producto, ubicacion: x.ubicacion, fisico: Number(x.fisico) })),
        p_equipos: edicion.equipos.map(x => ({ serie: x.serie, estado: x.estado })),
      }
      const { data, error: guardarError } = await cliente.rpc('qiora_editar_auditoria', payload)
      if (guardarError) throw guardarError
      if (!data?.ok) throw new Error('Supabase no confirmó la edición.')
      setMensaje(`Folio ${edicion.folio} actualizado correctamente. Vuelva a buscar para consultar los cambios.`)
      setEdicion(null)
      setPadreAutorizado(false)
      setPadreClave('')
      setVista('HISTORICO')
      setHistResultados([])
      setHistDetalle(null)
    } catch (e) { setError(e.message || 'No fue posible actualizar el folio.') }
    finally {
      if (clientePadre) await clientePadre.auth.signOut().catch(() => {})
      setGuardandoEdicion(false)
    }
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

  const estadisticasPanel = useMemo(() => {
    const totalMat = materiales.length
    const totalHer = herramientas.length
    const eqSistema = equipos.filter(x => x.existeSistema !== false)
    const escaneados = equipos.filter(x => x.escaneado === true).length
    const matHechos = materiales.filter(x => x.capturado === true).length
    const herHechos = herramientas.filter(x => x.capturado === true).length
    const eqHechos = equipos.filter(x => x.escaneado === true || ['ENTREGADO','ENTRADA PENDIENTE','VALIDACION BRM'].includes(x.estado)).length
    const faltantes = materiales.filter(x => x.capturado && numero(x.fisico)<numero(x.sistema)).length
      + herramientas.filter(x => x.capturado && numero(x.fisico)<numero(x.sistema)).length
      + equipos.filter(x => x.estado === 'FALTANTE').length
    const diferencias = materiales.filter(x => x.capturado && numero(x.fisico)!==numero(x.sistema)).length
      + herramientas.filter(x => x.capturado && numero(x.fisico)!==numero(x.sistema)).length
      + equipos.filter(x => x.escaneado && x.estado === 'NO EXISTE EN SISTEMA').length
    const coinciden = materiales.filter(x => x.capturado && numero(x.fisico)===numero(x.sistema)).length
      + herramientas.filter(x => x.capturado && numero(x.fisico)===numero(x.sistema)).length
      + equipos.filter(x => x.estado === 'COINCIDE').length
    const entregados = equipos.filter(x=>x.estado === 'ENTREGADO').length
    const pendientes = equipos.filter(x=>x.estado === 'ENTRADA PENDIENTE').length
    const total = totalMat + totalHer + equipos.length
    const hechos = matHechos + herHechos + eqHechos
    return {totalMat,totalHer,eqSistema:eqSistema.length,escaneados,matHechos,herHechos,eqHechos,
      faltantes,diferencias,coinciden,entregados,pendientes,total,hechos,
      porcentaje:total ? Math.round(100*hechos/total) : 0}
  },[materiales,herramientas,equipos])

  const indicadorAuditoria = (nombre,valor) => (
    <div key={nombre} style={{background:'linear-gradient(120deg,#08644e,#159a77)',padding:15,borderRadius:12,textAlign:'center',color:'white'}}>
      <div style={{fontSize:12,fontWeight:600}}>{nombre}</div>
      <strong style={{fontSize:25,display:'block',marginTop:5}}>{valor}</strong>
    </div>
  )
  const barraAuditoria = (nombre,hechos,total) => (
    <div key={nombre} style={{marginBottom:13,flex:1,minWidth:180}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,fontWeight:600}}>
        <span>{nombre}</span><span>{total?Math.round(hechos*100/total):0}% ({hechos}/{total})</span>
      </div>
      <div style={{height:9,marginTop:5,background:'#345b51',borderRadius:10,overflow:'hidden'}}>
        <div style={{width:`${total?Math.min(100,hechos*100/total):0}%`,height:'100%',background:'#19b68c'}} />
      </div>
    </div>
  )

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
              <h1 style={styles.titulo}>{vista === 'CAPTURA' ? 'Auditorías Técnicos' : vista === 'HISTORICO' ? 'Auditorías realizadas' : vista === 'FALTANTE_GLOBAL' ? 'Faltante global' : vista === 'DETALLE_FALTANTE' ? 'Detalle de faltantes' : vista === 'DETALLE_HISTORICO' ? 'Detalle de auditoría' : vista === 'EDITAR' ? 'Editar auditoría' : 'Programar Auditorías por Semana'}</h1>
              <div style={styles.subtitulo}>QIORA CONECTA · {perfil?.distrito || ''}</div>
            </div>
            <button type="button" style={styles.botonSecundario} onClick={() => (vista === 'DETALLE_FALTANTE' ? setVista('FALTANTE_GLOBAL') : ['FALTANTE_GLOBAL', 'DETALLE_HISTORICO', 'EDITAR'].includes(vista) ? regresarDesdeFaltante() : setVista('MENU'))}>{vista === 'DETALLE_FALTANTE' ? '← Regresar al faltante global' : ['FALTANTE_GLOBAL', 'DETALLE_HISTORICO', 'EDITAR'].includes(vista) ? '← Regresar al historial' : '← Regresar a Auditorías'}</button>
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

        {mensaje && ['CAPTURA', 'HISTORICO', 'FALTANTE_GLOBAL', 'PROGRAMACION', 'DETALLE_COSTOS'].includes(vista) && (
          <div style={styles.ok}>{mensaje}</div>
        )}
        {avisoOdoo && vista === 'CAPTURA' && (
          <div role="status" style={{...styles.usuario, background:'#fff5db', border:'1px solid #e1bd67', color:'#664800'}}>{avisoOdoo}</div>
        )}
        {ultimoPdf && vista === 'CAPTURA' && (
          <div style={{ marginBottom: 16 }}>
            <button type="button" style={styles.botonPrincipal} onClick={() => {
              try { descargarPdfAuditoria(ultimoPdf) }
              catch (e) { setError('No se pudo descargar el PDF: ' + (e.message || e)) }
            }}>Descargar último PDF: {ultimoPdf.folio}</button>
          </div>
        )}

        {vista === 'EDITAR' && edicion && (
          <section style={styles.tarjeta}>
            <h2>{!esHoyMexico(edicion.fecha) && !padreAutorizado ? 'Autorización del Usuario Padre' : `Editar folio: ${edicion.folio}`}</h2>
            {(esHoyMexico(edicion.fecha) || padreAutorizado) && <p>Auditoría: {fechaQiora(edicion.fecha)} · Almacén: {edicion.almacen} · Técnico: {edicion.tecnico}</p>}
            {!esHoyMexico(edicion.fecha) && !padreAutorizado && (
              <div style={styles.usuario}>
                <h3 style={{marginTop:0}}>Autorización del Usuario Padre</h3>
                <p>La auditoría es de un día anterior. Se requiere una cuenta autorizada expresamente por el administrador.</p>
                <div style={styles.formulario}>
                  <label style={styles.campo}>Usuario Padre<input autoComplete="off" style={styles.input} value={padreUsuario} onChange={e=>setPadreUsuario(e.target.value)} /></label>
                  <label style={styles.campo}>Contraseña<input type="password" autoComplete="off" style={styles.input} value={padreClave} onChange={e=>setPadreClave(e.target.value)} /></label>
                </div>
                <div style={styles.botones}>
                  <button type="button" style={styles.botonPrincipal} disabled={validandoPadre} onClick={autorizarUsuarioPadre}>{validandoPadre ? 'Validando autorización...' : 'Autorizar edición'}</button>
                  <button type="button" style={styles.botonSecundario} onClick={() => { setEdicion(null); setPadreAutorizado(false); setPadreUsuario(''); setPadreClave(''); setError(''); setVista('HISTORICO') }}>Cancelar</button>
                </div>
              </div>
            )}
            {(esHoyMexico(edicion.fecha) || padreAutorizado) && <>
            <p style={{color:'#55675c'}}>Solo se modifican cantidades físicas, estados y observaciones. Se conserva el folio y la información de origen.</p>
            {[['materiales','MATERIALES'],['herramientas','HERRAMIENTAS'],['equipos','EQUIPOS']].map(([grupo,titulo]) => (
              <div key={grupo} style={{marginTop:18}}>
                <h3>{titulo}</h3>
                <div style={styles.tablaWrap}><table style={styles.tabla}>
                  <thead><tr><th style={styles.th}>Identificación</th><th style={styles.th}>Sistema / lote</th><th style={styles.th}>Físico / estado</th></tr></thead>
                  <tbody>{(edicion[grupo] || []).map((fila,i) => <tr key={i}>
                    <td style={styles.td}>{grupo==='materiales' ? `${fila.sku} · ${fila.material}` : grupo==='herramientas' ? `${fila.producto} · ${fila.ubicacion}` : `${fila.serie} · ${fila.descripcion || ''}`}</td>
                    <td style={styles.td}>{grupo==='equipos' ? fila.lote : `${fila.sistema} · ${fila.lote || ''}`}</td>
                    <td style={styles.td}>{grupo==='equipos' ? (
                      <select style={styles.input} value={fila.estado || 'FALTANTE'} onChange={e=>cambiarFilaEdicion(grupo,i,'estado',e.target.value)}>
                        {['FALTANTE','COINCIDE','ENTREGADO','VALIDACION BRM','ENTRADA PENDIENTE','NO EXISTE EN SISTEMA'].map(v=><option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : <input type="number" min="0" step="1" style={styles.inputTabla} value={fila.fisico} onChange={e=>cambiarFilaEdicion(grupo,i,'fisico',e.target.value)} />}</td>
                  </tr>)}</tbody>
                </table></div>
              </div>
            ))}
            <label style={{...styles.campo,marginTop:18}}>Observaciones generales<textarea rows={3} style={styles.textarea} value={edicionComentario} onChange={e=>setEdicionComentario(e.target.value)} /></label>
            <div style={styles.botones}>
              <button type="button" style={styles.botonPrincipal} disabled={guardandoEdicion} onClick={guardarEdicion}>{guardandoEdicion ? 'Guardando...' : 'Guardar cambios del mismo folio'}</button>
              <button type="button" style={styles.botonSecundario} onClick={()=>{setEdicion(null);setPadreAutorizado(false);setPadreUsuario('');setPadreClave('');setVista('HISTORICO')}}>Cancelar</button>
            </div>
            </>}
          </section>
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
            <tbody>{histResultados.map((x)=><tr key={`${x.folio}|${x.almacen}`}><td style={styles.td}>{x.folio}</td><td style={styles.td}>{fechaQiora(x.fecha)}</td><td style={styles.td}>{x.mes}</td><td style={styles.td}>{x.almacen}</td><td style={styles.td}>{x.tecnico}</td><td style={styles.td}>{x.auditor}</td><td style={styles.td}>{x.materiales.length}</td><td style={styles.td}>{x.herramientas.length}</td><td style={styles.td}>{x.equipos.length}</td><td style={styles.td}><button type="button" style={styles.botonSecundario} onClick={()=>abrirDetalleHistorico(x)}>Ver faltantes</button> <button type="button" style={styles.botonSecundario} onClick={() => abrirEditor(x)}>Editar</button> <button type="button" style={styles.botonPrincipal} onClick={()=>{ try { descargarPdfAuditoria({folio:x.folio,fecha:fechaHoraMx(x.fecha),distrito:perfil?.distrito,almacen:x.almacen,tecnico:x.tecnico,auditor:x.auditor,usuario:x.materiales[0]?.auditor_usuario||x.herramientas[0]?.auditor_usuario||x.equipos[0]?.auditor_usuario||perfil?.usuario_almacen,tipo:x.tipoAuditoria||'TODO',comentario:x.materiales[0]?.comentario_general||x.herramientas[0]?.comentario_general||x.equipos[0]?.comentario_general||'',materiales:x.materiales,herramientas:x.herramientas,equipos:x.equipos}) } catch(e) {setError('Error al descargar PDF: '+(e.message||e))} }}>PDF</button> <button type="button" style={styles.botonPrincipal} onClick={()=>{ try { descargarExcelAuditoria(x) } catch (e) { setError("Error al descargar Excel: "+(e.message||e)) } }}>Excel</button></td></tr>)}</tbody></table>
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
            <tbody>{histResultados.map((x)=><tr key={`${x.folio}|${x.almacen}`}><td style={styles.td}>{x.folio}</td><td style={styles.td}>{fechaQiora(x.fecha)}</td><td style={styles.td}>{x.mes}</td><td style={styles.td}>{x.almacen}</td><td style={styles.td}>{x.tecnico}</td><td style={styles.td}>{x.auditor}</td><td style={styles.td}>{x.materiales.length}</td><td style={styles.td}>{x.herramientas.length}</td><td style={styles.td}>{x.equipos.length}</td><td style={styles.td}><button type="button" style={styles.botonSecundario} onClick={()=>abrirDetalleHistorico(x)}>Ver faltantes</button> <button type="button" style={styles.botonSecundario} onClick={() => abrirEditor(x)}>Editar</button> <button type="button" style={styles.botonPrincipal} onClick={()=>{ try { descargarPdfAuditoria({folio:x.folio,fecha:fechaHoraMx(x.fecha),distrito:perfil?.distrito,almacen:x.almacen,tecnico:x.tecnico,auditor:x.auditor,usuario:x.materiales[0]?.auditor_usuario||x.herramientas[0]?.auditor_usuario||x.equipos[0]?.auditor_usuario||perfil?.usuario_almacen,tipo:x.tipoAuditoria||'TODO',comentario:x.materiales[0]?.comentario_general||x.herramientas[0]?.comentario_general||x.equipos[0]?.comentario_general||'',materiales:x.materiales,herramientas:x.herramientas,equipos:x.equipos}) } catch(e) {setError('Error al descargar PDF: '+(e.message||e))} }}>PDF</button> <button type="button" style={styles.botonPrincipal} onClick={()=>{ try { descargarExcelAuditoria(x) } catch (e) { setError("Error al descargar Excel: "+(e.message||e)) } }}>Excel</button></td></tr>)}</tbody></table>
          </div>}
            {histResultados.length === 0 && <p>No se encontraron faltantes con los filtros seleccionados.</p>}
          </section>
        )}

        {vista === 'DETALLE_COSTOS' && histDetalle && (()=>{
          const r=detalleCosteado,d=histDetalle
          const tot=r.totM+r.totH+r.totE
          const tabla=(tit,cabs,rows)=> <div style={styles.tarjeta} key={tit}><h3>{tit}</h3><div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr>{cabs.map(c=><th key={c} style={styles.th}>{c}</th>)}</tr></thead><tbody>{rows.length?rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td style={styles.td} key={j}>{cell}</td>)}</tr>):<tr><td colSpan={cabs.length} style={styles.td}>Sin faltantes.</td></tr>}</tbody></table></div></div>
          return <section>
            <button style={styles.botonSecundario} onClick={()=>{setVista('HISTORICO');setHistDetalle(null)}}>← Regresar al historial</button>
            <div style={styles.tarjeta}><h2>Faltantes con costo</h2>
              {mensaje && <div style={styles.ok} role="status">{mensaje}</div>}
              <p><b>Folio:</b> {d.folio}　 <b>Fecha:</b> {fechaQiora(d.fecha)}　 <b>Almacén:</b> {d.almacen}</p>
              <p><b>Técnico:</b> {d.tecnico||'-'}　 <b>Auditor:</b> {d.auditor||'-'}　 <b>Tipo de auditoría:</b> {d.tipoAuditoria||'NO REGISTRADO'}</p>
              <p><b>Se auditó:</b> {d.alcance||'TODO'}</p>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
                { [['Líneas materiales',r.mats.length],['Líneas herramientas',r.herr.length],['Líneas equipos',r.eq.length],['Total materiales',precioMoneda(r.totM)],['Total herramientas',precioMoneda(r.totH)],['Total equipos',precioMoneda(r.totE)],['Gran total parcial',precioMoneda(tot)]].map(([label,val])=><div key={label} style={{padding:14,background:'#0b8664',color:'white',borderRadius:12,textAlign:'center'}}>{label}<div style={{fontWeight:800,fontSize:21,marginTop:5}}>{val}</div></div>)}
              </div>
              <p style={{color:'#a62929',fontWeight:700}}>{costosCargando?'Consultando costos...':r.sinCosto>0?`Hay ${r.sinCosto} renglones sin importe calculable. El total mostrado es parcial.`:'Todos los renglones tienen costo calculable.'}</p>
              <p>Herramientas: costo original ODOO por unidad menos depreciación lineal según fechas y vida útil. VALOR ACTUAL no se vuelve a descontar. Vida útil 0: sin depreciación. Sin fechas válidas: importe pendiente. No se calcula IVA sin regla confirmada; no son costos históricos congelados.</p>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginTop:16}}>
                <button type="button" style={{...styles.botonPrincipal,background:'#087c5c',fontSize:15,padding:'13px 22px'}}
                  disabled={movimientoGuardando || costosCargando || !costosGuardados || !!documentosEnviados[d.folio+'|COBRO'] || r.sinCosto>0 || (r.herr.length>0 && r.meses==null)}
                  onClick={()=>registrarMovimiento('COBRO')}>
                  {movimientoGuardando ? 'Procesando...' : 'MANDAR A COBRO'}
                </button>
                {String(d.tipoAuditoria||'').toUpperCase()==='BAJA' &&
                  <button type="button" style={styles.botonFaltantes}
                    disabled={movimientoGuardando || costosCargando || !costosGuardados || !!documentosEnviados[d.folio+'|BAJA'] || r.sinCosto>0}
                    onClick={()=>registrarMovimiento('BAJA')}>ENVIAR A BAJAS</button>}
                <button type="button" style={styles.botonPrincipal} disabled={movimientoGuardando || costosCargando}
                  onClick={()=>registrarMovimiento('GUARDAR_COSTOS')}>
                  {movimientoGuardando ? 'Guardando...' : 'GUARDAR COSTOS'}
                </button>
                <button type="button" style={styles.botonPrincipal} disabled={costosCargando} onClick={()=>exportarFaltantesCosto('Excel').catch(e=>setError(e.message))}>Descargar Excel</button>
                <button type="button" style={styles.botonPrincipal} disabled={costosCargando} onClick={()=>exportarFaltantesCosto('PDF').catch(e=>setError(e.message))}>Descargar PDF</button>
              </div>
              <p style={{fontSize:12,color:'#54635d',marginBottom:0}}>El envío incluye los faltantes de Materiales, Herramientas y Equipos, con sus importes y folio. Primero guarda los costos. Las fechas se capturan abajo en Herramientas.</p>
            </div>
            {tabla('Faltantes de materiales',['SKU','Material','Lote','Cantidad faltante','Costo unitario','Importe'],r.mats.map(x=>[x.sku,x.material,x.lote,x.qty,precioMoneda(x.costo),precioMoneda(x.importe)]))}
            <div style={styles.tarjeta}><h3>Faltantes de herramientas</h3>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><label>Fecha de asignación <input style={styles.input} type="date" value={fechaAsignacion} onChange={e=>{setFechaAsignacion(e.target.value);setCostosGuardados(false)}}/></label><label>Fecha de siniestro <input style={styles.input} type="date" min={fechaAsignacion||undefined} value={fechaSiniestro} onChange={e=>{setFechaSiniestro(e.target.value);setCostosGuardados(false)}}/></label></div>

              <p>Meses de uso: {r.meses === null ? 'CAPTURA FECHAS VÁLIDAS' : r.meses.toFixed(2)}. Depreciación lineal por fechas (máximo 100% del costo original). Vida útil 0: sin depreciación. El importe es el valor residual por cantidad faltante.</p>
              <div style={styles.tablaWrap}><table style={styles.tabla}><thead><tr>{['Referencia','Herramienta','Vida útil (meses)','Cant.','Compra unit.','Depreciación unit.','Residual unit.','Importe faltante'].map(x=><th style={styles.th} key={x}>{x}</th>)}</tr></thead><tbody>{r.herr.length?r.herr.map((x,i)=><tr key={i}>{[x.sku||x.producto,nombreHerramienta(x.producto),x.vida??'-',x.qty,precioMoneda(x.costo),precioMoneda(x.depreciacion),precioMoneda(x.unitario),precioMoneda(x.importe)].map((v,j)=><td key={j} style={styles.td}>{v}</td>)}</tr>):<tr><td colSpan={8} style={styles.td}>Sin faltantes de herramientas.</td></tr>}</tbody></table></div>
            </div>
            {tabla('Faltantes de equipos',['Serie','SKU','Descripción','Lote','Cantidad faltante','Costo unitario','Importe'],r.eq.map(x=>[x.serie,x.sku,x.descripcion,x.lote,1,precioMoneda(x.costo),precioMoneda(x.importe)]))}
          </section>
        })()}
        {(vista === 'DETALLE_FALTANTE' || vista === 'DETALLE_HISTORICO') && (
          <section style={styles.tarjeta}>
            <button type="button" style={styles.botonSecundario} onClick={() => { setVista(vista === 'DETALLE_FALTANTE' ? 'FALTANTE_GLOBAL' : 'HISTORICO'); window.scrollTo({top:0,behavior:'instant'}) }}>
              ← {vista === 'DETALLE_FALTANTE' ? 'Regresar al faltante global' : 'Regresar al historial'}
            </button>
{histDetalle && <div style={{marginTop:'18px'}}>
            <h3 style={{marginBottom:8}}>Detalle: {histDetalle.folio}</h3>
            {vista === 'DETALLE_HISTORICO' && <button type="button" style={styles.botonPrincipal} onClick={()=>{try {descargarExcelAuditoria(histDetalle)} catch(e) {setError(e.message||"No se pudo descargar")}}}>Descargar Excel del folio</button>}
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
        <section style={{...styles.tarjeta,background:'linear-gradient(#0b3e32,#071f1b)',color:'#fff',border:'1px solid #397d68'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}>
            <label style={styles.campo}>Almacén
              <input style={styles.input} value={almacen} maxLength={10} placeholder="0000" onChange={e=>setAlmacen(e.target.value.toUpperCase())}/>
            </label>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginTop:12}}>
            <button type="button" style={styles.botonPrincipal} disabled={cargando} onClick={cargarAuditoria}>{cargando?'Cargando...':'Cargar auditoría'}</button>
            <button type="button" style={{...styles.botonSecundario,background:'#087ba8',color:'#fff'}} disabled={cargando||!tecnico} onClick={cargarAuditoria}>Actualizar información sin borrar</button>
            <button type="button" style={styles.botonFaltantes} disabled={!tecnico} onClick={()=>setSoloFaltantes(v=>!v)}>{soloFaltantes?'Ver auditoría completa':'Ver faltantes'}</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginTop:14}}>
            <label style={styles.campo}>Técnico<input style={styles.input} readOnly value={tecnico?.nombre||''} placeholder="Se cargará automáticamente"/></label>
            <label style={styles.campo}>Fecha<input style={styles.input} readOnly value={tecnico?new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()):''} placeholder="Se cargará automáticamente"/></label>
            <label style={styles.campo}>Tipo de auditoría
              <select style={styles.input} value={tipoAuditoriaPanel} onChange={e=>setTipoAuditoriaPanel(e.target.value)}>
                <option value="Mensual">MENSUAL</option><option value="Vacaciones">VACACIONES</option><option value="Baja">BAJA</option><option value="Especial">ESPECIAL</option>
              </select>
            </label>
            <label style={styles.campo}>¿Qué se va a auditar?
              <select style={styles.input} value={tipo} onChange={e=>{setTipo(e.target.value);setSoloFaltantes(false)}}>
                <option value={TIPOS.TODO}>Todo</option><option value={TIPOS.MATERIALES}>Materiales</option>
                <option value={TIPOS.HERRAMIENTAS}>Herramientas</option><option value={TIPOS.EQUIPOS}>Equipos</option>
              </select>
            </label>
          </div>
          {tecnico && <p style={{fontSize:12,marginBottom:0}}>Almacén: {normalizarAlmacen(tecnico.usuario_almacen)} · ODOO: {tecnico.odoo||'-'}</p>}
          <button type="button" style={{...styles.botonSecundario,marginTop:12}} onClick={limpiarAuditoria}>Limpiar captura</button>
        </section>
        <section style={{marginBottom:15}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
            {[
              ['Materiales sistema',estadisticasPanel.totalMat],['Equipos sistema',estadisticasPanel.eqSistema],
              ['Series escaneadas',estadisticasPanel.escaneados],['Diferencias encontradas',estadisticasPanel.diferencias],
              ['Faltantes encontrados',estadisticasPanel.faltantes],['Coinciden',estadisticasPanel.coinciden],
              ['Entregados a almacén',estadisticasPanel.entregados],['Entradas pendientes',estadisticasPanel.pendientes]
            ].map(([nombre,valor])=>indicadorAuditoria(nombre,valor))}
          </div>
          <div style={{marginTop:14,padding:18,background:'linear-gradient(#0b3e32,#071f1b)',color:'#fff',borderRadius:14,border:'1px solid #397d68'}}>
            <strong>Avance general de la auditoría</strong>
            <div style={{display:'flex',gap:22,alignItems:'center',flexWrap:'wrap',marginTop:14}}>
              <div style={{width:95,height:95,borderRadius:'50%',border:'10px solid #2e5c4e',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <strong style={{fontSize:25}}>{estadisticasPanel.porcentaje}%</strong>
                <small>{estadisticasPanel.hechos} de {estadisticasPanel.total}</small>
              </div>
              <div style={{flex:1,minWidth:210}}>
                {barraAuditoria('Materiales',estadisticasPanel.matHechos,estadisticasPanel.totalMat)}
                {barraAuditoria('Herramientas',estadisticasPanel.herHechos,estadisticasPanel.totalHer)}
                {barraAuditoria('Equipos',estadisticasPanel.eqHechos,equipos.length)}
              </div>
            </div>
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
