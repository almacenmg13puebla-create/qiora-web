'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

const LIMITE = 100
const norm = value => String(value ?? '').trim().toUpperCase()
const headers = {
  'USUARIO': 'usuario_almacen',
  'USUARIO / ALMACÉN': 'usuario_almacen',
  'USUARIO / ALMACEN': 'usuario_almacen',
  'CLAVE': 'clave',
  'NOMBRE DEL TÉCNICO': 'nombre',
  'NOMBRE DEL TECNICO': 'nombre',
  'NOMBRE': 'nombre',
  'DISTRITO': 'distrito'
}

function convertirHoja(hoja) {
  const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false })
  if (!matriz.length) throw new Error('El Excel está vacío.')
  const campos = matriz[0].map(x => headers[norm(x)] || null)
  for (const obligatorio of ['usuario_almacen', 'clave', 'nombre', 'distrito']) {
    if (!campos.includes(obligatorio)) throw new Error(`Falta la columna: ${obligatorio}.`)
  }
  const registros = matriz.slice(1).filter(fila => fila.some(v => String(v ?? '').trim()))
  if (!registros.length) throw new Error('No hay usuarios en el Excel.')
  if (registros.length > LIMITE) throw new Error(`Máximo ${LIMITE} usuarios por archivo.`)
  return registros.map((fila, index) => {
    const datos = {}
    campos.forEach((campo, i) => { if (campo) datos[campo] = String(fila[i] ?? '').trim() })
    return { ...datos, fila: index + 2 }
  })
}

const estilo = { background: '#fff', color: '#153b31', borderRadius: 7, padding: 9, maxWidth: '100%' }
const boton = { background: '#118e6d', color: '#fff', border: 0, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }

export default function ImportarUsuariosExcel({ supabase, esPadre, distritoActual, onUsuariosCreados }) {
  const [filas, setFilas] = useState([])
  const [archivo, setArchivo] = useState('')
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState([])
  const [procesando, setProcesando] = useState(false)

  async function seleccionarArchivo(e) {
    const file = e.target.files?.[0]
    setFilas([])
    setResultado([])
    setError('')
    setArchivo('')
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Selecciona un archivo .xlsx.')
      return
    }
    try {
      const libro = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = libro.Sheets[libro.SheetNames[0]]
      const datos = convertirHoja(sheet)
      const vistos = new Set()
      for (const fila of datos) {
        if (!/^[A-Z0-9_-]{2,40}$/.test(norm(fila.usuario_almacen))) throw new Error(`Fila ${fila.fila}: usuario inválido.`)
        if (!/^\d{4}$/.test(fila.clave)) throw new Error(`Fila ${fila.fila}: la clave debe tener exactamente 4 dígitos.`)
        if (fila.nombre.length < 3 || fila.nombre.length > 200) throw new Error(`Fila ${fila.fila}: nombre inválido.`)
        if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(norm(fila.distrito))) throw new Error(`Fila ${fila.fila}: distrito inválido.`)
        if (!esPadre && norm(fila.distrito) !== norm(distritoActual)) throw new Error(`Fila ${fila.fila}: ese distrito no te pertenece.`)
        if (vistos.has(`${norm(fila.distrito)}:${norm(fila.usuario_almacen)}`)) throw new Error(`Fila ${fila.fila}: usuario duplicado dentro del Excel.`)
        vistos.add(`${norm(fila.distrito)}:${norm(fila.usuario_almacen)}`)
      }
      setFilas(datos)
      setArchivo(file.name)
    } catch (err) {
      setError(err?.message || 'No se pudo leer el Excel.')
    }
  }

  async function importar() {
    if (procesando || !filas.length) return
    if (!window.confirm(`¿Crear ${filas.length} usuarios? Solo se importarán usuario, clave, nombre y distrito; el puesto será TECNICO.`)) return
    setProcesando(true)
    setResultado([])
    setError('')
    try {
      const { data: { session }, error: sesionError } = await supabase.auth.getSession()
      if (sesionError || !session?.access_token) throw new Error('Sesión caducada. Inicia sesión nuevamente.')
      const res = []
      for (const fila of filas) {
        try {
          const response = await fetch('/api/usuarios/crear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              usuario_almacen: fila.usuario_almacen,
              clave: fila.clave,
              nombre: fila.nombre,
              distrito: fila.distrito,
              puesto: 'TECNICO',
              activo: true,
              permisos: {}
            })
          })
          const data = await response.json().catch(() => ({}))
          res.push({ fila: fila.fila, usuario: fila.usuario_almacen, ok: response.ok && data.ok === true,
            mensaje: response.ok && data.ok === true ? 'Creado' : (data.error || `HTTP ${response.status}`) })
        } catch (e) {
          res.push({ fila: fila.fila, usuario: fila.usuario_almacen, ok: false, mensaje: e?.message || 'Error de conexión' })
        }
        setResultado([...res])
      }
      if (res.some(x => x.ok)) await onUsuariosCreados?.()
    } catch (e) {
      setError(e?.message || 'No se pudo realizar la importación.')
    } finally {
      setProcesando(false)
    }
  }

  return (
    <section style={{ border: '1px solid #406f62', borderRadius: 12, padding: 16, margin: '18px 0', background: '#082a23' }}>
      <h3>Importar usuarios desde Excel</h3>
      <p>Columnas: USUARIO, CLAVE, NOMBRE DEL TECNICO, DISTRITO. Máximo {LIMITE} usuarios por archivo. Las claves iniciales deben tener 4 dígitos.</p>
      <p style={{ color: '#ffe4a3' }}>El archivo contiene claves temporales: no lo compartas y elimínalo cuando ya no lo necesites. Cambia las claves iniciales por contraseñas seguras antes de usar el sistema en producción.</p>
      <input style={estilo} type="file" accept=".xlsx" disabled={procesando} onChange={seleccionarArchivo} />
      {archivo && <p>Archivo: {archivo}. Registros válidos: {filas.length}</p>}
      {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
      {filas.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', maxHeight: 240, margin: '12px 0' }}>
            <table style={{ width: '100%', background: '#fff', color: '#143126', borderCollapse: 'collapse' }}>
              <thead><tr><th>Fila</th><th>Usuario</th><th>Nombre</th><th>Distrito</th><th>Clave</th></tr></thead>
              <tbody>{filas.map(f => <tr key={f.fila}><td>{f.fila}</td><td>{f.usuario_almacen}</td><td>{f.nombre}</td><td>{f.distrito}</td><td>••••</td></tr>)}</tbody>
            </table>
          </div>
          <button type="button" style={boton} disabled={procesando} onClick={importar}>
            {procesando ? 'Importando...' : `Crear ${filas.length} usuarios`}
          </button>
        </>
      )}
      {resultado.length > 0 && (
        <div aria-live="polite" style={{ marginTop: 12 }}>
          <p>Procesados: {resultado.length}/{filas.length}. Creados: {resultado.filter(x => x.ok).length}. Con error: {resultado.filter(x => !x.ok).length}.</p>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {resultado.map(r => <p key={r.fila} style={{ color: r.ok ? '#b9f3da' : '#ffb3b3', margin: '4px 0' }}>
              Fila {r.fila}: {r.usuario} — {r.mensaje}
            </p>)}
          </div>
        </div>
      )}
    </section>
  )
}
