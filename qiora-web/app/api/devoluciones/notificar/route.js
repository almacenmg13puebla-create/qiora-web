import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return NextResponse.json({ error: 'Sesion no proporcionada.' }, { status: 401 })

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const botToken = process.env.QIORA_BOT_TOKEN
    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'Faltan variables de Supabase en el servidor.' }, { status: 500 })
    }
    if (!botToken) return NextResponse.json({ error: 'QIORA_BOT_TOKEN no esta configurado en Vercel.' }, { status: 503 })

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !userData?.user) return NextResponse.json({ error: 'Sesion invalida.' }, { status: 401 })

    const body = await request.json()
    const distrito = String(body.distrito || '').trim().toUpperCase()
    const almacen = String(body.almacen || '').replace(/\D/g, '').padStart(4, '0').slice(-4)
    const folio = String(body.folio || '').trim()
    const tipo = String(body.tipo || '').trim().toUpperCase()
    if (!distrito || !/^\d{4}$/.test(almacen) || !folio || !['CRITICA', 'NORMAL'].includes(tipo)) {
      return NextResponse.json({ error: 'Datos de notificacion incompletos.' }, { status: 400 })
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: perfil, error: perfilError } = await admin
      .from('almacen_usuarios')
      .select('usuario_almacen,nombre,puesto,distrito,activo,devoluciones')
      .eq('auth_user_id', userData.user.id)
      .eq('activo', true)
      .maybeSingle()
    if (perfilError) throw perfilError
    if (!perfil) return NextResponse.json({ error: 'No existe perfil activo para la sesion.' }, { status: 403 })
    const puesto = String(perfil.puesto || '').trim().toUpperCase()
    const adminPadre = puesto === 'ADMIN_PADRE'
    if (!adminPadre && String(perfil.distrito || '').trim().toUpperCase() !== distrito) {
      return NextResponse.json({ error: 'No tienes acceso al centro indicado.' }, { status: 403 })
    }
    if (!adminPadre && perfil.devoluciones !== true) {
      return NextResponse.json({ error: 'No tienes permiso para devoluciones.' }, { status: 403 })
    }

    const { data: tecnico, error: tecnicoError } = await admin
      .from('almacen_usuarios')
      .select('nombre,telegram_chat_id,distrito,activo')
      .eq('usuario_almacen', almacen)
      .eq('distrito', distrito)
      .eq('activo', true)
      .maybeSingle()
    if (tecnicoError) throw tecnicoError
    if (!tecnico) return NextResponse.json({ error: `El almacen ${almacen} no esta activo en ${distrito}.` }, { status: 404 })
    const chatId = String(tecnico.telegram_chat_id || '').trim()
    if (!chatId) return NextResponse.json({ sent: false, error: 'El usuario del almacen no tiene telegram_chat_id configurado.' }, { status: 200 })

    const text = `${tipo === 'CRITICA' ? '🚨 DEVOLUCION DE EQUIPOS CRITICOS' : '📦 DEVOLUCION NORMAL'}\n\nCentro: ${distrito}\nFolio: ${folio}\nAlmacen: ${almacen}\nTecnico: ${tecnico.nombre || '-'}\n\nLa devolucion quedo registrada en QIORA Web.`
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }),
    })
    const telegramData = await telegramResponse.json().catch(() => ({}))
    if (!telegramResponse.ok || telegramData.ok !== true) {
      return NextResponse.json({ sent: false, error: telegramData.description || 'Telegram no confirmo el envio.' }, { status: 502 })
    }
    return NextResponse.json({ sent: true })
  } catch (error) {
    console.error('Error notificando devolucion:', error)
    return NextResponse.json({ error: error?.message || 'Error interno al notificar.' }, { status: 500 })
  }
}
