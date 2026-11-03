
'use client'

import { useRouter } from 'next/navigation'

export default function RecoleccionesMenuPage() {
  const router = useRouter()

  return (
    <main className="page">
      <div className="wrap">

        <button
          type="button"
          className="back"
          onClick={() => router.push('/acceso-almacen')}
        >
          ← Regresar al menú
        </button>

        <header>
          <h1>📦 RECOLECCIONES</h1>
          <p>Seleccione una opción de recolecciones</p>
        </header>

        <div className="menu">

          <button
            type="button"
            className="card"
            onClick={() =>
              router.push('/recolecciones/recepcion')
            }
          >
            📥 Recepción de Recolecciones
          </button>

          <button
            type="button"
            className="card"
            onClick={() =>
              router.push('/recolecciones/ver')
            }
          >
            📋 Ver Recolecciones
          </button>

          <button
            type="button"
            className="card"
            onClick={() =>
              router.push('/recolecciones/recus-tp')
            }
          >
            📦 RECUS TP - Recolecciones entregadas a Totalplay
          </button>

          <button
            type="button"
            className="card proceso"
            onClick={() =>
              router.push('/recolecciones/recus-tp')
            }
          >
            🔄 PROCESO RECU
            <span>
              Captura de entregas a Totalplay
            </span>
          </button>

        </div>

      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #042a23;
          color: #fff;
          padding: 18px;
          font-family: Arial, sans-serif;
        }

        .wrap {
          max-width: 1100px;
          margin: auto;
          border: 1px solid #286657;
          border-radius: 18px;
          padding: 20px;
          background: #052f27;
        }

        .back {
          border: 0;
          border-radius: 9px;
          background: #108d73;
          color: #fff;
          padding: 10px 16px;
          font-weight: 700;
          cursor: pointer;
          margin-bottom: 16px;
        }

        header {
          text-align: center;
          border: 1px solid #27866d;
          border-radius: 15px;
          padding: 22px;
          background: linear-gradient(
            115deg,
            #0c5b49,
            #18a783
          );
          margin-bottom: 20px;
        }

        h1 {
          margin: 0;
          font-size: 28px;
        }

        header p {
          margin: 8px 0 0;
          font-size: 13px;
        }

        .menu {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .card {
          min-height: 85px;
          border: 1px solid #229a7a;
          border-radius: 12px;
          background: linear-gradient(
            135deg,
            #0b765e,
            #18a77f
          );
          color: #fff;
          font-size: 16px;
          font-weight: 800;
          padding: 18px;
          cursor: pointer;
          transition:
            filter 0.2s,
            transform 0.2s;
        }

        .card:hover {
          filter: brightness(1.08);
          transform: translateY(-2px);
        }

        .proceso {
          background: linear-gradient(
            135deg,
            #087a98,
            #12a6a0
          );
          border-color: #40d4ca;
        }

        .proceso span {
          display: block;
          margin-top: 7px;
          font-size: 12px;
          font-weight: 400;
          color: #e5fffa;
        }

        @media (max-width: 760px) {
          .menu {
            grid-template-columns: 1fr;
          }

          h1 {
            font-size: 23px;
          }
        }
      `}</style>
    </main>
  )
}
