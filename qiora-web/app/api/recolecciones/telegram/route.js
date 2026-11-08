import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()
const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
})

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_NO_CONFIGURADO')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function normalizarAlmacen(v) {
  const s = clean(v)
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : upper(s)
}

function fechaMexico(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return clean(v) || 'NO REGISTRADA'
  return d.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}

function crearMensaje(r, destinatario) {
  const series = Array.isArray(r.series) ? r.series : []
  const lineas = [
    '✅ QIORA BOT - RECEPCIÓN DE RECOLECCIONES', '',
    `Hola ${destinatario.nombre || 'usuario'},`,
    'La recepción de tu recolección quedó registrada correctamente.', '',
    `📋 Folio: ${clean(r.folio)}`,
    `🏢 Distrito: ${upper(r.distrito)}`,
    `🏬 Almacén: ${clean(r.almacen)}`,
    `👷 Técnico: ${clean(r.tecnico)}`,
    `👤 Recibió: ${clean(r.recibe)}`,
    `📅 Fecha y hora: ${fechaMexico(r.fecha)}`,
    '', `📦 EQUIPOS RECIBIDOS (${series.length})`
  ]
  for (const s of series) {
    lineas.push(
      `• Serie: ${clean(s.serie) || 'NO REGISTRADA'}`,
      `  Material: ${clean(s.material) || 'NO REGISTRADO'}`,
      `  Descripción: ${clean(s.descripcion) || 'NO REGISTRADA'}`
    )
  }
  lineas.push('', '✅ Estado: RECEPCIÓN GUARDADA', '🤖 QIORA BOT')
  return lineas.join('\n').slice(0, 3900)
}

async function enviarTelegram(token, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) {
    throw new Error(data.description || `TELEGRAM_HTTP_${response.status}`)
  }
  return data.result?.message_id || null
}

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const tokenBot = clean(process.env.QIORA_BOT_TOKEN)
    if (!url || !anon || !tokenBot) return json({ ok: false, error: 'FALTAN_VARIABLES_SUPABASE_O_QIORA_BOT_TOKEN' }, 503)

    const jwt = clean(request.headers.get('authorization')).replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ ok: false, error: 'SESION_REQUERIDA' }, 401)

    let body
    try { body = await request.json() } catch { return json({ ok: false, error: 'JSON_INVALIDO' }, 400) }

    const folio = clean(body.folio)
    const distrito = upper(body.distrito)
    const almacen = clean(body.almacen)
    const tecnico = clean(body.tecnico)
    const recibe = clean(body.recibe)
    const series = Array.isArray(body.series) ? body.series : []
    if (!folio || !/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !almacen || !tecnico || !recibe || !series.length) {
      return json({ ok: false, error: 'DATOS_RECOLECCION_INCOMPLETOS' }, 400)
    }

    const publicDb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await publicDb.auth.getUser(jwt)
    if (authError || !auth?.user?.id) return json({ ok: false, error: 'SESION_INVALIDA' }, 401)

    const admin = adminClient()
    const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,distrito,puesto,activo,telegram_chat_id')
      .eq('auth_user_id', auth.user.id).eq('activo', true).limit(1).maybeSingle()
    if (actorError) throw actorError
    if (!actor) return json({ ok: false, error: 'PERFIL_ACTIVO_NO_ENCONTRADO' }, 403)
    if (upper(actor.distrito) !== distrito) return json({ ok: false, error: 'DISTRITO_NO_AUTORIZADO' }, 403)

    const { data: tecnicos, error: tecnicoError } = await admin.from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,distrito,puesto,activo,telegram_chat_id')
      .eq('distrito', distrito).eq('activo', true).eq('puesto', 'TECNICO')
    if (tecnicoError) throw tecnicoError
    const tecnicoNormalizado = upper(tecnico).replace(/\s+/g, ' ')
    const tecnicoDb = (tecnicos || []).find(x =>
      normalizarAlmacen(x.usuario_almacen) === normalizarAlmacen(almacen)
    ) || (tecnicos || []).find(x =>
      upper(x.nombre).replace(/\s+/g, ' ') === tecnicoNormalizado
    )

    const destinatarios = [
      tecnicoDb ? { ...tecnicoDb, rol: 'TECNICO' } : null,
      { ...actor, rol: 'RECIBIO' }
    ].filter(x => x && clean(x.telegram_chat_id))
    const unicos = [...new Map(destinatarios.map(x => [clean(x.telegram_chat_id), x])).values()]
    if (!unicos.length) {
      return json({ ok: true, enviados: 0, sin_telegram: true, mensaje: 'La recepción se guardó, pero ningún destinatario tiene Telegram vinculado.' })
    }

    const fecha = clean(body.fecha) || new Date().toISOString()
    const resultado = []
    for (const destinatario of unicos) {
      const chatId = clean(destinatario.telegram_chat_id)
      const { data: existente, error: consultaError } = await admin.from('qiora_recolecciones_telegram_avisos')
        .select('id,estado').eq('folio', folio).eq('telegram_chat_id', chatId).maybeSingle()
      if (consultaError) throw consultaError
      if (existente?.estado === 'ENVIADO') {
        resultado.push({ chat_id: chatId, estado: 'YA_ENVIADO' })
        continue
      }

      let avisoId = existente?.id
      if (!avisoId) {
        const { data: nuevo, error: insertError } = await admin.from('qiora_recolecciones_telegram_avisos')
          .insert({ folio, distrito, telegram_chat_id: chatId, usuario_almacen: destinatario.usuario_almacen || null, nombre: destinatario.nombre || null, estado: 'PENDIENTE' })
          .select('id').single()
        if (insertError) {
          if (insertError.code === '23505') {
            resultado.push({ chat_id: chatId, estado: 'EN_COLA' })
            continue
          }
          throw insertError
        }
        avisoId = nuevo.id
      }

      try {
        const texto = crearMensaje({ folio, distrito, almacen, tecnico, recibe, fecha, series }, destinatario)
        const messageId = await enviarTelegram(tokenBot, chatId, texto)
        const { error: updateError } = await admin.from('qiora_recolecciones_telegram_avisos')
          .update({ estado: 'ENVIADO', telegram_message_id: messageId ? String(messageId) : null, enviado_en: new Date().toISOString(), error: null })
          .eq('id', avisoId)
        if (updateError) throw updateError
        resultado.push({ chat_id: chatId, estado: 'ENVIADO' })
      } catch (sendError) {
        await admin.from('qiora_recolecciones_telegram_avisos')
          .update({ estado: 'ERROR', error: clean(sendError.message).slice(0, 1000) })
          .eq('id', avisoId)
        resultado.push({ chat_id: chatId, estado: 'ERROR', error: clean(sendError.message) })
      }
    }

    return json({ ok: true, folio, enviados: resultado.filter(x => x.estado === 'ENVIADO').length, destinatarios: resultado })
  } catch (error) {
    console.error('[QIORA RECEPCION TELEGRAM]', error?.message || error)
    return json({ ok: false, error: error?.message || 'ERROR_INTERNO' }, 500)
  }
}
