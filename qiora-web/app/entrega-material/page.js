'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const str = v => String(v ?? '').trim()
const normal = v => str(v).toUpperCase()
const esTPE = lote => /^TPE/i.test(str(lote))
const cantidad = m => Number(m.cantidad) || 0
const normalizar = (m, i) => ({
  ...m,
  _key: String(m.id ?? `${m.sku}-${m.lote}-${i}`),
  sku: str(m.sku),
  descripcion: str(m.descripcion || m.material),
  material: str(m.material || m.descripcion),
  lote: str(m.lote),
  cantidad: Number(m.cantidad),
  series: Array.isArray(m.series) ? m.series.map(normal).filter(Boolean) : []
})

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function htmlComprobanteEntrega({ data, materiales, almacen, tecnico, folio, distrito, manual }) {
  const fecha = new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short'
  })
  const totalPiezas = materiales.reduce((n, m) => n + cantidad(m), 0)
  const serializados = materiales.filter(m => esTPE(m.lote) && m.series?.length)
  const maxSeries = Math.max(0, ...serializados.map(m => m.series.length))
  const filas = materiales.map(m => `
    <tr>
      <td class="sku">${escaparHtml(m.sku)}</td>
      <td class="material">${escaparHtml(m.descripcion || m.material)}</td>
      <td class="center">${escaparHtml(m.cantidad)}</td>
      <td class="center">${escaparHtml(m.lote || 'SIN LOTE')}</td>
    </tr>`).join('')
  const columnasSeries = serializados.map(m => `
    <th>${escaparHtml(m.sku)} <small>(${m.series.length})</small></th>`).join('')
  const filasSeries = Array.from({ length: maxSeries }, (_, i) => `
    <tr>${serializados.map(m => `<td>${escaparHtml(m.series[i] || '')}</td>`).join('')}</tr>`).join('')
  const bloqueSeries = serializados.length ? `
    <section class="series-section">
      <h2 class="series-title">SERIES</h2>
      <table class="series-table"><thead><tr>${columnasSeries}</tr></thead><tbody>${filasSeries}</tbody></table>
    </section>` : ''

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Comprobante ${escaparHtml(data?.folio_control || '')}</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#14231e;background:#edf1ee}
    .actions{width:210mm;margin:10px auto;text-align:right}.actions button{background:#087b55;color:#fff;border:0;border-radius:5px;padding:10px 22px;font-weight:700;cursor:pointer;font-size:13px}
    .sheet{width:210mm;min-height:297mm;margin:12px auto;padding:7mm 8mm;background:#fff;box-shadow:0 2px 14px #0002;overflow:hidden}
    .top{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:8mm;border-bottom:2.5px solid #07804f;padding:0 0 4mm;margin-bottom:3mm}
    .brand{display:flex;align-items:center;gap:7px;color:#075c43}.sat-mark{width:18mm;height:15mm;border-radius:4mm;background:#079b68;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17pt;font-weight:900;letter-spacing:-1px}.sat-name{font-size:16pt;font-weight:900;line-height:1.05}.sat-sub{font-size:7pt;font-weight:700;line-height:1.15;margin-top:2px;max-width:42mm}
    h1{font-size:17pt;line-height:1.05;margin:0;text-align:right;color:#103e30}.folio{text-align:right;font-size:9pt;margin-top:3mm;font-weight:800}
    h2{font-size:9pt;color:#087653;margin:0 0 2mm;padding-bottom:1.2mm;border-bottom:1px solid #d5dfd9}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 7mm;font-size:8pt}.field{padding:1.3mm 0;border-bottom:1px solid #e1e7e3;min-height:10mm}.label{font-size:6.5pt;color:#62736b;text-transform:uppercase;display:block;margin-bottom:1mm}
    .materials{margin-top:4mm}.materials table,.series-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.3pt}.materials th,.series-table th{background:#006b4b;color:#fff;font-size:7pt;font-weight:800;padding:1.6mm 1.2mm;border:1px solid #b8c9c0;text-align:center}.materials td,.series-table td{border:1px solid #c7d1cc;padding:1.25mm 1.3mm;vertical-align:middle;overflow-wrap:anywhere}.materials .sku{width:13%;text-align:center;font-weight:700}.materials .material{width:49%}.materials .center{text-align:center;width:13%}.materials td:last-child{width:25%;text-align:center}
    .series-section{margin-top:3mm}.series-title{text-align:center;background:#e9f3eb;border:0;padding:1.5mm;margin:0 0 1.5mm;font-size:9pt}.series-table th{font-size:7pt;padding:1.5mm .8mm}.series-table th small{font-size:6pt}.series-table td{text-align:center;font-size:6.4pt;padding:1.1mm .5mm;line-height:1.15;white-space:nowrap}
    .totals{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:3mm;background:#eaf4e9;color:#07583f;font-size:9pt;font-weight:900;text-align:center;padding:2.5mm}.totals span+span{border-left:1px solid #087653}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin:7mm 4mm 0;text-align:center;font-size:8pt}.sign{padding-top:8mm;position:relative}.sign:before{content:"";position:absolute;left:5%;right:5%;top:7mm;border-top:1px solid #263b32}.foot{border-top:2px solid #07804f;margin-top:7mm;padding-top:2mm;text-align:center;color:#53645c;font-size:6.5pt}
    @page{size:A4 portrait;margin:0}
    @media print{html,body{width:210mm;height:297mm;background:#fff}.actions{display:none}.sheet{margin:0;width:210mm;height:297mm;min-height:297mm;padding:7mm 8mm;box-shadow:none;overflow:hidden;page-break-after:avoid;break-after:avoid}.materials tr,.series-table tr{break-inside:avoid;page-break-inside:avoid}}
    @media screen and (max-width:800px){.sheet,.actions{width:100%;margin:0}.sheet{min-height:100vh;padding:18px}.top{gap:12px}.sat-mark{width:58px;height:48px}.sat-name{font-size:16px}h1{font-size:16px}}
  </style></head><body>
  <div class="actions"><button onclick="window.print()">IMPRIMIR</button></div>
  <article class="sheet" id="sheet">
    <div class="top"><div class="brand"><div class="sat-mark">SAT</div><div><div class="sat-name">SAT</div><div class="sat-sub">Sistema de Automatización de Traspasos</div></div></div>
      <div><h1>ENTREGA DE MATERIAL</h1><div class="folio">FOLIO CONTROL: ${escaparHtml(data?.folio_control || 'NO GENERADO')}</div></div></div>
    <h2>DATOS DE LA ENTREGA</h2><div class="grid">
      <div class="field"><span class="label">Folio de solicitud</span>${escaparHtml(data?.folio || folio || (manual ? 'SIN SOLICITUD' : 'NO REGISTRADO'))}</div>
      <div class="field"><span class="label">Fecha de registro</span>${escaparHtml(fecha)}</div>
      <div class="field"><span class="label">Distrito</span>${escaparHtml(distrito || 'Consultar asignación SAT')}</div>
      <div class="field"><span class="label">Estado</span>PENDIENTE SAP</div>
      <div class="field"><span class="label">Almacén destino</span>${escaparHtml(almacen)}</div>
      <div class="field"><span class="label">Técnico que recibe</span>${escaparHtml(tecnico)}</div>
    </div>
    <section class="materials"><h2>MATERIALES ENTREGADOS</h2><table><thead><tr><th class="sku">SKU</th><th class="material">MATERIAL</th><th class="center">CANTIDAD</th><th class="center">LOTE</th></tr></thead><tbody>${filas}</tbody></table></section>
    ${bloqueSeries}
    <div class="totals"><span>TOTAL DE MATERIALES: ${materiales.length}</span><span>TOTAL DE PIEZAS: ${totalPiezas}</span></div>
    <div class="signatures"><div class="sign"><strong>ENTREGA</strong><br>Nombre y firma</div><div class="sign"><strong>RECIBE</strong><br>Nombre y firma</div></div>
    <div class="foot">CONTROL DE ALMACÉN · COMPROBANTE DE ENTREGA</div>
  </article>
  </body></html>`
}


export default function EntregaMaterial() {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [pendientes, setPendientes] = useState([])
  const [folio, setFolio] = useState('')
