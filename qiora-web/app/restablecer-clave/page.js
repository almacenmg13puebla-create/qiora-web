'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const campo = { width: '100%', boxSizing: 'border-box', borderRadius: 8, padding: 12, marginTop: 6, marginBottom: 14, border: '1px solid #4f9280' }
export default function RestablecerClave() {
  const [token, setToken] = useState('')
  const [clave, setClave] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [terminado, setTerminado] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token_hash') || '')
    window.history.replaceState(null, '', '/restablecer-clave')
  }, [])
  async function guardar(e) {
    e.preventDefault()
    if (procesando) return
    setMensaje('')
    if (clave.length < 12 || clave.length > 128 || !/[A-Za-z]/.test(clave) || !/[0-9]/.test(clave)) {
      setMensaje('La contraseña debe tener entre 12 y 128 caracteres, letras y números.')
      return
    }
    if (clave !== confirmar) { setMensaje('Las contraseñas no coinciden.'); return }
    setProcesando(true)
    try {
      const res = await fetch('/api/usuarios/confirmar-restablecimiento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_hash: token, nueva_clave: clave }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar.')
      setClave('');setConfirmar('');setToken('');setTerminado(true)
      setMensaje('Contraseña actualizada. Inicia sesión con tu usuario habitual.')
    } catch (err) { setMensaje(err.message || 'Error al restablecer.') }
    finally { setProcesando(false) }
  }
  return <main style={{ minHeight: '100vh', padding: 24, background: '#073f33', color: '#fff', display: 'grid', placeItems: 'center' }}>
    <section style={{ width: '100%', maxWidth: 430, background: '#0b5443', borderRadius: 12, padding: 24 }}>
      <h1>Restablecer contraseña</h1>
      {!terminado && token ? <form onSubmit={guardar}>
        <label>Contraseña nueva<input type="password" autoComplete="new-password" value={clave} onChange={e=>setClave(e.target.value)} style={campo} required minLength={12}/></label>
        <label>Confirmar contraseña<input type="password" autoComplete="new-password" value={confirmar} onChange={e=>setConfirmar(e.target.value)} style={campo} required minLength={12}/></label>
        <button type="submit" disabled={procesando} style={{ padding: 12, borderRadius: 8, cursor: 'pointer' }}>{procesando ? 'Guardando...' : 'Cambiar contraseña'}</button>
      </form> : !terminado ? <p>Enlace no disponible. Solicita otro al administrador.</p> : null}
      {mensaje && <p role="status">{mensaje}</p>}
      <p><Link href="/" style={{color: '#fff'}}>Regresar al inicio de sesión</Link></p>
    </section>
  </main>
}
