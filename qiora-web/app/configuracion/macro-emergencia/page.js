'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const PROCESOS = [
  ['MB52', 'MB52', 'Stock de almacén', 'Consulta'],
  ['IQ09', 'IQ09', 'Equipos y números de serie', 'Consulta'],
  ['STOCK_TECNICOS', 'Stock técnicos', 'Existencias asignadas a técnicos', 'Consulta'],
  ['ACTUALIZAR_SUPABASE', 'Actualizar inventarios', 'Sincronización con Supabase', 'Datos'],
  ['CONSULTAS_SAP', 'Consultas SAP', 'Consultas previamente configuradas', 'Consulta'],
  ['TRASPASOS', 'Traspasos', 'Operaciones entre almacenes o distritos', 'Movimiento'],
  ['RECOLECCIONES', 'Recolecciones', 'Consulta y procesamiento de recolecciones', 'Movimiento'],
  ['MOVIMIENTOS_ALMACEN', 'Movimientos de almacén', 'Entradas, salidas y transferencias', 'Movimiento'],
  ['AUDITORIAS', 'Auditorías', 'Inventarios, equipos y diferencias', 'Control']
]
const NIVELES = [
  ['BLOQUEADO', 'Bloqueado'],
  ['CONSULTAR', 'Consultar'],
  ['PREPARAR', 'Preparar'],
  ['EJECUTAR', 'Ejecutar']
]

export default function MacroEmergenciaConfigPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [levels, setLevels] = useState({})
  const [approval, setApproval] = useState({})
  const [authorized, setAuthorized] = useState({})
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [districtSearch, setDistrictSearch] = useState('')
  const [tokenGenerated, setTokenGenerated] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const request = useCallback(async (method = 'GET', payload = null) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('La sesión terminó. Inicia sesión nuevamente.')
    const response = await fetch('/api/configuracion/macro-emergencia', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
      const auth = {}, lv = {}, ap = {}
      for (const d of result.distritos || []) auth[d.centro] = d.autorizado === true
      for (const d of result.distritos || []) {
        for (const [proc] of PROCESOS) {
          const row = (result.permisos || []).find(p => p.centro === d.centro && p.proceso === proc)
          lv[`${d.centro}:${proc}`] = row?.nivel || 'BLOQUEADO'
          ap[`${d.centro}:${proc}`] = row?.requiere_aprobacion === true
        }
      }
      setAuthorized(auth); setLevels(lv); setApproval(ap)
      setSelectedDistrict(current => (result.distritos || []).some(d => d.centro === current) ? current : (result.distritos?.[0]?.centro || ''))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  async function generateToken() {
    if (!window.confirm('Generar un token nuevo revocará el token maestro anterior. ¿Continuar?')) return
    setSaving(true); setError(''); setMessage(''); setTokenGenerated('')
    try {
      const result = await request('POST', { action: 'GENERAR_TOKEN' })
      setTokenGenerated(result.token)
      setMessage('Token generado. Cópialo y guárdalo ahora; no se volverá a mostrar.')
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function revokeToken() {
    if (!window.confirm('Revocar el token maestro bloqueará las nuevas operaciones de emergencia. ¿Continuar?')) return
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
        for (const [proceso] of PROCESOS) permisos.push({
          centro: d.centro,
          proceso,
          nivel: levels[`${d.centro}:${proceso}`] || 'BLOQUEADO',
          requiere_aprobacion: approval[`${d.centro}:${proceso}`] === true
        })
      }
      const result = await request('POST', { action: 'GUARDAR_PERMISOS', distritos, permisos })
      setMessage(result.mensaje); await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const districts = data?.distritos || []
  const currentDistrict = districts.find(d => d.centro === selectedDistrict)
  const filteredDistricts = useMemo(() => districts.filter(d => `${d.centro} ${d.nombre_region || ''}`.toLowerCase().includes(districtSearch.toLowerCase())), [districts, districtSearch])
  const enabledCount = districts.filter(d => authorized[d.centro] === true).length
  const processEnabledCount = PROCESOS.filter(([p]) => levels[`${selectedDistrict}:${p}`] && levels[`${selectedDistrict}:${p}`] !== 'BLOQUEADO').length
  const tokenActive = data?.token?.activo === true

  return (
    <main className="qme-page">
      <div className="qme-shell">
        <div className="qme-topline">
          <button className="qme-back" onClick={() => router.push('/configuracion')}>← Configuración</button>
          <span className="qme-breadcrumb">Administración / Macro de emergencia</span>
        </div>

        <header className="qme-header">
          <div>
            <div className="qme-eyebrow">CENTRO DE CONTROL · ADMIN_PADRE</div>
            <h1>Macro de emergencia multidistrito</h1>
            <p>Administra el acceso de Excel y define qué operaciones puede realizar por distrito.</p>
          </div>
          <div className={`qme-status ${tokenActive ? 'is-active' : 'is-off'}`}><span />{tokenActive ? 'Token maestro activo' : 'Token maestro inactivo'}</div>
        </header>

        {error && <div className="qme-alert qme-alert-error"><strong>No se pudo completar.</strong> {error}</div>}
        {message && <div className="qme-alert qme-alert-success">{message}</div>}

        <section className="qme-token-card">
          <div className="qme-token-copy">
            <div className="qme-section-kicker">AUTENTICACIÓN</div>
            <h2>Token Excel maestro</h2>
            <p>Autoriza a la macro central. Los tokens individuales de cada distrito se conservan sin cambios.</p>
            <div className="qme-token-state"><span className={tokenActive ? 'dot-green' : 'dot-gray'} />Estado: <b>{loading ? 'Consultando…' : tokenActive ? 'ACTIVO' : data?.token?.configurado ? 'REVOCADO' : 'SIN CONFIGURAR'}</b></div>
          </div>
          <div className="qme-token-actions">
            <button className="qme-btn qme-btn-primary" disabled={saving || loading} onClick={generateToken}>{data?.token?.configurado ? 'Renovar token' : 'Generar token'}</button>
            <button className="qme-btn qme-btn-danger-outline" disabled={saving || !tokenActive} onClick={revokeToken}>Revocar</button>
            <button className="qme-btn qme-btn-light" disabled={loading || saving} onClick={load}>Actualizar</button>
          </div>
          {tokenGenerated && <div className="qme-token-reveal"><div><b>Token nuevo</b><small>Esta es la única vez que se mostrará. Guárdalo en un lugar seguro.</small></div><code>{tokenGenerated}</code><button className="qme-btn qme-btn-primary" onClick={() => navigator.clipboard?.writeText(tokenGenerated)}>Copiar token</button></div>}
        </section>

        <div className="qme-workspace-heading">
          <div><div className="qme-section-kicker">AUTORIZACIONES</div><h2>Distritos y permisos</h2><p>Selecciona un distrito para administrar sus procesos. Los cambios se guardan al presionar «Guardar autorizaciones».</p></div>
          <div className="qme-counter"><b>{enabledCount}</b><span>de {districts.length} distritos autorizados</span></div>
        </div>

        <section className="qme-workspace">
          <aside className="qme-sidebar">
            <div className="qme-sidebar-head"><h3>Distritos</h3><span>{districts.length}</span></div>
            <input className="qme-search" value={districtSearch} onChange={e => setDistrictSearch(e.target.value)} placeholder="Buscar distrito…" />
            {loading ? <div className="qme-empty">Cargando distritos…</div> : filteredDistricts.map(d => (
              <div key={d.centro} className={`qme-district-item ${selectedDistrict === d.centro ? 'selected' : ''}`}>
                <button className="qme-district-select" onClick={() => setSelectedDistrict(d.centro)}>
                  <span className="qme-district-code">{d.centro}</span>
                  <span className="qme-district-name">{d.nombre_region || 'Sin región'}</span>
                  <span className={`qme-mini-status ${d.activo ? 'online' : 'offline'}`}>{d.activo ? 'SAP activo' : 'SAP inactivo'}</span>
                </button>
                <label className="qme-switch-label" title="Autorizar este distrito para la macro">
                  <input type="checkbox" checked={authorized[d.centro] === true} onChange={e => setAuthorized(v => ({ ...v, [d.centro]: e.target.checked }))} />
                  <span className="qme-switch" />
                  <small>{authorized[d.centro] ? 'Autorizado' : 'No autorizado'}</small>
                </label>
              </div>
            ))}
            {!loading && filteredDistricts.length === 0 && <div className="qme-empty">No hay distritos que coincidan.</div>}
            <div className="qme-sidebar-note">Activar un distrito aquí no concede permisos SAP por sí solo. También debes configurar sus procesos.</div>
          </aside>

          <section className="qme-permissions">
            {!currentDistrict ? <div className="qme-empty qme-empty-large">Selecciona un distrito para configurar sus permisos.</div> : <>
              <div className="qme-selected-head">
                <div><div className="qme-section-kicker">DISTRITO SELECCIONADO</div><h3>{currentDistrict.centro} <span>— {currentDistrict.nombre_region || 'Sin región'}</span></h3><p>{currentDistrict.activo ? 'El centro está activo en QIORA.' : 'El centro está inactivo en QIORA.'}</p></div>
                <div className={`qme-access-pill ${authorized[currentDistrict.centro] ? 'allowed' : 'blocked'}`}>{authorized[currentDistrict.centro] ? 'Acceso macro autorizado' : 'Acceso macro bloqueado'}</div>
              </div>
              <div className="qme-process-summary"><b>{processEnabledCount}</b> de {PROCESOS.length} procesos con permiso · Los movimientos SAP empiezan bloqueados.</div>
              <div className="qme-process-grid">
                {PROCESOS.map(([proc, title, description, type]) => {
                  const key = `${currentDistrict.centro}:${proc}`
                  const value = levels[key] || 'BLOQUEADO'
                  const mutating = type === 'Movimiento'
                  return <article className={`qme-process-card ${mutating ? 'is-movement' : ''}`} key={key}>
                    <div className="qme-process-card-top"><span className={`qme-type-tag tag-${type.toLowerCase()}`}>{type}</span>{mutating && <span className="qme-lock-hint">Control SAP</span>}</div>
                    <h4>{title}</h4>
                    <p>{description}</p>
                    <label className="qme-field-label" htmlFor={`level-${key}`}>Nivel de autorización</label>
                    <select id={`level-${key}`} className={`qme-level level-${value.toLowerCase()}`} value={value} onChange={e => setLevels(v => ({ ...v, [key]: e.target.value }))}>
                      {NIVELES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
                    </select>
                    <label className="qme-approval"><input type="checkbox" checked={approval[key] === true} onChange={e => setApproval(v => ({ ...v, [key]: e.target.checked }))} /><span>Exigir aprobación adicional para ejecutar</span></label>
                    {mutating && <div className="qme-card-warning">Puede modificar información en SAP. Requiere validación y prueba específica.</div>}
                  </article>
                })}
              </div>
              <div className="qme-savebar"><div><b>Permisos de {currentDistrict.centro}</b><small>Los cambios aún no se han guardado.</small></div><div className="qme-save-actions"><button className="qme-btn qme-btn-light" disabled={saving || loading} onClick={load}>Descartar cambios</button><button className="qme-btn qme-btn-primary" disabled={saving || loading} onClick={savePermissions}>{saving ? 'Guardando…' : 'Guardar autorizaciones'}</button></div></div>
            </>}
          </section>
        </section>

        <section className="qme-security">
          <div className="qme-security-icon">盾</div><div><h3>Controles de seguridad</h3><p>El servidor debe validar token, distrito, proceso y nivel en cada solicitud. Los permisos de esta pantalla no sustituyen las autorizaciones nativas de SAP ni habilitan automáticamente transacciones que aún no estén integradas y probadas.</p></div>
        </section>
      </div>

      <style jsx>{`
        * { box-sizing: border-box; }
        .qme-page { min-height:100vh; background:#f4f7f8; color:#172b3a; padding:30px 22px 56px; }
        .qme-shell { max-width:1420px; margin:0 auto; }
        .qme-topline { display:flex; align-items:center; gap:14px; margin-bottom:22px; }
        .qme-back { border:1px solid #d6e0e5; background:#fff; color:#294657; border-radius:9px; padding:9px 13px; font-weight:650; cursor:pointer; }
        .qme-breadcrumb { color:#81919a; font-size:13px; }
        .qme-header { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:22px; }
        .qme-eyebrow,.qme-section-kicker { color:#16856e; font-size:10px; font-weight:800; letter-spacing:1.25px; margin-bottom:7px; }
        .qme-header h1 { font-size:clamp(25px,3vw,34px); letter-spacing:-.8px; margin:0; color:#173344; }
        .qme-header p,.qme-workspace-heading p { color:#6c7e88; margin:7px 0 0; font-size:14px; }
        .qme-status { display:flex; align-items:center; gap:8px; border-radius:30px; padding:10px 14px; white-space:nowrap; font-size:12px; font-weight:750; }
        .qme-status span,.dot-green,.dot-gray { width:8px; height:8px; border-radius:50%; display:inline-block; }
        .qme-status.is-active { background:#e6f5ef; color:#167451; }.qme-status.is-active span,.dot-green { background:#19a36f; }
        .qme-status.is-off { background:#edf0f2; color:#687983; }.qme-status.is-off span,.dot-gray { background:#9aa8ae; }
        .qme-alert { padding:13px 16px; border-radius:10px; margin:0 0 16px; font-size:13px; }
        .qme-alert-error { background:#fff0ef; border:1px solid #f3cbc7; color:#9a3028; }.qme-alert-success { background:#eaf7f0; border:1px solid #c9e9d8; color:#176c48; }
        .qme-token-card { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:18px; align-items:center; background:#fff; border:1px solid #dfe7e9; border-radius:15px; padding:23px 25px; box-shadow:0 3px 12px rgba(25,55,68,.035); }
        .qme-token-copy h2,.qme-workspace-heading h2 { font-size:20px; margin:0; color:#1b3747; }.qme-token-copy p { color:#73838b; font-size:13px; margin:7px 0 13px; }
        .qme-token-state { display:flex; align-items:center; gap:7px; color:#667984; font-size:12px; }.qme-token-state b { color:#253f4c; }
        .qme-token-actions,.qme-save-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
        .qme-btn { border-radius:9px; border:1px solid transparent; padding:10px 14px; font-size:12px; font-weight:750; cursor:pointer; transition:.15s ease; }
        .qme-btn:disabled { opacity:.5; cursor:not-allowed; }.qme-btn-primary { background:#117d68; color:white; }.qme-btn-primary:hover:not(:disabled) { background:#0d6a59; }
        .qme-btn-danger-outline { background:#fff; border-color:#e8c9c7; color:#a33a34; }.qme-btn-danger-outline:hover:not(:disabled) { background:#fff4f3; }
        .qme-btn-light { background:#f5f8f9; border-color:#dce5e8; color:#49616d; }.qme-btn-light:hover:not(:disabled) { background:#eaf0f2; }
        .qme-token-reveal { grid-column:1/-1; background:#f0f8f5; border:1px solid #cce7dc; border-radius:11px; padding:14px; display:grid; grid-template-columns:180px minmax(0,1fr) auto; gap:12px; align-items:center; }.qme-token-reveal small { display:block; color:#668078; margin-top:4px; font-size:11px; }.qme-token-reveal code { overflow-wrap:anywhere; color:#165a49; font-size:12px; }
        .qme-workspace-heading { display:flex; align-items:end; justify-content:space-between; gap:20px; margin:30px 0 14px; }.qme-counter { display:flex; align-items:center; gap:9px; background:#e9f2f1; color:#50716d; border-radius:10px; padding:9px 13px; font-size:11px; }.qme-counter b { color:#117d68; font-size:20px; }
        .qme-workspace { display:grid; grid-template-columns:265px minmax(0,1fr); gap:16px; align-items:start; }
        .qme-sidebar,.qme-permissions { background:#fff; border:1px solid #dfe7e9; border-radius:14px; box-shadow:0 3px 12px rgba(25,55,68,.035); }
        .qme-sidebar { padding:16px; }.qme-sidebar-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }.qme-sidebar-head h3 { margin:0; font-size:15px; }.qme-sidebar-head span { background:#eef3f4; color:#60747d; border-radius:20px; padding:3px 8px; font-size:11px; font-weight:700; }
        .qme-search { width:100%; border:1px solid #dce5e8; background:#fafcfc; border-radius:8px; padding:10px 11px; font-size:12px; outline:none; margin-bottom:11px; }.qme-search:focus,.qme-level:focus { border-color:#168b73; box-shadow:0 0 0 3px rgba(22,139,115,.1); }
        .qme-district-item { border:1px solid #e8edef; border-radius:10px; margin-bottom:8px; overflow:hidden; }.qme-district-item.selected { border-color:#78bca9; box-shadow:0 0 0 2px rgba(22,139,115,.08); background:#fbfefd; }
        .qme-district-select { width:100%; border:0; background:transparent; text-align:left; padding:11px 11px 5px; cursor:pointer; display:block; }.qme-district-code { display:block; color:#203e4c; font-weight:800; font-size:13px; }.qme-district-name { display:block; color:#75858c; font-size:11px; margin-top:2px; }.qme-mini-status { display:inline-block; font-size:10px; margin-top:7px; }.qme-mini-status.online { color:#19815c; }.qme-mini-status.offline { color:#a34b45; }
        .qme-switch-label { display:flex; align-items:center; gap:7px; padding:8px 11px 10px; cursor:pointer; color:#71818a; font-size:10px; }.qme-switch-label input { position:absolute; opacity:0; }.qme-switch { width:29px; height:16px; border-radius:20px; background:#cbd5d9; position:relative; transition:.15s; flex:none; }.qme-switch:after { content:''; position:absolute; width:12px; height:12px; left:2px; top:2px; background:white; border-radius:50%; transition:.15s; box-shadow:0 1px 3px #71818a; }.qme-switch-label input:checked + .qme-switch { background:#159675; }.qme-switch-label input:checked + .qme-switch:after { transform:translateX(13px); }
        .qme-sidebar-note { border-top:1px solid #edf1f2; padding-top:12px; margin-top:10px; color:#87959b; font-size:10px; line-height:1.5; }.qme-empty { color:#839198; font-size:12px; padding:16px 5px; }.qme-empty-large { text-align:center; padding:70px 20px; }
        .qme-permissions { padding:20px; min-width:0; }.qme-selected-head { display:flex; align-items:center; justify-content:space-between; gap:15px; padding-bottom:15px; border-bottom:1px solid #edf1f2; }.qme-selected-head h3 { margin:0; color:#1e3b49; font-size:19px; }.qme-selected-head h3 span { color:#7b8a91; font-weight:500; }.qme-selected-head p { margin:5px 0 0; color:#849198; font-size:11px; }.qme-access-pill { padding:7px 10px; border-radius:30px; font-size:10px; font-weight:750; white-space:nowrap; }.qme-access-pill.allowed { background:#e8f6ef; color:#18764f; }.qme-access-pill.blocked { background:#f1f3f4; color:#78858a; }
        .qme-process-summary { color:#87949a; font-size:11px; padding:13px 0 3px; }.qme-process-summary b { color:#147e68; font-size:15px; }
        .qme-process-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:11px; margin-top:11px; }.qme-process-card { border:1px solid #e4ebed; border-radius:11px; padding:13px; min-width:0; background:#fff; }.qme-process-card.is-movement { background:#fffdf9; border-color:#eee5d4; }
        .qme-process-card-top { display:flex; align-items:center; justify-content:space-between; gap:5px; min-height:18px; }.qme-type-tag { display:inline-block; border-radius:5px; padding:3px 6px; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.35px; }.tag-consulta { background:#eaf2fa; color:#416b91; }.tag-datos { background:#eaf6f2; color:#27775d; }.tag-movimiento { background:#fff0d9; color:#98651e; }.tag-control { background:#f0edfa; color:#69569a; }.qme-lock-hint { color:#a17b3e; font-size:9px; }
        .qme-process-card h4 { margin:9px 0 4px; color:#284451; font-size:13px; }.qme-process-card p { min-height:30px; margin:0 0 12px; color:#849198; font-size:10px; line-height:1.45; }.qme-field-label { display:block; color:#60747e; font-size:10px; font-weight:750; margin-bottom:5px; }.qme-level { width:100%; min-width:0; padding:9px 28px 9px 10px; border:1px solid #dce5e8; border-radius:7px; color:#3d5661; background:#f8fafb; font-size:11px; font-weight:700; outline:none; }.qme-level.level-bloqueado { color:#78858b; }.qme-level.level-ejecutar { color:#16744f; background:#edf8f2; border-color:#cde8d8; }
        .qme-approval { display:flex; align-items:flex-start; gap:7px; margin-top:11px; color:#657981; font-size:10px; line-height:1.4; cursor:pointer; }.qme-approval input { margin:1px 0 0; accent-color:#13856d; }.qme-card-warning { border-top:1px solid #f0e6d5; margin-top:10px; padding-top:8px; color:#9a7740; font-size:9px; line-height:1.4; }
        .qme-savebar { display:flex; align-items:center; justify-content:space-between; gap:15px; border-top:1px solid #edf1f2; margin-top:18px; padding-top:15px; }.qme-savebar b { display:block; color:#294653; font-size:12px; }.qme-savebar small { display:block; color:#8a989d; font-size:10px; margin-top:3px; }
        .qme-security { display:flex; align-items:flex-start; gap:13px; margin-top:17px; border:1px solid #dce9e5; background:#f0f7f4; border-radius:12px; padding:15px 17px; }.qme-security-icon { color:#16836c; font-size:20px; }.qme-security h3 { margin:0 0 4px; color:#285347; font-size:12px; }.qme-security p { margin:0; color:#6d827b; font-size:10px; line-height:1.55; }
        @media(max-width:1050px) { .qme-process-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.qme-workspace { grid-template-columns:230px minmax(0,1fr); } }
        @media(max-width:760px) { .qme-page { padding:17px 12px 35px; }.qme-header,.qme-workspace-heading { align-items:flex-start; flex-direction:column; }.qme-token-card { grid-template-columns:1fr; padding:18px; }.qme-token-actions { justify-content:flex-start; }.qme-workspace { grid-template-columns:1fr; }.qme-sidebar { max-height:330px; overflow:auto; }.qme-process-grid { grid-template-columns:1fr; }.qme-selected-head,.qme-savebar { align-items:flex-start; flex-direction:column; }.qme-save-actions { width:100%; }.qme-token-reveal { grid-template-columns:1fr; }.qme-breadcrumb { display:none; } }
      `}</style>
    </main>
  )
}
