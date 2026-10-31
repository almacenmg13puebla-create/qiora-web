import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USUARIO_PRUEBA = '15027101';

function getSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_URL.'
    );
  }

  if (!serviceRole) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return createClient(
    url,
    serviceRole,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

async function enviarTelegram(chatId, mensaje) {
  const token = process.env.QIORA_BOT_TOKEN;

  if (!token) {
    throw new Error(
      'Falta QIORA_BOT_TOKEN en Vercel.'
    );
  }

  const respuesta = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensaje
      })
    }
  );

  const resultado = await respuesta.json();

  if (!respuesta.ok || !resultado.ok) {
    throw new Error(
      'Telegram rechazó el mensaje: ' +
      JSON.stringify(resultado)
    );
  }

  return resultado;
}

export async function POST(request) {
  try {
    /*
     * 1. AUTORIZACIÓN
     */
    const secretRecibido =
      request.headers.get(
        'x-qiora-reminders-secret'
      );

    const secretEsperado =
      process.env.QIORA_KM_REMINDERS_SECRET;

    if (
      !secretEsperado ||
      !secretRecibido ||
      secretRecibido !== secretEsperado
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: 'NO_AUTORIZADO'
        },
        {
          status: 401
        }
      );
    }

    /*
     * 2. LEER SOLICITUD
     */
    let body = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const usuario =
      String(
        body.usuario_almacen || ''
      ).trim();

    /*
     * Seguridad adicional:
     * este endpoint SOLO permite 15027101.
     */
    if (usuario !== USUARIO_PRUEBA) {
      return NextResponse.json(
        {
          ok: false,
          error: 'USUARIO_NO_PERMITIDO'
        },
        {
          status: 403
        }
      );
    }

    /*
     * 3. BUSCAR USUARIO EN SUPABASE
     */
    const supabase = getSupabase();

    const {
      data: usuarioDb,
      error: usuarioError
    } = await supabase
      .from('almacen_usuarios')
      .select(
        `
          id,
          usuario_almacen,
          nombre,
          puesto,
          distrito,
          telegram_chat_id,
          activo
        `
      )
      .eq(
        'usuario_almacen',
        USUARIO_PRUEBA
      )
      .eq(
        'activo',
        true
      )
      .maybeSingle();

    if (usuarioError) {
      throw new Error(
        'Error buscando usuario: ' +
        usuarioError.message
      );
    }

    if (!usuarioDb) {
      return NextResponse.json(
        {
          ok: false,
          error: 'USUARIO_NO_ENCONTRADO',
          usuario_almacen: USUARIO_PRUEBA
        },
        {
          status: 404
        }
      );
    }

    /*
     * 4. VERIFICAR TELEGRAM
     */
    const chatId =
      String(
        usuarioDb.telegram_chat_id || ''
      ).trim();

    if (!chatId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'USUARIO_SIN_TELEGRAM',
          usuario_almacen: USUARIO_PRUEBA,
          nombre: usuarioDb.nombre || null
        },
        {
          status: 400
        }
      );
    }

    /*
     * 5. MENSAJE DE PRUEBA
     */
    const mensaje = [
      'QIORA — PRUEBA DE RECORDATORIOS',
      '',
      'Este es un mensaje de prueba.',
      'La conexión de recordatorios de kilometraje funciona correctamente.',
      '',
      `Usuario: ${USUARIO_PRUEBA}`,
      `Nombre: ${usuarioDb.nombre || 'Sin nombre'}`,
      `Puesto: ${usuarioDb.puesto || 'Sin puesto'}`,
      `Distrito: ${usuarioDb.distrito || 'Sin distrito'}`,
      '',
      'No necesitas realizar ninguna acción.'
    ].join('\n');

    /*
     * 6. ENVIAR
     */
    const telegram =
      await enviarTelegram(
        chatId,
        mensaje
      );

    /*
     * No devolvemos el chat_id al cliente.
     */
    return NextResponse.json({
      ok: true,
      prueba: true,
      enviado: true,
      usuario_almacen:
        usuarioDb.usuario_almacen,
      nombre:
        usuarioDb.nombre || null,
      puesto:
        usuarioDb.puesto || null,
      distrito:
        usuarioDb.distrito || null,
      telegram_message_id:
        telegram?.result?.message_id || null
    });

  } catch (error) {
    console.error(
      'ERROR PRUEBA RECORDATORIO:',
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'ERROR_INTERNO'
      },
      {
        status: 500
      }
    );
  }
}
