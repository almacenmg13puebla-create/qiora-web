import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// La credencial se valida con la misma RPC utilizada por la API de Traspasos.
// No se requieren listas de tokens en variables de entorno de Vercel.
async function autorizar(admin, body) {
  const distrito = upper(body?.distrito)
  const token = clean(body?.token)
  if (!/^[A-Z]{2,5}[0-9]{1,5}$/.test(distrito) || !token) return ''

  const { data: valido, error } = await admin.rpc('qiora_excel_validar_credencial', {
    p_distrito: distrito,
    p_token: token,
  })
  if (error) throw error
  return valido === true ? distrito : ''
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Variables de Supabase incompletas en Vercel.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function tsv(value) {
  return clean(value).replace(/[\t\r\n]+/g, ' ').replace(/\u0000/g, '')
}

const CAMPOS = [
  'ID_COMANDO', 'DISTRITO', 'USUARIO_SOLICITA', 'NOMBRE_SOLICITA',
  'TELEGRAM_CHAT_ID', 'PROCESO', 'ESTADO', 'FECHA_INICIO',
  'FECHA_FIN', 'RESULTADO', 'PARAMETRO', 'EQUIPO', 'SERIE', 'RESULTADO_MAC'
]

export async function POST(request) {
  let body
  try { body = await request.json() }
  catch { return respond({ ok: false, error: 'JSON invalido' }, 400) }

  // La validacion ocurre antes de reclamar o actualizar cualquier comando.
  let admin, distrito
  try {
    admin = adminClient()
    distrito = await autorizar(admin, body)
  } catch (e) {
    console.error('Comandos SAP autenticacion:', e.message)
    return respond({ ok: false, error: 'Error validando credencial Excel' }, 500)
  }
  if (!distrito) return respond({ ok: false, error: 'TOKEN_INVALIDO' }, 401)

  const accion = upper(body.action || body.accion)
  const pc = upper(body.pc)
  if (!/^[A-Z0-9_.-]{1,80}$/.test(pc)) return respond({ ok: false, error: 'PC_INVALIDA' }, 400)

  try {
    if (accion === 'RECLAMAR_COMANDO') {
      const { data, error } = await admin.rpc('qiora_reclamar_comando_sap', {
        p_distrito: distrito, p_pc: pc,
      })
      if (error) throw error
      const orden = Array.isArray(data) ? data[0] : data
      const valores = orden ? [
        orden.id_comando, orden.distrito, orden.usuario_solicita, orden.nombre_solicita,
        orden.telegram_chat_id, orden.proceso, orden.estado, orden.fecha_inicio,
        orden.fecha_fin, orden.resultado, orden.parametro, orden.equipo,
        orden.serie || orden.parametro, orden.resultado_mac,
      ] : null
      const salida = CAMPOS.join('\t') + '\n' + (valores ? valores.map(tsv).join('\t') + '\n' : '')
      return new Response(salida, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    }

    if (accion === 'FINALIZAR_COMANDO') {
      const id = clean(body.id_comando)
      const estado = upper(body.estado)
      const resultado = clean(body.resultado).slice(0, 10000)
      const mac = clean(body.resultado_mac).slice(0, 1000)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return respond({ ok: false, error: 'UUID_INVALIDO' }, 400)
      if (!['REALIZADO','ERROR'].includes(estado)) return respond({ ok: false, error: 'ESTADO_INVALIDO' }, 400)
      const { data, error } = await admin.from('comandos_sap').update({
        estado, resultado, resultado_mac: mac || null,
        fecha_fin: new Date().toISOString(), actualizado_en: new Date().toISOString(),
      })
        .eq('id_comando', id).eq('distrito', distrito)
        .eq('pc_ejecutora', pc).eq('estado', 'EJECUTANDO')
        .select('id_comando')
      if (error) throw error
      if (!data?.length) return respond({ ok: false, error: 'ORDEN_NO_RECLAMADA_POR_ESTA_PC_O_YA_FINALIZADA' }, 409)
      return respond({ ok: true, id_comando: id, estado })
    }

    return respond({ ok: false, error: 'ACCION_INVALIDA' }, 400)
  } catch (e) {
    console.error('QIORA COMANDOS SAP:', e.message)
    return respond({ ok: false, error: 'Error de procesamiento de comandos SAP' }, 500)
  }
}
