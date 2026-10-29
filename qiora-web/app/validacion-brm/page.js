'use client'

import {
  useEffect,
  useRef,
  useState
} from 'react'

import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const texto = valor =>
  String(valor ?? '').trim()

const mayus = valor =>
  texto(valor).toUpperCase()

function archivoSeguro(valor) {
  return mayus(valor)
    .replace(/[^A-Z0-9_-]/g, '')
}

export default function ValidacionBrmPage() {
  const router = useRouter()

  const serieRef = useRef(null)
  const fileRef = useRef(null)

  const [perfil, setPerfil] =
    useState(null)

  const [centro, setCentro] =
    useState('')

  const [centroPerfil, setCentroPerfil] =
    useState('')

  const [puestoPerfil, setPuestoPerfil] =
    useState('')

  const [almacen, setAlmacen] =
    useState('')

  const [tecnico, setTecnico] =
    useState('')

  const [serie, setSerie] =
    useState('')

  const [sku, setSku] =
    useState('')

  const [descripcion, setDescripcion] =
    useState('')

  const [lote, setLote] =
    useState('')

  const [cuenta, setCuenta] =
    useState('')

  const [mac, setMac] =
    useState('')

  const [ot, setOt] =
    useState('')

  const [os, setOs] =
    useState('')

  const [evidencia, setEvidencia] =
    useState(null)

  const [preview, setPreview] =
    useState('')

  const [buscando, setBuscando] =
    useState(false)

  const [guardando, setGuardando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [aviso, setAviso] =
    useState('')

  /*
    ==============================
    PERFIL ACTIVO
    ==============================
  */

  useEffect(() => {
    let vivo = true

    ;(async () => {
      try {
        const {
          data,
          error: perfilError
        } =
          await supabase.rpc(
            'qiora_mi_perfil'
          )

        if (perfilError) {
          throw perfilError
        }

        if (
          !data ||
          data.activo !== true
        ) {
          throw new Error(
            'No existe un perfil activo.'
          )
        }

        const puesto =
          mayus(data.puesto)

        const esAdmin =
          puesto === 'ADMIN_PADRE' ||
          puesto.startsWith('ADMIN_')

        if (
          !esAdmin &&
          data.validacion_brm !== true
        ) {
          throw new Error(
            'No tienes permiso VALIDACION_BRM.'
          )
        }

        if (!vivo) {
          return
        }

        setPerfil(data)

        const centroUsuario = mayus(data.distrito)
        setPuestoPerfil(puesto)
        setCentroPerfil(centroUsuario)
        setCentro(puesto === 'ADMIN_PADRE' && !centroUsuario ? 'TODOS' : centroUsuario)

        if (puesto !== 'ADMIN_PADRE' && !centroUsuario) {
          throw new Error('El usuario no tiene centro/distrito configurado.')
        }

        /*
          SI ES TECNICO:
          SU ALMACEN SE CARGA
          AUTOMATICAMENTE.
        */
        if (
          puesto === 'TECNICO'
        ) {
          setAlmacen(
            texto(
              data.usuario_almacen
            )
          )
        }

      } catch (e) {
        if (vivo) {
          setError(
            e?.message ||
            'No fue posible cargar el perfil.'
          )
        }
      }
    })()

    return () => {
      vivo = false
    }
  }, [])

  /*
    ==============================
    CONTEXTO
    ==============================
  */

  async function cargarContexto(
    almacenValor
  ) {
    const a =
      texto(almacenValor)

    if (!a) {
      setTecnico('')
      return null
    }

    const {
      data,
      error: contextoError
    } =
      await supabase.rpc(
        'qiora_brm_contexto',
        {
          p_almacen: a
        }
      )

    if (contextoError) {
      throw contextoError
    }

    const centroAlmacen = upper(data?.centro || data?.distrito)
    if (puestoPerfil !== 'ADMIN_PADRE' && centroAlmacen !== upper(centroPerfil)) {
      throw new Error(`Acceso denegado: el almacén pertenece a ${centroAlmacen || 'un centro sin configurar'} y tu centro activo es ${centroPerfil}.`)
    }

    setCentro(centroAlmacen || centroPerfil || 'TODOS')

    setTecnico(
      data?.tecnico ||
      ''
    )

    return data
  }

  /*
    ==============================
    BUSCAR SERIE
    ==============================
  */

  async function buscarSerie() {
    if (buscando) {
      return
    }

    setError('')
    setAviso('')

    const a =
      texto(almacen)

    const s =
      mayus(serie)

    if (!a) {
      setError(
        'Captura el almacén.'
      )
      return
    }

    if (!s) {
      setError(
        'Captura o escanea la serie.'
      )
      return
    }

    setBuscando(true)

    try {
      const {
        data,
        error: buscarError
      } =
        await supabase.rpc(
          'qiora_brm_buscar_serie',
          {
            p_almacen: a,
            p_serie: s
          }
        )

      if (buscarError) {
        throw buscarError
      }

      const centroSerie = upper(data?.centro || data?.distrito)
      if (puestoPerfil !== 'ADMIN_PADRE' && centroSerie !== upper(centroPerfil)) {
        throw new Error(`Acceso denegado: la serie pertenece a ${centroSerie || 'un centro sin configurar'} y tu centro activo es ${centroPerfil}.`)
      }

      setSerie(
        data?.serie ||
        s
      )

      setSku(
        data?.sku ||
        data?.material ||
        ''
      )

      setDescripcion(
        data?.descripcion ||
        ''
      )

      setLote(
        data?.lote ||
        ''
      )

      setTecnico(
        data?.tecnico ||
        ''
      )

      setCentro(
        data?.centro ||
        ''
      )

      setAviso(
        `Serie encontrada correctamente en ${data?.centro || centro}.`
      )

    } catch (e) {
      setSku('')
      setDescripcion('')
      setLote('')

      setError(
        e?.message ||
        'No fue posible consultar la serie.'
      )

    } finally {
      setBuscando(false)
    }
  }

  /*
    ==============================
    ARCHIVO
    ==============================
  */

  function seleccionarArchivo(
    archivo
  ) {
    if (preview) {
      URL.revokeObjectURL(
        preview
      )
    }

    setEvidencia(
      archivo ||
      null
    )

    setPreview(
      archivo
        ? URL.createObjectURL(
            archivo
          )
        : ''
    )
  }

  /*
    ==============================
    SUBIR EVIDENCIA
    ==============================
  */

  async function subirEvidencia() {
    if (!evidencia) {
      throw new Error(
        'Selecciona la evidencia.'
      )
    }

    if (!centro) {
      throw new Error(
        'No existe centro activo.'
      )
    }

    const extension =
      texto(
        evidencia.name
          ?.split('.')
          .pop()
      )
        .toLowerCase() ||
      'jpg'

    const nombre =
      `${Date.now()}_${archivoSeguro(
        serie
      )}.${extension}`

    /*
      ESTRUCTURA:
      MG13/0009/archivo.jpg
      MG18/xxxx/archivo.jpg
    */
    const ruta =
      `${mayus(centro)}/${texto(
        almacen
      )}/${nombre}`

    const {
      error: uploadError
    } =
      await supabase.storage
        .from(
          'brm-evidencias'
        )
        .upload(
          ruta,
          evidencia,
          {
            upsert: false,
            cacheControl:
              '3600'
          }
        )

    if (uploadError) {
      throw uploadError
    }

    return ruta
  }

  /*
    ==============================
    LIMPIAR
    ==============================
  */

  function limpiarCaptura() {
    setSerie('')
    setSku('')
    setDescripcion('')
    setLote('')
    setCuenta('')
    setMac('')
    setOt('')
    setOs('')
    setEvidencia(null)

    if (preview) {
      URL.revokeObjectURL(
        preview
      )
    }

    setPreview('')

    if (fileRef.current) {
      fileRef.current.value =
        ''
    }

    setTimeout(
      () =>
        serieRef.current
          ?.focus(),
      100
    )
  }

  /*
    ==============================
    GUARDAR
    ==============================
  */

  async function guardar() {
    if (guardando) {
      return
    }

    setError('')
    setAviso('')

    let rutaEvidencia =
      ''

    try {
      if (!perfil) {
        throw new Error(
          'No existe perfil activo.'
        )
      }

      if (!texto(almacen)) {
        throw new Error(
          'Captura el almacén.'
        )
      }

      if (!mayus(serie)) {
        throw new Error(
          'Captura la serie.'
        )
      }

      if (!sku) {
        throw new Error(
          'Primero busca una serie válida.'
        )
      }

      if (!texto(cuenta)) {
        throw new Error(
          'Captura la cuenta.'
        )
      }

      if (!texto(mac)) {
        throw new Error(
          'Captura la MAC.'
        )
      }

      if (!texto(ot)) {
        throw new Error(
          'Captura la OT.'
        )
      }

      if (!texto(os)) {
        throw new Error(
          'Captura la OS.'
        )
      }

      if (!evidencia) {
        throw new Error(
          'Selecciona una evidencia.'
        )
      }

      setGuardando(true)

      /*
        REVALIDAR CENTRO
      */
      await cargarContexto(
        almacen
      )

      const contextoValidado = await cargarContexto(almacen)
      if (puestoPerfil !== 'ADMIN_PADRE' && upper(contextoValidado?.centro || contextoValidado?.distrito) !== upper(centroPerfil)) {
        throw new Error('El almacén no pertenece al centro activo. No se guardó la validación.')
      }

      rutaEvidencia =
        await subirEvidencia()

      const {
        data,
        error: guardarError
      } =
        await supabase.rpc(
          'qiora_brm_guardar',
          {
            p_almacen:
              texto(almacen),

            p_serie:
              mayus(serie),

            p_cuenta:
              mayus(cuenta),

            p_mac:
              mayus(mac),

            p_ot:
              mayus(ot),

            p_os:
              mayus(os),

            p_evidencia_path:
              rutaEvidencia
          }
        )

      if (guardarError) {
        throw guardarError
      }

      limpiarCaptura()

      const centroGuardado = upper(data?.centro || data?.distrito)
      if (puestoPerfil !== 'ADMIN_PADRE' && centroGuardado && centroGuardado !== upper(centroPerfil)) {
        throw new Error(`Supabase devolvió una validación de ${centroGuardado}; se esperaba ${centroPerfil}.`)
      }

      setAviso(
        `Validación BRM guardada correctamente. Folio: ${data?.folio || ''} · Centro: ${centroGuardado || centroPerfil || centro}`
      )

    } catch (e) {
      /*
        SI SUBIO LA FOTO,
        PERO NO GUARDO BRM,
        ELIMINAR ARCHIVO.
      */
      if (rutaEvidencia) {
        try {
          await supabase.storage
            .from(
              'brm-evidencias'
            )
            .remove([
              rutaEvidencia
            ])
        } catch {}
      }

      setError(
        e?.message ||
        'No fue posible guardar la validación.'
      )

    } finally {
      setGuardando(false)
    }
  }

  const tecnicoActivo =
    mayus(
      perfil?.puesto
    ) ===
    'TECNICO'

  return (
    <main style={css.base}>

      <div style={css.marco}>

        <button
          type="button"
          style={css.regresar}

          onClick={() =>
            router.push('/')
          }
        >
          ← Regresar
        </button>

        <header style={css.hero}>

          <h1 style={css.titulo}>
            Validación BRM
          </h1>

          <p style={css.subtitulo}>
            Validación por centro
            {
              centro
                ? ` · ${centro}`
                : ''
            }
          </p>

        </header>

        {error && (
          <div style={css.error}>
            {error}
          </div>
        )}

        {aviso && (
          <div style={css.exito}>
            {aviso}
          </div>
        )}

        <section style={css.panel}>

          <div style={css.grid}>

            <label style={css.label}>
              Serie

              <div style={css.serieFila}>

                <input
                  ref={serieRef}

                  style={css.input}

                  placeholder="Escanee o escriba la serie"

                  value={serie}

                  onChange={
                    e => {
                      setSerie(
                        mayus(
                          e.target.value
                        )
                      )

                      setSku('')
                      setDescripcion('')
                      setLote('')
                    }
                  }

                  onKeyDown={
                    e => {
                      if (
                        e.key ===
                        'Enter'
                      ) {
                        buscarSerie()
                      }
                    }
                  }
                />

                <button
                  type="button"

                  style={css.buscarIcono}

                  disabled={
                    buscando
                  }

                  onClick={
                    buscarSerie
                  }
                >
                  🔍
                </button>

              </div>

            </label>

            <label style={css.label}>
              Almacén

              <input
                style={{
                  ...css.input,

                  ...(tecnicoActivo
                    ? css.readonly
                    : {})
                }}

                value={almacen}

                readOnly={
                  tecnicoActivo
                }

                placeholder="0000"

                onChange={
                  e => {
                    if (
                      tecnicoActivo
                    ) {
                      return
                    }

                    setAlmacen(
                      texto(
                        e.target.value
                      )
                    )

                    setTecnico('')
                    setSku('')
                    setDescripcion('')
                    setLote('')
                  }
                }

                onBlur={() => {
                  if (
                    texto(almacen)
                  ) {
                    cargarContexto(
                      almacen
                    ).catch(
                      e =>
                        setError(
                          e.message
                        )
                    )
                  }
                }}
              />

            </label>

            <label style={css.label}>
              Distrito

              <input
                style={css.readonlyInput}
                value={centro}
                readOnly
              />

            </label>

            <label style={css.label}>
              Centro

              <input
                style={css.readonlyInput}
                value={centro}
                readOnly
              />

            </label>

            <label style={css.label}>
              Técnico

              <input
                style={css.readonlyInput}
                value={tecnico}
                readOnly
              />

            </label>

            <label style={css.label}>
              SKU

              <input
                style={css.readonlyInput}
                value={sku}
                readOnly
              />

            </label>

            <label style={css.label}>
              Descripción

              <input
                style={css.readonlyInput}
                value={descripcion}
                readOnly
              />

            </label>

            <label style={css.label}>
              Lote

              <input
                style={css.readonlyInput}
                value={lote}
                readOnly
              />

            </label>

            <label style={css.label}>
              Cuenta

              <input
                style={css.input}

                placeholder="Capturar cuenta"

                value={cuenta}

                onChange={
                  e =>
                    setCuenta(
                      mayus(
                        e.target.value
                      )
                    )
                }
              />

            </label>

            <label style={css.label}>
              MAC

              <input
                style={css.input}

                placeholder="Capturar MAC"

                value={mac}

                onChange={
                  e =>
                    setMac(
                      mayus(
                        e.target.value
                      )
                    )
                }
              />

            </label>

            <label style={css.label}>
              OT

              <input
                style={css.input}

                placeholder="Capturar OT"

                value={ot}

                onChange={
                  e =>
                    setOt(
                      mayus(
                        e.target.value
                      )
                    )
                }
              />

            </label>

            <label style={css.label}>
              OS

              <input
                style={css.input}

                placeholder="Capturar OS"

                value={os}

                onChange={
                  e =>
                    setOs(
                      mayus(
                        e.target.value
                      )
                    )
                }
              />

            </label>

          </div>

          <label style={css.label}>
            Evidencia

            <input
              ref={fileRef}

              type="file"

              accept="image/*"

              capture="environment"

              style={css.file}

              onChange={
                e =>
                  seleccionarArchivo(
                    e.target
                      .files?.[0]
                  )
              }
            />

          </label>

          {preview && (

            <img
              src={preview}

              alt="Evidencia BRM"

              style={css.preview}
            />

          )}

          <button
            type="button"

            style={css.guardar}

            disabled={
              guardando
            }

            onClick={guardar}
          >
            {
              guardando
                ? 'Guardando...'
                : 'GUARDAR'
            }
          </button>

        </section>

      </div>

    </main>
  )
}

const css = {
  base: {
    minHeight: '100vh',
    background:
      'linear-gradient(180deg,#062d23,#031d17)',
    color: '#fff',
    padding: 16,
    fontFamily:
      'Arial, Helvetica, sans-serif',
  },

  marco: {
    maxWidth: 1200,
    margin: '0 auto',
    border: '1px solid #376b5c',
    borderRadius: 16,
    padding: 20,
    background: '#04251d',
  },

  regresar: {
    border: 0,
    borderRadius: 30,
    padding: '10px 16px',
    background: '#118366',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 15,
  },

  hero: {
    background:
      'linear-gradient(120deg,#10533f,#18a67b)',
    border:
      '1px solid #48a58a',
    borderRadius: 14,
    padding: 25,
    textAlign: 'center',
    marginBottom: 18,
  },

  titulo: {
    margin: 0,
    fontSize: 32,
  },

  subtitulo: {
    margin: '7px 0 0',
    color: '#e4fff6',
  },

  panel: {
    background: '#0b3028',
    color: '#fff',
    border: '1px solid #406f62',
    borderRadius: 14,
    padding: 18,
    marginBottom: 18,
  },

  grid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(250px,1fr))',
    gap: 15,
    marginBottom: 18,
  },

  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
  },

  serieFila: {
    display: 'flex',
    gap: 8,
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 11,
    borderRadius: 8,
    border: '1px solid #c9d7d2',
    background: '#fff',
    color: '#19342a',
  },

  readonly: {
    background: '#e3e9e7',
    cursor: 'not-allowed',
  },

  readonlyInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 11,
    borderRadius: 8,
    border: '1px solid #b9c9c4',
    background: '#e4e9e8',
    color: '#263f36',
    fontWeight: 700,
  },

  buscarIcono: {
    minWidth: 46,
    border: 0,
    borderRadius: 8,
    background: '#159b76',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  file: {
    padding: 10,
    background: '#fff',
    color: '#263f36',
    borderRadius: 8,
    width: '100%',
    boxSizing: 'border-box',
  },

  preview: {
    display: 'block',
    width: '100%',
    maxHeight: 350,
    objectFit: 'contain',
    borderRadius: 10,
    marginTop: 15,
    background: '#d9dfdd',
  },

  guardar: {
    width: '100%',
    border: 0,
    borderRadius: 10,
    padding: 14,
    marginTop: 18,
    background: '#16a34a',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  },

  error: {
    background: '#ffe0e0',
    color: '#8e2525',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },

  exito: {
    background: '#dff9e9',
    color: '#17623e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
}
