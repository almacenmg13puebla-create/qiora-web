import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const S = v => String(v ?? '').trim()
const U = v => S(v).toUpperCase()
const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
})

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !anon || !service) throw new Error('SUPABASE_NO_CONFIGURADO')
  return {
    auth: createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  }
}

async function enviarTelegram(chatId, text) {
  const token = S(process.env.QIORA_BOT_TOKEN)
  if (!token) throw new Error('FALTA_QIORA_BOT_TOKEN_EN_VERCEL')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    cache: 'no-store'
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) throw new Error(data.description || `TELEGRAM_HTTP_${response.status}`)
}

export async function POST(req) {
  try {
    const bearer = S(req.headers.get('authorization')).replace(/^Bearer\s+/i, '')
    if (!bearer) return json({ ok: false, error: 'SESION_REQUERIDA' }, 401)
    const body = await req.json().catch(() => null)
    if (!body) return json({ ok: false, error: 'JSON_INVALIDO' }, 400)

    const folio = S(body.folio)
    const distrito = U(body.distrito)
    const almacen = S(body.almacen)
    const seriesPendientesSolicitadas = Array.isArray(body.series_pendientes) ? body.series_pendientes : []
    const mensajeSolicitado = S(body.mensaje)
    if (!folio || !/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !almacen) {
      return json({ ok: false, error: 'DATOS_RECOLECCION_INCOMPLETOS' }, 400)
    }

    const { auth, admin } = clients()
    const { data: authData, error: authError } = await auth.auth.getUser(bearer)
    if (authError || !authData?.user) return json({ ok: false, error: 'SESION_INVALIDA' }, 401)

    const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
      .select('id,distrito,activo,puesto')
      .eq('auth_user_id', authData.user.id).eq('activo', true).maybeSingle()
    if (actorError) throw new Error(actorError.message)
    if (!actor || U(actor.distrito) !== distrito) return json({ ok: false, error: 'USUARIO_NO_AUTORIZADO_PARA_DISTRITO' }, 403)

    const { data: rows, error: rowsError } = await admin.from('recolecciones_equipos')
      .select('id,folio,distrito,almacen,tecnico,recibe,serie,material,descripcion,estado')
      .eq('folio', folio).eq('distrito', distrito).eq('almacen', almacen)
    if (rowsError) throw new Error(rowsError.message)
    if (!rows?.length) return json({ ok: false, error: 'RECOLECCION_NO_ENCONTRADA' }, 404)

    const { data: usuarios, error: usersError } = await admin.from('almacen_usuarios')
      .select('usuario_almacen,nombre,puesto,distrito,telegram_chat_id,activo')
      .eq('distrito', distrito).eq('activo', true).eq('puesto', 'TECNICO')
      .eq('usuario_almacen', almacen)
    if (usersError) throw new Error(usersError.message)
    const tecnico = (usuarios || []).find(x => S(x.telegram_chat_id))
    if (!tecnico) return json({ ok: true, enviado: false, motivo: 'TECNICO_SIN_TELEGRAM_CHAT_ID' })

    // Acepta series pendientes como texto (formato enviado por page.js) o como objeto.
    const candidatas = [...new Set(seriesPendientesSolicitadas
      .map(x => S(typeof x === 'string' ? x : x?.serie))
      .filter(Boolean))]
    let pendientes = []
    if (candidatas.length) {
      const { data: iq09, error: iqError } = await admin.from('iq09_equipos')
        .select('serie,material,descripcion,almacen,distrito')
        .eq('distrito', distrito).eq('almacen', almacen).in('serie', candidatas)
      if (iqError) throw new Error('ERROR_VALIDANDO_SERIES_PENDIENTES: ' + iqError.message)
      const seriesRecibidasSet = new Set((rows || []).map(x => U(x.serie)))
      pendientes = (iq09 || []).filter(x => !seriesRecibidasSet.has(U(x.serie)))
    }

    const seriesRecibidas = rows.map(x => ({ serie: x.serie, material: x.material, descripcion: x.descripcion }))
    const lineas = [
      '✅ QIORA BOT – RECOLECCIÓN RECIBIDA', '',
      `Hola, ${tecnico.nombre || rows[0].tecnico || ''}.`, '',
      'Tu recolección fue recibida en el almacén.', '',
      `📋 Folio: ${folio}`,
      `🏢 Distrito: ${distrito}`,
      `🏬 Almacén: ${almacen}`,
      `👷 Técnico: ${rows[0].tecnico || tecnico.nombre || ''}`,
      `👤 Recibió: ${rows[0].recibe || ''}`,
      `📅 Fecha y hora: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
      '',
      `📦 Equipos recibidos: ${seriesRecibidas.length}`
    ]
    for (const x of seriesRecibidas) lineas.push(`• Serie: ${x.serie || ''}`, `  Material: ${x.material || 'NO REGISTRADO'}`)
    lineas.push('')
    if (pendientes.length) {
      lineas.push(`⚠️ EQUIPOS PENDIENTES POR ENTREGAR: ${pendientes.length}`, '', 'SERIES:')
      for (const x of pendientes) lineas.push(S(x.serie))
      lineas.push('', '*FAVOR DE ENTREGAR A ALMACÉN*')
    } else {
      lineas.push('⚠️ EQUIPOS PENDIENTES POR ENTREGAR: 0', '✅ TODAS LAS SERIES DEL INVENTARIO CONSULTADO FUERON RECIBIDAS.')
    }
    lineas.push('', '📌 Estado: RECEPCIÓN GUARDADA', '', '🤖 QIORA BOT')

    // Se prioriza el texto construido por page.js para que WhatsApp y Telegram sean idénticos.
    const mensaje = (mensajeSolicitado || lineas.join('\n')).slice(0, 3900)

    const { data: existente, error: checkError } = await admin.from('qiora_recolecciones_telegram_envios')
      .select('id,estado').eq('folio', folio).eq('documento_sap', 'PENDIENTE_GUARDADO')
      .eq('telegram_chat_id', S(tecnico.telegram_chat_id)).maybeSingle()
    if (checkError) throw new Error(checkError.message)
    if (existente?.estado === 'ENVIADO') return json({ ok: true, enviado: false, duplicado: true, mensaje })

    let controlId = existente?.id
    if (!controlId) {
      const { data: control, error: insertError } = await admin.from('qiora_recolecciones_telegram_envios')
        .insert({ folio, distrito, documento_sap: 'PENDIENTE_GUARDADO', telegram_chat_id: S(tecnico.telegram_chat_id), usuario_almacen: tecnico.usuario_almacen, nombre_destinatario: tecnico.nombre, estado: 'PENDIENTE' })
        .select('id').single()
      if (insertError) {
        if (insertError.code === '23505') return json({ ok: true, enviado: false, duplicado: true })
        throw new Error(insertError.message)
      }
      controlId = control.id
    }

    try {
      await enviarTelegram(tecnico.telegram_chat_id, mensaje)
      const { error: markError } = await admin.from('qiora_recolecciones_telegram_envios')
        .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString(), error: null }).eq('id', controlId)
      if (markError) throw new Error(markError.message)
    } catch (e) {
      await admin.from('qiora_recolecciones_telegram_envios').update({ estado: 'ERROR', error: S(e.message).slice(0, 1000) }).eq('id', controlId)
      throw e
    }
    return json({ ok: true, enviado: true, destinatario: tecnico.nombre, series_recibidas: seriesRecibidas.length, pendientes: pendientes.length, mensaje })
  } catch (e) {
    console.error('[QIORA RECEPCION TELEGRAM GUARDADA]', e?.message || e)
    return json({ ok: false, error: S(e?.message || e) }, 500)
  }
}
