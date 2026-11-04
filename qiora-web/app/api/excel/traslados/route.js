import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()

const out = (v, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

async function validarExcel(db, distrito, token) {
  const { data, error } = await db.rpc('qiora_excel_validar_credencial', {
    p_distrito: distrito,
    p_token: token
  })
  if (error || data !== true) throw new Error('TOKEN_INVALIDO')
}

function normalizarFila(x, distrito) {
  const documento = S(x.documentoTraspaso || x.documento_traspaso)
  if (!/^\d{8,12}$/.test(documento)) {
    throw new Error('DOCUMENTO_SAP_INVALIDO: ' + documento)
  }
  return {
    distrito,
    centro: U(x.centro || distrito),
    almacen: S(x.almacen),
    documento_traspaso: documento,
    fecha: S(x.fecha),
    movimiento: S(x.movimiento),
    centro_receptor: U(x.centroReceptor || x.centro_receptor || distrito),
    almacen_receptor: S(x.almacenReceptor || x.almacen_receptor),
    documento_receptor: S(x.documentoReceptor || x.documento_receptor) || null,
    fecha_receptor: S(x.fechaReceptor || x.fecha_receptor) || null,
    movimiento_receptor: S(x.movimientoReceptor || x.movimiento_receptor) || null,
    status_sap: S(x.status || x.status_sap),
    dias: Number(String(x.dias || 0).replace(',', '.')) || 0,
    raw_sap: x,
    actualizado_en: new Date().toISOString()
  }
}

function pendientes(rows) {
  return rows.filter(x =>
    !x.documento_receptor &&
    !['CERRADO', 'REALIZADO', 'RECIBIDO', 'ENTRADA', 'ENTRADA REALIZADA', 'FINALIZADO'].includes(U(x.status_sap))
  )
}

function textoReporte(distrito, rows) {
  const ps = pendientes(rows)
  const lines = [
    '📥 TRASPASOS PENDIENTES POR ENTRADA',
    '',
    `🏢 Distrito: ${distrito}`,
    `📊 Total: ${ps.length}`,
    '',
    ...ps.map((x, i) => [
      `${i + 1}) 📄 Documento: ${x.documento_traspaso}`,
      `📅 Fecha: ${x.fecha || 'NO REGISTRADA'}`,
      `🔄 Movimiento: ${x.movimiento || 'NO REGISTRADO'}`,
      '⬅️ ORIGEN',
      `👤 Nombre: ${x.almacen || 'NO REGISTRADO'}`,
      `🏢 Almacén: ${x.almacen || 'NO REGISTRADO'}`,
      '➡️ DESTINO',
      `👤 Nombre: ${x.almacen_receptor || 'NO REGISTRADO'}`,
      `🏢 Almacén: ${x.almacen_receptor || 'NO REGISTRADO'}`,
      '🟡 PENDIENTE DE ENTRADA'
    ].join('\n'))
  ]
  return { total: ps.length, mensaje: lines.join('\n\n'), pendientes: ps }
}

export async function POST(req) {
  try {
    const d = await req.json()
    const distrito = U(d.distrito || d.centro)
    const token = S(d.token)

    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !token) {
      return out({ ok: false, error: 'DISTRITO_O_TOKEN_INVALIDO' }, 400)
    }

    const db = dbAdmin()
    await validarExcel(db, distrito, token)

    if (U(d.action) === 'SUBIR_TRASLADOS_SAP') {
      if (!Array.isArray(d.filas) || d.filas.length > 10000) {
        return out({ ok: false, error: 'FILAS_INVALIDAS' }, 400)
      }

      const rows = d.filas.map(x => normalizarFila(x, distrito))
      if (rows.length) {
        const { error } = await db.from('qiora_traslados_sap').upsert(rows, {
          onConflict: 'distrito,documento_traspaso'
        })
        if (error) throw error
      }

      const { data: all, error: readError } = await db
        .from('qiora_traslados_sap')
        .select('*')
        .eq('distrito', distrito)
        .order('fecha', { ascending: true })
      if (readError) throw readError

      const reporte = textoReporte(distrito, all || [])
      const { error: avisoError } = await db.from('qiora_avisos_traslados').insert({
        distrito,
        tipo: 'REPORTE_PENDIENTES',
        total_pendientes: reporte.total,
        mensaje: reporte.mensaje,
        estado: 'PENDIENTE',
        origen_comando: S(d.comandoId),
        creado_en: new Date().toISOString()
      })
      if (avisoError) throw avisoError

      return out({
        ok: true,
        distrito,
        recibidos: rows.length,
        total_pendientes: reporte.total,
        mensaje: 'Traslados SAP guardados en Supabase; reporte preparado.'
      })
    }

    return out({ ok: false, error: 'ACCION_INVALIDA' }, 400)
  } catch (e) {
    console.error('[EXCEL TRASLADOS]', e)
    const msg = S(e.message || e)
    return out({ ok: false, error: msg }, msg === 'TOKEN_INVALIDO' ? 403 : 500)
  }
}
