import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const fail = (error, status=400) => NextResponse.json({ ok:false, error }, { status })
const norm = v => String(v ?? '').trim().toUpperCase()

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return fail('Variables Supabase incompletas.', 503)

  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return fail('Inicia sesión.', 401)

  const publicClient = createClient(url, anon, { auth:{ persistSession:false, autoRefreshToken:false } })
  const { data:{ user }, error:userError } = await publicClient.auth.getUser(auth.slice(7))
  if (userError || !user) return fail('Sesión inválida.', 401)

  let body
  try { body = await request.json() } catch { return fail('JSON inválido.') }
  const sku = String(body.sku ?? '').trim()
  const almacen = String(body.almacen ?? '').trim()
  if (!sku || !/^\d{1,4}$/.test(almacen)) return fail('SKU o almacén inválido.')

  const admin = createClient(url, service, { auth:{ persistSession:false, autoRefreshToken:false } })
  const { data: actor, error:actorError } = await admin.from('almacen_usuarios')
    .select('distrito,usuario_almacen,activo,solicitud_material,acceso_almacen,acceso_coordinador,administrar_permisos')
    .eq('auth_user_id', user.id).eq('activo', true).maybeSingle()
  if (actorError || !actor) return fail('Usuario no autorizado.', 403)

  const target = almacen.padStart(4,'0')
  const own = String(actor.usuario_almacen ?? '').padStart(4,'0')
  const allowed = target === own || actor.acceso_almacen || actor.acceso_coordinador || actor.administrar_permisos
  if (!allowed || (!actor.solicitud_material && !actor.acceso_almacen)) return fail('Almacén no autorizado.',403)

  const distrito = norm(actor.distrito)
  const { data: material, error:matError } = await admin.from('materiales')
    .select('sku,material,maximo,factor_empaque,minimo_reposicion,cantidad_reposicion,activo')
    .eq('sku', sku).eq('activo', true).maybeSingle()
  if (matError) return fail('No se pudo consultar la configuración del material. Ejecuta primero la migración SQL.',500)

  if (!material) return NextResponse.json({
    ok:true, sku, aplica:false, motivo:'SKU sin configuración en materiales.'
  })

  const { data: rows, error:stockError } = await admin.from('stock_tecnicos')
    .select('disponible')
    .eq('distrito', distrito).eq('almacen', target).eq('sku', sku)
  if (stockError) return fail('No se pudo consultar stock_tecnicos.',500)

  const existencia = (rows || []).reduce((sum,row)=>sum+Math.max(Number(row.disponible)||0,0),0)
  const minimo = Number(material.minimo_reposicion)||0
  const empaque = Number(material.cantidad_reposicion)||0
  const aplica = minimo > 0 && empaque > 0 && existencia < minimo

  return NextResponse.json({
    ok:true, sku, almacen:target, existencia,
    minimo_reposicion:minimo,
    cantidad_reposicion:empaque,
    maximo:material.maximo == null ? null : Number(material.maximo),
    aplica,
    cantidad_sugerida:aplica ? empaque : 0,
    descripcion:material.material
  }, { headers:{'Cache-Control':'no-store'} })
}
