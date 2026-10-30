
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })

const TIPOS = [
  'STOCK_TECNICOS',
  'STOCK_ALMACEN',
  'IQ09_EQUIPOS'
]

export async function POST(req: Request) {
  try {
    const {
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SUPABASE_SECRET_KEY: fallback
    } = process.env

    if (!url || !(key || fallback)) {
      return response({
        ok: false,
        error: 'SUPABASE_NO_CONFIGURADO'
      }, 503)
    }

    const data = await req.json()

    const centro = String(data.distrito || '')
      .trim()
      .toUpperCase()

    const token = String(data.token || '').trim()
    const tipo = String(data.tipo || '').trim().toUpperCase()
    const action = String(data.action || '').trim().toLowerCase()
    const lote = String(data.lote || '').trim()

    if (
      !/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro) ||
      !token ||
      !TIPOS.includes(tipo)
    ) {
      return response({
        ok: false,
        error: 'PARAMETROS_INVALIDOS'
      }, 400)
    }

    const db = createClient(url, key || fallback!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    // =========================================
    // DESCARGAR INVENTARIO DESDE SUPABASE
    // =========================================

    if (action === 'download') {

      const { data: out, error } = await db.rpc(
        'qiora_excel_inventario_descargar',
        {
          p_distrito: centro,
          p_token: token,
          p_tipo: tipo
        }
      )

      if (error) {
        console.error('ERROR DESCARGA INVENTARIO:', error)

        return response({
          ok: false,
          error: 'ERROR_DESCARGA_INVENTARIO',
          detalle: error.message
        }, 400)
      }

      return response({
        ok: true,
        distrito: centro,
        tipo,
        total: Array.isArray(out) ? out.length : 0,
        filas: out || []
      })
    }

    // =========================================
    // SUBIR LOTES A SUPABASE
    // =========================================

    if (!lote || lote.length > 180) {
      return response({
        ok: false,
        error: 'LOTE_INVALIDO'
      }, 400)
    }

    if (action === 'batch') {

      if (
        !Array.isArray(data.filas) ||
        data.filas.length < 1 ||
        data.filas.length > 150 ||
        !Number.isInteger(data.offset)
      ) {
        return response({
          ok: false,
          error: 'LOTE_INVALIDO'
        }, 400)
      }

      const { data: out, error } = await db.rpc(
        'qiora_excel_inventario_lote',
        {
          p_distrito: centro,
          p_token: token,
          p_tipo: tipo,
          p_lote: lote,
          p_offset: data.offset,
          p_filas: data.filas
        }
      )

      return error
        ? response({ ok: false, error: error.message }, 400)
        : response(out)
    }

    // =========================================
    // CONFIRMAR CARGA COMPLETA
    // =========================================

    if (action === 'commit') {

      if (
        !Number.isInteger(data.total) ||
        data.total < 1
      ) {
        return response({
          ok: false,
          error: 'TOTAL_INVALIDO'
        }, 400)
      }

      const { data: out, error } = await db.rpc(
        'qiora_excel_inventario_commit',
        {
          p_distrito: centro,
          p_token: token,
          p_tipo: tipo,
          p_lote: lote,
          p_total: data.total
        }
      )

      return error
        ? response({ ok: false, error: error.message }, 400)
        : response(out)
    }

    return response({
      ok: false,
      error: 'ACCION_INVALIDA'
    }, 400)

  } catch (e: unknown) {

    const mensaje = e instanceof Error
      ? e.message
      : String(e)

    console.error('QIORA INVENTARIOS:', mensaje)

    return response({
      ok: false,
      error: mensaje
    }, 500)
  }
}
