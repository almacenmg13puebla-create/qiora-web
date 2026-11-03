import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'recus-tp-acuses'
const answer = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const text = v => String(v ?? '').trim()
const norm = v => text(v).toUpperCase()
const numeric = v => Number(v)
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
const toMessage = e => e?.message || 'Error inesperado.'

async function getContext(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return { problem: answer({ ok: false, error: 'Faltan variables de Supabase en Vercel.' }, 503) }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { problem: answer({ ok: false, error: 'Debes iniciar sesión.' }, 401) }
  const authDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error: authError } = await authDb.auth.getUser(token)
  if (authError || !auth?.user?.id) return { problem: answer({ ok: false, error: 'Sesión inválida o vencida.' }, 401) }
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error } = await db.from('almacen_usuarios')
    .select('auth_user_id,usuario_almacen,distrito,puesto,activo,recolecciones')
    .eq('auth_user_id', auth.user.id).maybeSingle()
  if (error || !actor || actor.activo !== true) return { problem: answer({ ok: false, error: 'No se encontró un perfil activo.' }, 403) }
  const admin = norm(actor.puesto) === 'ADMIN_PADRE'
  if (!admin && actor.recolecciones !== true) return { problem: answer({ ok: false, error: 'Tu usuario no tiene permiso para Recolecciones.' }, 403) }
  const distrito = norm(actor.distrito)
  if (!distrito && !admin) return { problem: answer({ ok: false, error: 'Tu usuario no tiene distrito asignado.' }, 403) }
  return { db, actor, distrito, admin, userId: auth.user.id }
}

async function list(db, distrito, admin) {
  let query = db.from('recus_tp').select('id,distrito,pedido,salida,fecha,folio_entrada,cantidad,estatus,acuse_pdf_path,creado_en')
    .order('creado_en', { ascending: false }).limit(500)
  if (!admin) query = query.eq('distrito', distrito)
  const { data, error } = await query
  if (error) throw error
  const ids = (data || []).map(r => r.id)
  const seriesById = {}
  if (ids.length) {
    // Consultar en grupos para evitar URLs de consulta demasiado largas.
    for (let i = 0; i < ids.length; i += 100) {
      const { data: series, error: seriesError } = await db.from('recus_tp_series')
        .select('recu_tp_id,serie,sku,material,lote').in('recu_tp_id', ids.slice(i, i + 100)).order('id', { ascending: true })
      if (seriesError) throw seriesError
      for (const row of series || []) (seriesById[row.recu_tp_id] ||= []).push(row)
    }
  }
  const results = []
  for (const r of data || []) {
    let acuse_url = null
    if (r.acuse_pdf_path) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(r.acuse_pdf_path, 3600)
      acuse_url = signed?.signedUrl || null
    }
    results.push({ ...r, series: seriesById[r.id] || [], acuse_url })
  }
  return results
}

export async function GET(request) {
  const ctx = await getContext(request)
  if (ctx.problem) return ctx.problem
  try { return answer({ ok: true, registros: await list(ctx.db, ctx.distrito, ctx.admin) }) }
  catch (e) { return answer({ ok: false, error: `No se pudieron consultar RECUS TP: ${toMessage(e)}` }, 500) }
}

export async function POST(request) {
  const ctx = await getContext(request)
  if (ctx.problem) return ctx.problem
  let body
  try { body = await request.json() } catch { return answer({ ok: false, error: 'JSON no válido.' }, 400) }
  const pedido = text(body.pedido), salida = text(body.salida)
  const fecha = text(body.fecha), entrada = text(body.folio_entrada) || 'PENDIENTE'
  const cantidad = numeric(body.cantidad)
  const series = body.series
  if (!pedido || !salida || !isDate(fecha) || !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 5000)
    return answer({ ok: false, error: 'Captura pedido, salida SAP, fecha válida y cantidad de piezas (1 a 5000).' }, 400)
  if (!Array.isArray(series) || series.length !== cantidad)
    return answer({ ok: false, error: 'La cantidad de piezas debe coincidir con las filas del Excel.' }, 400)
  const clean = series.map(r => ({ serie: text(r.serie), sku: text(r.sku), material: text(r.material), lote: text(r.lote) }))
  if (clean.some(r => !r.serie)) return answer({ ok: false, error: 'Todas las filas del Excel deben tener número de serie.' }, 400)
  if (new Set(clean.map(r => norm(r.serie))).size !== clean.length)
    return answer({ ok: false, error: 'El Excel contiene series duplicadas.' }, 400)
  const distrito = ctx.admin ? norm(body.distrito) : ctx.distrito
  if (!distrito) return answer({ ok: false, error: 'Selecciona un distrito.' }, 400)
  // El perfil de ADMIN_PADRE puede operar cualquier distrito existente.
  if (ctx.admin) {
    const { data: target, error: dError } = await ctx.db.from('almacen_usuarios').select('distrito').eq('distrito', distrito).eq('activo', true).limit(1)
    if (dError || !target?.length) return answer({ ok: false, error: 'Distrito no encontrado entre los usuarios activos.' }, 400)
  }
  let createdId = null
  try {
    const { data: saved, error: saveError } = await ctx.db.from('recus_tp').insert({
      distrito, pedido, salida, fecha, folio_entrada: entrada, cantidad,
      estatus: norm(entrada) === 'PENDIENTE' ? 'PENDIENTE' : 'ENTREGADO', creado_por: ctx.userId
    }).select('id').single()
    if (saveError) throw saveError
    createdId = saved.id
    for (let i = 0; i < clean.length; i += 300) {
      const { error: seriesError } = await ctx.db.from('recus_tp_series').insert(
        clean.slice(i, i + 300).map(r => ({ recu_tp_id: createdId, ...r }))
      )
      if (seriesError) throw seriesError
    }
    return answer({ ok: true, id: createdId }, 201)
  } catch (e) {
    if (createdId !== null) {
      // Revertir solo este registro nuevo si la importación quedó incompleta.
      await ctx.db.from('recus_tp_series').delete().eq('recu_tp_id', createdId)
      await ctx.db.from('recus_tp').delete().eq('id', createdId)
    }
    return answer({ ok: false, error: `No se pudo guardar: ${toMessage(e)}` }, 500)
  }
}

export async function PATCH(request) {
  const ctx = await getContext(request)
  if (ctx.problem) return ctx.problem
  let form
  try { form = await request.formData() } catch { return answer({ ok: false, error: 'Formulario inválido.' }, 400) }
  const id = Number(form.get('id'))
  const entrada = text(form.get('folio_entrada'))
  const pdf = form.get('acuse')
  if (!Number.isSafeInteger(id) || id < 1 || !entrada || norm(entrada) === 'PENDIENTE')
    return answer({ ok: false, error: 'Selecciona el pedido y escribe un folio de entrada válido.' }, 400)
  let q = ctx.db.from('recus_tp').select('id,distrito,acuse_pdf_path').eq('id', id)
  if (!ctx.admin) q = q.eq('distrito', ctx.distrito)
  const { data: existing, error: lookupError } = await q.maybeSingle()
  if (lookupError || !existing) return answer({ ok: false, error: 'Registro no encontrado o sin permiso.' }, 404)
  let newPath = null
  if (pdf && typeof pdf.arrayBuffer === 'function' && pdf.size) {
    if (pdf.size > 10 * 1024 * 1024) return answer({ ok: false, error: 'El PDF excede 10 MB.' }, 400)
    const buffer = Buffer.from(await pdf.arrayBuffer())
    if (buffer.subarray(0, 5).toString() !== '%PDF-') return answer({ ok: false, error: 'El archivo debe ser un PDF válido.' }, 400)
    newPath = `${norm(existing.distrito)}/${id}/${randomUUID()}.pdf`
    const { error: uploadError } = await ctx.db.storage.from(BUCKET)
      .upload(newPath, buffer, { contentType: 'application/pdf', upsert: false })
    if (uploadError) return answer({ ok: false, error: `No se pudo subir el acuse PDF: ${uploadError.message}. Verifica el bucket privado ${BUCKET}.` }, 500)
  }
  let update = ctx.db.from('recus_tp').update({ folio_entrada: entrada, estatus: 'ENTREGADO', actualizado_en: new Date().toISOString(), ...(newPath ? { acuse_pdf_path: newPath } : {}) }).eq('id', id)
  if (!ctx.admin) update = update.eq('distrito', ctx.distrito)
  const { data: changed, error: updateError } = await update.select('id').maybeSingle()
  if (updateError || !changed) {
    if (newPath) await ctx.db.storage.from(BUCKET).remove([newPath])
    return answer({ ok: false, error: updateError?.message || 'No se pudo actualizar el folio.' }, 500)
  }
  return answer({ ok: true })
}
