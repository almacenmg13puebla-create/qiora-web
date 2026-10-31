import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const out = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  })

const s = value =>
  String(value ?? '').trim()

function numero(value) {
  const texto = s(value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')

  if (!texto) return null

  const n = Number(texto)

  return Number.isFinite(n)
    ? n
    : null
}

function buscar(row, ...nombres) {
  for (const nombre of nombres) {
    if (
      Object.prototype.hasOwnProperty.call(
        row,
        nombre
      )
    ) {
      return row[nombre]
    }
  }

  return ''
}

function normalizar(row) {
  const fechaFormulario = s(
    buscar(
      row,
      'Marca temporal',
      'MARCA TEMPORAL'
    )
  )

  const distrito = s(
    buscar(
      row,
      'Distrito',
      'DISTRITO'
    )
  )

  const tipoUnidad = s(
    buscar(
      row,
      'Tipo de unidad',
      'TIPO DE UNIDAD'
    )
  )

  const fechaRevision = s(
    buscar(
      row,
      'Fecha de revisión',
      'Fecha de revision',
      'FECHA DE REVISIÓN'
    )
  )

  const semana = s(
    buscar(
      row,
      'Semana',
      'SEMANA'
    )
  )

  const placa = s(
    buscar(
      row,
      'Placas (sin guiones)',
      'Placa',
      'PLACA'
    )
  )
    .replace(/-/g, '')
    .toUpperCase()

  const numeroUnico = s(
    buscar(
      row,
      'Número único (Catálogo)',
      'Número único (Autos)',
      'Número único (Motos)',
      'Numero unico (Catalogo)'
    )
  ).toUpperCase()

  const numeroEmpleado = s(
    buscar(
      row,
      'Número de empleado del Operador (es el Número de Seguro Social)',
      'Número de empleado',
      'NUMERO EMPLEADO'
    )
  )

  const usuarioFfm = s(
    buscar(
      row,
      'Usuario FFM del Operador',
      'Usuario FFM',
      'USUARIO FFM'
    )
  ).toUpperCase()

  const nombreOperador = s(
    buscar(
      row,
      'Nombre completo del Operador',
      'Empleado asignado',
      'EMPLEADO ASIGNADO'
    )
  )

  const kilometraje = numero(
    buscar(
      row,
      'Kilometraje (escribir número exacto)',
      'Kilometraje',
      'ULTIMO KILOMETRAJE'
    )
  )

  const almacen = s(
    buscar(
      row,
      'Almacén',
      'Almacen',
      'ALMACÉN'
    )
  )

  const modelo = s(
    buscar(
      row,
      'Modelo',
      'MODELO'
    )
  )

  const fotografiaOdometro = s(
    buscar(
      row,
      'Fotografía del odómetro',
      'Fotografia del odometro'
    )
  )

  /*
    La marca temporal normalmente permanece
    igual aunque posteriormente se corrija
    algún dato del formulario.

    La combinamos con usuario/placa/número
    único para identificar la respuesta.
  */
  const sourceKey = [
    fechaFormulario,
    usuarioFfm,
    placa,
    numeroUnico
  ]
    .map(x => s(x).toUpperCase())
    .join('|')

  return {
    source_key: sourceKey,

    fecha_formulario:
      fechaFormulario || null,

    distrito:
      distrito || null,

    tipo_unidad:
      tipoUnidad || null,

    fecha_revision:
      fechaRevision || null,

    semana:
      semana || null,

    placa:
      placa || null,

    numero_unico:
      numeroUnico || null,

    numero_empleado:
      numeroEmpleado || null,

    usuario_ffm:
      usuarioFfm || null,

    nombre_operador:
      nombreOperador || null,

    kilometraje,

    almacen:
      almacen || null,

    modelo:
      modelo || null,

    fotografia_odometro:
      fotografiaOdometro || null,

    datos_completos:
      row,

    sincronizado_en:
      new Date().toISOString()
  }
}

export async function POST(request) {
  try {
    const {
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      QIORA_KILOMETRAJES_SYNC_SECRET: syncSecret
    } = process.env

    if (
      !url ||
      !serviceKey ||
      !syncSecret
    ) {
      return out({
        ok: false,
        error: 'SERVIDOR_NO_CONFIGURADO'
      }, 503)
    }

    const recibido =
      s(
        request.headers.get(
          'x-qiora-sync-secret'
        )
      )

    if (
      !recibido ||
      recibido !== syncSecret
    ) {
      return out({
        ok: false,
        error: 'NO_AUTORIZADO'
      }, 401)
    }

    const body =
      await request.json()

    if (
      !body ||
      !Array.isArray(body.filas)
    ) {
      return out({
        ok: false,
        error: 'FILAS_INVALIDAS'
      }, 400)
    }

    if (
      body.filas.length < 1 ||
      body.filas.length > 500
    ) {
      return out({
        ok: false,
        error: 'LOTE_INVALIDO'
      }, 400)
    }

    const filas =
      body.filas
        .map(normalizar)
        .filter(row =>
          row.source_key &&
          row.source_key !== '|||'
        )

    if (!filas.length) {
      return out({
        ok: true,
        procesadas: 0
      })
    }

    const db =
      createClient(
        url,
        serviceKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        }
      )

    const {
      data,
      error
    } =
      await db
        .from(
          'qiora_kilometrajes'
        )
        .upsert(
          filas,
          {
            onConflict:
              'source_key'
          }
        )
        .select(
          'id,source_key'
        )

    if (error) {
      console.error(
        'ERROR SYNC KILOMETRAJES:',
        error
      )

      return out({
        ok: false,
        error: error.message
      }, 500)
    }

    return out({
      ok: true,
      procesadas:
        filas.length,
      guardadas:
        data?.length || 0
    })

  } catch (error) {
    console.error(
      'ERROR API KILOMETRAJES:',
      error
    )

    return out({
      ok: false,
      error:
        error?.message ||
        'ERROR_INTERNO'
    }, 500)
  }
}
