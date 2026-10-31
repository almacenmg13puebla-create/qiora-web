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
    distrito: null,
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


function llaveEmpleado(v) {
  return clean(v).replace(/\s+/g, '').toUpperCase()
}

async function enriquecerDistritosPlacas(admin, filas) {
  const { data: usuarios, error } = await admin
    .from('almacen_usuarios')
    .select('distrito,usuario_ffm,ffm,numero_empleado,numero_empleado_odoo')
    .eq('activo', true)

  if (error) throw new Error(error.message)

  const porFfm = new Map()
  const porEmpleado = new Map()

  function agregar(map, llave, distrito) {
    const k = upper(llave)
    const d = upper(distrito)
    if (!k || !d) return

    if (!map.has(k)) {
      map.set(k, new Set())
    }

    map.get(k).add(d)
  }

  for (const u of usuarios || []) {
    agregar(porFfm, u.usuario_ffm, u.distrito)
    agregar(porFfm, u.ffm, u.distrito)

    const n1 = llaveEmpleado(u.numero_empleado)
    const n2 = llaveEmpleado(u.numero_empleado_odoo)

    if (n1) {
      if (!porEmpleado.has(n1)) porEmpleado.set(n1, new Set())
      porEmpleado.get(n1).add(upper(u.distrito))
    }

    if (n2) {
      if (!porEmpleado.has(n2)) porEmpleado.set(n2, new Set())
      porEmpleado.get(n2).add(upper(u.distrito))
    }
  }

  let identificadas = 0
  let sinDistrito = 0
  let conflictos = 0

  const resultado = filas.map(fila => {
    const candidatos = new Set()

    const ffm = upper(fila.usuario_ffm)
    const empleado = llaveEmpleado(fila.numero_empleado)

    if (ffm && porFfm.has(ffm)) {
      for (const d of porFfm.get(ffm)) {
        if (d) candidatos.add(d)
      }
    }

    if (empleado && porEmpleado.has(empleado)) {
      for (const d of porEmpleado.get(empleado)) {
        if (d) candidatos.add(d)
      }
    }

    let distrito = null

    if (candidatos.size === 1) {
      distrito = [...candidatos][0]
      identificadas++
    } else if (candidatos.size > 1) {
      conflictos++
    } else {
      sinDistrito++
    }

    return {
      ...fila,
      distrito
    }
  })

  return {
    filas: resultado,
    diagnostico: {
      total: filas.length,
      identificadas,
      sin_distrito: sinDistrito,
      conflictos
    }
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
  const baseNormalizada = filas.map(normalizarPlaca).filter(x => x.numero_unico)

  if (!baseNormalizada.length) {
    return { ok: false, error: 'No encontré registros con NÚMERO ÚNICO en el archivo.' }
  }

  const enriquecido = await enriquecerDistritosPlacas(admin, baseNormalizada)
  const normalizadas = enriquecido.filas

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
    diagnostico_distritos: enriquecido.diagnostico,
    mensaje: [
      'PLACAS ACTUALIZADAS', '',
      `Archivo: ${fileName || 'Excel recibido'}`,
      `Hoja: ${nombreHoja}`,
      `Registros cargados: ${normalizadas.length}`,
      `Con distrito identificado: ${enriquecido.diagnostico.identificadas}`,
      `Sin distrito identificado: ${enriquecido.diagnostico.sin_distrito}`,
      `Conflictos de distrito: ${enriquecido.diagnostico.conflictos}`,
      '',
      'El catálogo anterior fue reemplazado correctamente.'
    ].join('\n')
  }
}

function normalizarLlave(v) {
  return upper(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function esCoordinador(p) {
  return upper(p?.puesto) === 'COORDINADOR'
}

async function usuariosAlcancePendientes(admin, perfil) {
  /*
    ADMIN_PADRE ve todo el país.
  */
  if (esAdminPadre(perfil)) {
    return null
  }

  const distrito = upper(perfil?.distrito)

  if (!distrito) {
    return []
  }

  /*
    Administradores de distrito:
    todos los usuarios activos de su distrito.
  */
  if (esAdminDistrito(perfil)) {
    const { data, error } = await admin
      .from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,distrito,puesto,usuario_ffm,ffm,numero_empleado,numero_empleado_odoo,coordinador')
      .eq('activo', true)
      .eq('distrito', distrito)

    if (error) throw new Error(error.message)
    return data || []
  }

  /*
    Coordinador:
    únicamente técnicos/usuarios activos de su distrito
    que lo tengan asignado en la columna coordinador.

    Se compara contra nombre y usuario_almacen del coordinador
    para soportar los dos formatos que ya existen en almacen_usuarios.
  */
  if (esCoordinador(perfil)) {
    const { data, error } = await admin
      .from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,distrito,puesto,usuario_ffm,ffm,numero_empleado,numero_empleado_odoo,coordinador')
      .eq('activo', true)
      .eq('distrito', distrito)

    if (error) throw new Error(error.message)

    const nombreCoordinador = normalizarLlave(perfil.nombre)
    const usuarioCoordinador = normalizarLlave(perfil.usuario_almacen)

    return (data || []).filter(u => {
      const coordinador = normalizarLlave(u.coordinador)
      return Boolean(
        coordinador &&
        (
          coordinador === nombreCoordinador ||
          coordinador === usuarioCoordinador
        )
      )
    })
  }

  /*
    Almacenista:
    usuarios activos del mismo distrito y mismo almacén/código
    cuando almacen_usuarios.usuario_almacen coincide.

    Si tu catálogo usa otra columna específica para almacén,
    esta parte se puede cambiar sin afectar los demás roles.
  */
  if (esAlmacenista(perfil)) {
    const almacen = normalizarLlave(perfil.usuario_almacen)
    if (!almacen) return []

    const { data, error } = await admin
      .from('almacen_usuarios')
      .select('id,nombre,usuario_almacen,distrito,puesto,usuario_ffm,ffm,numero_empleado,numero_empleado_odoo,coordinador')
      .eq('activo', true)
      .eq('distrito', distrito)

    if (error) throw new Error(error.message)

    return (data || []).filter(
      u => normalizarLlave(u.usuario_almacen) === almacen
    )
  }

  /*
    Técnico y demás puestos:
    solo su propio usuario.
  */
  return [perfil]
}

function indicesAlcance(usuarios) {
  if (usuarios === null) {
    return null
  }

  const ffms = new Set()
  const empleados = new Set()
  const nombres = new Set()

  for (const u of usuarios || []) {
    const ffm = normalizarLlave(u?.usuario_ffm || u?.ffm)
    const empleado = normalizarLlave(
      u?.numero_empleado ||
      u?.numero_empleado_odoo
    )
    const nombre = normalizarLlave(u?.nombre)

    if (ffm) ffms.add(ffm)
    if (empleado) empleados.add(empleado)
    if (nombre) nombres.add(nombre)
  }

  return {
    ffms,
    empleados,
    nombres
  }
}

function dentroAlcancePendientes(fila, indices) {
  if (indices === null) {
    return true
  }

  const ffm = normalizarLlave(fila?.usuario_ffm)
  const empleado = normalizarLlave(fila?.numero_empleado)
  const nombre = normalizarLlave(fila?.empleado_asignado)

  /*
    Se intenta primero FFM, después número de empleado
    y finalmente nombre exacto.

    Esto permite incluir placas con usuario_ffm NULL
    cuando sí existe número de empleado, como JF3830B.
  */
  if (ffm && indices.ffms.has(ffm)) return true
  if (empleado && indices.empleados.has(empleado)) return true
  if (nombre && indices.nombres.has(nombre)) return true

  return false
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

function textoContiene(valor, termino) {
  return upper(valor).includes(termino)
}

async function consultarPlacas(admin, perfil, payload) {
  const terminoOriginal = clean(payload.termino || payload.buscar || payload.valor)
  const termino = upper(terminoOriginal).replace(/-/g, '')

  if (termino.length < 2 || termino.length > 80) {
    return { ok: false, error: 'La búsqueda debe tener entre 2 y 80 caracteres.' }
  }

  /*
    CONSULTAR PLACAS es una consulta global de solo lectura.
    No se limita por FFM del técnico.

    PENDIENTES conserva su filtro por alcance mediante
    listaFfmPermitidos() y dentroAlcance().
  */
  const filas = await leerTodo(
    admin,
    'qiora_placas',
    'id,numero_unico,distrito,placa,estado_placa,sucursal,empleado_asignado,numero_empleado,usuario_ffm,puesto_empleado,marca,modelo,numero_serie,ultimo_kilometraje,fecha_ultimo_kilometraje'
  )

  const encontrados = filas.filter(f => {
    const placaNormalizada = upper(f.placa).replace(/-/g, '')

    return placaNormalizada.includes(termino) ||
      textoContiene(f.usuario_ffm, termino) ||
      textoContiene(f.numero_empleado, termino) ||
      textoContiene(f.numero_unico, termino) ||
      textoContiene(f.empleado_asignado, termino)
  })

  if (!encontrados.length) {
    return {
      ok: true,
      total: 0,
      mensaje: `🔎 CONSULTAR PLACAS\n\nSin resultados para: ${terminoOriginal}`
    }
  }

  const lineas = [
    '🔎 CONSULTAR PLACAS',
    '',
    `Resultados: ${encontrados.length}`
  ]

  for (const f of encontrados.slice(0, 20)) {
    lineas.push('')
    lineas.push(`🚘 ${f.placa || 'SIN PLACA'} | ${f.numero_unico || 'SIN NÚMERO ÚNICO'}`)
    lineas.push(`FFM: ${f.usuario_ffm || 'NO REGISTRADO'}`)
    lineas.push(`Empleado: ${f.empleado_asignado || 'NO REGISTRADO'}${f.numero_empleado ? ` (${f.numero_empleado})` : ''}`)
    lineas.push(`Distrito: ${f.distrito || 'NO IDENTIFICADO'}`)
    lineas.push(`Sucursal: ${f.sucursal || 'NO REGISTRADA'}`)
    lineas.push(`Vehículo: ${[f.marca, f.modelo].filter(Boolean).join(' ') || 'NO REGISTRADO'}`)
    lineas.push(`Último KM: ${f.ultimo_kilometraje ?? 'NO REGISTRADO'}`)
    lineas.push(`Fecha último KM: ${f.fecha_ultimo_kilometraje || 'NO REGISTRADA'}`)
  }

  if (encontrados.length > 20) {
    lineas.push('', `Mostrando 20 de ${encontrados.length} resultados.`)
  }

  return {
    ok: true,
    total: encontrados.length,
    resultados: encontrados.slice(0, 20),
    mensaje: lineas.join('\n').slice(0, 4000)
  }
}

async function pendientesKilometraje(admin, perfil) {
  const usuarios = await usuariosAlcancePendientes(admin, perfil)
  const indices = indicesAlcance(usuarios)

  const filas = await leerTodo(
    admin,
    'qiora_kilometrajes_pendientes',
    'id,numero_unico,distrito,placa,empleado_asignado,numero_empleado,usuario_ffm,sucursal,modelo,semana',
    'id'
  )

  let pendientes

  if (esAdminPadre(perfil)) {
    pendientes = filas
  } else if (esAdminDistrito(perfil)) {
    const distrito = upper(perfil?.distrito)
    pendientes = filas.filter(
      f => upper(f?.distrito) === distrito
    )
  } else {
    pendientes = filas.filter(
      f => dentroAlcancePendientes(f, indices)
    )
  }

  const semana =
    pendientes[0]?.semana ||
    filas[0]?.semana ||
    ''

  const puesto = upper(perfil?.puesto)
  const distrito = upper(perfil?.distrito)

  let alcanceTexto = ''

  if (esAdminPadre(perfil)) {
    alcanceTexto = 'NACIONAL'
  } else if (esAdminDistrito(perfil)) {
    alcanceTexto = distrito || 'DISTRITO'
  } else if (esCoordinador(perfil)) {
    alcanceTexto = `COORDINADOR / ${distrito || 'SIN DISTRITO'}`
  } else if (esAlmacenista(perfil)) {
    alcanceTexto = `ALMACÉN ${perfil?.usuario_almacen || ''} / ${distrito || ''}`.trim()
  } else {
    alcanceTexto = `TÉCNICO / ${distrito || 'SIN DISTRITO'}`
  }

  if (!pendientes.length) {
    return {
      ok: true,
      total: 0,
      semana,
      alcance: alcanceTexto,
      mensaje: [
        '⏳ KILOMETRAJES PENDIENTES',
        semana ? `Semana: ${semana}` : '',
        `Alcance: ${alcanceTexto}`,
        '',
        '✅ No hay vehículos pendientes en tu alcance.'
      ].filter(Boolean).join('\n')
    }
  }

  const lineas = [
    '⏳ KILOMETRAJES PENDIENTES',
    semana ? `Semana: ${semana}` : '',
    `Alcance: ${alcanceTexto}`,
    `Total: ${pendientes.length}`
  ].filter(Boolean)

  for (const p of pendientes) {
    const identificador =
      p.usuario_ffm ||
      p.numero_empleado ||
      'SIN FFM'

    const linea =
      `• ${p.empleado_asignado || 'SIN OPERADOR'} — ` +
      `${p.placa || 'SIN PLACA'} — ${identificador}`

    if (
      (lineas.join('\n').length + linea.length + 2) >
      3800
    ) {
      break
    }

    lineas.push(linea)
  }

  const mostrados =
    Math.max(0, lineas.length - 4)

  if (mostrados < pendientes.length) {
    lineas.push(
      `… Mostrando ${mostrados} de ${pendientes.length} pendientes.`
    )
  }

  return {
    ok: true,
    total: pendientes.length,
    semana,
    alcance: alcanceTexto,
    pendientes,
    mensaje: lineas.join('\n')
  }
}


function normalizarAlmacenTraspaso(v) {
  const x = upper(v)
  return /^\d{1,4}$/.test(x) ? x.padStart(4, '0') : x
}

function permisoTraspasos(perfil) {
  if (!perfil) return false
  const puesto = upper(perfil.puesto)
  return puesto === 'ADMIN_PADRE' ||
    ((puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' || puesto.startsWith('ADMIN_') || puesto === 'ALMACENISTA' || puesto === 'TECNICO') &&
      (perfil.traspasos === true || perfil.capturar_traspaso === true || perfil.acceso_traspasos === true))
}

async function tecnicosTraspaso(admin, almacenes) {
  const keys = [...new Set(almacenes.map(normalizarAlmacenTraspaso).filter(Boolean))]
  const { data, error } = await admin.from('almacen_usuarios')
    .select('id,usuario_almacen,nombre,puesto,distrito,telegram_chat_id,activo,auth_user_id')
    .eq('activo', true)
    .in('usuario_almacen', keys)
  if (error) throw new Error(error.message)
  return (data || []).filter(x => upper(x.puesto) === 'TECNICO')
}

async function validarTraspasoBot(admin, perfil, payload) {
  if (!perfil) return { ok:false, permitido:false, mensaje:'Telegram no está vinculado a un usuario activo.' }
  if (!permisoTraspasos(perfil)) return { ok:false, permitido:false, mensaje:'No tienes permiso para capturar traspasos.' }

  const origen = normalizarAlmacenTraspaso(payload.origen)
  const destino = normalizarAlmacenTraspaso(payload.destino)
  if (!origen || !destino || origen === destino) return { ok:false, permitido:false, mensaje:'Origen o destino inválido.' }

  const puesto = upper(perfil.puesto)
  const esPadre = puesto === 'ADMIN_PADRE'
  const esAdmin = puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' || puesto.startsWith('ADMIN_')
  const esAlmacenista = puesto === 'ALMACENISTA'
  const esTecnico = puesto === 'TECNICO'
  if (!(esPadre || esAdmin || esAlmacenista || esTecnico)) return { ok:false, permitido:false, mensaje:'Tu puesto no puede capturar traspasos.' }

  const tecnicos = await tecnicosTraspaso(admin, [origen, destino])
  if (tecnicos.length !== 2) return { ok:false, permitido:false, mensaje:'Ambos almacenes deben corresponder a técnicos activos.' }
  const [tOrigen, tDestino] = [
    tecnicos.find(x => normalizarAlmacenTraspaso(x.usuario_almacen) === origen),
    tecnicos.find(x => normalizarAlmacenTraspaso(x.usuario_almacen) === destino)
  ]
  if (!tOrigen || !tDestino) return { ok:false, permitido:false, mensaje:'No se identificaron ambos técnicos.' }

  if (!esPadre) {
    const distrito = upper(perfil.distrito)
    if (!distrito || upper(tOrigen.distrito) !== distrito || upper(tDestino.distrito) !== distrito) {
      return { ok:false, permitido:false, mensaje:'El origen y destino deben pertenecer a tu distrito.' }
    }
  }
  if (esTecnico && ![origen, destino].includes(normalizarAlmacenTraspaso(perfil.usuario_almacen))) {
    return { ok:false, permitido:false, mensaje:'Como técnico, solo puedes participar como origen o destino.' }
  }

  return {
    ok:true, permitido:true,
    origen, destino,
    distrito: esPadre ? upper(tOrigen.distrito) : upper(perfil.distrito),
    nombre_origen:tOrigen.nombre || '', nombre_destino:tDestino.nombre || '',
    tecnico_origen:tOrigen.nombre || '', tecnico_destino:tDestino.nombre || '',
    puesto:perfil.puesto || '', usuario_almacen:normalizarAlmacenTraspaso(perfil.usuario_almacen)
  }
}

async function buscarAlmacenTraspaso(admin, perfil, payload) {
  if (!perfil || !permisoTraspasos(perfil)) return { ok:false, error:'No tienes permiso para capturar traspasos.' }
  const consulta = clean(payload.almacen)
  if (consulta.length < 1 || consulta.length > 100) return { ok:false, error:'Escribe un almacén o nombre válido.' }
  const { data, error } = await admin.from('almacen_usuarios')
    .select('usuario_almacen,nombre,puesto,distrito')
    .eq('activo', true)
    .eq('puesto', 'TECNICO')
    .limit(1000)
  if (error) throw new Error(error.message)
  const q = normalizarLlave(consulta)
  let lista = (data || []).filter(x => {
    if (upper(perfil.puesto) !== 'ADMIN_PADRE' && upper(x.distrito) !== upper(perfil.distrito)) return false
    return normalizarLlave(x.usuario_almacen) === q || normalizarLlave(x.nombre).includes(q)
  }).slice(0,20).map(x => ({ almacen:normalizarAlmacenTraspaso(x.usuario_almacen), nombre:x.nombre || '', distrito:x.distrito || '' }))
  return { ok:true, encontrados:lista }
}

async function buscarMaterialesTraspaso(admin, perfil, payload) {
  const validacion = await validarTraspasoBot(admin, perfil, payload)
  if (!validacion.ok) return validacion
  const origen = validacion.origen
  const consulta = upper(payload.consulta)
  if (consulta.length < 1 || consulta.length > 100) return { ok:false, error:'Escribe SKU o descripción.' }

  // En el flujo técnico -> técnico, el inventario del origen vive en stock_tecnicos.
  // stock_almacen queda reservado para movimientos cuyo origen sea un almacén de centro.
  const { data, error } = await admin.from('stock_tecnicos')
    .select('sku,material,centro,almacen,lote,cantidad,libre_utilizacion,trans_trasl,tecnico,solicita,disponible')
    .eq('almacen', origen)
    .gt('disponible', 0)
    .limit(2000)
  if (error) throw new Error(error.message)

  const agrupados = new Map()
  for (const r of data || []) {
    const sku = clean(r.sku)
    const desc = clean(r.material)
    if (!(upper(sku).includes(consulta) || upper(desc).includes(consulta))) continue
    const lote = clean(r.lote)
    const key = `${sku}|${lote}`
    const actual = agrupados.get(key) || { sku, material:sku, descripcion:desc, disponible:0, lote }
    actual.disponible += Number(r.disponible || 0)
    agrupados.set(key, actual)
  }

  return {
    ok:true,
    fuente_inventario:'stock_tecnicos',
    materiales:[...agrupados.values()].sort((a,b)=>a.sku.localeCompare(b.sku)).slice(0,50)
  }
}

async function buscarSeriesTraspaso(admin, perfil, payload) {
  const validacion = await validarTraspasoBot(admin, perfil, payload)
  if (!validacion.ok) return validacion
  const sku = clean(payload.sku)
  const lote = clean(payload.lote)
  if (!sku) return { ok:false, error:'Falta SKU.' }
  let q = admin.from('iq09_equipos').select('serie,material,descripcion,lote,estatus_sap,tipo_stock,almacen,distrito')
    .eq('almacen', validacion.origen).eq('material', sku).eq('tipo_stock', '01')
  if (lote) q = q.eq('lote', lote)
  const { data, error } = await q.limit(1000)
  if (error) throw new Error(error.message)
  const series = (data || []).filter(x => clean(x.serie)).map(x => ({ serie:x.serie, material:x.material, descripcion:x.descripcion || '', lote:x.lote || '' }))
  return { ok:true, series }
}

async function buscarSeriesDirectasTraspaso(admin, perfil, payload) {
  const validacion = await validarTraspasoBot(admin, perfil, payload)
  if (!validacion.ok) return validacion
  const solicitadas = [...new Set(String(payload.series || '').split(/[,;\n\s]+/).map(clean).filter(Boolean))]
  if (!solicitadas.length || solicitadas.length > 100) return { ok:false, error:'Indica entre 1 y 100 series.' }
  const { data, error } = await admin.from('iq09_equipos')
    .select('serie,material,descripcion,lote,estatus_sap,tipo_stock,almacen')
    .eq('almacen', validacion.origen)
    .in('serie', solicitadas)
    .eq('tipo_stock', '01')
    .limit(200)
  if (error) throw new Error(error.message)
  const encontradas = data || []
  const porGrupo = new Map()
  for (const x of encontradas) {
    const key = `${x.material}|${x.lote}`
    const g = porGrupo.get(key) || { sku:x.material, descripcion:x.descripcion || '', lote:x.lote || '', series:[], cantidad:0 }
    g.series.push(x.serie); g.cantidad++
    porGrupo.set(key,g)
  }
  const vistas = new Set(encontradas.map(x=>x.serie))
  const no_encontradas = solicitadas.filter(x=>!vistas.has(x))
  return { ok:true, materiales:[...porGrupo.values()], no_encontradas, rechazadas:[] }
}

function mensajeTraspasoNuevo(folio, validacion, materiales, capturista) {
  const lineas = [
    '🚚 NUEVO TRASPASO', '',
    `Folio: ${folio}`,
    `Distrito: ${validacion.distrito}`,
    '', 'ORIGEN',
    `${validacion.origen} | ${validacion.nombre_origen}`,
    '', 'DESTINO',
    `${validacion.destino} | ${validacion.nombre_destino}`,
    '', 'MATERIALES'
  ]
  for (const m of materiales) {
    lineas.push(`${m.sku} | ${m.descripcion || ''}`)
    lineas.push(`Cantidad: ${m.cantidad} | Lote: ${m.lote || 'SIN LOTE'}`)
    if (Array.isArray(m.series) && m.series.length) lineas.push(`Series: ${m.series.join(', ')}`)
  }
  lineas.push('', `Capturó: ${capturista}`, 'Estado: PENDIENTE')
  return lineas.join('\n').slice(0,3900)
}

async function confirmarTraspasoBot(admin, perfil, payload) {
  const validacion = await validarTraspasoBot(admin, perfil, payload)
  if (!validacion.ok) return validacion
  if (!perfil.auth_user_id) return { ok:false, error:'El usuario no tiene auth_user_id; no se puede registrar con seguridad.' }
  const materiales = Array.isArray(payload.materiales) ? payload.materiales : []
  if (!materiales.length || materiales.length > 100) return { ok:false, error:'No hay materiales válidos.' }

  const normalizados = []
  for (const m of materiales) {
    const sku = clean(m.sku || m.material)
    const lote = clean(m.lote)
    const cantidad = Number(m.cantidad)
    const series = Array.isArray(m.series) ? [...new Set(m.series.map(clean).filter(Boolean))] : []
    if (!sku || !Number.isFinite(cantidad) || cantidad <= 0) return { ok:false, error:`Material o cantidad inválida: ${sku || 'SIN SKU'}` }

    const { data: stocksBase, error: stockError } = await admin.from('stock_tecnicos')
      .select('sku,material,almacen,disponible,lote')
      .eq('almacen', validacion.origen).eq('sku', sku).limit(200)
    if (stockError) throw new Error(stockError.message)
    const stocks = (stocksBase || []).filter(x => (clean(x.lote) || 'NA') === (lote || 'NA'))
    const disponible = stocks.reduce((n,x)=>n+Number(x.disponible || 0),0)
    if (disponible < cantidad) return { ok:false, error:`Stock insuficiente para ${sku}. Disponible: ${disponible}; solicitado: ${cantidad}.` }

    if (lote.toUpperCase().startsWith('TPE') && lote.toUpperCase() !== 'TPE USADO') {
      if (series.length !== cantidad) return { ok:false, error:`El material ${sku} requiere exactamente ${cantidad} series.` }
      const { data: equipos, error: equipoError } = await admin.from('iq09_equipos')
        .select('serie,material,lote,almacen,tipo_stock')
        .eq('almacen', validacion.origen).eq('material', sku).eq('lote', lote)
        .eq('tipo_stock','01').in('serie',series).limit(200)
      if (equipoError) throw new Error(equipoError.message)
      const disponibles = new Set((equipos || []).map(x=>x.serie))
      const faltan = series.filter(x=>!disponibles.has(x))
      if (faltan.length) return { ok:false, error:`Series no disponibles en origen: ${faltan.join(', ')}` }
    } else if (series.length) {
      return { ok:false, error:`El lote ${lote} no está configurado como material serializado; no se aceptan series manuales.` }
    }
    const desc = clean(m.descripcion || stocks?.[0]?.material)
    normalizados.push({ sku, material:sku, descripcion:desc, cantidad, lote:lote || 'NA', series })
  }

  const capturista = `${perfil.usuario_almacen} | ${perfil.nombre || ''}`.trim()
  const { data: creado, error: crearError } = await admin.rpc('qiora_crear_traspaso_bot', {
    p_distrito: validacion.distrito,
    p_origen: validacion.origen,
    p_destino: validacion.destino,
    p_solicitado_por: capturista,
    p_tecnico_origen: validacion.nombre_origen,
    p_tecnico_destino: validacion.nombre_destino,
    p_materiales: normalizados,
    p_creado_por: perfil.auth_user_id,
    p_centro: validacion.distrito
  })
  if (crearError) throw new Error(crearError.message)
  const registro = Array.isArray(creado) ? creado[0] : creado
  if (!registro?.folio_control) throw new Error('Supabase no devolvió el folio de control.')

  const folio = registro.folio_control
  const mensaje = mensajeTraspasoNuevo(folio, validacion, normalizados, capturista)
  const tecnicosNotificacion = await tecnicosTraspaso(admin, [validacion.origen, validacion.destino])
  const perfilOrigen = tecnicosNotificacion.find(x=>normalizarAlmacenTraspaso(x.usuario_almacen)===validacion.origen)
  const perfilDestino = tecnicosNotificacion.find(x=>normalizarAlmacenTraspaso(x.usuario_almacen)===validacion.destino)
  const chatsPrivados = [perfilOrigen, perfilDestino]
    .filter(x=>clean(x?.telegram_chat_id))
  const privados = [...new Map(chatsPrivados.map(x=>[clean(x.telegram_chat_id),x])).values()]
    .map(x=>({ telegram_chat_id:clean(x.telegram_chat_id), usuario:x.usuario_almacen, mensaje }))

  const distritos = [...new Set([upper(perfilOrigen?.distrito), upper(perfilDestino?.distrito)].filter(Boolean))]
  const { data: configs, error: cfgError } = await admin.from('qiora_distritos_telegram')
    .select('centro,chat_traspasos').in('centro',distritos)
  if (cfgError) throw new Error(cfgError.message)
  const grupos = [...new Map((configs || []).filter(x=>clean(x.chat_traspasos)).map(x=>[clean(x.chat_traspasos),{
    chat_id:clean(x.chat_traspasos), distrito:clean(x.centro), mensaje
  }])).values()]

  const avisos = [
    ...privados.map(x=>({folio_control:folio,destino:`PRIVADO:${x.telegram_chat_id}`,estado:'PENDIENTE',telegram_notificado:false,actualizado_en:new Date().toISOString()})),
    ...grupos.map(x=>({folio_control:folio,destino:`GRUPO:${x.distrito}`,estado:'PENDIENTE',telegram_notificado:false,actualizado_en:new Date().toISOString()}))
  ]
  if (avisos.length) {
    const { error: avisoError } = await admin.from('qiora_traspasos_avisos').upsert(avisos,{onConflict:'folio_control,destino'})
    if (avisoError) throw new Error(`Traspaso guardado (${folio}), pero no se pudieron preparar avisos: ${avisoError.message}`)
  }

  return {
    ok:true, folio_control:folio, mensaje:`✅ TRASPASO REGISTRADO\n\nFolio: ${folio}\nDistrito: ${validacion.distrito}\nOrigen: ${validacion.origen} | ${validacion.nombre_origen}\nDestino: ${validacion.destino} | ${validacion.nombre_destino}\nMateriales: ${normalizados.length}\nEstado: PENDIENTE`,
    avisos_privados:privados,
    grupos_notificar:grupos,
    grupos_notificados:grupos.map(x=>x.distrito),
    folio
  }
}

async function marcarAvisoTraspaso(admin, payload) {
  const folio = clean(payload.folio_control)
  const destino = clean(payload.destino)
  if (!folio || !destino) return { ok:false, error:'Falta folio_control o destino del aviso.' }
  const { error } = await admin.from('qiora_traspasos_avisos').update({
    estado: payload.error ? 'ERROR' : 'ENVIADO',
    error: payload.error ? clean(payload.error).slice(0,1000) : null,
    telegram_notificado: !payload.error,
    telegram_notificado_en: payload.error ? null : new Date().toISOString(),
    actualizado_en:new Date().toISOString()
  }).eq('folio_control',folio).eq('destino',destino)
  if (error) throw new Error(error.message)
  return { ok:true }
}

async function listarTraspasosBot(admin, perfil, payload) {
  if (!perfil || !permisoTraspasos(perfil)) return { ok:false,error:'No tienes permiso para consultar traspasos.' }
  let q = admin.from('qiora_traspasos').select('folio_control,folio_sap,distrito,origen,destino,solicitado_por,tecnico_origen,tecnico_destino,estado,materiales,creado_en').order('creado_en',{ascending:false}).limit(100)
  const puesto = upper(perfil.puesto)
  if (puesto === 'ADMIN_PADRE') {
    // alcance nacional
  } else if (puesto === 'ADMIN' || puesto === 'ADMINISTRADOR' || puesto.startsWith('ADMIN_') || puesto === 'ALMACENISTA') {
    q = q.eq('distrito',perfil.distrito)
  } else {
    const almacen = normalizarAlmacenTraspaso(perfil.usuario_almacen)
    q = q.eq('distrito',perfil.distrito).or(`origen.eq.${almacen},destino.eq.${almacen}`)
  }
  const estado = clean(payload.estado)
  if (estado) q = q.eq('estado',estado)
  const objetivo = upper(payload.objetivo)
  if (objetivo && objetivo !== 'MIOS' && objetivo !== 'TODOS') {
    const alm = normalizarAlmacenTraspaso(objetivo)
    q = q.or(`origen.eq.${alm},destino.eq.${alm}`)
  }
  const { data,error } = await q
  if (error) throw new Error(error.message)
  const rows = data || []
  const lineas = ['🚚 TRASPASOS',`Total: ${rows.length}`,'']
  for (const x of rows) lineas.push(`${x.folio_control || 'SIN FOLIO'} | ${x.estado}\n${x.origen} → ${x.destino}\n${x.tecnico_origen || ''} → ${x.tecnico_destino || ''}\n${new Date(x.creado_en).toLocaleString('es-MX')}`,'')
  return { ok:true, traspasos:rows, mensaje:lineas.join('\n').slice(0,3900) }
}

async function accionMigrada(admin, payload) {
  const accion = clean(payload.accion || payload.action)

  if (accion === 'telegram_registrar') {
    return registrarTelegram(admin, payload)
  }

  const perfil = await perfilTelegram(admin, payload.telegram_chat_id)

  if (accion === 'telegram_traspaso_nombre_almacen') return buscarAlmacenTraspaso(admin, perfil, payload)
  if (accion === 'telegram_traspaso_validar') return validarTraspasoBot(admin, perfil, payload)
  if (accion === 'telegram_traspaso_buscar_materiales') return buscarMaterialesTraspaso(admin, perfil, payload)
  if (accion === 'telegram_traspaso_series') return buscarSeriesTraspaso(admin, perfil, payload)
  if (accion === 'telegram_traspaso_buscar_series_directas') return buscarSeriesDirectasTraspaso(admin, perfil, payload)
  if (accion === 'telegram_traspaso_confirmar') return confirmarTraspasoBot(admin, perfil, payload)
  if (accion === 'telegram_traspasos') return listarTraspasosBot(admin, perfil, payload)
  if (accion === 'telegram_traspaso_marcar_aviso') return marcarAvisoTraspaso(admin, payload)

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
