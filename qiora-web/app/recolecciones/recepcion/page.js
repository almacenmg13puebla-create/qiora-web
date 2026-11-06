'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()

const formatPhone = raw => {
  const digits = clean(raw).replace(/\D/g, '')

  if (digits.length === 10) return `52${digits}`
  if (digits.length >= 11 && digits.length <= 15) return digits

  return ''
}

const formatFecha = valor => {
  if (!valor) return ''

  const fecha = new Date(valor)

  if (Number.isNaN(fecha.getTime())) {
    return clean(valor)
  }

  return fecha.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const makeText = r => {
  const series = Array.isArray(r.series) ? r.series : []
  const pendientes = Number(r.pendientes ?? 0)

  const lines = [
    '*RECOLECCIÓN RECIBIDA*',
    '',
    `Hola *${r.tecnico || ''}* 👋`,
    'Tu recolección fue recibida en almacén.',
    '',
    `📄 *Folio:* ${r.folio || ''}`,
    `🏢 *Centro:* ${r.centro || r.distrito || ''}`,
    `📦 *Almacén:* ${r.almacen || ''}`,
    `👷 *Técnico:* ${r.tecnico || ''}`,
    `👤 *Recibió:* ${r.recibe || ''}`,
    `📅 *Fecha:* ${formatFecha(r.fecha)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `📦 *EQUIPOS ENTREGADOS (${series.length})*`
  ]

  for (const equipo of series) {
    const serie = clean(equipo.serie)
    const material = clean(equipo.material)
    const descripcion = clean(equipo.descripcion)

    if (!material || !descripcion) {
      lines.push(`• ${serie} ⚠️ NO EXISTE EN SAP`)
    } else {
      lines.push(
        `• ${serie} | ${material} - ${descripcion}`
      )
    }
  }

  lines.push(
    '━━━━━━━━━━━━━━━━━━━━',
    ''
  )

  if (pendientes <= 0) {
    lines.push(
      '✅ *ENTREGA COMPLETA*',
      'No tienes equipos pendientes en esta recolección.'
    )
  } else {
    lines.push(
      '⚠️ *ENTREGA PARCIAL*',
      `Quedan ${pendientes} equipo(s) pendiente(s) por entregar.`
    )
  }

  lines.push(
    '',
    '✅ *Recepción registrada correctamente*',
    '',
    '🏢 *Sistema Nacional de Almacenes*'
  )
