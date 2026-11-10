import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = value => String(value ?? '').trim()
const U = value => S(value).toUpperCase()
const json = (data, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'no-store' }
})

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw Object.assign(new Error('SUPABASE_NO_CONFIGURADO'), { status: 503 })
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

async function validateToken(db, token) {
  if (!token || token.length < 24 || token.length > 256) return false
  const { data, error } = await db.from('qiora_macro_emergencia_token')
    .select('token_hash').eq('singleton', true).eq('activo', true).maybeSingle()
  if (error) throw error
  if (!data?.token_hash) return false
  return hashToken(token) === data.token_hash
}

export async function POST(request) {
  try {
    const db = getAdmin()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'JSON_INVALIDO' }, 400)
    const token = S(body.token_maestro)
    if (!(await validateToken(db, token))) return json({ ok: false, error: 'TOKEN_MAESTRO_INVALIDO' }, 401)
    const action = U(body.action)

    if (action === 'CONFIG_TSV') {
      const { data: enabled, error: enabledError } = await db.from('qiora_macro_emergencia_distritos')
        .select('centro').eq('autorizado', true)
      if (enabledError) throw enabledError
      const centers = (enabled || []).map(x => U(x.centro))
      let districts = []
      let permissions = []
      if (centers.length) {
        const [d, p] = await Promise.all([
          db.from('qiora_distritos').select('centro,nombre_region,activo').in('centro', centers).eq('activo', true).order('centro'),
          db.from('qiora_macro_emergencia_permisos').select('centro,proceso,nivel,requiere_aprobacion').in('centro', centers)
        ])
        if (d.error) throw d.error
        if (p.error) throw p.error
        districts = d.data || []
        permissions = p.data || []
      }
      const lines = ['DISTRITO\tREGION\tPROCESO\tNIVEL\tREQUIERE_APROBACION']
      for (const district of districts) {
        const rows = permissions.filter(p => p.centro === district.centro && p.nivel !== 'BLOQUEADO')
        if (!rows.length) lines.push([district.centro, district.nombre_region || '', '', 'BLOQUEADO', 'NO'].join('\t'))
        for (const p of rows) lines.push([district.centro, district.nombre_region || '', p.proceso, p.nivel, p.requiere_aprobacion ? 'SI' : 'NO'].join('\t'))
      }
      return new NextResponse(lines.join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      })
    }

    if (action === 'CONFIG') {
      const { data, error } = await db.from('qiora_macro_emergencia_distritos')
        .select('centro,autorizado').eq('autorizado', true)
      if (error) throw error
      const enabled = (data || []).map(x => U(x.centro))
      if (!enabled.length) return json({ ok: true, distritos: [] })
      const [{ data: districts, error: districtError }, { data: permissions, error: permissionError }] = await Promise.all([
        db.from('qiora_distritos').select('centro,nombre_region,activo').in('centro', enabled).eq('activo', true).order('centro'),
        db.from('qiora_macro_emergencia_permisos').select('centro,proceso,nivel,requiere_aprobacion').in('centro', enabled)
      ])
      if (districtError) throw districtError
      if (permissionError) throw permissionError
      return json({ ok: true, distritos: (districts || []).map(d => ({
        ...d,
        procesos: (permissions || []).filter(p => p.centro === d.centro && p.nivel !== 'BLOQUEADO')
      })) })
    }

    if (action === 'AUTORIZAR') {
      const distrito = U(body.distrito)
      const proceso = U(body.proceso)
      const operacion = U(body.operacion || 'CONSULTAR')
      if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito)) return json({ ok: false, error: 'DISTRITO_INVALIDO' }, 400)
      const { data, error } = await db.rpc('qiora_macro_emergencia_autorizar_hash', {
        p_token_hash: hashToken(token), p_distrito: distrito, p_proceso: proceso, p_operacion: operacion
      })
      if (error) throw error
      return json(data || { ok: false, permitido: false, error: 'SIN_RESPUESTA_AUTORIZACION' }, data?.permitido ? 200 : 403)
    }

    if (action === 'REGISTRAR') {
      const distrito = U(body.distrito)
      const proceso = U(body.proceso)
      const operacion = U(body.operacion || 'CONSULTAR')
      const estado = U(body.estado || 'INICIADO')
      const allowedStates = ['INICIADO','PREPARADO','EN_APROBACION','REALIZADO','ERROR','CANCELADO']
      if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !proceso || !allowedStates.includes(estado)) {
        return json({ ok: false, error: 'PARAMETROS_INVALIDOS' }, 400)
      }
      const permiso = await db.rpc('qiora_macro_emergencia_autorizar_hash', {
        p_token_hash: hashToken(token), p_distrito: distrito, p_proceso: proceso, p_operacion: operacion
      })
      if (permiso.error) throw permiso.error
      if (permiso.data?.permitido !== true && estado !== 'ERROR') {
        return json({ ok: false, error: permiso.data?.error || 'OPERACION_NO_AUTORIZADA' }, 403)
      }
      const row = {
        ejecucion_id: S(body.ejecucion_id), distrito, proceso, operacion, estado,
        pc: S(body.pc).slice(0, 120), usuario_excel: S(body.usuario).slice(0, 120),
        registros_descargados: Number.isInteger(body.registros_descargados) ? body.registros_descargados : null,
        registros_cargados: Number.isInteger(body.registros_cargados) ? body.registros_cargados : null,
        documento_sap: S(body.documento_sap).slice(0, 80) || null,
        mensaje: S(body.mensaje).slice(0, 2000) || null,
        finalizado_en: ['REALIZADO','ERROR','CANCELADO'].includes(estado) ? new Date().toISOString() : null,
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}
      }
      if (!row.ejecucion_id) return json({ ok: false, error: 'EJECUCION_ID_REQUERIDO' }, 400)
      const { data, error } = await db.from('qiora_macro_emergencia_ejecuciones').upsert(row, {
        onConflict: 'ejecucion_id,distrito,proceso'
      }).select('id,estado,iniciado_en,finalizado_en').single()
      if (error) throw error
      return json({ ok: true, ejecucion: data })
    }

    return json({ ok: false, error: 'ACCION_INVALIDA' }, 400)
  } catch (error) {
    console.error('[QIORA EXCEL EMERGENCIA]', error)
    return json({ ok: false, error: S(error?.message) || 'ERROR_INTERNO' }, Number(error?.status) || 500)
  }
}
