'use client'

import Link from 'next/link'

const opciones = [
  { href: '/devoluciones/equipos-criticos', icono: '!', titulo: 'Equipos criticos', texto: 'Devolucion de equipos con mas de 30 dias en cajuela.' },
  { href: '/devoluciones/normal', icono: '+', titulo: 'Devolucion normal', texto: 'Registrar devoluciones de equipos por serie.' },
  { href: '/devoluciones/consumibles', icono: '=', titulo: 'Consumible', texto: 'Registrar devoluciones de consumibles y cantidades.' },
]

export default function DevolucionesPage() {
  return (
    <main style={s.base}>
      <section style={s.shell}>
        <Link href="/" style={s.back}>Regresar al menu</Link>
        <header style={s.hero}>
          <h1 style={s.title}>DEVOLUCIONES</h1>
          <p style={s.subtitle}>Seleccione el tipo de devolucion</p>
        </header>
        <div style={s.grid}>
          {opciones.map((o) => (
            <Link key={o.href} href={o.href} style={s.card}>
              <span style={s.icon}>{o.icono}</span>
              <h2 style={s.cardTitle}>{o.titulo}</h2>
              <p style={s.cardText}>{o.texto}</p>
              <span style={s.action}>Abrir modulo</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}

const s = {
  base: { minHeight: '100vh', padding: 16, boxSizing: 'border-box', color: '#f0fff8', background: 'linear-gradient(145deg,#031f19,#052f25)', fontFamily: 'Arial, sans-serif' },
  shell: { maxWidth: 1200, margin: '0 auto', padding: 18, border: '1px solid #356f5d', borderRadius: 18, background: 'rgba(2,28,22,.82)' },
  back: { display: 'inline-block', marginBottom: 16, padding: '9px 15px', borderRadius: 24, background: '#117b5d', color: '#fff', textDecoration: 'none', fontWeight: 700 },
  hero: { padding: '22px 16px', border: '1px solid #379579', borderRadius: 15, textAlign: 'center', background: 'linear-gradient(110deg,#10553f,#16a47b)' },
  title: { margin: 0, fontSize: 28 }, subtitle: { margin: '7px 0 0', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginTop: 18 },
  card: { display: 'block', minHeight: 170, padding: 18, border: '1px solid #246d57', borderRadius: 14, color: '#f2fff9', textDecoration: 'none', background: 'linear-gradient(145deg,#0e634b,#087b5d)' },
  icon: { display: 'inline-grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: '#19a77c', fontWeight: 900, fontSize: 22 },
  cardTitle: { fontSize: 18, margin: '12px 0 8px' }, cardText: { minHeight: 40, lineHeight: 1.45, fontSize: 13, color: '#d2eee3' },
  action: { display: 'block', marginTop: 16, padding: 11, borderRadius: 9, textAlign: 'center', fontWeight: 800, background: '#19aa7d' },
}
