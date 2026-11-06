import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const norm = v => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const txt = v => String(v ?? '').trim()
const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const money = v => Math.round(num(v) * 100) / 100
// Convierte fechas ISO, DD/MM/AAAA y numeros seriales de Excel (SAP/Excel).
const dateValue = v => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  // Excel usa como origen practico el 30/12/1899 (sistema 1900).
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial >= 20000 && serial <= 100000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    }
  }
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(s)
  if (dm) {
    const d = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]))
    return d.getFullYear() === Number(dm[3]) && d.getMonth() === Number(dm[2])-1 && d.getDate() === Number(dm[1]) ? d : null
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/.exec(s)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2])-1, Number(iso[3]))
    return d.getFullYear() === Number(iso[1]) && d.getMonth() === Number(iso[2])-1 && d.getDate() === Number(iso[3]) ? d : null
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}
const displayDate = v => {
  const d = dateValue(v)
  return d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : 'Sin fecha valida'
}

const inRange = (v, from, to) => {
  const d = dateValue(v)
  if (!d) return !from && !to
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (from && day < new Date(`${from}T00:00:00`).getTime()) return false
  if (to && day > new Date(`${to}T23:59:59`).getTime()) return false
  return true
}
const alm = v => {
  const s = txt(v).replace(/^'+/, '')
  return /^\d{1,4}$/.test(s) ? s.padStart(4, '0') : s.toUpperCase()
}
const pages = async (queryFactory, limit = 1000) => {
  const out = []
  for (let start = 0; start < 50000; start += limit) {
    const { data, error } = await queryFactory(start, start + limit - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < limit) break
  }
  return out
}
const response = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function GET(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return response({ ok: false, error: 'Falta configurar Supabase en el servidor.' }, 503)

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return response({ ok: false, error: 'Inicia sesión para consultar el dashboard.' }, 401)

  const publicDb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await publicDb.auth.getUser(jwt)
  if (authError || !authData?.user) return response({ ok: false, error: 'Sesión inválida.' }, 401)

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await db.from('almacen_usuarios')
    .select('usuario_almacen,nombre,distrito,puesto,activo,dashboard')
    .eq('auth_user_id', authData.user.id).maybeSingle()
  if (actorError || !actor || actor.activo !== true) return response({ ok: false, error: 'No se encontró un perfil activo.' }, 403)

  const puesto = norm(actor.puesto)
  const padre = puesto === 'ADMIN_PADRE'
  if (!padre && actor.dashboard !== true) return response({ ok: false, error: 'Tu perfil no tiene permiso para consultar el Dashboard.' }, 403)

  const params = new URL(request.url).searchParams
  const from = params.get('desde') || ''
  const to = params.get('hasta') || ''
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
    return response({ ok: false, error: 'El rango de fechas no es válido.' }, 400)
  }

  let distritos = [norm(actor.distrito)]
  if (padre) {
    const { data: users, error: usersError } = await db.from('almacen_usuarios').select('distrito').eq('activo', true).not('distrito', 'is', null).limit(10000)
    if (usersError) return response({ ok: false, error: `No se pudieron identificar los distritos: ${usersError.message}` }, 500)
    distritos = [...new Set((users || []).map(x => norm(x.distrito)).filter(Boolean))].sort()
  }
  if (!distritos.length) return response({ ok: true, distrito: padre ? 'TODOS' : norm(actor.distrito), kpis: {}, tablas: {}, detalles: {}, advertencias: ['No hay distritos activos asociados a usuarios.'] })

  const advertencias = []
  const all = { solicitudes: [], traspasos: [], recolecciones: [], recoTP: [], recoTPSeries: [], auditorias: [], stock: [], iq09: [], costos: [], stockCentro: [], usuarios: [] }
  const optionalRows = async (name, factory) => {
    try { return await pages(factory) }
    catch (e) { advertencias.push(`${name}: ${e.message || 'No disponible'}`); return [] }
  }

  for (const distrito of distritos) {
    const [users, traspasos, iq09, stockCentro] = await Promise.all([
      optionalRows(`Usuarios ${distrito}`, (a,b) => db.from('almacen_usuarios').select('usuario_almacen,nombre,distrito,puesto,activo').eq('distrito', distrito).range(a,b)),
      optionalRows(`Traspasos ${distrito}`, (a,b) => db.from('qiora_traspasos').select('*').eq('distrito', distrito).order('creado_en', { ascending: true }).range(a,b)),
      optionalRows(`IQ09 ${distrito}`, (a,b) => db.from('iq09_equipos').select('*').eq('distrito', distrito).range(a,b)),
      optionalRows(`Stock centro ${distrito}`, (a,b) => db.from('stock_almacen').select('*').eq('centro', distrito).range(a,b)),
    ])
    all.usuarios.push(...users)
    all.traspasos.push(...traspasos)
    all.iq09.push(...iq09)
    all.stockCentro.push(...stockCentro)
    const tp = await optionalRows(`RECUS TP ${distrito}`, (a,b) => db.from('recus_tp').select('*').eq('distrito', distrito).range(a,b))
    all.recoTP.push(...tp)
    const tpIds = tp.map(r => r.id).filter(v => v !== null && v !== undefined)
    for (let i = 0; i < tpIds.length; i += 100) {
      const ids = tpIds.slice(i, i + 100)
      const series = await optionalRows(`Series RECUS TP ${distrito}`, (a,b) => db.from('recus_tp_series').select('*').in('recu_tp_id', ids).range(a,b))
      all.recoTPSeries.push(...series)
    }
  }

  for (const table of ['auditorias_materiales','auditorias_herramientas','auditorias_equipos']) {
    const rows = await optionalRows(table, (a,b) => db.from(table).select('*').range(a,b))
    all.auditorias.push(...rows.map(r => ({...r, _tipo:table.replace('auditorias_','').toUpperCase()})))
  }
  all.stock = await optionalRows('Stock técnicos', (a,b) => db.from('stock_tecnicos').select('*').range(a,b))
  all.costos = await optionalRows('Costos SAP', (a,b) => db.from('costos_sap').select('*').range(a,b))

  // Solicitudes: se reutiliza el RPC de consulta que ya usa la pantalla Ver Solicitudes.
  try {
    const { data, error } = await publicDb.rpc('qiora_material_listar', {
      p_folio: '', p_almacen: '', p_estatus: '', p_desde: from || null, p_hasta: to || null,
    })
    if (error) throw error
    all.solicitudes = (Array.isArray(data) ? data : []).filter(r => {
      const d = norm(r.distrito || r.centro || '')
      return padre ? (!d || distritos.includes(d)) : (!d || d === norm(actor.distrito))
    })
  } catch (e) {
    advertencias.push(`Solicitudes (qiora_material_listar): ${e.message || 'No disponible'}`)
  }

  // La tabla histórica de recolecciones se filtra por los almacenes de técnicos activos del distrito.
  const warehouses = new Set(all.usuarios.filter(u => u.activo === true && norm(u.puesto) === 'TECNICO').map(u => `${norm(u.distrito)}|${alm(u.usuario_almacen)}`))
  const recoByDistrict = await optionalRows('Recolecciones', (a,b) => db.from('recolecciones_equipos').select('*').range(a,b))
  all.recolecciones = recoByDistrict.filter(r => {
    const d = norm(r.distrito || '')
    const key = `${d || (distritos.length === 1 ? distritos[0] : '')}|${alm(r.almacen)}`
    return warehouses.has(key) || (d && distritos.includes(d))
  })

  const userByKey = new Map()
  const districtByWarehouse = new Map()
  all.usuarios.forEach(u => {
    const district=norm(u.distrito), warehouse=alm(u.usuario_almacen)
    userByKey.set(`${district}|${warehouse}`, txt(u.nombre) || warehouse)
    if(!districtByWarehouse.has(warehouse))districtByWarehouse.set(warehouse,new Set())
    districtByWarehouse.get(warehouse).add(district)
  })
  const costBySku = new Map()
  all.costos.forEach(c => { const sku = norm(c.sku || c.material); if(c.activo !== false && sku) costBySku.set(sku, num(c.costo_unitario ?? c.costo_por_pieza ?? c.costo ?? c.precio)) })
  const group = (rows, keyFn, create, add) => {
    const map = new Map()
    for (const row of rows) {
      const key = keyFn(row)
      if (!map.has(key)) map.set(key, create(row, key))
      add(map.get(key), row)
    }
    return [...map.values()]
  }
  const details = { solicitudes: {}, traspasos: {}, recolecciones: {}, recoleccionesEntregadasTP: {}, auditorias: {}, valor: {}, criticos: {}, recoleccionesPendientes: {}, materialesTraspasados: {}, materialesSolicitados: {} }

  const solicitudes = all.solicitudes.filter(r => inRange(r.fecha || r.creado_en, from, to))
  const solGroups = group(solicitudes, r => `${norm(r.distrito || actor.distrito)}|${alm(r.almacen)}|${txt(r.tecnico)}`, r => ({ key: `${norm(r.distrito || actor.distrito)}|${alm(r.almacen)}|${txt(r.tecnico)}`, distrito: norm(r.distrito || actor.distrito), almacen: alm(r.almacen), tecnico: txt(r.tecnico) || 'Sin técnico', pendientes: 0, entregadas: 0, total: 0, piezas: 0 }), (g,r) => {
    const status = norm(r.estatus || r.estado)
    if (status.includes('ENTREG') || status.includes('SURT') || status.includes('REAL')) g.entregadas++
    else g.pendientes++
    g.total++
    g.piezas += num(r.cantidad_total ?? r.cantidad ?? r.piezas) || 1
    if (!details.solicitudes[g.key]) details.solicitudes[g.key] = []
    details.solicitudes[g.key].push({ folio:r.folio, fecha:r.fecha, cantidad:r.cantidad_total ?? r.cantidad, estatus:r.estatus || r.estado, materiales:Array.isArray(r.materiales)?r.materiales:[] })
  })
  const materialSolMap = new Map()
  solicitudes.forEach(r => {
    const items = Array.isArray(r.materiales) ? r.materiales : [{ sku:r.sku || r.material, material:r.material, cantidad:r.cantidad_total ?? r.cantidad }]
    items.forEach(m => {
      const sku=txt(m.sku || m.material), desc=txt(m.material || m.descripcion), key=`${sku}|${desc}`
      if(!sku) return
      const g=materialSolMap.get(key)||{sku,material:desc,cantidad:0,movimientos:0}
      g.cantidad+=num(m.cantidad)||1;g.movimientos++;materialSolMap.set(key,g)
    })
  })
  const materialSol=[...materialSolMap.values()].sort((a,b)=>b.cantidad-a.cantidad)

  const traspasos = all.traspasos.filter(r => inRange(r.creado_en || r.fecha || r.created_at, from, to))
  const traGroups = group(traspasos, r => `${norm(r.distrito)}|${alm(r.origen)}|${txt(r.tecnico_origen || r.solicitado_por || r.creado_por)}`, r => ({ key:`${norm(r.distrito)}|${alm(r.origen)}|${txt(r.tecnico_origen || r.solicitado_por || r.creado_por)}`, distrito:norm(r.distrito), almacen:alm(r.origen), tecnico:txt(r.tecnico_origen || r.solicitado_por || r.creado_por) || 'Sin técnico', pendientes:0, realizados:0, error:0, total:0, piezas:0 }), (g,r) => {
    const st = norm(r.estado || r.estatus || '')
    if (st.includes('ERROR') || st.includes('RECHAZ')) g.error++
    else if (st.includes('REALIZ') || st.includes('COMPLET') || txt(r.folio_sap)) g.realizados++
    else g.pendientes++
    g.total++
    const mats = Array.isArray(r.materiales) ? r.materiales : []
    const qty = mats.reduce((n,x) => n + num(x.cantidad), 0) || num(r.cantidad) || 1
    g.piezas += qty
    if (!details.traspasos[g.key]) details.traspasos[g.key] = []
    details.traspasos[g.key].push({ folio:r.folio_control, fecha:r.creado_en, destino:r.destino, estado:r.estado, documento:r.documento_sap, materiales:mats })
  })
  const materialTra = new Map()
  traspasos.forEach(r => (Array.isArray(r.materiales) ? r.materiales : []).forEach(m => {
    const sku = txt(m.sku || m.material), desc = txt(m.descripcion || m.nombre || m.material), k = `${sku}|${desc}`
    const g = materialTra.get(k) || { sku, material:desc, cantidad:0, movimientos:0 }
    g.cantidad += num(m.cantidad); g.movimientos++; materialTra.set(k,g)
  }))

  const reco = all.recolecciones.filter(r => inRange(r.fecha || r.fecha_recepcion || r.creado_en, from, to))
  const auditoriaWarehouseSet = new Set(all.usuarios.filter(u => u.activo === true && norm(u.puesto) === 'TECNICO').map(u => `${norm(u.distrito)}|${alm(u.usuario_almacen)}`))
  const auditRows = all.auditorias.filter(r => {
    const d=norm(r.distrito), warehouse=alm(r.almacen)
    if(d) return distritos.includes(d)
    const mapped=districtByWarehouse.get(warehouse)
    const inferred=mapped && mapped.size===1 ? [...mapped][0] : ''
    return !!inferred && auditoriaWarehouseSet.has(`${inferred}|${warehouse}`)
  }).filter(r => inRange(r.fecha || r.created_at, from, to))
  const auditGroups = group(auditRows, r => `${norm(r.distrito || (distritos.length===1?distritos[0]:''))}|${alm(r.almacen)}|${txt(r.folio)}`, r => ({key:`${norm(r.distrito || (distritos.length===1?distritos[0]:''))}|${alm(r.almacen)}|${txt(r.folio)}`,distrito:norm(r.distrito || (distritos.length===1?distritos[0]:'')),almacen:alm(r.almacen),tecnico:txt(r.tecnico),folio:txt(r.folio),fecha:r.fecha,tipos:[],total:0}), (g,r) => {g.total++;if(!g.tecnico)g.tecnico=txt(r.tecnico);if(!g.fecha)g.fecha=r.fecha;if(!g.tipos.includes(r._tipo))g.tipos.push(r._tipo);if(!details.auditorias[g.key])details.auditorias[g.key]=[];details.auditorias[g.key].push({tipo:r._tipo,folio:r.folio,fecha:r.fecha,sku:r.sku,material:r.material,serie:r.serie,estado:r.estado,diferencia:r.diferencia})})
  const recoGroups = group(reco, r => `${norm(r.distrito || actor.distrito)}|${alm(r.almacen)}|${txt(r.tecnico || r.nombre)}`, r => ({key:`${norm(r.distrito || actor.distrito)}|${alm(r.almacen)}|${txt(r.tecnico || r.nombre)}`,distrito:norm(r.distrito || actor.distrito),almacen:alm(r.almacen),tecnico:txt(r.tecnico || r.nombre) || userByKey.get(`${norm(actor.distrito)}|${alm(r.almacen)}`) || 'Sin técnico',total:0}), (g,r) => {
    g.total++
    if (!details.recolecciones[g.key]) details.recolecciones[g.key] = []
    details.recolecciones[g.key].push({ fecha:r.fecha || r.fecha_recepcion, serie:r.serie, sku:r.material, material:r.descripcion, estado:r.estado })
  })
  // Una serie queda entregada a TP cuando aparece en RECUS TP, sin importar
  // que el folio de entrada siga PENDIENTE: ese folio es una conciliación posterior.
  const deliveredSeries = new Set(all.recoTPSeries.map(sr => {
    const h = all.recoTP.find(x => String(x.id) === String(sr.recu_tp_id))
    return h && norm(sr.serie) ? `${norm(h.distrito)}|${norm(sr.serie)}` : ''
  }).filter(Boolean))
  const tpHeaderById = new Map(all.recoTP.map(r => [String(r.id), r]))
  const tpSeriesSeen = new Set()
  const tpSeriesEvents = all.recoTPSeries.map(sr => {
    const h = tpHeaderById.get(String(sr.recu_tp_id)) || {}
    return { ...sr, distrito: h.distrito, pedido: h.pedido, salida: h.salida,
      fecha: h.fecha, folio_entrada: h.folio_entrada, estatus: h.estatus,
      cantidad: 1, almacen: h.almacen || '', tecnico: h.tecnico || '' }
  }).filter(r => distritos.includes(norm(r.distrito))).filter(r => {
    const key = `${norm(r.distrito)}|${norm(r.serie)}`
    if (!norm(r.serie) || tpSeriesSeen.has(key)) return false
    tpSeriesSeen.add(key)
    return true
  })
  const recoTPGroups = group(tpSeriesEvents.filter(r => inRange(r.fecha, from, to)), r => `${norm(r.distrito)}|${txt(r.pedido)}|${txt(r.salida)}`, r => ({key:`${norm(r.distrito)}|${txt(r.pedido)}|${txt(r.salida)}`,distrito:norm(r.distrito),almacen:txt(r.pedido),tecnico:txt(r.salida) || 'Totalplay',total:0,costo:0,costoSinIdentificar:0,folios:1}), (g,r) => {
    g.total++
    const sku = txt(r.sku)
    if (costBySku.has(norm(sku))) g.costo += costBySku.get(norm(sku))
    else g.costoSinIdentificar++
    if(!details.recoleccionesEntregadasTP[g.key])details.recoleccionesEntregadasTP[g.key]=[]
    details.recoleccionesEntregadasTP[g.key].push({fecha:r.fecha,serie:r.serie,sku:r.sku,material:r.material,lote:r.lote,pedido:r.pedido,salida:r.salida,folioEntrada:r.folio_entrada,estado:r.estatus,costo:costBySku.get(norm(sku)) ?? null})
  })
  recoTPGroups.forEach(g => { g.costo = money(g.costo) })

  const critGroups = new Map(), pendingGroups = new Map()
  const today = new Date(); today.setHours(0,0,0,0)
  let maxCritDays = 0, maxPendingDays = 0
  const seenPendingSeries = new Set()
  all.iq09.forEach(r => {
    const warehouse = alm(r.almacen), district = norm(r.distrito)
    if (!warehouse || !distritos.includes(district)) return
    // Pendientes por recibir: solo lote TPE USADO de técnicos activos.
    if (norm(r.lote) === 'TPE USADO' && !warehouses.has(`${district}|${warehouse}`)) return
    const serial = norm(r.serie), lot = norm(r.lote)
    const d = dateValue(r.fecha_modificacion || r.fecha_ingreso || r.fecha)
    const days = d ? Math.max(0, Math.floor((today - new Date(d.getFullYear(),d.getMonth(),d.getDate())) / 86400000)) : null
    const tech = userByKey.get(`${district}|${warehouse}`) || warehouse
    const key = `${district}|${warehouse}|${tech}`
    if (lot === 'TPE USADO' && serial && !deliveredSeries.has(`${district}|${serial}`) && !seenPendingSeries.has(`${district}|${serial}`)) {
      seenPendingSeries.add(`${district}|${serial}`)
      const g = pendingGroups.get(key) || {key,distrito:district,almacen:warehouse,tecnico:tech,total:0,maxDias:0}
      g.total++; if(days !== null){g.maxDias=Math.max(g.maxDias,days); maxPendingDays=Math.max(maxPendingDays,days);} pendingGroups.set(key,g)
      if (!details.recoleccionesPendientes[key]) details.recoleccionesPendientes[key]=[]
      details.recoleccionesPendientes[key].push({serie:r.serie,sku:r.material,material:r.descripcion,lote:r.lote,dias:days,fecha:displayDate(r.fecha_modificacion)})
    } else if (!lot.includes('TPE USADO') && days !== null && days > 30 && !lot.includes('TPI USADO') && !lot.includes('TPI HERRAM') && !lot.includes('TPI GARANT')) {
      const g = critGroups.get(key) || {key,distrito:district,almacen:warehouse,tecnico:tech,total:0,maxDias:0}
      g.total++; g.maxDias=Math.max(g.maxDias,days); maxCritDays=Math.max(maxCritDays,days); critGroups.set(key,g)
      if (!details.criticos[key]) details.criticos[key]=[]
      details.criticos[key].push({serie:r.serie,sku:r.material,material:r.descripcion,lote:r.lote,dias:days,fecha:displayDate(r.fecha_modificacion || r.fecha_ingreso || r.fecha)})
    }
  })

  const tecnicosActivos = new Map(
    all.usuarios.filter(u => u.activo === true && norm(u.puesto) === 'TECNICO')
      .map(u => [`${norm(u.distrito)}|${alm(u.usuario_almacen)}`, txt(u.nombre) || alm(u.usuario_almacen)])
  )
  const valGroups = new Map()
  all.stock.forEach(r => {
    const warehouse=alm(r.almacen), sku=txt(r.sku || r.material)
    const taggedDistrict=norm(r.distrito || r.centro)
    const mapped=districtByWarehouse.get(warehouse)
    const district=taggedDistrict ? taggedDistrict : (mapped && mapped.size===1 ? [...mapped][0] : '')
    if (!distritos.includes(district) || !warehouse || !sku || !tecnicosActivos.has(`${district}|${warehouse}`)) return
    const qty=num(r.disponible ?? r.libre_utilizacion ?? r.cantidad)
    if (qty<=0) return
    const cost=costBySku.get(sku) ?? 0, value=qty*cost, tech=tecnicosActivos.get(`${district}|${warehouse}`)
    const key=`${district}|${warehouse}|${tech}`
    const g=valGroups.get(key)||{key,distrito:district,almacen:warehouse,tecnico:tech,piezas:0,total:0}
    g.piezas+=qty;g.total+=value;valGroups.set(key,g)
    if(!details.valor[key])details.valor[key]=[]
    details.valor[key].push({sku,material:r.material,disponible:qty,costo:cost,valor:value,costoConocido:costBySku.has(sku)})
  })

  const centerGroups = new Map()
  all.stockCentro.forEach(r => {
    const district=norm(r.centro || r.distrito), sku=txt(r.sku || r.material)
    if (!distritos.includes(district) || !sku) return
    const qty=num(r.disponible ?? r.libre_utilizacion ?? r.cantidad ?? r.stock)
    const value=qty*(costBySku.get(sku) ?? 0)
    if(!centerGroups.has(district))centerGroups.set(district,{key:district,distrito:district,almacen:district,tecnico:'Stock de centro',total:0,piezas:0})
    const g=centerGroups.get(district);g.total+=value;g.piezas+=qty
    if (!details.valorCentro) details.valorCentro = {}
    if (!details.valorCentro[district]) details.valorCentro[district] = []
    details.valorCentro[district].push({sku,material:r.material,disponible:qty,costo:costBySku.get(sku) ?? 0,valor:value,costoConocido:costBySku.has(sku)})
  })

  if (!all.stockCentro.length) advertencias.push('Valor por centro: no se encontraron filas en stock_almacen para los distritos autorizados (columna centro).')
  const skuSinCosto = new Set()
  for (const r of [...all.stock, ...all.stockCentro]) {
    const sku = txt(r.sku || r.material)
    if (sku && !costBySku.has(sku)) skuSinCosto.add(sku)
  }
  if (skuSinCosto.size) advertencias.push(`Hay ${skuSinCosto.size} SKU sin costo SAP identificado; los importes de inventario son parciales.`)

  if (all.stockCentro.length && [...centerGroups.values()].every(x => x.total === 0)) advertencias.push('Valor por centro: hay registros en stock_almacen, pero el valor es 0. Revisa cantidades y precios en costos_sap; no se puede confirmar su costo total.')
  // Reportes de recolecciones: recibidas y enviadas a Totalplay, independientes.
  // Solo se incluyen filas con distrito explícito o almacén que pertenezca
  // inequívocamente a un distrito autorizado. Nunca se presupone MG13.
  const recoDistritoSeguro = r => {
    const marcado = norm(r.distrito || r.centro)
    if (marcado) return distritos.includes(marcado) ? marcado : ''
    const posibles = districtByWarehouse.get(alm(r.almacen))
    return posibles?.size === 1 && distritos.includes([...posibles][0]) ? [...posibles][0] : ''
  }
  const obtenerCosto = (r, cantidad) => {
    const exp = r.costo_total ?? r.valor_total ?? r.importe_total
    if (exp !== undefined && exp !== null && txt(exp) !== '') return { costo: money(exp), conocido: true }
    const unit = r.costo_unitario ?? r.costo_por_pieza ?? r.precio_unitario
    if (unit !== undefined && unit !== null && txt(unit) !== '') return { costo: money(num(unit) * cantidad), conocido: true }
    const sku = txt(r.sku || r.material || r.codigo_material)
    if (sku && costBySku.has(norm(sku))) return { costo: money(costBySku.get(norm(sku)) * cantidad), conocido: true }
    return { costo: null, conocido: false }
  }
  const fechaReporte = r => {
    const valor = r.fecha || r.fecha_recepcion || r.fecha_salida || r.fecha_entrega || r.creado_en || r.created_at
    const fecha = dateValue(valor)
    if (!fecha) return null
    return `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}`
  }
  const eventoReco = (r, distrito) => {
    const fecha = fechaReporte(r)
    if (!fecha) return null
    const cantidad = Math.max(1, num(r.cantidad ?? r.piezas ?? 1) || 1)
    const valor = obtenerCosto(r, cantidad)
    return { fecha, distrito, almacen: alm(r.almacen || r.pedido), serie: txt(r.serie || r.numero_serie),
      cantidad, costo: valor.costo, costoConocido: valor.conocido }
  }
  // Las recibidas se cuentan desde la tabla de recepciones; las enviadas,
  // desde recus_tp. No mezclar los dos procesos ni contar dos veces envíos.
  const recepcionesSinDistrito = all.recolecciones.filter(r => !recoDistritoSeguro(r)).length
  if (recepcionesSinDistrito) advertencias.push(`${recepcionesSinDistrito} recolección(es) sin distrito verificable excluidas del reporte para evitar mezclar centros.`)
  const eventosRecibidas = all.recolecciones
    .map(r => { const d = recoDistritoSeguro(r); return d ? eventoReco(r, d) : null })
    .filter(Boolean).filter(r => inRange(r.fecha, from, to))
  const eventosEnviadas = tpSeriesEvents
    .map(r => {
      const fecha = fechaReporte(r.fecha)
      if (!fecha) return null
      const sku = txt(r.sku)
      const conocido = costBySku.has(norm(sku))
      return { fecha, distrito: norm(r.distrito), almacen: alm(r.pedido), serie: txt(r.serie),
        cantidad: 1, costo: conocido ? money(costBySku.get(norm(sku))) : null, costoConocido: conocido }
    })
    .filter(Boolean).filter(r => inRange(r.fecha, from, to))
  if (!all.recoTP.length) advertencias.push('Recolecciones enviadas a TP: no hay filas disponibles en recus_tp; no se sustituyen por las recibidas.')
  const resumenEventos = eventos => ({
    cantidad: eventos.reduce((a, r) => a + r.cantidad, 0),
    costoConocido: money(eventos.reduce((a, r) => a + (r.costoConocido ? r.costo : 0), 0)),
    sinCosto: eventos.reduce((a, r) => a + (r.costoConocido ? 0 : r.cantidad), 0),
  })
  const reporteRecolecciones = {
    recibidas: { ...resumenEventos(eventosRecibidas), registros: eventosRecibidas },
    enviadasTP: { ...resumenEventos(eventosEnviadas), registros: eventosEnviadas },
  }

  // Recibidas y enviadas son procesos separados. El faltante es una diferencia
  // agregada del periodo, NO un cotejo por serie. Evitar inventar una meta de auditorías.
  const resumenDistrito = new Map(distritos.map(d => [d, {
    distrito:d, recibidasPiezas:0, recibidasCosto:0, recibidasSinCosto:0,
    entregadasPiezas:0, entregadasCosto:0, entregadasSinCosto:0,
    pendientesPiezas:0, pendientesCosto:0, pendientesSinCosto:0,
    faltantesPiezas:0, faltantesCosto:null,
    auditoriasRealizadas:0, auditoriasFaltantes:null,
    valorCajuela:0, valorCentro:0
  }]))
  for (const r of eventosRecibidas) {
    const g=resumenDistrito.get(r.distrito)
    if(!g)continue
    g.recibidasPiezas+=r.cantidad
    if(r.costoConocido)g.recibidasCosto+=r.costo
    else g.recibidasSinCosto+=r.cantidad
  }
  for (const r of eventosEnviadas) {
    const g=resumenDistrito.get(r.distrito)
    if(!g)continue
    g.entregadasPiezas+=r.cantidad
    if(r.costoConocido)g.entregadasCosto+=r.costo
    else g.entregadasSinCosto+=r.cantidad
  }
  for (const [key,items] of Object.entries(details.recoleccionesPendientes)) {
    const distrito=key.split('|')[0], g=resumenDistrito.get(distrito)
    if(!g)continue
    for (const r of items) {
      g.pendientesPiezas++
      const sku=txt(r.sku)
      if(costBySku.has(norm(sku)))g.pendientesCosto+=costBySku.get(norm(sku))
      else g.pendientesSinCosto++
    }
  }
  for (const r of auditGroups) {
    const g=resumenDistrito.get(r.distrito)
    if(g)g.auditoriasRealizadas++ // un folio auditado, no una fila de material
  }
  for (const r of valGroups.values()) {
    const g=resumenDistrito.get(r.distrito)
    if(g)g.valorCajuela+=r.total
  }
  for (const r of centerGroups.values()) {
    const g=resumenDistrito.get(r.distrito)
    if(g)g.valorCentro+=r.total
  }
  for (const g of resumenDistrito.values()) {
    g.faltantesPiezas=Math.max(0,g.recibidasPiezas-g.entregadasPiezas)
    // El costo exacto de las piezas faltantes requiere cotejo individual de serie/SKU.
    g.recibidasCosto=money(g.recibidasCosto)
    g.entregadasCosto=money(g.entregadasCosto)
    g.pendientesCosto=money(g.pendientesCosto)
    g.valorCajuela=money(g.valorCajuela)
    g.valorCentro=money(g.valorCentro)
  }
  advertencias.push('Piezas faltantes por entregar = recibidas menos enviadas del periodo, por distrito (diferencia agregada, no conciliación por serie). No se presenta costo faltante sin identificar las piezas exactas.')
  advertencias.push('Auditorías faltantes: sin una meta verificable por distrito no es posible calcularlas.')
  const porDistrito=[...resumenDistrito.values()]

  const rows = {
    solicitudes: solGroups,
    traspasos: traGroups,
    recolecciones: recoGroups,
    recoleccionesEntregadasTP: recoTPGroups,
    auditorias: auditGroups,
    recoleccionesPendientes: [...pendingGroups.values()],
    criticos: [...critGroups.values()],
    valor: [...valGroups.values()],
    valorCentro: [...centerGroups.values()],
    materialesSolicitados: materialSol,
    materialesTraspasados: [...materialTra.values()],
  }
  const sort = (a,b) => num(b.total ?? b.cantidad) - num(a.total ?? a.cantidad)
  Object.keys(rows).forEach(k => { if (Array.isArray(rows[k])) rows[k].sort(sort) })
  const sum = k => rows[k].reduce((a,b)=>a+num(b.total),0)
  const valorCajuela = money(sum('valor'))
  const valorCentro = money(sum('valorCentro'))
  const kpis = {
    solicitudes: sum('solicitudes'), traspasos:sum('traspasos'), recolecciones:sum('recolecciones'),
    recoleccionesEntregadasTP: sum('recoleccionesEntregadasTP'),
    auditoriasRealizadas: rows.auditorias.length,
    valorCajuela, valorCentro, valorTotal:money(valorCajuela+valorCentro),
    criticos:sum('criticos'), materialMasTraspasado:rows.materialesTraspasados.reduce((a,b)=>a+num(b.cantidad),0),
    materialMasSolicitado:rows.materialesSolicitados.reduce((a,b)=>a+num(b.cantidad),0),
    recoleccionesPendientes:sum('recoleccionesPendientes'),maxDiasRecoleccionesPendientes:maxPendingDays,maxDiasCriticos:maxCritDays,
    auditoriasFaltantes:null,
    recibidasPiezas:porDistrito.reduce((a,g)=>a+g.recibidasPiezas,0),
    recibidasCosto:money(porDistrito.reduce((a,g)=>a+g.recibidasCosto,0)),
    entregadasPiezas:porDistrito.reduce((a,g)=>a+g.entregadasPiezas,0),
    entregadasCosto:money(porDistrito.reduce((a,g)=>a+g.entregadasCosto,0)),
    pendientesPiezas:porDistrito.reduce((a,g)=>a+g.pendientesPiezas,0),
    pendientesCosto:money(porDistrito.reduce((a,g)=>a+g.pendientesCosto,0)),
    faltantesPiezas:porDistrito.reduce((a,g)=>a+g.faltantesPiezas,0),
    faltantesCosto:null,
  }
  return response({ok:true,distrito:padre?'TODOS':norm(actor.distrito),desde:from,hasta:to,generado:new Date().toISOString(),kpis,tablas:rows,detalles:details,reporteRecolecciones,porDistrito,advertencias})
}
