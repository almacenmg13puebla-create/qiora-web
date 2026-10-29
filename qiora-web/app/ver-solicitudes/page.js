'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function VerSolicitudes() {
  const router = useRouter()

  const [folio, setFolio] = useState('')
  const [almacen, setAlmacen] = useState('')
  const [estatus, setEstatus] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filas, setFilas] = useState([])
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState(null)
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async (limpiarFiltros = false) => {
    setBusy(true)
    setError('')

    try {
      const { data, error: consultaError } =
        await supabase.rpc('qiora_material_listar', {
          p_folio: limpiarFiltros ? '' : folio.trim(),
          p_almacen: limpiarFiltros ? '' : almacen.trim(),
          p_estatus: limpiarFiltros ? '' : estatus,
          p_desde: limpiarFiltros || !desde ? null : desde,
          p_hasta: limpiarFiltros || !hasta ? null : hasta,
        })

      if (consultaError) throw consultaError

      setFilas(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message || 'No fue posible consultar las solicitudes.')
      setFilas([])
    } finally {
      setBusy(false)
    }
  }, [folio, almacen, estatus, desde, hasta])

  useEffect(() => {
    cargar(true)
  }, [cargar])

  function limpiar() {
    setFolio('')
    setAlmacen('')
    setEstatus('')
    setDesde('')
    setHasta('')
    setDetalle(null)
    cargar(true)
  }

  return (
    <main className="vs">
      <div className="wrap">
        <button
          type="button"
          className="back"
          onClick={() => router.push('/')}
        >
          ← Regresar al menú
        </button>

        <header>
          <h1>Ver Solicitudes</h1>
          <p>
            Consulta solicitudes por almacén, folio, estatus y rango de fechas.
          </p>
        </header>

        <div className="acciones-principales">
          <button
            type="button"
            onClick={() => router.push('/entrega-material')}
          >
            Entrega de material
          </button>
        </div>

        {error && (
          <div className="warn" role="alert">
            {error}
          </div>
        )}

        <section>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              cargar(false)
            }}
          >
            <div className="filters">
              <label>
                Folio (opcional)
                <input
                  value={folio}
                  onChange={(e) => setFolio(e.target.value)}
                  placeholder="Folio de solicitud"
                />
              </label>

              <label>
                Almacén (opcional)
                <input
                  value={almacen}
                  onChange={(e) =>
                    setAlmacen(
                      e.target.value.replace(/\D/g, '').slice(0, 4)
                    )
                  }
                  placeholder="0008"
                  maxLength={4}
                />
              </label>

              <label>
                Estatus
                <select
                  value={estatus}
                  onChange={(e) => setEstatus(e.target.value)}
                >
                  <option value="">Todos los estatus</option>
                  {[
                    'PENDIENTE',
                    'EN_PREPARACION',
                    'EN_PROCESO_SAP',
                    'ENTREGADO',
                    'CANCELADO',
                  ].map((opcion) => (
                    <option key={opcion} value={opcion}>
                      {opcion}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Fecha inicial
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </label>

              <label>
                Fecha final
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </label>
            </div>

            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? 'Buscando...' : 'Buscar'}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => cargar(true)}
              >
                Ver todo
              </button>

              <button
                type="button"
                className="red"
                disabled={busy}
                onClick={limpiar}
              >
                Limpiar
              </button>
            </div>
          </form>
        </section>

        <section>
          <h2>Total solicitudes: {filas.length}</h2>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {[
                    'Folio',
                    'Fecha',
                    'Técnico',
                    'Almacén',
                    'Fecha de retiro',
                    'Cantidad total',
                    'Estatus',
                    'Acción',
                  ].map((titulo) => (
                    <th key={titulo}>{titulo}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filas.length ? (
                  filas.map((fila, index) => (
                    <tr key={fila.folio || index}>
                      <td>{fila.folio || '—'}</td>
                      <td>
                        {fila.fecha
                          ? new Date(fila.fecha).toLocaleString('es-MX')
                          : '—'}
                      </td>
                      <td>{fila.tecnico || '—'}</td>
                      <td>{fila.almacen || '—'}</td>
                      <td>{fila.fecha_retiro || '—'}</td>
                      <td>{fila.cantidad_total ?? 0}</td>
                      <td>{fila.estatus || '—'}</td>
                      <td className="rowActions">
                        <button
                          type="button"
                          onClick={() => setDetalle(fila)}
                        >
                          Ver todo
                        </button>

                        <button
                          type="button"
                          disabled={
                            !['PENDIENTE', 'EN_PREPARACION'].includes(
                              String(fila.estatus || '').toUpperCase()
                            )
                          }
                          onClick={() =>
                            router.push(
                              '/entrega-material?folio=' +
                              encodeURIComponent(fila.folio)
                            )
                          }
                        >
                          Entregar
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="empty">
                      {busy ? 'Consultando solicitudes...' : 'Sin resultados.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {detalle && (
          <section>
            <button
              type="button"
              onClick={() => setDetalle(null)}
            >
              Cerrar detalle
            </button>

            <h2>
              {detalle.folio} — {detalle.tecnico}
            </h2>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Material</th>
                    <th>Cantidad</th>
                    <th>Lote asignado</th>
                  </tr>
                </thead>

                <tbody>
                  {(Array.isArray(detalle.materiales)
                    ? detalle.materiales
                    : []
                  ).map((material, index) => (
                    <tr key={index}>
                      <td>{material.sku || '—'}</td>
                      <td>{material.material || '—'}</td>
                      <td>{material.cantidad ?? 0}</td>
                      <td>{material.lote || '—'}</td>
                    </tr>
                  ))}

                  {(!Array.isArray(detalle.materiales) ||
                    detalle.materiales.length === 0) && (
                    <tr>
                      <td colSpan={4} className="empty">
                        No hay detalle de materiales disponible.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <style jsx>{css}</style>
    </main>
  )
}

const css = `
  .vs {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 20px;
    background: #03251d;
    color: #fff;
    font: 13px Arial, sans-serif;
  }

  .wrap {
    max-width: 1200px;
    margin: 0 auto;
  }

  .vs header {
    text-align: center;
    background: linear-gradient(120deg, #08523d, #17a47c);
  }

  .vs header,
  .vs section {
    border: 1px solid #346c5a;
    border-radius: 12px;
    padding: 17px;
    margin: 12px 0;
    background-color: #09332a;
  }

  .vs header h1 {
    margin: 0 0 7px;
  }

  .vs header p {
    margin: 0;
  }

  .filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .vs label {
    display: block;
    font-weight: bold;
  }

  .vs input,
  .vs select {
    display: block;
    box-sizing: border-box;
    width: 100%;
    background: #f6f7f9;
    color: #123;
    border: 0;
    border-radius: 8px;
    padding: 11px;
    margin-top: 5px;
  }

  .vs button {
    background: #0e9570;
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 9px 13px;
    margin: 3px;
    cursor: pointer;
    font-weight: 700;
  }

  .vs button:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  .vs .back {
    margin-bottom: 10px;
  }

  .acciones-principales {
    display: flex;
    justify-content: flex-end;
    margin: 12px 0;
  }

  .acciones-principales button {
    min-width: 190px;
    padding: 12px 18px;
    background: #19a77c;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 12px;
  }

  .vs button.red {
    background: #cb2e37;
  }

  .scroll {
    overflow: auto;
    width: 100%;
  }

  .vs table {
    width: 100%;
    border-collapse: collapse;
    background: #f8faf9;
    color: #234;
  }

  .vs td,
  .vs th {
    padding: 9px;
    border: 1px solid #becfc8;
    text-align: left;
    white-space: nowrap;
  }

  .vs th {
    background: #047854;
    color: #fff;
  }

  .rowActions {
    display: flex;
    gap: 4px;
  }

  .empty {
    text-align: center;
    padding: 20px !important;
  }

  .warn {
    margin: 12px 0;
    padding: 12px;
    border-radius: 8px;
    background: #ffe0e0;
    color: #8e2525;
  }

  @media (max-width: 700px) {
    .filters {
      grid-template-columns: 1fr;
    }

    .vs {
      padding: 10px;
    }
  }
`
