'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const CAMPOS = {
  STOCK_TECNICOS: [
    ['almacen', 'Almacén'], ['sku', 'SKU'], ['material', 'Material'],
    ['lote', 'Lote'], ['cantidad', 'Cantidad'], ['disponible', 'Disponible'],
    ['tecnico', 'Técnico'],
  ],
  IQ09_EQUIPOS: [
    ['almacen', 'Almacén'], ['serie', 'Serie'], ['material', 'Material'],
    ['descripcion', 'Descripción'], ['lote', 'Lote'],
    ['estatus_sap', 'Estatus SAP'], ['denom_status', 'Denominación'],
    ['tipo_stock', 'Tipo de stock'],
  ],
}

const permitido = (perfil) =>
  ['auditoria', 'dashboard', 'traspasos', 'solicitud_material'].some((p) => perfil?.[p] === true)

export default function InventariosPage() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [validando, setValidando] = useState(true)
  const [tipo, setTipo] = useState('STOCK_TECNICOS')
  const [almacen, setAlmacen] = useState('')
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [resultado, setResultado] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) { router.replace('/'); return }
        const { data, error: perfilError } = await supabase.rpc('qiora_mi_perfil')
        if (perfilError) throw perfilError
        if (!data || data.activo !== true || !permitido(data)) {
          throw new Error('Este usuario no tiene permiso para consultar inventarios.')
        }
        if (vivo) setPerfil(data)
      } catch (e) {
        if (vivo) setError(e.message || 'No se pudo validar el acceso.')
      } finally {
        if (vivo) setValidando(false)
      }
    })()
    return () => { vivo = false }
  }, [router])

  const buscar = useCallback(async (nuevaPagina = 1, filtroActual = filtro, tipoActual = tipo) => {
    setOcupado(true)
    setError('')
    try {
      const { data, error: consultaError } = await supabase.rpc('qiora_consultar_inventario', {
        p_tipo: tipoActual,
        p_almacen: filtroActual || null,
        p_pagina: nuevaPagina,
        p_limite: 100,
      })
      if (consultaError) throw consultaError
      if (!data?.ok) throw new Error('Supabase no confirmó la consulta.')
      setResultado(data)
      setPagina(nuevaPagina)
    } catch (e) {
      setResultado(null)
      setError(e.message || 'Error al consultar inventarios.')
    } finally {
      setOcupado(false)
    }
  }, [filtro, tipo])

  if (validando) return <main style={estilos.pagina}>Validando sesión...</main>
  if (!perfil) return <main style={estilos.pagina}><h1>Inventarios</h1><p role="alert">{error}</p><a href="/">Volver al panel</a></main>

  const columnas = CAMPOS[tipo]
  const totalPaginas = Math.max(1, Math.ceil(Number(resultado?.total || 0) / 100))

  return (
    <main style={estilos.pagina}>
      <div style={estilos.contenedor}>
        <header style={estilos.cabecera}>
          <div><h1 style={{ margin: 0 }}>QIORA · Inventarios</h1><p style={{ marginBottom: 0 }}>Distrito {perfil.distrito} · {perfil.nombre}</p></div>
          <button style={estilos.boton} type="button" onClick={() => router.push('/')}>Regresar al panel</button>
        </header>
        <section style={estilos.card}>
          <div style={estilos.filtros}>
            <label>Inventario
              <select style={estilos.input} value={tipo} onChange={(e) => { setTipo(e.target.value); setResultado(null); setPagina(1) }}>
                <option value="STOCK_TECNICOS">Stock de técnicos</option>
                <option value="IQ09_EQUIPOS">IQ09 · Equipos</option>
              </select>
            </label>
            <label>Almacén (vacío = permitidos del distrito)
              <input style={estilos.input} value={almacen} onChange={(e) => setAlmacen(e.target.value.toUpperCase())} maxLength={10} placeholder="Ej. 0026" />
            </label>
          </div>
          <button style={estilos.principal} type="button" disabled={ocupado} onClick={() => { const f = almacen.trim(); setFiltro(f); buscar(1, f, tipo) }}>{ocupado ? 'Consultando...' : 'Consultar inventario'}</button>
          <p style={estilos.nota}>La consulta es de solo lectura. Los técnicos únicamente pueden consultar su propio almacén; Auditorías y Dashboard consultan su distrito.</p>
        </section>
        {error && <p role="alert" style={estilos.error}>{error}</p>}
        {resultado && <section style={estilos.card}>
          <h2 style={{ marginTop: 0 }}>{tipo === 'STOCK_TECNICOS' ? 'Stock de técnicos' : 'Equipos IQ09'}</h2>
          <p>Distrito: <b>{resultado.distrito}</b> · Almacén: <b>{resultado.almacen || 'Todos los autorizados'}</b> · Registros: <b>{resultado.total}</b></p>
          <div style={{ overflowX: 'auto' }}><table style={estilos.tabla}><thead><tr>{columnas.map(([campo, etiqueta]) => <th style={estilos.th} key={campo}>{etiqueta}</th>)}</tr></thead><tbody>
            {(resultado.filas || []).map((fila, i) => <tr key={i}>{columnas.map(([campo]) => <td style={estilos.td} key={campo}>{fila[campo] ?? '-'}</td>)}</tr>)}
          </tbody></table></div>
          {(!resultado.filas || resultado.filas.length === 0) && <p>No se encontraron registros para estos filtros.</p>}
          <div style={estilos.paginacion}><button style={estilos.boton} type="button" disabled={ocupado || pagina <= 1} onClick={() => buscar(pagina - 1)}>Anterior</button><span>Página {pagina} de {totalPaginas}</span><button style={estilos.boton} type="button" disabled={ocupado || pagina >= totalPaginas} onClick={() => buscar(pagina + 1)}>Siguiente</button></div>
        </section>}
      </div>
    </main>
  )
}

const estilos = {
  pagina: { minHeight: '100vh', background: '#071f19', color: '#eef7f3', padding: '24px', fontFamily: 'Arial, sans-serif' },
  contenedor: { maxWidth: '1450px', margin: '0 auto' },
  cabecera: { display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 },
  card: { background: '#0a3027', border: '1px solid #397564', borderRadius: 16, padding: 20, marginBottom: 20 },
  filtros: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 16 },
  input: { display: 'block', width: '100%', marginTop: 8, padding: 12, borderRadius: 9, border: '1px solid #397564', background: '#fff', color: '#111' },
  principal: { background: '#18a97e', color: '#fff', border: 0, borderRadius: 9, padding: '12px 18px', marginTop: 18, fontWeight: 700, cursor: 'pointer' },
  boton: { background: 'transparent', color: '#fff', border: '1px solid #568374', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' },
  nota: { color: '#b8d1c9', fontSize: 13 },
  error: { color: '#ffdcdc', background: '#5a1e1e', padding: 14, borderRadius: 9 },
  tabla: { width: '100%', minWidth: 850, borderCollapse: 'collapse', textAlign: 'left' },
  th: { padding: 11, color: '#fff', background: '#11624b' },
  td: { padding: 10, borderBottom: '1px solid #315f53' },
  paginacion: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 20 },
}
