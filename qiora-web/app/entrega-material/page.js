'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'

// useSearchParams debe estar dentro de un componente envuelto por Suspense.
export default function EntregaMaterialPage() {
  return (
    <Suspense fallback={<main className="em-loading">Cargando entrega de material...</main>}>
      <EntregaMaterial />
    </Suspense>
  )
}

function EntregaMaterial() {
  const router = useRouter()
  const qs = useSearchParams()
  const folioUrl = qs.get('folio') || ''
  const [folio, F] = useState('')
  const [almacen, A] = useState('')
  const [tecnico, T] = useState('')
  const [materiales, M] = useState([])
  const [err, E] = useState('')
  const [ok, O] = useState('')
  const [busy, B] = useState(false)
  const [manual, V] = useState(false)

  useEffect(() => {
    if (folioUrl) buscar(folioUrl)
    // Solo buscar cuando cambie el folio de la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioUrl])

  async function buscar(f) {
    E('')
    O('')
    const { data, error } = await supabase.rpc('qiora_material_listar', {
      p_folio: f || '',
      p_almacen: f ? '' : almacen,
      p_estatus: '',
      p_desde: null,
      p_hasta: null,
    })
    if (error) {
      E(error.message)
      return
    }
    const registros = Array.isArray(data) ? data : []
    const x = (f ? registros.find(item => item.folio === f) : registros[0]) || null
    if (!x) {
      E('No se encontró solicitud pendiente.')
      return
    }
    V(false)
    F(x.folio)
    A(x.almacen)
    T(x.tecnico)
    M(Array.isArray(x.materiales) ? x.materiales : [])
  }

  async function guardar() {
    if (busy || manual || !folio || !materiales.length) return
    B(true)
    E('')
    O('')
    try {
      const { data, error } = await supabase.rpc('qiora_material_guardar_entrega', {
        p_folio_solicitud: folio,
        p_almacen: almacen,
        p_materiales: materiales,
      })
      if (error) throw error
      O('Entrega registrada en MIGO. FOLIO ' + data.folio + ' · FOLIO_CONTROL ' + data.folio_control + ' · PENDIENTE SAP')
    } catch (e) {
      E(e?.message || 'No se pudo guardar la entrega.')
    } finally {
      B(false)
    }
  }

  function limpiar() {
    F('')
    A('')
    T('')
    M([])
    V(false)
    E('')
    O('')
  }

  return (
    <main className="em">
      <div className="wrap">
        <button onClick={() => router.push('/ver-solicitudes')}>← Ver solicitudes</button>
        <header>
          <h1>ENTREGA DE MATERIAL</h1>
          <p>Complemento con materiales cargados desde Solicitudes.</p>
        </header>
        <section>
          <h3>Buscar solicitudes por almacén</h3>
          <label>
            Almacén
            <input value={almacen} onChange={e => A(e.target.value)} />
          </label>
          <button onClick={() => buscar('')}>Buscar pendientes</button>
          <button onClick={() => {
            V(true)
            F('')
            M([])
            O('')
            E('La entrega sin solicitud requiere un flujo de reserva autorizado. No se permite omitir existencias o máximos.')
          }}>Entrega sin solicitud</button>
          <div className="grid">
            <label>Solicitud pendiente<input value={folio} readOnly /></label>
            <label>Almacén<input value={almacen} readOnly /></label>
            <label>Técnico<input value={tecnico} readOnly /></label>
          </div>
        </section>
        <section>
          <h3>Materiales solicitados</h3>
          <div className="scroll">
            <table>
              <thead><tr><th>SKU</th><th>Material</th><th>Cantidad</th><th>Lote</th><th>Series</th></tr></thead>
              <tbody>
                {materiales.map((m, i) => (
                  <tr key={i}>
                    <td>{m.sku}</td>
                    <td>{m.material}</td>
                    <td>{m.cantidad}</td>
                    <td>{m.lote || '—'}</td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="green" disabled={busy || manual || !folio || !materiales.length} onClick={guardar}>Guardar Entrega</button>
          <button className="red" onClick={limpiar}>Limpiar</button>
        </section>
        {err && <p className="warn">{err}</p>}
        {ok && <p className="ok">{ok}</p>}
      </div>
      <style jsx>{css}</style>
    </main>
  )
}

const css = `.em{background:#03251e;color:white;min-height:100vh;padding:19px;font:13px Arial}.wrap{max-width:1050px;margin:auto}.em header{background:linear-gradient(120deg,#0a5746,#159f79);text-align:center}.em header,.em section{border:1px solid #346e61;border-radius:12px;padding:18px;margin:13px 0;background-color:#08342a}.em h1{margin:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.em label{display:inline-block;margin:8px;font-weight:bold}.em input{display:block;padding:11px;border:0;border-radius:8px;background:#f2f6f8;color:#123}.em button{background:#118f71;color:#fff;padding:11px;border:0;border-radius:9px;margin:7px;cursor:pointer}.em button:disabled{opacity:.5}.em .green{background:#12a45f}.em .red{background:#d33}.scroll{overflow:auto}.em table{width:100%;border-collapse:collapse;background:#f9faf9;color:#234}.em th{background:#067b56;color:white}.em th,.em td{padding:11px;border:1px solid #bdcec5}.warn{background:#ffe2e2;color:#9b1f1f;padding:12px;border-radius:9px}.ok{background:#d9ffe4;color:#075f37;padding:12px;border-radius:9px}@media(max-width:680px){.grid{grid-template-columns:1fr}}`
