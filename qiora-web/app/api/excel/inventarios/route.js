
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ==========================================
// RESPUESTA JSON
// ==========================================

const response = (data, status = 200) => {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  })
}

// ==========================================
// INVENTARIOS PERMITIDOS
// ==========================================

const TIPOS = [
  'STOCK_TECNICOS',
  'STOCK_ALMACEN',
  'IQ09_EQUIPOS'
]

// ==========================================
// API PRINCIPAL
// ==========================================

export async function POST(req) {
  try {

    // 1. CONFIGURACION SUPABASE

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

    // 2. RECIBIR DATOS DE EXCEL

    const data = await req.json()

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return response({
        ok: false,
        error: 'JSON_INVALIDO'
      }, 400)
    }

    const centro = String(data.distrito || '')
      .trim()
      .toUpperCase()

    const token = String(data.token || '').trim()
    const tokenMaestro = String(data.token_maestro || '').trim()
    const modoEmergencia = tokenMaestro.length > 0

    const tipo = String(data.tipo || '')
      .trim()
      .toUpperCase()

    const accion = String(data.action || '')
      .trim()
      .toLowerCase()

    const lote = String(data.lote || '').trim()

    // 3. VALIDAR DISTRITO

    if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(centro)) {
      return response({
        ok: false,
        error: 'DISTRITO_INVALIDO'
      }, 400)
    }

    // 4. VALIDAR TOKEN INDIVIDUAL

    if (!modoEmergencia && (!token || token.length < 12)) {
      return response({
        ok: false,
        error: 'TOKEN_INVALIDO'
      }, 401)
    }

    // 5. VALIDAR INVENTARIO

    if (!TIPOS.includes(tipo)) {
      return response({
        ok: false,
        error: 'TIPO_INVALIDO'
      }, 400)
    }

    // 6. VALIDAR ACCION

    if (!['batch', 'commit'].includes(accion)) {
      return response({
        ok: false,
        error: 'ACCION_INVALIDA'
      }, 400)
    }

    // 7. VALIDAR LOTE

    if (!lote || lote.length < 8 || lote.length > 180) {
      return response({
        ok: false,
        error: 'LOTE_INVALIDO'
      }, 400)
    }

    // ========================================
    // CONEXION SUPABASE
    // ========================================

    const db = createClient(url, key || fallback, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    // ========================================
    // ACCION 1: RECIBIR LOTES
    // ========================================

    if (accion === 'batch') {

      if (
        !Array.isArray(data.filas) ||
        data.filas.length < 1 ||
        data.filas.length > 150 ||
        !Number.isInteger(data.offset) ||
        data.offset < 0
      ) {
        return response({
          ok: false,
          error: 'LOTE_INVALIDO'
        }, 400)
      }

      const {
        data: out,
        error
      } = await db.rpc(
        modoEmergencia ? 'qiora_macro_emergencia_inventario_lote' : 'qiora_excel_inventario_lote',
        modoEmergencia ? {
          p_token_hash: createHash('sha256').update(tokenMaestro, 'utf8').digest('hex'),
          p_distrito: centro,
          p_tipo: tipo,
          p_lote: lote,
          p_offset: data.offset,
          p_filas: data.filas
        } : {
          p_distrito: centro,
          p_token: token,
          p_tipo: tipo,
          p_lote: lote,
          p_offset: data.offset,
          p_filas: data.filas
        }
      )

      if (error) {
        console.error(
          'ERROR QIORA BATCH:',
          centro,
          tipo,
          error.message
        )

        return response({
          ok: false,
          error: error.message
        }, 400)
      }

      return response(out)
    }

    // ========================================
    // ACCION 2: CONFIRMAR INVENTARIO
    // ========================================

    if (accion === 'commit') {

      if (
        !Number.isInteger(data.total) ||
        data.total < 1
      ) {
        return response({
          ok: false,
          error: 'TOTAL_INVALIDO'
        }, 400)
      }

      const {
        data: out,
        error
      } = await db.rpc(
        modoEmergencia ? 'qiora_macro_emergencia_inventario_commit' : 'qiora_excel_inventario_commit_seguro',
        modoEmergencia ? {
          p_token_hash: createHash('sha256').update(tokenMaestro, 'utf8').digest('hex'),
          p_distrito: centro,
          p_tipo: tipo,
          p_lote: lote,
          p_total: data.total
        } : {
          p_distrito: centro,
          p_token: token,
          p_tipo: tipo,
          p_lote: lote,
          p_total: data.total
        }
      )

      if (error) {
        console.error(
          'ERROR QIORA COMMIT:',
          centro,
          tipo,
          error.message
        )

        return response({
          ok: false,
          error: error.message
        }, 400)
      }

      return response(out)
    }

    return response({
      ok: false,
      error: 'ACCION_INVALIDA'
    }, 400)

  } catch (e) {

    const mensaje = e && e.message
      ? e.message
      : String(e)

    console.error(
      'ERROR API EXCEL INVENTARIOS:',
      mensaje
    )

    return response({
      ok: false,
      error: mensaje
    }, 500)
  }
}
