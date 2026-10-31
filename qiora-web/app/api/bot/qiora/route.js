import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()

function verificarBot(request) {
  const esperado = clean(process.env.QIORA_BOT_API_KEY)
  const recibido = clean(request.headers.get('x-qiora-bot-key'))
  return Boolean(esperado && recibido && esperado === recibido)
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Variables Supabase incompletas en Vercel.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function supabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en Vercel.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function perfilTelegram(admin, chatId) {
  const id = clean(chatId)
  if (!id) return null

  const { data, error } = await admin
    .from('almacen_usuarios')
    .select('*')
    .eq('telegram_chat_id', id)
    .eq('activo', true)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data || null
}

function esAdmin(p) {
  const puesto = upper(p?.puesto)
  return puesto === 'ADMIN_PADRE' || puesto === 'ADMIN' ||
    puesto === 'ADMINISTRADOR' || puesto === 'ALMACENISTA' ||
    puesto.startsWith('ADMIN_')
}

function esAdminPadre(p) {
  return upper(p?.puesto) === 'ADMIN_PADRE'
}

function esAdminDistrito(p) {
  const puesto = upper(p?.puesto)
  return puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' || puesto.startsWith('ADMIN_')
}

function esAlmacenista(p) {
  return upper(p?.puesto) === 'ALMACENISTA'
}

function ffmUsuario(p) {
  return upper(p?.usuario_ffm || p?.ffm)
}

function puedeCargarPlacas(p) {
  if (!p) return false
  const puesto = upper(p.puesto)
  return puesto === 'ADMIN_PADRE' ||
    puesto === 'ADMIN' ||
    puesto === 'ADMINISTRADOR' ||
    puesto === 'ALMACENISTA' ||
    puesto.startsWith('ADMIN_') ||
    p.configuracion === true ||
    p.administrar_distritos === true
}

async function registrarTelegram(admin, payload) {
  const distrito = upper(payload.distrito)
  const usuario = upper(payload.usuario_almacen)
  const chatId = clean(payload.telegram_chat_id)
  const clave = String(payload.clave ?? '')

  if (!/^([A-Z]{2,5}[0-9]{1,5})$/.test(distrito)) {
    return { ok: false, error: 'Distrito inválido.' }
  }
  if (!/^[A-Z0-9_-]{2,10}$/.test(usuario)) {
    return { ok: false, error: 'Número de usuario o almacén inválido.' }
  }
  if (!/^\d{5,20}$/.test(chatId)) {
    return { ok: false, error: 'No se pudo identificar tu cuenta de Telegram.' }
  }
  if (!clave || clave.length > 256) {
    return { ok: false, error: 'Introduce tu contraseña personal de SAT.' }
  }

  const { data: perfil, error: perfilError } = await admin
    .from('almacen_usuarios')
    .select('id,usuario_almacen,distrito,nombre,puesto,activo,auth_user_id,telegram_chat_id')
    .eq('usuario_almacen', usuario)
    .eq('distrito', distrito)
    .limit(1)
    .maybeSingle()

  if (perfilError) throw new Error(perfilError.message)
  if (!perfil || perfil.activo !== true || !perfil.auth_user_id) {
    return { ok: false, error: 'No se encontró un usuario activo de SAT con ese distrito y número.' }
  }

  if (clean(perfil.telegram_chat_id) && clean(perfil.telegram_chat_id) !== chatId) {
    return { ok: false, error: 'Este usuario ya está vinculado a otra cuenta de Telegram. Solicita apoyo al administrador de SAT.' }
  }

  const auth = supabaseAuthClient()
  const { data: login, error: loginError } = await auth.auth.signInWithPassword({
    email: `${usuario.toLowerCase()}@qiora.local`,
    password: `QIORA#${clave}`,
  })

  if (loginError || !login?.user?.id) {
    return { ok: false, error: 'Contraseña incorrecta. Verifica tu usuario y contraseña de SAT.' }
  }

  if (String(login.user.id).toLowerCase() !== String(perfil.auth_user_id).toLowerCase()) {
    await auth.auth.signOut().catch(() => {})
    return { ok: false, error: 'La cuenta autenticada no corresponde al usuario indicado en SAT.' }
  }

  await auth.auth.signOut().catch(() => {})

  const { data: ocupado, error: ocupadoError } = await admin
    .from('almacen_usuarios')
    .select('usuario_almacen,distrito')
    .eq('telegram_chat_id', chatId)
    .neq('id', perfil.id)
    .limit(1)
    .maybeSingle()

  if (ocupadoError) throw new Error(ocupadoError.message)
  if (ocupado) {
    return { ok: false, error: 'Esta cuenta de Telegram ya está vinculada a otro usuario SAT.' }
  }

  if (clean(perfil.telegram_chat_id) === chatId) {
    return {
      ok: true,
      registrado: true,
      mensaje: `Tu Telegram ya estaba vinculado.\nUsuario: ${usuario}\nDistrito: ${distrito}\nPuesto: ${perfil.puesto || 'No indicado'}`,
      usuario: perfil.usuario_almacen,
      distrito: perfil.distrito,
      puesto: perfil.puesto || '',
      nombre: perfil.nombre || '',
      faltantes: [],
    }
  }

  const { data: actualizado, error: updateError } = await admin
    .from('almacen_usuarios')
    .update({
      telegram_chat_id: chatId,
      bot_confirmado: true,
      fecha_confirmacion_bot: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', perfil.id)
    .eq('activo', true)
    .or('telegram_chat_id.is.null,telegram_chat_id.eq.')
    .select('usuario_almacen,distrito,nombre,puesto,telegram_chat_id')
    .maybeSingle()

  if (updateError) throw new Error(updateError.message)

  if (!actualizado) {
    const { data: comprobacion, error: checkError } = await admin
      .from('almacen_usuarios')
      .select('telegram_chat_id')
      .eq('id', perfil.id)
      .maybeSingle()
    if (checkError) throw new Error(checkError.message)
    if (clean(comprobacion?.telegram_chat_id) !== chatId) {
      return { ok: false, error: 'No se pudo completar el vínculo porque la cuenta cambió durante el registro. Inténtalo nuevamente.' }
    }
  }

  return {
    ok: true,
    registrado: true,
    mensaje: `Registro completado.\nUsuario: ${usuario}\nDistrito: ${distrito}\nPuesto: ${perfil.puesto || 'No indicado'}`,
    usuario: perfil.usuario_almacen,
    distrito: perfil.distrito,
    puesto: perfil.puesto || '',
    nombre: perfil.nombre || '',
    faltantes: [],
  }
}

function formatoDato(v) {
  const x = clean(v)
  return x || 'NO REGISTRADO'
}

async function consultarMiPerfil(admin, perfil) {
  const ahora = new Date().toISOString()
  const { error } = await admin.from('almacen_usuarios')
    .update({ ultima_conexion: ahora, actualizado_en: ahora })
    .eq('id', perfil.id).eq('activo', true)
  if (error) throw new Error(`No se pudo actualizar la última conexión: ${error.message}`)
  return {
    ok: true, perfil,
    mensaje: [
      'MI PERFIL QIORA', '',
      `Usuario/Almacén: ${formatoDato(perfil.usuario_almacen)}`,
      `Nombre: ${formatoDato(perfil.nombre)}`,
      `Puesto: ${formatoDato(perfil.puesto)}`,
      `Distrito: ${formatoDato(perfil.distrito)}`,
      `Teléfono: ${formatoDato(perfil.telefono)}`,
      `Odoo: ${formatoDato(perfil.odoo)}`,
      `Coordinador: ${formatoDato(perfil.coordinador)}`,
      `Supervisor: ${formatoDato(perfil.supervisor)}`,
      `Correo: ${formatoDato(perfil.correo)}`,
      `Estado: ${perfil.activo ? 'ACTIVO' : 'INACTIVO'}`
    ].join('\n')
  }
}

async function consultarMiAlmacen(admin, perfil) {
  const ahora = new Date().toISOString()
  const { error } = await admin.from('almacen_usuarios')
    .update({ ultima_conexion: ahora, actualizado_en: ahora })
    .eq('id', perfil.id).eq('activo', true)
  if (error) throw new Error(`No se pudo actualizar la última conexión: ${error.message}`)
  return {
    ok: true, perfil,
    mensaje: [
      'MI ALMACEN QIORA', '',
      `Código de almacén: ${formatoDato(perfil.usuario_almacen)}`,
      `Responsable: ${formatoDato(perfil.nombre)}`,
      `Distrito: ${formatoDato(perfil.distrito)}`,
      `Puesto: ${formatoDato(perfil.puesto)}`,
      `Coordinador: ${formatoDato(perfil.coordinador)}`,
      `Supervisor: ${formatoDato(perfil.supervisor)}`,
      `Estado: ${perfil.activo ? 'ACTIVO' : 'INACTIVO'}`
    ].join('\n')
  }
}

async function descargarArchivoTelegram(fileId) {
  const token = clean(process.env.QIORA_BOT_TOKEN)
  if (!token) throw new Error('Falta QIORA_BOT_TOKEN en Vercel.')

  const id = clean(fileId)
  if (!id) throw new Error('FILE_ID_NO_RECIBIDO')

  const respuestaInfo = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(id)}`,
    { cache: 'no-store' }
  )
  const info = await respuestaInfo.json().catch(() => ({}))

  if (!respuestaInfo.ok || !info?.ok || !info?.result?.file_path) {
    throw new Error(info?.description || 'No se pudo obtener el archivo de Telegram.')
  }

  const respuestaArchivo = await fetch(
    `https://api.telegram.org/file/bot${token}/${info.result.file_path}`,
    { cache: 'no-store' }
  )
  if (!respuestaArchivo.ok) {
    throw new Error(`Telegram no permitió descargar el archivo. HTTP ${respuestaArchivo.status}`)
  }

  return Buffer.from(await respuestaArchivo.arrayBuffer())
}

function leerExcelPlacas(buffer) {
  let workbook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } catch {
    throw new Error('El archivo no es un Excel válido.')
  }

  if (!Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length) {
    throw new Error('El Excel no contiene hojas.')
  }

  const nombreHoja = workbook.SheetNames[0]
  const hoja = workbook.Sheets[nombreHoja]
  if (!hoja) throw new Error('No se pudo leer la primera hoja del Excel.')

  const filas = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false })
  if (!Array.isArray(filas) || !filas.length) {
    throw new Error('El Excel no contiene registros.')
  }

  return { nombreHoja, filas }
}

function buscarCampo(row, ...nombres) {
  for (const nombre of nombres) {
    if (Object.prototype.hasOwnProperty.call(row, nombre)) return row[nombre]
  }
  return ''
}

function normalizarPlaca(row) {
  const numeroUnico = upper(buscarCampo(
    row, 'NUMERO UNICO', 'NÚMERO UNICO', 'NÚMERO ÚNICO', 'Número único', 'Numero unico'
  ))

  const placa = upper(buscarCampo(row, 'PLACA', 'Placa')).replace(/-/g, '')
  const ultimoTexto = clean(buscarCampo(
    row, 'ULTIMO KILOMETRAJE', 'ÚLTIMO KILOMETRAJE', 'Ultimo kilometraje', 'Último kilometraje'
  )).replace(/,/g, '')
  const ultimoKilometraje = /^[0-9]+(?:\.[0-9]+)?$/.test(ultimoTexto) ? Number(ultimoTexto) : null

  return {
    numero_unico: numeroUnico,
    placa: placa || null,
    estado_placa: clean(buscarCampo(row, 'ESTADO PLACA', 'Estado placa')) || null,
    sucursal: clean(buscarCampo(row, 'SUCURSAL', 'Sucursal')) || null,
    empleado_asignado: clean(buscarCampo(row, 'EMPLEADO ASIGNADO', 'Empleado asignado')) || null,
    numero_empleado: clean(buscarCampo(row, 'NÚMERO EMPLEADO', 'NUMERO EMPLEADO', 'Número empleado', 'Numero empleado')) || null,
    usuario_ffm: upper(buscarCampo(row, 'USUARIO FFM', 'Usuario FFM')) || null,
    puesto_empleado: clean(buscarCampo(row, 'PUESTO EMPLEADO', 'Puesto empleado')) || null,
    marca: clean(buscarCampo(row, 'MARCA', 'Marca')) || null,
    modelo: clean(buscarCampo(row, 'MODELO', 'Modelo')) || null,
    numero_serie: clean(buscarCampo(row, 'NUMERO DE SERIE', 'NÚMERO DE SERIE', 'Número de serie')) || null,
    ultimo_kilometraje: ultimoKilometraje,
    fecha_ultimo_kilometraje: clean(buscarCampo(
      row, 'FECHA ULTIMO KILOMETRAJE', 'FECHA ÚLTIMO KILOMETRAJE', 'Fecha ultimo kilometraje', 'Fecha último kilometraje'
    )) || null,
    datos_completos: row,
  }
}

async function cargarPlacasTelegram(admin, perfil, payload) {
  if (!puedeCargarPlacas(perfil)) {
    return { ok: false, error: 'No tienes permiso para actualizar PLACAS.' }
  }

  const fileId = clean(payload.file_id || payload.telegram_file_id)
  const fileName = clean(payload.file_name || payload.nombre_archivo)

  if (!fileId) return { ok: false, error: 'No se recibió el archivo de Telegram.' }
  if (fileName && !/\.(xlsx|xls)$/i.test(fileName)) {
    return { ok: false, error: 'El archivo debe ser Excel .xlsx o .xls.' }
  }

  const buffer = await descargarArchivoTelegram(fileId)
  if (buffer.length > 20 * 1024 * 1024) {
    return { ok: false, error: 'El archivo supera el límite permitido.' }
  }

  const { nombreHoja, filas } = leerExcelPlacas(buffer)
  const normalizadas = filas.map(normalizarPlaca).filter(x => x.numero_unico)
  if (!normalizadas.length) {
    return { ok: false, error: 'No encontré registros con NÚMERO ÚNICO en el archivo.' }
  }

  const vistos = new Set()
  for (const fila of normalizadas) {
    if (vistos.has(fila.numero_unico)) {
      return { ok: false, error: `NÚMERO ÚNICO DUPLICADO: ${fila.numero_unico}` }
    }
    vistos.add(fila.numero_unico)
  }

  const { data, error } = await admin.rpc('qiora_reemplazar_placas', {
    p_filas: normalizadas,
  })
  if (error) throw new Error(error.message)

  return {
    ok: true,
    accion: 'telegram_placas_cargar',
    registros: normalizadas.length,
    hoja: nombreHoja,
    resultado: data,
    mensaje: [
      'PLACAS ACTUALIZADAS', '',
      `Archivo: ${fileName || 'Excel recibido'}`,
      `Hoja: ${nombreHoja}`,
      `Registros cargados: ${normalizadas.length}`, '',
      'El catálogo anterior fue reemplazado correctamente.'
    ].join('\n')
  }
}

async function listaFfmPermitidos(admin, perfil) {
  if (esAdminPadre(perfil)) return null

  if (esAdminDistrito(perfil)) {
    const distrito = upper(perfil.distrito)
    if (!distrito) return new Set()

    const { data, error } = await admin
      .from('almacen_usuarios')
      .select('usuario_ffm,ffm')
      .eq('activo', true)
      .eq('distrito', distrito)

    if (error) throw new Error(error.message)
    return new Set((data || []).map(ffmUsuario).filter(Boolean))
  }

  if (esAlmacenista(perfil)) {
    const almacen = upper(perfil.usuario_almacen)
    if (!almacen) return new Set()

    const { data, error } = await admin
      .from('almacen_usuarios')
      .select('usuario_ffm,ffm')
      .eq('activo', true)
      .eq('usuario_almacen', almacen)

    if (error) throw new Error(error.message)
    return new Set((data || []).map(ffmUsuario).filter(Boolean))
  }

  const propio = ffmUsuario(perfil)
  return new Set(propio ? [propio] : [])
}

async function leerTodo(admin, tabla, columnas, orden = 'id') {
  const salida = []
  const tam = 1000
  let desde = 0

  while (true) {
    const hasta = desde + tam - 1
    const { data, error } = await admin
      .from(tabla)
      .select(columnas)
      .order(orden, { ascending: true })
      .range(desde, hasta)

    if (error) throw new Error(error.message)
    const lote = data || []
    salida.push(...lote)
    if (lote.length < tam) break
    desde += tam
  }

  return salida
}

function dentroAlcance(fila, ffms) {
  if (ffms === null) return true
  return ffms.has(upper(fila?.usuario_ffm))
}

function textoContiene(valor, termino) {
  return upper(valor).includes(termino)
}

async function consultarPlacas(admin, perfil, payload) {
  const termino = upper(payload.termino || payload.buscar || payload.valor)
  if (termino.length < 2 || termino.length > 80) {
    return { ok: false, error: 'La búsqueda debe tener entre 2 y 80 caracteres.' }
  }

  const ffms = await listaFfmPermitidos(admin, perfil)
  const filas = await leerTodo(
    admin,
    'qiora_placas',
    'id,numero_unico,placa,estado_placa,sucursal,empleado_asignado,numero_empleado,usuario_ffm,puesto_empleado,marca,modelo,numero_serie,ultimo_kilometraje,fecha_ultimo_kilometraje'
  )

  const encontrados = filas.filter(f => {
    if (!dentroAlcance(f, ffms)) return false
    return textoContiene(f.placa, termino) ||
      textoContiene(f.usuario_ffm, termino) ||
      textoContiene(f.numero_empleado, termino) ||
      textoContiene(f.numero_unico, termino) ||
      textoContiene(f.empleado_asignado, termino)
  })

  if (!encontrados.length) {
    return { ok: true, total: 0, mensaje: `🔎 CONSULTAR PLACAS\n\nSin resultados para: ${clean(payload.termino)}` }
  }

  const lineas = ['🔎 CONSULTAR PLACAS', '', `Resultados: ${encontrados.length}`]
  for (const f of encontrados.slice(0, 20)) {
    lineas.push('')
    lineas.push(`🚘 ${f.placa || 'SIN PLACA'} | ${f.numero_unico || 'SIN NÚMERO ÚNICO'}`)
    lineas.push(`FFM: ${f.usuario_ffm || 'NO REGISTRADO'}`)
    lineas.push(`Empleado: ${f.empleado_asignado || 'NO REGISTRADO'}${f.numero_empleado ? ` (${f.numero_empleado})` : ''}`)
    lineas.push(`Sucursal: ${f.sucursal || 'NO REGISTRADA'}`)
    lineas.push(`Vehículo: ${[f.marca, f.modelo].filter(Boolean).join(' ') || 'NO REGISTRADO'}`)
    lineas.push(`Último KM: ${f.ultimo_kilometraje ?? 'NO REGISTRADO'}`)
  }

  if (encontrados.length > 20) lineas.push('', `Mostrando 20 de ${encontrados.length} resultados.`)

  return { ok: true, total: encontrados.length, resultados: encontrados.slice(0, 20), mensaje: lineas.join('\n').slice(0, 4000) }
}

async function pendientesKilometraje(admin, perfil) {
  const ffms = await listaFfmPermitidos(admin, perfil)
  const filas = await leerTodo(
    admin,
    'qiora_kilometrajes_pendientes',
    'id,numero_unico,placa,empleado_asignado,numero_empleado,usuario_ffm,sucursal,modelo,semana',
    'id'
  )

  const pendientes = filas.filter(f => dentroAlcance(f, ffms))
  const semana = pendientes[0]?.semana || filas[0]?.semana || ''

  if (!pendientes.length) {
    return {
      ok: true,
      total: 0,
      semana,
      mensaje: `⏳ KILOMETRAJES PENDIENTES${semana ? `\nSemana: ${semana}` : ''}\n\n✅ No hay vehículos pendientes en tu alcance.`
    }
  }

  const lineas = [
    '⏳ KILOMETRAJES PENDIENTES',
    semana ? `Semana: ${semana}` : '',
    `Total: ${pendientes.length}`,
  ].filter(Boolean)

  for (const p of pendientes) {
    const linea = `• ${p.empleado_asignado || p.usuario_ffm || 'SIN OPERADOR'} — ${p.placa || 'SIN PLACA'}${p.usuario_ffm ? ` — ${p.usuario_ffm}` : ''}`
    if ((lineas.join('\n').length + linea.length + 2) > 3800) break
    lineas.push(linea)
  }

  if (lineas.length - 3 < pendientes.length) {
    lineas.push(`… Total pendientes: ${pendientes.length}`)
  }

  return {
    ok: true,
    total: pendientes.length,
    semana,
    pendientes,
    mensaje: lineas.join('\n')
  }
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)

  if (accion === 'telegram_registrar') {
    return registrarTelegram(admin, payload)
  }

  const perfil = await perfilTelegram(admin, payload.telegram_chat_id)

  if (accion === 'telegram_mi_perfil' || accion === 'telegram_mi_almacen') {
    if (!perfil) return { ok: false, error: 'Telegram no está vinculado a un usuario activo. Envía REGISTRAR DISTRITO USUARIO.' }
    return accion === 'telegram_mi_perfil'
      ? consultarMiPerfil(admin, perfil)
      : consultarMiAlmacen(admin, perfil)
  }

  if (accion === 'telegram_config_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a un usuario activo de SAT.' }
    return {
      ok: true,
      permitido: esAdmin(perfil),
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
      permisos: perfil.permisos || {},
      administrar_permisos: Boolean(perfil.administrar_permisos),
    }
  }

  if (accion === 'telegram_sap_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a SAT.' }
    return {
      ok: true,
      permitido: esAdmin(perfil),
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
    }
  }

  if (accion === 'telegram_placas_permiso') {
    if (!perfil) return { ok: true, permitido: false, mensaje: 'Telegram no está vinculado a SAT.' }
    return {
      ok: true,
      permitido: puedeCargarPlacas(perfil),
      usuario: perfil.usuario_almacen || '',
      nombre: perfil.nombre || '',
      puesto: perfil.puesto || '',
      distrito: perfil.distrito || '',
    }
  }

  if (accion === 'telegram_placas_cargar') {
    if (!perfil) return { ok: false, error: 'Telegram no está vinculado a un usuario activo.' }
    return cargarPlacasTelegram(admin, perfil, payload)
  }

  if (accion === 'telegram_placas_consultar') {
    if (!perfil) return { ok: false, error: 'Telegram no está vinculado a un usuario activo.' }
    return consultarPlacas(admin, perfil, payload)
  }

  if (accion === 'telegram_kilometrajes_pendientes') {
    if (!perfil) return { ok: false, error: 'Telegram no está vinculado a un usuario activo.' }
    return pendientesKilometraje(admin, perfil)
  }

  return null
}

export async function POST(request) {
  try {
    if (!verificarBot(request)) return json({ ok: false, error: 'Bot no autorizado.' }, 401)

    let payload
    try {
      payload = await request.json()
    } catch {
      return json({ ok: false, error: 'JSON inválido.' }, 400)
    }

    const accion = clean(payload?.accion || payload?.action)
    if (!accion) return json({ ok: false, error: 'Falta accion.' }, 400)

    const admin = supabaseAdmin()
    const directo = await accionMigrada(admin, payload)
    if (directo) return json(directo, directo.ok === false ? 400 : 200)

    return json({
      ok: false,
      error: `La acción ${accion} todavía no está migrada directamente a SAT/Supabase.`,
      codigo: 'ACCION_PENDIENTE_MIGRACION',
    }, 501)
  } catch (e) {
    console.error('[SAT BOT API]', e?.message || 'Error interno')
    return json({ ok: false, error: e?.message || 'Error interno SAT.' }, 500)
  }
}
