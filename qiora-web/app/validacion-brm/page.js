'use client'

import {
  useEffect,
  useRef,
  useState
} from 'react'

import {
  useRouter
} from 'next/navigation'

import {
  supabase
} from '../../lib/supabase'

const limpio = valor =>
  String(
    valor ?? ''
  ).trim()

const upper = valor =>
  limpio(valor)
    .toUpperCase()

export default function ValidacionBrmPage() {
  const router =
    useRouter()

  const serieRef =
    useRef(null)

  const archivoRef =
    useRef(null)

  const [
    cargando,
    setCargando
  ] = useState(false)

  const [
    guardando,
    setGuardando
  ] = useState(false)

  const [
    subiendo,
    setSubiendo
  ] = useState(false)

  const [
    error,
    setError
  ] = useState('')

  const [
    aviso,
    setAviso
  ] = useState('')

  const [
    usuarioActivo,
    setUsuarioActivo
  ] = useState('')

  const [
    almacen,
    setAlmacen
  ] = useState('')

  const [
    distrito,
    setDistrito
  ] = useState('')

  const [
    centro,
    setCentro
  ] = useState('')

  const [
    tecnico,
    setTecnico
  ] = useState('')

  const [
    serie,
    setSerie
  ] = useState('')

  const [
    sku,
    setSku
  ] = useState('')

  const [
    descripcion,
    setDescripcion
  ] = useState('')

  const [
    lote,
    setLote
  ] = useState('')

  const [
    cuenta,
    setCuenta
  ] = useState('')

  const [
    mac,
    setMac
  ] = useState('')

  const [
    ot,
    setOt
  ] = useState('')

  const [
    os,
    setOs
  ] = useState('')

  const [
    evidencia,
    setEvidencia
  ] = useState(null)

  const [
    preview,
    setPreview
  ] = useState('')

  /*
    =============================
    USUARIO ACTIVO
    =============================
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

        if (!vivo) {
          return
        }

        /*
          SOPORTA OBJETO O ARRAY
        */
        const perfil =
          Array.isArray(data)
            ? data[0]
            : data

        if (!perfil) {
          throw new Error(
            'No fue posible obtener el perfil activo.'
          )
        }

        const usuario =
          perfil.nombre ||
          perfil.usuario_almacen ||
          perfil.usuario ||
          ''

        setUsuarioActivo(
          usuario
        )

        /*
          SI EL PERFIL TRAE ALMACÉN,
          LO COLOCAMOS AUTOMÁTICAMENTE.
        */
        const almacenPerfil =
          perfil.usuario_almacen ||
          perfil.almacen ||
          ''

        if (almacenPerfil) {
          setAlmacen(
            upper(
              almacenPerfil
            )
          )
        }

      } catch (e) {
        setError(
          e?.message ||
          'No se pudo cargar el usuario.'
        )
      }
    })()

    return () => {
      vivo = false
    }
  }, [])

  /*
    =============================
    CONTEXTO POR DISTRITO
    =============================
  */

  async function cargarContexto(
    almacenValor
  ) {
    const a =
      upper(
        almacenValor
      )

    if (!a) {
      setDistrito('')
      setCentro('')
      setTecnico('')

      return null
    }

    const {
      data,
      error:
        contextoError
    } =
      await supabase.rpc(
        'qiora_brm_contexto',
        {
          p_almacen:
            a
        }
      )

    if (contextoError) {
      throw contextoError
    }

    setAlmacen(
      data?.almacen ||
      a
    )

    setDistrito(
      data?.distrito ||
      ''
    )

    setCentro(
      data?.centro ||
      ''
    )

    setTecnico(
      data?.tecnico ||
      ''
    )

    return data
  }

  /*
    =============================
    BUSCAR SERIE
    =============================
  */

  async function consultarSerie() {
    if (cargando) {
      return
    }

    setError('')
    setAviso('')

    const a =
      upper(
        almacen
      )

    const s =
      upper(
        serie
      )

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

    setCargando(true)

    try {
      await cargarContexto(
        a
      )

      const {
        data,
        error:
          serieError
      } =
        await supabase.rpc(
          'qiora_brm_buscar_serie',
          {
            p_almacen:
              a,

            p_serie:
              s
          }
        )

      if (serieError) {
        throw serieError
      }

      setSerie(
        data?.serie ||
        s
      )

      setSku(
        data?.sku ||
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

      setDistrito(
        data?.distrito ||
        ''
      )

      setCentro(
        data?.centro ||
        ''
      )

      setTecnico(
        data?.tecnico ||
        ''
      )

      setAviso(
        'Serie encontrada correctamente.'
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
      setCargando(false)
    }
  }

  /*
    =============================
    EVIDENCIA
    =============================
  */

  function seleccionarEvidencia(
    archivo
  ) {
    setEvidencia(
      archivo ||
      null
    )

    if (preview) {
      URL.revokeObjectURL(
        preview
      )
    }

    if (archivo) {
      setPreview(
        URL.createObjectURL(
          archivo
        )
      )
    } else {
      setPreview('')
    }
  }

  async function subirEvidencia() {
    if (!evidencia) {
      return ''
    }

    setSubiendo(true)

    try {
      const extension =
        evidencia.name
          ?.split('.')
          .pop()
          ?.toLowerCase() ||
        'jpg'

      const nombreSeguro =
        `${Date.now()}_${upper(serie)
          .replace(
            /[^A-Z0-9_-]/g,
            ''
          )}.${extension}`

      /*
        IMPORTANTE:
        LA RUTA TAMBIÉN QUEDA
        SEPARADA POR DISTRITO.
      */
      const ruta =
        `${upper(distrito)}/${upper(almacen)}/${nombreSeguro}`

      const {
        error:
          uploadError
      } =
        await supabase.storage
          .from(
            'brm-evidencias'
          )
          .upload(
            ruta,
            evidencia,
            {
              cacheControl:
                '3600',

              upsert:
                false
            }
          )

      if (uploadError) {
        throw uploadError
      }

      const {
        data
      } =
        supabase.storage
          .from(
            'brm-evidencias'
          )
          .getPublicUrl(
            ruta
          )

      return (
        data
          ?.publicUrl ||
        ''
      )

    } finally {
      setSubiendo(false)
    }
  }

  /*
    =============================
    LIMPIAR
    =============================
  */

  function limpiarFormulario() {
    setSerie('')
    setSku('')
    setDescripcion('')
    setLote('')
    setCuenta('')
    setMac('')
    setOt('')
    setOs('')

    setEvidencia(
      null
    )

    if (preview) {
      URL.revokeObjectURL(
        preview
      )
    }

    setPreview('')

    if (
      archivoRef.current
    ) {
      archivoRef.current.value =
        ''
    }

    setError('')

    setTimeout(
      () => {
        serieRef.current
          ?.focus()
      },
      100
    )
  }

  /*
    =============================
    GUARDAR
    =============================
  */

  async function guardar() {
    if (
      guardando ||
      subiendo
    ) {
      return
    }

    setError('')
    setAviso('')

    try {
      if (!upper(almacen)) {
        throw new Error(
          'Captura el almacén.'
        )
      }

      if (!upper(serie)) {
        throw new Error(
          'Captura la serie.'
        )
      }

      if (!sku) {
        throw new Error(
          'Primero consulta una serie válida.'
        )
      }

      if (!upper(distrito)) {
        throw new Error(
          'No se pudo determinar el distrito.'
        )
      }

      if (!upper(centro)) {
        throw new Error(
          'No se pudo determinar el centro del distrito.'
        )
      }

      if (!limpio(cuenta)) {
        throw new Error(
          'Captura la cuenta.'
        )
      }

      if (!limpio(mac)) {
        throw new Error(
          'Captura la MAC.'
        )
      }

      if (!limpio(ot)) {
        throw new Error(
          'Captura la OT.'
        )
      }

      if (!limpio(os)) {
        throw new Error(
          'Captura la OS.'
        )
      }

      if (!evidencia) {
        throw new Error(
          'Agrega la evidencia.'
        )
      }

      setGuardando(true)

      /*
        VOLVEMOS A VALIDAR CONTEXTO
        ANTES DE GUARDAR.
      */
      await cargarContexto(
        almacen
      )

      const evidenciaUrl =
        await subirEvidencia()

      const {
        data,
        error:
          guardarError
      } =
        await supabase.rpc(
          'qiora_brm_guardar',
          {
            p_almacen:
              upper(almacen),

            p_serie:
              upper(serie),

            p_cuenta:
              upper(cuenta),

            p_mac:
              upper(mac),

            p_ot:
              upper(ot),

            p_os:
              upper(os),

            p_evidencia_url:
              evidenciaUrl,

            p_validado_por:
              usuarioActivo
          }
        )

      if (guardarError) {
        throw guardarError
      }

      setAviso(
        `BRM guardado correctamente. Distrito: ${data?.distrito || distrito} · Centro: ${data?.centro || centro}`
      )

      /*
        LIMPIAMOS SOLO LA CAPTURA.
        ALMACÉN / DISTRITO / CENTRO
        SE CONSERVAN PARA SIGUIENTE
        EQUIPO.
      */
      limpiarFormulario()

    } catch (e) {
      console.error(
        'ERROR BRM:',
        e
      )

      setError(
        e?.message ||
        'No fue posible guardar la validación BRM.'
      )

    } finally {
      setGuardando(false)
    }
  }

  return (
    <main style={css.base}>

      <div style={css.marco}>

        <button
          type="button"
          style={css.regresar}
          onClick={() =>
            router.back()
          }
        >
          ← Regresar a Técnicos
        </button>

        <header style={css.hero}>
          <h1 style={css.titulo}>
            Validación BRM
          </h1>

          <p style={css.subtitulo}>
            Validación por Distrito
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

              <div style={css.filaSerie}>

                <input
                  ref={serieRef}
                  style={css.input}
                  placeholder="Escanear serie"
                  value={serie}
                  onChange={
                    e =>
                      setSerie(
                        upper(
                          e.target.value
                        )
                      )
                  }
                  onKeyDown={
                    e => {
                      if (
                        e.key ===
                        'Enter'
                      ) {
                        consultarSerie()
                      }
                    }
                  }
                />

                <button
                  type="button"
                  style={css.buscar}
                  disabled={cargando}
                  onClick={
                    consultarSerie
                  }
                >
                  {
                    cargando
                      ? '...'
                      : '🔍'
                  }
                </button>

              </div>
            </label>

            <label style={css.label}>
              Almacén

              <input
                style={css.input}
                placeholder="1906"
                value={almacen}
                onChange={
                  e => {
                    setAlmacen(
                      upper(
                        e.target.value
                      )
                    )

                    setDistrito('')
                    setCentro('')
                    setTecnico('')
                    setSku('')
                    setDescripcion('')
                    setLote('')
                  }
                }
                onBlur={() => {
                  if (
                    upper(
                      almacen
                    )
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
                style={css.bloqueado}
                value={distrito}
                readOnly
                placeholder="Automático"
              />
            </label>

            <label style={css.label}>
              Centro

              <input
                style={css.bloqueado}
                value={centro}
                readOnly
                placeholder="Automático por distrito"
              />
            </label>

            <label style={css.label}>
              Técnico

              <input
                style={css.bloqueado}
                value={tecnico}
                readOnly
              />
            </label>

            <label style={css.label}>
              SKU

              <input
                style={css.bloqueado}
                value={sku}
                readOnly
              />
            </label>

            <label style={css.label}>
              Descripción

              <input
                style={css.bloqueado}
                value={descripcion}
                readOnly
              />
            </label>

            <label style={css.label}>
              Lote

              <input
                style={css.bloqueado}
                value={lote}
                readOnly
              />
            </label>

            <label style={css.label}>
              Cuenta

              <input
                style={css.input}
                value={cuenta}
                onChange={
                  e =>
                    setCuenta(
                      upper(
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
                value={mac}
                onChange={
                  e =>
                    setMac(
                      upper(
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
                value={ot}
                onChange={
                  e =>
                    setOt(
                      upper(
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
                value={os}
                onChange={
                  e =>
                    setOs(
                      upper(
                        e.target.value
                      )
                    )
                }
              />
            </label>

          </div>

          <div style={css.evidenciaBox}>

            <label style={css.label}>
              Evidencia

              <input
                ref={archivoRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={css.archivo}
                onChange={
                  e =>
                    seleccionarEvidencia(
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

          </div>

          <button
            type="button"
            style={css.guardar}
            disabled={
              guardando ||
              subiendo
            }
            onClick={guardar}
          >
            {
              guardando
                ? 'Guardando...'
                : subiendo
                  ? 'Subiendo evidencia...'
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
    padding: 16,
    background:
      'linear-gradient(180deg,#087b95,#07485b)',
    fontFamily:
      'Arial, Helvetica, sans-serif',
    color: '#fff'
  },

  marco: {
    maxWidth: 1000,
    margin: '0 auto'
  },

  regresar: {
    background: '#0e6075',
    border: '1px solid #77b7c5',
    color: '#fff',
    padding: '10px 18px',
    borderRadius: 24,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 12
  },

  hero: {
    textAlign: 'center',
    marginBottom: 18
  },

  titulo: {
    margin: 0,
    fontSize: 32
  },

  subtitulo: {
    margin:
      '5px 0 0',
    opacity: .9
  },

  panel: {
    background: '#f5f7f8',
    color: '#23343a',
    borderRadius: 12,
    padding: 18,
    boxShadow:
      '0 8px 25px rgba(0,0,0,.18)'
  },

  grid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(260px,1fr))',
    gap: 16
  },

  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 700
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 11,
    borderRadius: 7,
    border: '1px solid #b8c3c8',
    background: '#fff',
    color: '#1d3238',
    textTransform: 'uppercase'
  },

  bloqueado: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 11,
    borderRadius: 7,
    border: '1px solid #cad4d7',
    background: '#e4e8ea',
    color: '#44565b',
    fontWeight: 700
  },

  filaSerie: {
    display: 'flex',
    gap: 5
  },

  buscar: {
    minWidth: 45,
    border: 0,
    borderRadius: 7,
    background: '#0787a1',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 18
  },

  evidenciaBox: {
    marginTop: 18
  },

  archivo: {
    background: '#fff',
    color: '#263a40',
    padding: 10,
    border:
      '1px solid #bdc9cd',
    borderRadius: 7
  },

  preview: {
    marginTop: 12,
    width: '100%',
    maxHeight: 340,
    objectFit: 'contain',
    background: '#ddd',
    borderRadius: 8
  },

  guardar: {
    display: 'block',
    width: '100%',
    marginTop: 22,
    border: 0,
    borderRadius: 8,
    padding: 14,
    background: '#078aa4',
    color: '#fff',
    fontWeight: 800,
    fontSize: 16,
    cursor: 'pointer'
  },

  error: {
    marginBottom: 12,
    background: '#ffe1e1',
    color: '#8d2525',
    padding: 12,
    borderRadius: 8,
    fontWeight: 700
  },

  exito: {
    marginBottom: 12,
    background: '#dffbea',
    color: '#13643c',
    padding: 12,
    borderRadius: 8,
    fontWeight: 700
  }
}
