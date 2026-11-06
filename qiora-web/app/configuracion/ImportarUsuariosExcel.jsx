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
  'TELÉFONO': 'telefono',
  'TELEFONO': 'telefono',
  'PUESTO': 'puesto',
  'NÚMERO EMPLEADO': 'numero_empleado',
  'NUMERO EMPLEADO': 'numero_empleado',
  'NÚMERO DE EMPLEADO': 'numero_empleado',
  'NUMERO DE EMPLEADO': 'numero_empleado',
  'NO EMPLEADO': 'numero_empleado',
  'NO. EMPLEADO': 'numero_empleado',
  'COORDINADOR': 'coordinador',
  'USUARIO FFM': 'usuario_ffm',
  'DISTRITO': 'distrito'
}

function convertirHoja(hoja) {
  const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false })
  if (!matriz.length) throw new Error('El Excel está vacío.')
  const campos = matriz[0].map(x => headers[norm(x)] || null)
  for (const obligatorio of ['usuario_almacen', 'nombre', 'puesto']) {
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

export default function ImportarUsuariosExcel({ supabase, esPadre, distritoActual, distritos = [], onUsuariosCreados }) {
  const [filas, setFilas] = useState([])
  const [archivo, setArchivo] = useState('')
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState([])
  const [procesando, setProcesando] = useState(false)
  const [distritoSeleccionado, setDistritoSeleccionado] = useState('')

  async function seleccionarArchivo(e) {
    const file = e.target.files?.[0]
    setFilas([])
    setResultado([])
    setError('')
    setArchivo('')
    if (!file) return
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Selecciona un archivo .xlsx o .xls.')
      return
    }
    try {
      const libro = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = libro.Sheets[libro.SheetNames[0]]
      const datos = convertirHoja(sheet)
      const vistos = new Set()
      for (const fila of datos) {
        if (!/^[A-Z0-9_-]{2,40}$/.test(norm(fila.usuario_almacen))) throw new Error(`Fila ${fila.fila}: usuario inválido.`)
        if (fila.nombre.length < 3 || fila.nombre.length > 200) throw new Error(`Fila ${fila.fila}: nombre inválido.`)
        if (!fila.puesto) throw new Error(`Fila ${fila.fila}: puesto obligatorio.`)
        if (norm(fila.puesto).startsWith('ADMIN')) throw new Error(`Fila ${fila.fila}: no se permiten puestos administrativos.`)
        const distrito = norm(fila.distrito || (!esPadre ? distritoActual : ''))
        if (distrito && !/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) throw new Error(`Fila ${fila.fila}: distrito inválido.`)
        if (!esPadre && distrito !== norm(distritoActual)) throw new Error(`Fila ${fila.fila}: ese distrito no te pertenece.`)
        const llave = `${distrito}:${norm(fila.usuario_almacen)}`
        if (vistos.has(llave)) throw new Error(`Fila ${fila.fila}: usuario duplicado dentro del Excel.`)
        vistos.add(llave)
        fila.distrito = distrito
      }
      setFilas(datos)
      setArchivo(file.name)
    } catch (err) {
      setError(err?.message || 'No se pudo leer el Excel.')
    }
  }

  async function importar() {
    if (procesando || !filas.length) return
    if (esPadre && filas.some(f => !f.distrito) && !distritoSeleccionado) { setError('Selecciona el distrito para los usuarios del archivo.'); return }
    if (!window.confirm(`¿Crear ${filas.length} usuarios? Se generará una contraseña temporal aleatoria para cada usuario creado.`)) return
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
              nombre: fila.nombre,
              distrito: fila.distrito || distritoSeleccionado || distritoActual,
              telefono: fila.telefono || '',
              puesto: fila.puesto,
              numero_empleado: fila.numero_empleado || '',
              coordinador: fila.coordinador || '',
              usuario_ffm: fila.usuario_ffm || '',
              activo: true,
              // Otorga automáticamente acceso al módulo Traspasos.
              permisos: {
                traspasos: true,
                ver_traspasos: true,
                capturar_traspaso: true
              }
            })
          })
          const data = await response.json().catch(() => ({}))
          res.push({ fila: fila.fila, usuario: fila.usuario_almacen, distrito: fila.distrito, nombre: fila.nombre, ok: response.ok && data.ok === true, login: data.login || '', clave_temporal: response.ok && data.ok === true ? data.clave_temporal : '',
            mensaje: response.ok && data.ok === true ? 'Creado' : (data.error || `HTTP ${response.status}`) })
        } catch (e) {
          res.push({ fila: fila.fila, usuario: fila.usuario_almacen, distrito: fila.distrito, nombre: fila.nombre, ok: false, mensaje: e?.message || 'Error de conexión' })
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

  function descargarClaves() {
    const creados = resultado.filter(r => r.ok && r.clave_temporal)
    if (!creados.length) return
    const datos = creados.map(r => ({ USUARIO: r.usuario, DISTRITO: r.distrito, 'NOMBRE DEL TECNICO': r.nombre, 'USUARIO DE ACCESO': r.login, 'CLAVE TEMPORAL': r.clave_temporal }))
    const hoja = XLSX.utils.json_to_sheet(datos)
    hoja['!cols'] = [{wch:18},{wch:12},{wch:35},{wch:23},{wch:34}]
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Claves temporales')
    XLSX.writeFile(libro, 'QIORA_CLAVES_TEMPORALES.xlsx')
  }

  return (
    <section style={{ border: '1px solid #406f62', borderRadius: 12, padding: 16, margin: '18px 0', background: '#082a23' }}>
      <h3>Importar usuarios desde Excel</h3>
      <p>Columnas: USUARIO / ALMACÉN, NOMBRE, TELÉFONO, PUESTO, NÚMERO EMPLEADO, COORDINADOR y USUARIO FFM. DISTRITO es opcional; si eres administrador padre y no viene en el archivo, selecciónalo abajo. Máximo {LIMITE} usuarios por archivo.</p>
      {esPadre && <label style={{ display: 'block', margin: '10px 0' }}>Distrito para los usuarios (si no viene en el Excel): <select style={estilo} value={distritoSeleccionado} onChange={e => setDistritoSeleccionado(e.target.value)}><option value=''>Selecciona distrito</option>{distritos.filter(d => d.activo !== false).map(d => <option key={d.centro || d.codigo} value={d.centro || d.codigo}>{d.centro || d.codigo} {d.nombre_region || ''}</option>)}</select></label>}
      <p style={{ color: '#ffe4a3' }}>El Excel descargado con claves temporales contiene información sensible. Descárgalo, entrégalo de forma segura y elimínalo al terminar.</p>
      <input style={estilo} type="file" accept=".xlsx,.xls" disabled={procesando} onChange={seleccionarArchivo} />
      {archivo && <p>Archivo: {archivo}. Registros válidos: {filas.length}</p>}
      {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
      {filas.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', maxHeight: 240, margin: '12px 0' }}>
            <table style={{ width: '100%', background: '#fff', color: '#143126', borderCollapse: 'collapse' }}>
              <thead><tr>{['Fila','Usuario / Almacén','Nombre','Teléfono','Puesto','Número empleado','Coordinador','Usuario FFM','Distrito'].map(x => <th key={x}>{x}</th>)}</tr></thead>
              <tbody>{filas.map(f => <tr key={f.fila}><td>{f.fila}</td><td>{f.usuario_almacen}</td><td>{f.nombre}</td><td>{f.telefono || '—'}</td><td>{f.puesto}</td><td>{f.numero_empleado || '—'}</td><td>{f.coordinador || '—'}</td><td>{f.usuario_ffm || '—'}</td><td>{f.distrito || distritoSeleccionado || '—'}</td></tr>)}</tbody>
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
          {resultado.some(r => r.ok && r.clave_temporal) && <button type="button" style={boton} onClick={descargarClaves}>Descargar Excel con claves temporales</button>}
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
