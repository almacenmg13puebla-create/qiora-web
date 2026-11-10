'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const PROCESOS = [
  ['MB52', 'MB52 - Stock de almacen'],
  ['IQ09', 'IQ09 - Equipos y series'],
  ['STOCK_TECNICOS', 'Stock de tecnicos'],
  ['ACTUALIZAR_SUPABASE', 'Actualizar inventarios en Supabase'],
  ['CONSULTAS_SAP', 'Consultas SAP configuradas'],
  ['TRASPASOS', 'Traspasos'],
  ['RECOLECCIONES', 'Recolecciones'],
  ['MOVIMIENTOS_ALMACEN', 'Movimientos de almacen'],
  ['AUDITORIAS', 'Auditorias']
]
const NIVELES = [
  ['BLOQUEADO', 'Bloqueado'],
  ['CONSULTAR', 'Consultar'],
  ['PREPARAR', 'Preparar'],
  ['EJECUTAR', 'Ejecutar']
]
const css = {
  page: { minHeight: '100vh', background: '#f3f5f8', padding: 24, color: '#172033' },
  wrap: { maxWidth: 1180, margin: '0 auto' },
  back: { padding: '9px 13px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer' },
  panel: { background: '#fff', border: '1px solid #dce2ea', borderRadius: 12, padding: 20, marginTop: 18 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  button: { padding: '10px 14px', border: 0, borderRadius: 8, background: '#173b68', color: '#fff', cursor: 'pointer' },
  danger: { padding: '10px 14px', border: 0, borderRadius: 8, background: '#9f2525', color: '#fff', cursor: 'pointer' },
  input: { padding: 9, border: '1px solid #cbd5e1', borderRadius: 7, minWidth: 180 },
  district: { border: '1px solid #dce2ea', borderRadius: 10, padding: 16, marginTop: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 12 },
  process: { display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #edf0f4' },
  note: { color: '#526078', lineHeight: 1.5 },
  error: { background: '#fff0f0', color: '#8c2020', padding: 12, borderRadius: 8, marginTop: 12 },
  success: { background: '#edf8f1', color: '#17643a', padding: 12, borderRadius: 8, marginTop: 12 },
  token: { fontFamily: 'monospace', overflowWrap: 'anywhere', background: '#f1f5f9', padding: 12, borderRadius: 8, marginTop: 12 }
}

export default function MacroEmergenciaConfigPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [levels, setLevels] = useState({})
  const [approval, setApproval] = useState({})
  const [authorized, setAuthorized] = useState({})
  const [tokenGenerated, setTokenGenerated] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const request = useCallback(async (method = 'GET', payload = null) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('La sesion termino. Inicia sesion nuevamente.')
    const response = await fetch('/api/configuracion/macro-emergencia', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: payload ? JSON.stringify(payload) : undefined
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'No se pudo completar la solicitud.')
    return result
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await request()
      setData(result)
      const auth = {}
      const lv = {}
      const ap = {}
      for (const d of result.distritos || []) auth[d.centro] = d.autorizado
      for (const d of result.distritos || []) {
        for (const [proc] of PROCESOS) {
          const row = (result.permisos || []).find(p => p.centro === d.centro && p.proceso === proc)
          lv[`${d.centro}:${proc}`] = row?.nivel || 'BLOQUEADO'
          ap[`${d.centro}:${proc}`] = row?.requiere_aprobacion === true
        }
      }
      setAuthorized(auth); setLevels(lv); setApproval(ap)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  async function generateToken() {
    if (!window.confirm('Generar un token nuevo revocara el token maestro anterior. Continuar?')) return
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request('POST', { action: 'GENERAR_TOKEN' })
      setTokenGenerated(result.token)
      setMessage('Token generado. Copialo y guardalo en el libro Excel; no se mostrara otra vez.')
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function revokeToken() {
    if (!window.confirm('Revocar el token maestro bloqueara las nuevas operaciones de emergencia. Continuar?')) return
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request('POST', { action: 'REVOCAR_TOKEN' })
      setTokenGenerated(''); setMessage(result.mensaje); await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function savePermissions() {
    setSaving(true); setError(''); setMessage('')
    try {
      const distritos = (data?.distritos || []).map(d => ({ centro: d.centro, autorizado: authorized[d.centro] === true }))
      const permisos = []
      for (const d of data?.distritos || []) {
        for (const [proceso] of PROCESOS) {
          permisos.push({
            centro: d.centro,
            proceso,
            nivel: levels[`${d.centro}:${proceso}`] || 'BLOQUEADO',
            requiere_aprobacion: approval[`${d.centro}:${proceso}`] === true
          })
        }
      }
      const result = await request('POST', { action: 'GUARDAR_PERMISOS', distritos, permisos })
      setMessage(result.mensaje); await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <main style={css.page}>
      <div style={css.wrap}>
        <button style={css.back} onClick={() => router.push('/configuracion')}>Regresar a Configuracion</button>
        <h1 style={{ marginBottom: 4 }}>QIORA - Macro de emergencia multidistrito</h1>
        <p style={css.note}>Configuracion exclusiva de ADMIN_PADRE. Los permisos se validan en el servidor antes de aceptar cada operacion.</p>
        {error && <div style={css.error}>{error}</div>}
        {message && <div style={css.success}>{message}</div>}

        <section style={css.panel}>
          <h2>Token Excel maestro</h2>
          <p style={css.note}>El servidor almacena solamente el hash del token. Al generarlo se muestra una sola vez. Generar uno nuevo invalida el anterior.</p>
          <div style={css.row}>
            <strong>Estado: {data?.token?.activo ? 'ACTIVO' : data?.token?.configurado ? 'REVOCADO' : 'SIN CONFIGURAR'}</strong>
            <button style={css.button} disabled={saving || loading} onClick={generateToken}>Generar / renovar token</button>
            <button style={css.danger} disabled={saving || !data?.token?.activo} onClick={revokeToken}>Revocar token</button>
            <button style={{ ...css.button, background: '#526078' }} disabled={loading} onClick={load}>Actualizar</button>
          </div>
          {tokenGenerated && <div style={css.token}><strong>Copiar ahora:</strong><br />{tokenGenerated}<div style={{ marginTop: 8 }}><button style={css.button} onClick={() => navigator.clipboard?.writeText(tokenGenerated)}>Copiar token</button></div></div>}
        </section>

        <section style={css.panel}>
          <h2>Distritos y permisos por proceso</h2>
          <p style={css.note}>Selecciona los distritos habilitados. Para cada proceso define si puede consultar, preparar o ejecutar. Los movimientos que modifiquen SAP deben empezar bloqueados y probarse en modo de preparacion.</p>
          {loading ? <p>Cargando configuracion...</p> : (data?.distritos || []).map(d => (
            <article key={d.centro} style={css.district}>
              <div style={css.row}>
                <label style={{ fontWeight: 700 }}>
                  <input type="checkbox" checked={authorized[d.centro] === true} onChange={e => setAuthorized(v => ({ ...v, [d.centro]: e.target.checked }))} />
                  {' '}{d.centro} - {d.nombre_region || 'Sin region'}
                </label>
                <span style={css.note}>Distrito SAP: {d.activo ? 'Activo' : 'Inactivo'}</span>
              </div>
              <div style={css.grid}>
                {PROCESOS.map(([proc, label]) => {
                  const key = `${d.centro}:${proc}`
                  const value = levels[key] || 'BLOQUEADO'
                  const mutating = ['TRASPASOS','RECOLECCIONES','MOVIMIENTOS_ALMACEN'].includes(proc)
                  return <div key={key} style={{ border: '1px solid #edf0f4', borderRadius: 8, padding: 10 }}>
                    <div style={css.process}>
                      <span>{label}</span>
                      <select style={css.input} value={value} onChange={e => setLevels(v => ({ ...v, [key]: e.target.value }))}>
                        {NIVELES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
                      </select>
                    </div>
                    <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={approval[key] === true} onChange={e => setApproval(v => ({ ...v, [key]: e.target.checked }))} />
                      {' '}Exigir aprobacion adicional para ejecutar
                    </label>
                    {mutating && <small style={css.note}>Operacion con posibles cambios en SAP.</small>}
                  </div>
                })}
              </div>
            </article>
          ))}
          <div style={{ ...css.row, marginTop: 18 }}>
            <button style={css.button} disabled={saving || loading || !data?.distritos?.length} onClick={savePermissions}>{saving ? 'Guardando...' : 'Guardar autorizaciones'}</button>
            <button style={{ ...css.button, background: '#526078' }} disabled={loading} onClick={load}>Descartar cambios</button>
          </div>
        </section>
        <section style={css.panel}>
          <h2>Controles de seguridad</h2>
          <ul style={css.note}>
            <li>El token maestro no sustituye los tokens individuales de los distritos.</li>
            <li>La API comprueba distrito, proceso y nivel de operacion en cada solicitud.</li>
            <li>Los movimientos SAP requieren validacion de permisos SAP nativos y confirmacion del resultado.</li>
            <li>La pantalla no habilita por si sola transacciones SAP nuevas: cada flujo debe implementarse y probarse por separado.</li>
          </ul>
        </section>
      </div>
    </main>
  )
}
