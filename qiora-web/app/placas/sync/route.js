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
  const numeroUnico = s(
    buscar(
      row,
      'NUMERO UNICO',
      'NÚMERO UNICO',
      'Número único',
      'Numero unico'
    )
  ).toUpperCase()

  const placa = s(
    buscar(
      row,
      'PLACA',
      'Placa'
    )
  )
    .replace(/-/g, '')
    .toUpperCase()

  const estadoPlaca = s(
    buscar(
      row,
      'ESTADO PLACA',
      'Estado placa'
    )
  )

  const sucursal = s(
    buscar(
      row,
      'SUCURSAL',
      'Sucursal'
    )
  )

  const empleadoAsignado = s(
    buscar(
      row,
      'EMPLEADO ASIGNADO',
      'Empleado asignado'
    )
  )

  const numeroEmpleado = s(
    buscar(
      row,
      'NÚMERO EMPLEADO',
      'NUMERO EMPLEADO',
      'Número empleado'
    )
  )

  const usuarioFfm = s(
    buscar(
      row,
      'USUARIO FFM',
      'Usuario FFM'
    )
  ).toUpperCase()

  const puestoEmpleado = s(
    buscar(
      row,
      'PUESTO EMPLEADO',
      'Puesto empleado'
    )
  )

  const marca = s(
    buscar(
      row,
      'MARCA',
      'Marca'
    )
  )

  const modelo = s(
    buscar(
      row,
      'MODELO',
      'Modelo'
    )
  )

  const numeroSerie = s(
    buscar(
      row,
      'NUMERO DE SERIE',
      'NÚMERO DE SERIE',
      'Número de serie'
    )
  )

  const ultimoKilometrajeTexto = s(
    buscar(
      row,
      'ULTIMO KILOMETRAJE',
      'ÚLTIMO KILOMETRAJE',
      'Ultimo kilometraje'
    )
  ).replace(/,/g, '')

  const ultimoKilometraje =
    /^[0-9]+(?:\.[0-9]+)?$/.test(
      ultimoKilometrajeTexto
    )
      ? Number(ultimoKilometrajeTexto)
      : null

  const fechaUltimoKilometraje = s(
    buscar(
      row,
      'FECHA ULTIMO KILOMETRAJE',
      'FECHA ÚLTIMO KILOMETRAJE',
      'Fecha ultimo kilometraje'
    )
  )

  return {
    numero_unico:
      numeroUnico,

    placa:
      placa || null,

    estado_placa:
      estadoPlaca || null,

    sucursal:
      sucursal || null,

    empleado_asignado:
      empleadoAsignado || null,

    numero_empleado:
      numeroEmpleado || null,

    usuario_ffm:
      usuarioFfm || null,

    puesto_empleado:
      puestoEmpleado || null,

    marca:
      marca || null,

    modelo:
      modelo || null,

    numero_serie:
      numeroSerie || null,

    ultimo_kilometraje:
      ultimoKilometraje,

    fecha_ultimo_kilometraje:
      fechaUltimoKilometraje || null,

    datos_completos:
      row
  }
}

export async function GET() {
  return out({
    ok: true,
    ruta: 'placas-sync'
  })
}

export async function POST(request) {
  try {
    const {
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      QIORA_PLACAS_SYNC_SECRET: syncSecret
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
      body.filas.length > 10000
    ) {
      return out({
        ok: false,
        error: 'CANTIDAD_FILAS_INVALIDA'
      }, 400)
    }

    const filas =
      body.filas
        .filter(
          row =>
            row &&
            typeof row === 'object' &&
            !Array.isArray(row)
        )
        .map(normalizar)
        .filter(
          row =>
            row.numero_unico
        )

    if (!filas.length) {
      return out({
        ok: false,
        error: 'SIN_REGISTROS_VALIDOS'
      }, 400)
    }

    /*
      Validación antes de tocar Supabase.
    */
    const numeros =
      new Set()

    for (const fila of filas) {
      if (
        numeros.has(
          fila.numero_unico
        )
      ) {
        return out({
          ok: false,
          error:
            'NUMERO_UNICO_DUPLICADO',
          numero_unico:
            fila.numero_unico
        }, 400)
      }

      numeros.add(
        fila.numero_unico
      )
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

    /*
      El RPC ejecuta DELETE + INSERT
      dentro de una sola transacción.

      Si algo falla, PostgreSQL revierte
      toda la operación.
    */
    const {
      data,
      error
    } =
      await db.rpc(
        'qiora_reemplazar_placas',
        {
          p_filas:
            filas
        }
      )

    if (error) {
      console.error(
        'ERROR SYNC PLACAS:',
        error
      )

      return out({
        ok: false,
        error:
          error.message
      }, 500)
    }

    return out({
      ok: true,
      registros:
        filas.length,
      resultado:
        data
    })

  } catch (error) {
    console.error(
      'ERROR API PLACAS:',
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
