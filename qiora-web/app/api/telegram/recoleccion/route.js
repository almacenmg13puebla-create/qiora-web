import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  try {
    const body = await request.json()

    const almacen = String(
      body?.almacen || ''
    ).trim()

    const mensaje = String(
      body?.mensaje || ''
    ).trim()

    if (!almacen) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ALMACEN_REQUERIDO'
        },
        {
          status: 400
        }
      )
    }

    if (!mensaje) {
      return NextResponse.json(
        {
          ok: false,
          error: 'MENSAJE_REQUERIDO'
        },
        {
          status: 400
        }
      )
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY

    const telegramToken =
      process.env.QIORA_BOT_TOKEN

    if (!supabaseUrl) {
      throw new Error(
        'Falta NEXT_PUBLIC_SUPABASE_URL'
      )
    }

    if (!serviceRoleKey) {
      throw new Error(
        'Falta SUPABASE_SERVICE_ROLE_KEY'
      )
    }

    if (!telegramToken) {
      throw new Error(
        'Falta QIORA_BOT_TOKEN'
      )
    }

    /*
      CLIENTE SUPABASE SOLO DEL SERVIDOR.
      SERVICE_ROLE nunca debe ir al navegador.
    */
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    )

    /*
      BUSCAR TÉCNICO POR ALMACÉN.
    */
    const {
      data: tecnico,
      error: tecnicoError
    } = await supabaseAdmin
      .from('almacen_usuarios')
      .select(`
        usuario_almacen,
        nombre,
        telegram_chat_id,
        activo
      `)
      .eq('usuario_almacen', almacen)
      .eq('activo', true)
      .limit(1)
      .maybeSingle()

    if (tecnicoError) {
      throw tecnicoError
    }

    if (!tecnico) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `No se encontró técnico activo para el almacén ${almacen}.`
        },
        {
          status: 404
        }
      )
    }

    const chatId = String(
      tecnico.telegram_chat_id || ''
    ).trim()

    if (!chatId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `El técnico ${tecnico.nombre || almacen} no tiene TELEGRAM_CHAT_ID registrado.`
        },
        {
          status: 400
        }
      )
    }

    /*
      ENVIAR MENSAJE PRIVADO DESDE QIORA BOT.
    */
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          chat_id: chatId,
          text: mensaje,

          /*
            NO usamos parse_mode para evitar errores
            cuando nombres, materiales o descripciones
            contienen caracteres especiales.
          */
          disable_web_page_preview: true
        }),

        cache: 'no-store'
      }
    )

    const telegramJson =
      await telegramResponse.json()

    if (
      !telegramResponse.ok ||
      !telegramJson?.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            telegramJson?.description ||
            'Telegram rechazó el mensaje.'
        },
        {
          status: 502
        }
      )
    }

    return NextResponse.json({
      ok: true,

      almacen,

      tecnico:
        tecnico.nombre || '',

      telegram_chat_id:
        chatId,

      message_id:
        telegramJson?.result
          ?.message_id || null
    })

  } catch (error) {
    console.error(
      'ERROR TELEGRAM RECOLECCION:',
      error
    )

    return NextResponse.json(
      {
        ok: false,
        error:
          error?.message ||
          'No fue posible enviar Telegram.'
      },
      {
        status: 500
      }
    )
  }
}
