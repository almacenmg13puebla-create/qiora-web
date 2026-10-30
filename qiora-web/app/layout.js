
import './globals.css'

export const metadata = {
  title: 'Sistema de Traspasos',
  description: 'Sistema de gestión de inventarios y traspasos'
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
