import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

function responder(error, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !serviceKey) return responder('Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel (solo servidor).', 503)
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return responder('Sesión requerida.', 401)
  const jwt = header.slice(7)
  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: authError } = await authClient.auth.getUser(jwt)
  if (authError || !user) return responder('Sesión no válida.', 401)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: caller, error: callerError } = await admin.from('almacen_usuarios')
    .select('distrito,activo,puesto,administrar_permisos').eq('auth_user_id', user.id).eq('activo', true).maybeSingle()
  if (callerError || !caller || (caller.administrar_permisos !== true && String(caller.puesto||'').toUpperCase() !== 'ADMIN_'+String(caller.distrito||'').toUpperCase() && String(caller.puesto||'').toUpperCase() !== 'ADMIN_PADRE')) return responder('No autorizado para crear usuarios.', 403)

  let payload
  try { payload = await request.json() } catch { return responder('Datos JSON inválidos.') }
  if (String(payload.puesto||'').toUpperCase().startsWith('ADMIN_') || String(payload.puesto||'').toUpperCase()==='ADMIN_PADRE') return responder('Los roles administrativos solo pueden asignarse mediante el procedimiento de alta de distrito.',403)
  delete payload.distrito
  delete payload.auth_user_id
  delete payload.fecha_alta
  delete payload.fecha_baja
  if (payload.permisos && typeof payload.permisos === 'object') { for (const k of ['administrar_distritos','administrar_permisos']) delete payload.permisos[k] }
  const nombre = String(payload.nombre || '').trim()
  const identificador = String(payload.usuario_almacen || '').trim()
  const clave = String(payload.clave || '')
  const empleado = String(payload.numero_empleado || '').trim()
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(identificador)) return responder('Usuario/almacén inválido (2 a 40 caracteres alfanuméricos).')
  if (nombre.length < 3 || nombre.length > 200) return responder('Nombre inválido.')
  if (clave.length < 6 || clave.length > 100) return responder('La clave debe contener entre 6 y 100 caracteres.')
  if (empleado && !/^\d{1,30}$/.test(empleado)) return responder('Número de empleado inválido.')
  const { data: repetido, error: checkError } = await admin.from('almacen_usuarios').select('id').eq('distrito', caller.distrito).eq('usuario_almacen', identificador).limit(1)
  if (checkError) return responder('Error verificando duplicados: ' + checkError.message, 500)
  if (repetido?.length) return responder('Ya existe ese usuario/almacén.')
  const correoAutenticacion = `${identificador.toLowerCase()}@qiora.local`
  // Mantener compatibilidad con el inicio de sesión existente de QIORA.
  const { data: authCreated, error: createError } = await admin.auth.admin.createUser({
    email: correoAutenticacion,
    password: `QIORA#${clave}`,
    email_confirm: true,
  })
  if (createError || !authCreated?.user) return responder('No se pudo crear la cuenta Auth: ' + (createError?.message || ''), 400)
  const uid = authCreated.user.id
  const datos = { ...payload, usuario_almacen: identificador, nombre, numero_empleado: empleado }
  delete datos.clave
  // Las fechas laborales son asignadas exclusivamente por Supabase.
  delete datos.fecha_alta
  delete datos.fecha_baja
  try {
    const { data, error } = await admin.rpc('qiora_usuarios_crear_servidor', { p_auth_id: uid, p_datos: datos, p_distrito: caller.distrito })
    if (error || !data) throw new Error(error?.message || 'No se pudo guardar el perfil')
    return NextResponse.json({ ok: true })
  } catch (error) {
    // Compensación: eliminar la cuenta Auth si falló la creación del perfil.
    const { error: rollback } = await admin.auth.admin.deleteUser(uid)
    if (rollback) return responder(`Fallo al crear el perfil (${error.message}). Requiere intervención administrativa para la cuenta Auth ${uid}.`, 500)
    return responder(`Fallo al crear perfil: ${error.message}. Se revirtió el alta Auth.`, 500)
  }
}
