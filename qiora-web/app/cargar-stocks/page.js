'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

const TIPOS = [
  { id: 'STOCK_ALMACEN', titulo: 'STOCK_ALMACEN', columnas: 8, accept: '.csv,.xlsx,.xls',
    descripcion: 'Material, Descripción del material, Centro, Almacén, Libre utilización, Lote, Trans./Trasl., Denominación almacén.' },
  { id: 'STOCK_TECNICOS', titulo: 'STOCK_TECNICOS', columnas: 9, accept: '.csv,.xlsx,.xls',
    descripcion: 'Los ocho campos de almacén más Solicita. Disponible se calcula automáticamente.' },
  { id: 'HERRAMIENTA', titulo: 'Cargar herramienta', columnas: 3, accept: '.csv,.xlsx,.xls',
    descripcion: 'Producto, Ubicación y Cantidad.' },
  { id: 'IQ09', titulo: 'iq09_equipos', columnas: 10, accept: '.csv,.xlsx,.xls',
    descripcion: 'Material, Descripción material, Número de serie, Centro, Almacén, Fecha modificación, Lote, Lote de stock, Denom. status y Tp.stocks (contab.refer.).' },
]

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()
const almacen4 = v => {
  const digits = clean(v).replace(/\D/g, '')
  return digits ? digits.padStart(4, '0').slice(-4) : ''
}
function numero(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = clean(v).replace(/,/g, '').replace(/[$\s]/g, '')
  if (!s) return 0
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error(`Cantidad no válida: "${v}".`)
  return n
}
function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => {
      try {
        const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array', raw: false, cellDates: false })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        if (!sheet) throw new Error('El archivo no contiene una hoja de datos.')
        resolve(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false }))
      } catch (e) { reject(e) }
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsArrayBuffer(file)
  })
}
function filasAObjetos(tipo, filas, distrito) {
  if (!Array.isArray(filas) || filas.length < 2) throw new Error('El archivo debe incluir encabezados y al menos una fila de datos.')
  const def = TIPOS.find(x => x.id === tipo)
  const datos = filas.slice(1).filter(r => Array.isArray(r) && r.some(v => clean(v) !== ''))
  if (!datos.length) throw new Error('El archivo no contiene filas de datos.')
  const index = datos.findIndex(r => r.length < def.columnas)
  if (index >= 0) throw new Error(`La fila ${index + 2} tiene menos de ${def.columnas} columnas requeridas.`)

  if (tipo === 'STOCK_ALMACEN') return datos.map((r, i) => {
    const centro = upper(r[2])
    if (centro && centro !== distrito) throw new Error(`La fila ${i + 2} pertenece a ${centro}, no a ${distrito}. No se cargó el archivo.`)
    const libre = numero(r[4])
    return { material: clean(r[0]), descripcion: clean(r[1]), centro: distrito, almacen: almacen4(r[3]), libre_utilizacion: libre, lote: clean(r[5]), trans_trasl: numero(r[6]), denominacion_almacen: clean(r[7]), entrega: 0, disponible: Math.max(0, libre) }
  })
  if (tipo === 'STOCK_TECNICOS') return datos.map((r, i) => {
    const centro = upper(r[2])
    if (centro && centro !== distrito) throw new Error(`La fila ${i + 2} pertenece a ${centro}, no a ${distrito}. No se cargó el archivo.`)
    const libre = numero(r[4])
    const solicita = numero(r[8])
    return { material: clean(r[0]), descripcion: clean(r[1]), centro: distrito, almacen: almacen4(r[3]), libre_utilizacion: libre, lote: clean(r[5]), trans_trasl: numero(r[6]), denominacion_almacen: clean(r[7]), solicita, disponible: Math.max(0, libre - solicita) }
  })
  if (tipo === 'HERRAMIENTA') {
    // Este archivo es "Inventario por colaborador", no un archivo de 3 columnas.
    // Identificar las columnas por encabezado evita leer SUCURSAL como CANTIDAD.
    const encabezados = filas[0].map(v =>
      clean(v)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
    )

    const indice = (nombre) => encabezados.indexOf(nombre)
    const iColaborador = indice('COLABORADOR')
    const iSucursal = indice('SUCURSAL')
    const iReferencia = indice('REFERENCIA')
    const iProducto = indice('PRODUCTO')
    const iCantidad = indice('CANTIDAD')

    if ([iColaborador, iSucursal, iProducto, iCantidad].some(i => i < 0)) {
      throw new Error(
        'El archivo de herramienta debe incluir los encabezados COLABORADOR, SUCURSAL, PRODUCTO y CANTIDAD.'
      )
    }

    return datos.map((r, i) => {
      const colaborador = clean(r[iColaborador])
      const sucursal = clean(r[iSucursal])
      const referencia = iReferencia >= 0 ? clean(r[iReferencia]) : ''
      const nombreProducto = clean(r[iProducto])
      const cantidad = numero(r[iCantidad])

      if (!colaborador || !sucursal || !nombreProducto) {
        throw new Error(`Faltan COLABORADOR, SUCURSAL o PRODUCTO en la fila ${i + 2}.`)
      }

      return {
        producto: referencia ? `${referencia} - ${nombreProducto}` : nombreProducto,
        ubicacion: `${sucursal}/Stock/${colaborador}`,
        cantidad,
        distrito,
      }
    })
  }
  if (tipo === 'IQ09') return datos.map((r, i) => {
    const centro = upper(r[3])
    if (centro && centro !== distrito) throw new Error(`La fila ${i + 2} pertenece a ${centro}, no a ${distrito}. No se cargó el archivo.`)
    return { material: clean(r[0]), descripcion: clean(r[1]), serie: upper(r[2]), centro: distrito, distrito, almacen: almacen4(r[4]), fecha_modificacion: clean(r[5]), lote: clean(r[6]), lote_stock: clean(r[7]), denom_status: clean(r[8]), tipo_stock: clean(r[9]) }
  })
  throw new Error('Tipo de carga desconocido.')
}

export default function CargarStocksPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [distrito, setDistrito] = useState('')
  const [archivos, setArchivos] = useState({})
  const [busyTipo, setBusyTipo] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargandoPerfil, setCargandoPerfil] = useState(true)

  useEffect(() => {
    let vivo = true
    async function iniciar() {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        if (!userData?.user) throw new Error('Inicia sesión para cargar stocks.')
        const { data, error: perfilError } = await supabase.rpc('qiora_mi_perfil')
        if (perfilError) throw perfilError
        if (!data || data.activo !== true) throw new Error('No se encontró un perfil activo.')
        const centro = upper(data.distrito)
        if (!centro) throw new Error('El perfil activo no tiene distrito configurado.')
        const puesto = upper(data.puesto)
        if (!puesto.startsWith('ADMIN_') && data.cargar_stocks !== true && data.carga_stocks !== true) {
          throw new Error('Tu usuario no tiene permiso para cargar stocks.')
        }
        if (vivo) { setPerfil(data); setDistrito(centro) }
      } catch (e) {
        if (vivo) setError(e?.message || 'No fue posible validar el perfil.')
      } finally { if (vivo) setCargandoPerfil(false) }
    }
    iniciar()
    return () => { vivo = false }
  }, [])

  function seleccionar(tipo, file) {
    setArchivos(prev => ({ ...prev, [tipo]: file || null }))
    setError('')
    setMensaje('')
  }

  async function cargarArchivo(tipo) {
    const file = archivos[tipo]
    if (!file) { setError(`Selecciona primero el archivo de ${tipo}.`); return }
    if (!perfil || !distrito) { setError('No se ha validado el distrito del usuario activo.'); return }
    setBusyTipo(tipo); setError(''); setMensaje('')
    try {
      const filas = await parseFile(file)
      const registros = filasAObjetos(tipo, filas, distrito)
      const confirmar = window.confirm(`Se reemplazarán los registros actuales de ${tipo} del distrito ${distrito} por ${registros.length} filas del archivo. Los demás distritos no se modificarán. ¿Deseas continuar?`)
      if (!confirmar) return
      const { data, error: rpcError } = await supabase.rpc('qiora_stock_reemplazar', { p_tipo: tipo, p_filas: registros })
      if (rpcError) throw rpcError
      setMensaje(`${tipo}: se reemplazaron ${Number(data?.total ?? registros.length)} registros para ${distrito}.`)
      setArchivos(prev => ({ ...prev, [tipo]: null }))
      const input = document.getElementById(`archivo-${tipo}`)
      if (input) input.value = ''
    } catch (e) {
      setError(e?.message || `No se pudo cargar ${tipo}.`)
    } finally { setBusyTipo('') }
  }

  return (
    <main style={s.base}>
      <div style={s.shell}>
        <button type="button" style={s.back} onClick={() => router.push('/acceso-almacen')}>← Regresar a Acceso Almacén</button>
        <header style={s.hero}>
          <h1 style={s.title}>Cargar stocks</h1>
          <p style={s.subtitle}>Suba archivos de stock y herramienta.</p>
          <div style={s.centro}>Distrito activo: {distrito || (cargandoPerfil ? 'Validando...' : 'No disponible')}</div>
        </header>

        {error && <div role="alert" style={s.error}>{error}</div>}
        {mensaje && <div role="status" style={s.success}>{mensaje}</div>}

        <section style={s.panel}>
          <h2 style={s.panelTitle}>Cargar stocks</h2>
          <div style={s.grid}>
            {TIPOS.map(tipo => (
              <div key={tipo.id} style={s.uploadCard}>
                <label htmlFor={`archivo-${tipo.id}`} style={s.label}>
                  {tipo.id === 'HERRAMIENTA' ? 'Subir herramienta (CSV o XLSX)' : `Subir ${tipo.titulo} (CSV o XLSX)`}
                </label>
                <input id={`archivo-${tipo.id}`} type="file" accept={tipo.accept} disabled={!!busyTipo || cargandoPerfil} onChange={e => seleccionar(tipo.id, e.target.files?.[0])} style={s.file} />
                <p style={s.description}>{tipo.descripcion}</p>
                <button type="button" style={s.button} disabled={!!busyTipo || cargandoPerfil || !perfil} onClick={() => cargarArchivo(tipo.id)}>
                  {busyTipo === tipo.id ? 'Procesando archivo...' : `Cargar ${tipo.id === 'HERRAMIENTA' ? 'herramienta' : tipo.titulo}`}
                </button>
              </div>
            ))}
          </div>
          <div style={s.note}>
            <strong>Importante:</strong> cada carga reemplaza únicamente los datos de ese tipo dentro del distrito activo. En STOCK_ALMACEN se genera Entrega = 0 y Disponible = Libre utilización. En STOCK_TECNICOS, Disponible = Libre utilización − Solicita. Disponible queda al final.
          </div>
        </section>
      </div>
    </main>
  )
}

const s = {
  base: { minHeight: '100vh', padding: 16, boxSizing: 'border-box', color: '#f0fff8', background: 'linear-gradient(145deg,#031f19,#052f25)', fontFamily: 'Arial, sans-serif' },
  shell: { maxWidth: 1200, margin: '0 auto', padding: 18, border: '1px solid #356f5d', borderRadius: 18, background: 'rgba(2,28,22,.82)' },
  back: { display: 'inline-block', marginBottom: 14, padding: '9px 15px', border: 0, borderRadius: 24, background: '#117b5d', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  hero: { padding: '22px 16px', border: '1px solid #379579', borderRadius: 15, textAlign: 'center', background: 'linear-gradient(110deg,#10553f,#16a47b)' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { margin: '7px 0', fontSize: 14 },
  centro: { fontSize: 12, fontWeight: 700, color: '#e2fff3' },
  panel: { marginTop: 16, padding: 16, border: '1px solid #356f5d', borderRadius: 14, background: '#082e25' },
  panelTitle: { margin: '0 0 14px', fontSize: 18 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 },
  uploadCard: { padding: 14, border: '1px solid #285f4f', borderRadius: 12, background: '#0a382d', minWidth: 0 },
  label: { display: 'block', marginBottom: 8, fontWeight: 700, fontSize: 13 },
  file: { display: 'block', boxSizing: 'border-box', width: '100%', padding: 8, borderRadius: 8, background: '#f6f7f9', color: '#18352b', fontSize: 12 },
  description: { minHeight: 34, color: '#d2eee3', fontSize: 12, lineHeight: 1.45 },
  button: { width: '100%', padding: 12, border: 0, borderRadius: 9, background: '#19a77c', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  note: { marginTop: 16, padding: 12, borderRadius: 9, background: '#0d4a39', color: '#d2eee3', fontSize: 12, lineHeight: 1.55 },
  error: { marginTop: 12, padding: 12, borderRadius: 8, background: '#ffe0e0', color: '#8e2525' },
  success: { marginTop: 12, padding: 12, borderRadius: 8, background: '#dff9e9', color: '#17623e' },
}
