import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const response = (body, status = 200, contentType = 'application/json; charset=utf-8') =>
  new NextResponse(body, { status, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } })
const S = v => String(v ?? '')
const U = v => S(v).trim().toUpperCase()

function tsv(v) {
  return S(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

export async function POST(req) {
  try {
    const body = await req.json()
    const distrito = U(body.distrito || body.centro)
    const token = S(body.token).trim()
    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !token) {
      return response(JSON.stringify({ ok: false, error: 'DISTRITO_O_TOKEN_INVALIDO' }), 400)
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
    if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: valid, error: authError } = await db.rpc('qiora_excel_validar_credencial', {
      p_distrito: distrito,
      p_token: token
    })
    if (authError || valid !== true) {
      return response(JSON.stringify({ ok: false, error: 'TOKEN_INVALIDO' }), 403)
    }

    if (U(body.action) !== 'DESCARGAR_RECOLECCIONES') {
      return response(JSON.stringify({ ok: false, error: 'ACCION_INVALIDA' }), 400)
    }

    const headers = [
      'ID', 'FOLIO', 'FECHA', 'DISTRITO', 'ALMACEN', 'TECNICO', 'RECIBE',
      'TELEFONO', 'SERIE', 'MATERIAL', 'DESCRIPCION', 'LOTE', 'TP_STOCKS',
      'DIAS_EN_CAJUELA', 'ESTADO', 'ACTUALIZADO_EN'
    ]
    const all = []
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from('recolecciones_equipos')
        .select('id,folio,fecha,distrito,almacen,tecnico,recibe,telefono,serie,material,descripcion,lote,tp_stocks,dias_en_cajuela,estado,actualizado_en')
        .eq('distrito', distrito)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw error
      all.push(...(data || []))
      if (!data || data.length < pageSize) break
    }

    const lines = [headers.join('\t')]
    for (const row of all) {
      lines.push(headers.map(h => tsv(row[h.toLowerCase()])).join('\t'))
    }
    return response('\uFEFF' + lines.join('\r\n'), 200, 'text/tab-separated-values; charset=utf-8')
  } catch (e) {
    console.error('[EXCEL RECOLECCIONES]', e)
    return response(JSON.stringify({ ok: false, error: S(e?.message || e) }), 500)
  }
}
