import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TZ = 'America/Mexico_City'
const s = v => String(v ?? '').trim()
const upper = v => s(v).toUpperCase()

const out = (body, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })

function nowMexicoParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date())

  const get = type => parts.find(p => p.type === type)?.value || ''
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    weekday: weekdayMap[get('weekday')] || 0,
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  }
}

function scheduleSlot(now) {
  if (![1, 2, 3].includes(now.weekday)) return null
  if (![8, 12, 18].includes(now.hour)) return null
  // El trigger corre cada 5 minutos. Se acepta solo la ventana 00-04
  // para no mandar tarde ni repetir el mismo horario.
  if (now.minute > 4) return null
  return `${now.year}-${now.month}-${now.day}-${String(now.hour).padStart(2, '0')}:00`
}

function dateKey(now) {
  return `${now.year}-${now.month}-${now.day}`
}

function normalize(v) {
  return upper(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

function isoWeekAndYear(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const get = t => Number(parts.find(p => p.type === t)?.value)
  const localDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day')))
  const day = localDate.getUTCDay() || 7
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(localDate.getUTCFullYear(), 0, 1))
  return {
    year: localDate.getUTCFullYear(),
    week: Math.ceil((((localDate - yearStart) / 86400000) + 1) / 7)
  }
}

function createAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Variables Supabase incompletas.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function sendTelegram(chatId, message) {
  const token = s(process.env.QIORA_BOT_TOKEN)
  if (!token) throw new Error('Falta QIORA_BOT_TOKEN en Vercel.')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    }),
    cache: 'no-store'
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`)
}

async function registerAndSend(admin, { slot, chatId, kind, message }) {
  const destino = `${kind}:${chatId}`
  const { error: insertError } = await admin
    .from('qiora_kilometrajes_avisos')
    .insert({
      fecha_horario: slot,
      destino,
      telegram_chat_id: String(chatId),
      tipo_destino: kind,
      estado: 'ENVIANDO',
      mensaje: message
    })

  // La restricción única evita que dos ejecuciones manden el mismo aviso.
  if (insertError) {
    if (insertError.code === '23505') return { skipped: true }
    throw new Error(`No se pudo reservar aviso ${destino}: ${insertError.message}`)
  }

  try {
    await sendTelegram(chatId, message)
    await admin.from('qiora_kilometrajes_avisos')
      .update({ estado: 'ENVIADO', enviado_en: new Date().toISOString(), error: null })
      .eq('fecha_horario', slot)
      .eq('destino', destino)
    return { sent: true }
  } catch (e) {
    await admin.from('qiora_kilometrajes_avisos')
      .update({ estado: 'ERROR', error: s(e.message).slice(0, 500) })
      .eq('fecha_horario', slot)
      .eq('destino', destino)
    return { failed: true, error: e.message }
  }
}

function pendingLine(p) {
  const placa = s(p.placa) || 'SIN PLACA'
  const operador = s(p.empleado_asignado) || 'SIN OPERADOR'
  const ffm = s(p.usuario_ffm) || 'SIN FFM'
  return `• ${operador} — ${placa} — ${ffm}`
}

export async function GET(request) {
  try {
    const expected = s(process.env.QIORA_KM_REMINDERS_SECRET)
    const supplied = s(request.headers.get('x-qiora-reminders-secret'))
    if (!expected || supplied !== expected) return out({ ok: false, error: 'NO_AUTORIZADO' }, 401)

    const now = nowMexicoParts()
    const slot = scheduleSlot(now)
    if (!slot) return out({ ok: true, skipped: true, motivo: 'FUERA_DE_HORARIO', hora_mexico: now })

    const admin = createAdmin()
    const { year, week } = isoWeekAndYear()

    const { data: pendingRows, error: pendingError } = await admin
      .from('qiora_kilometrajes_pendientes')
      .select('id,anio,semana,distrito,placa,numero_unico,empleado_asignado,numero_empleado,usuario_ffm,sucursal,modelo')
      .eq('anio', year)
      .eq('semana', week)

    if (pendingError) throw new Error(`Vista de pendientes: ${pendingError.message}`)

    const { data: users, error: usersError } = await admin
      .from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,puesto,distrito,usuario_ffm,ffm,numero_empleado,numero_empleado_odoo,coordinador,telegram_chat_id,activo')
      .eq('activo', true)
      .not('telegram_chat_id', 'is', null)

    if (usersError) throw new Error(`Usuarios: ${usersError.message}`)

    const allPending = pendingRows || []
    const activeUsers = users || []
    const byDistrict = new Map()
    for (const row of allPending) {
      const district = upper(row.distrito)
      if (!district) continue // No asignar filas sin distrito a un distrito inventado.
      if (!byDistrict.has(district)) byDistrict.set(district, [])
      byDistrict.get(district).push(row)
    }

    let sent = 0
    let skipped = 0
    const errors = []
    const weekLabel = `${year} / semana ${week}`

    // 1) Mensaje privado a cada técnico con pendientes que coincidan por FFM,
    // número de empleado o nombre. Solo si la placa tiene distrito asignado.
    for (const [district, rows] of byDistrict.entries()) {
      const districtUsers = activeUsers.filter(u => upper(u.distrito) === district)
      for (const user of districtUsers) {
        if (upper(user.puesto) !== 'TECNICO' || !s(user.telegram_chat_id)) continue
        const ffm = normalize(user.usuario_ffm || user.ffm)
        const emp = normalize(user.numero_empleado || user.numero_empleado_odoo)
        const name = normalize(user.nombre)
        const mine = rows.filter(p =>
          (ffm && normalize(p.usuario_ffm) === ffm) ||
          (emp && normalize(p.numero_empleado) === emp) ||
          (name && normalize(p.empleado_asignado) === name)
        )
        if (!mine.length) continue

        const message = [
          '⏰ RECORDATORIO DE KILOMETRAJE',
          `Distrito: ${district}`,
          weekLabel,
          '',
          'Tienes vehículos pendientes de registrar:',
          ...mine.slice(0, 30).map(pendingLine),
          '',
          'Registra el kilometraje en el formulario de la semana actual.'
        ].join('\n')

        const result = await registerAndSend(admin, {
          slot, chatId: user.telegram_chat_id, kind: 'TECNICO', message
        })
        if (result.sent) sent++
        else if (result.skipped) skipped++
        else if (result.failed) errors.push(`${user.usuario_almacen}: ${result.error}`)
      }

      // 2) Coordinadores: todos los pendientes de sus técnicos asignados.
      for (const coordinator of districtUsers) {
        if (upper(coordinator.puesto) !== 'COORDINADOR' || !s(coordinator.telegram_chat_id)) continue
        const code = normalize(coordinator.usuario_almacen)
        const name = normalize(coordinator.nombre)
        const teamUsers = districtUsers.filter(u => {
          if (upper(u.puesto) !== 'TECNICO') return false
          const assigned = normalize(u.coordinador)
          return assigned && (assigned === code || assigned === name)
        })
        const keys = new Set(teamUsers.flatMap(u => [
          normalize(u.usuario_ffm || u.ffm),
          normalize(u.numero_empleado || u.numero_empleado_odoo),
          normalize(u.nombre)
        ]).filter(Boolean))
        const mine = rows.filter(p => [
          normalize(p.usuario_ffm),
          normalize(p.numero_empleado),
          normalize(p.empleado_asignado)
        ].some(k => k && keys.has(k)))
        if (!mine.length) continue

        const message = [
          '📋 PENDIENTES DE KILOMETRAJE — COORDINADOR',
          `Distrito: ${district}`,
          `Coordinador: ${coordinator.nombre || coordinator.usuario_almacen}`,
          weekLabel,
          `Total: ${mine.length}`,
          '',
          ...mine.slice(0, 45).map(pendingLine)
        ].join('\n')

        const result = await registerAndSend(admin, {
          slot, chatId: coordinator.telegram_chat_id, kind: 'COORDINADOR', message
        })
        if (result.sent) sent++
        else if (result.skipped) skipped++
        else if (result.failed) errors.push(`${coordinator.usuario_almacen}: ${result.error}`)
      }

      // 3) Almacenistas: resumen del distrito; no se supone una relación
      // técnico-almacén que el esquema actual no demuestra.
      for (const warehouse of districtUsers) {
        if (upper(warehouse.puesto) !== 'ALMACENISTA' || !s(warehouse.telegram_chat_id)) continue
        const message = [
          '📋 PENDIENTES DE KILOMETRAJE — ALMACÉN',
          `Distrito: ${district}`,
          `Almacén: ${warehouse.usuario_almacen || 'NO INDICADO'}`,
          weekLabel,
          `Total del distrito: ${rows.length}`,
          '',
          ...rows.slice(0, 45).map(pendingLine)
        ].join('\n')

        const result = await registerAndSend(admin, {
          slot, chatId: warehouse.telegram_chat_id, kind: 'ALMACENISTA', message
        })
        if (result.sent) sent++
        else if (result.skipped) skipped++
        else if (result.failed) errors.push(`${warehouse.usuario_almacen}: ${result.error}`)
      }

      // 4) Administradores del distrito.
      for (const manager of districtUsers) {
        const role = upper(manager.puesto)
        if (!(role === `ADMIN_${district}` || role === 'ADMIN' || role === 'ADMINISTRADOR') || !s(manager.telegram_chat_id)) continue
        const message = [
          '📊 RESUMEN DE KILOMETRAJE PENDIENTE',
          `Distrito: ${district}`,
          weekLabel,
          `Total: ${rows.length}`,
          '',
          ...rows.slice(0, 45).map(pendingLine)
        ].join('\n')

        const result = await registerAndSend(admin, {
          slot, chatId: manager.telegram_chat_id, kind: 'ADMIN_DISTRITO', message
        })
        if (result.sent) sent++
        else if (result.skipped) skipped++
        else if (result.failed) errors.push(`${manager.usuario_almacen}: ${result.error}`)
      }
    }

    // 5) ADMIN_PADRE: consolidado nacional de filas que sí tienen distrito.
    for (const parent of activeUsers.filter(u => upper(u.puesto) === 'ADMIN_PADRE' && s(u.telegram_chat_id))) {
      const message = [
        '📊 RESUMEN NACIONAL DE KILOMETRAJE PENDIENTE',
        weekLabel,
        `Total con distrito identificado: ${allPending.filter(p => s(p.distrito)).length}`,
        `Sin distrito identificado: ${allPending.filter(p => !s(p.distrito)).length}`,
        '',
        ...Array.from(byDistrict.entries()).map(([d, rows]) => `${d}: ${rows.length} pendientes`)
      ].join('\n')

      const result = await registerAndSend(admin, {
        slot, chatId: parent.telegram_chat_id, kind: 'ADMIN_PADRE', message
      })
      if (result.sent) sent++
      else if (result.skipped) skipped++
      else if (result.failed) errors.push(`${parent.usuario_almacen}: ${result.error}`)
    }

    return out({
      ok: errors.length === 0,
      fecha_horario: slot,
      anio: year,
      semana: week,
      pendientes_con_distrito: allPending.filter(p => s(p.distrito)).length,
      pendientes_sin_distrito: allPending.filter(p => !s(p.distrito)).length,
      enviados: sent,
      duplicados_omitidos: skipped,
      errores: errors
    })
  } catch (e) {
    console.error('[QIORA RECORDATORIOS]', e?.message || e)
    return out({ ok: false, error: e?.message || 'ERROR_INTERNO' }, 500)
  }
}
// Sincronizacion de respuestas de Google Sheets -> Supabase.
// Esta ruta comparte el GET de recordatorios y agrega POST para la carga.
import { createHash } from 'node:crypto'

function keyHeader(value) {
  return s(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

function field(row, aliases) {
  const wanted = new Set(aliases.map(keyHeader))
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(keyHeader(key))) return value
  }
  return ''
}

function textField(row, aliases) {
  const value = field(row, aliases)
  return value === null || value === undefined ? '' : String(value).trim()
}

function numberField(row, aliases) {
  const raw = textField(row, aliases).replace(/,/g, '').replace(/\s/g, '')
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function makeSourceKey(row) {
  const explicit = textField(row, [
    'source_key', 'source key', 'id respuesta', 'id de respuesta',
    'response id', 'timestamp id', 'folio formulario'
  ])
  if (explicit) return explicit.slice(0, 240)
  const canonical = Object.keys(row || {}).sort().reduce((out, key) => {
    out[String(key)] = row[key] == null ? '' : String(row[key]).trim()
    return out
  }, {})
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function mapKilometrajeRow(row) {
  const fechaFormulario = textField(row, [
    'fecha_formulario', 'fecha formulario', 'marca temporal', 'timestamp',
    'fecha y hora', 'fecha de envio', 'fecha de envío'
  ])
  const fechaRevision = textField(row, [
    'fecha_revision', 'fecha revision', 'fecha de revision', 'fecha de revisión'
  ])
  const placa = textField(row, ['placa', 'placas', 'matricula', 'matrícula'])
  const numeroUnico = textField(row, [
    'numero_unico', 'numero unico', 'número único', 'numero de unidad', 'número de unidad'
  ])
  const distrito = textField(row, ['distrito', 'centro', 'distrito operativo'])
  const semana = textField(row, ['semana', 'semana del año', 'semana del anio'])
  const kilometraje = numberField(row, [
    'kilometraje', 'kilometraje actual', 'odometro', 'odómetro', 'lectura odometro', 'lectura odómetro'
  ])

  return {
    source_key: makeSourceKey(row),
    fecha_formulario: fechaFormulario || null,
    distrito: distrito || null,
    tipo_unidad: textField(row, ['tipo_unidad', 'tipo unidad', 'tipo de unidad']) || null,
    fecha_revision: fechaRevision || null,
    semana: semana || null,
    placa: placa || null,
    numero_unico: numeroUnico || null,
    numero_empleado: textField(row, ['numero_empleado', 'numero empleado', 'número de empleado', 'no empleado']) || null,
    usuario_ffm: textField(row, ['usuario_ffm', 'usuario ffm', 'ffm', 'usuario']) || null,
    nombre_operador: textField(row, ['nombre_operador', 'nombre operador', 'nombre', 'empleado', 'nombre del operador']) || null,
    kilometraje,
    almacen: textField(row, ['almacen', 'almacén', 'sucursal', 'centro de costo']) || null,
    modelo: textField(row, ['modelo', 'marca y modelo']) || null,
    fotografia_odometro: textField(row, ['fotografia_odometro', 'fotografia odometro', 'fotografía odómetro', 'foto odometro', 'foto odómetro', 'fotografia']) || null,
    datos_completos: row
  }
}

export async function POST(request) {
  try {
    const expected = s(process.env.QIORA_SYNC_SECRET)
    const supplied = s(request.headers.get('x-qiora-sync-secret'))
    if (!expected || supplied !== expected) return out({ ok: false, error: 'NO_AUTORIZADO' }, 401)

    let payload
    try {
      payload = await request.json()
    } catch {
      return out({ ok: false, error: 'JSON_INVALIDO' }, 400)
    }

    if (!Array.isArray(payload?.filas)) return out({ ok: false, error: 'Se esperaba un arreglo filas.' }, 400)
    if (payload.filas.length > 500) return out({ ok: false, error: 'MAXIMO_500_FILAS_POR_LOTE' }, 413)
    if (!payload.filas.length) return out({ ok: true, procesadas: 0, guardadas: 0, duplicadas_en_lote: 0 })

    const admin = createAdmin()
    const mapped = payload.filas
      .filter(row => row && typeof row === 'object' && !Array.isArray(row))
      .map(mapKilometrajeRow)

    if (!mapped.length) return out({ ok: false, error: 'No hay filas validas.' }, 400)

    // Evita repetir la misma respuesta dentro del lote; el upsert protege reintentos.
    const unique = new Map()
    for (const row of mapped) unique.set(row.source_key, row)
    const rows = [...unique.values()]

    const { data, error } = await admin
      .from('qiora_kilometrajes')
      .upsert(rows, { onConflict: 'source_key' })
      .select('id,source_key')

    if (error) {
      console.error('[QIORA KM SYNC] Supabase upsert:', error.message)
      return out({ ok: false, error: 'SUPABASE_UPSERT_ERROR', detalle: error.message }, 500)
    }

    return out({
      ok: true,
      procesadas: mapped.length,
      guardadas: Array.isArray(data) ? data.length : rows.length,
      duplicadas_en_lote: mapped.length - rows.length,
      lote: rows.length
    })
  } catch (error) {
    console.error('[QIORA KM SYNC]', error?.message || error)
    return out({ ok: false, error: error?.message || 'ERROR_INTERNO_SYNC' }, 500)
  }
}
