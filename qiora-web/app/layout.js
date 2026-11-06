
import './globals.css'

export const metadata = {
  title: 'QiORA Conecta · Sistema Nacional de Almacenes',
  description: 'Sistema QiORA Conecta para gestión de almacenes, inventarios y traspasos'
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
