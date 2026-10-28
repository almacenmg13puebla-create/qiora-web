'use client'

import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const MENU = [
  ['Accesos especiales', null],
  ['Actualizar máximos', 'catalogos'],
  ['Materiales', 'materiales'],
  ['Distritos', 'distritos'],
  ['Horarios', 'horarios'],

  ['Costos SAP', 'costos_sap'],
  ['Costos ODOO', 'costos_odoo'],
  ['Herramienta ODOO', 'herramienta_odoo_inventario'],
  ['Exportar fechas', null],
  ['Usuarios', 'usuarios'],

  ['RECUS TP', null],
  ['Actualizar macro Excel', null],
  ['Grupos de materiales', 'grupos_materiales']
]

const CAMPOS = {
  costos_sap: [
    ['sku', 'SKU'],
    ['material', 'Material'],
    ['costo_unitario', 'Costo unitario'],
    ['activo', 'Activo']
  ],

  herramienta_odoo_inventario: [
    ['no_empleado', 'No. empleado'],
    ['colaborador', 'Colaborador'],
    ['referencia', 'Referencia'],
    ['producto', 'Producto'],
    ['cantidad', 'Cantidad'],
    ['valor_compra', 'Valor compra (total)'],
    ['valor_actual', 'Valor actual (total)'],
    ['estado', 'Estado']
  ],

  costos_odoo: [
    ['sku', 'SKU'],
    ['herramienta', 'Herramienta'],
    ['costo', 'Costo'],
    ['vida_util_meses', 'Vida útil (meses)'],
    ['activo', 'Activo']
  ],

  materiales: [
    ['sku', 'SKU'],
    ['material', 'Material'],
    ['tipo', 'Tipo'],
    ['grupo', 'Grupo'],
    ['maximo', 'Máximo'],
    ['activo', 'Activo']
  ],

  grupos_materiales: [
    ['grupo', 'Grupo'],
    ['tipo', 'Tipo'],
    ['maximo', 'Máximo'],
    ['activo', 'Activo']
  ]
}

const nombres = {
  distritos: 'Administrar Distritos',
  horarios: 'Configurar días y horarios',
  usuarios: 'Usuarios / Número de empleado',
  costos_sap: 'Costos SAP',
  costos_odoo: 'Costos ODOO',
  herramienta_odoo_inventario:
    'Herramienta ODOO por colaborador',
  materiales: 'Materiales',
  grupos_materiales: 'Grupos de materiales'
}

const DIAS = [
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO',
  'DOMINGO'
]

const normal = x =>
  String(x ?? '')
    .toLocaleUpperCase('es-MX')

const textoNumero = x =>
  String(x ?? '').trim()

const nuevo = () => ({
  sku: '',
  material: '',
  herramienta: '',
  costo: '',
  vida_util_meses: '12',
  activo: true
})

const nuevoUsuarioVacio = () => ({
  usuario_almacen: '',
  clave: '',
  nombre: '',
  telefono: '',
  puesto: 'TECNICO',
  numero_empleado: '',
  correo: '',
  coordinador: '',
  usuario_ffm: '',
  fecha_nacimiento: '',
  telegram_chat_id: '',
  activo: true,
  permisos: {}
})

const nuevoHorario = () => ({
  dia: 'LUNES',
  fecha: '',
  hora_inicio: '',
  hora_fin: '',
  activo: true
})

const horarioActivo = valor =>
  valor === true ||
  String(valor ?? '')
    .trim()
    .toUpperCase() === 'SI'

export default function ConfiguracionPage() {
  const router = useRouter()

  const [validando, setValidando] =
    useState(true)

  const [permitido, setPermitido] =
    useState(false)

  const [seccion, setSeccion] =
    useState('')

  const [filas, setFilas] =
    useState([])

  const [busqueda, setBusqueda] =
    useState('')

  const [pagina, setPagina] =
    useState(1)

  const [total, setTotal] =
    useState(0)

  const [form, setForm] =
    useState(nuevo())

  const [cargando, setCargando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [aviso, setAviso] =
    useState('')

  /*
    USUARIOS
  */

  const [usuarios, setUsuarios] =
    useState([])

  const [
    permisosDisponibles,
    setPermisosDisponibles
  ] = useState([])

  const [
    usuarioEditando,
    setUsuarioEditando
  ] = useState(null)

  const [
    filtroActivos,
    setFiltroActivos
  ] = useState('TODOS')

  const [
    creandoUsuario,
    setCreandoUsuario
  ] = useState(false)

  const [
    nuevoUsuario,
    setNuevoUsuario
  ] = useState(
    nuevoUsuarioVacio()
  )

  const [
    guardandoFicha,
    setGuardandoFicha
  ] = useState(false)

  /*
    DISTRITOS
  */

  const [esPadre, setEsPadre] =
    useState(false)

  const [distritos, setDistritos] =
    useState([])

  const [
    distritoEditando,
    setDistritoEditando
  ] = useState('')

  const [
    distritoForm,
    setDistritoForm
  ] = useState({
    centro: '',
    nombre_region: '',
    token_excel: '',
    token_traspasos: '',
    chat_traspasos: '',
    activo: true
  })

  const [
    configTelegram,
    setConfigTelegram
  ] = useState({})

  const [
    guardandoDistrito,
    setGuardandoDistrito
  ] = useState(false)

  const [
    creandoAdminDistrito,
    setCreandoAdminDistrito
  ] = useState('')

  /*
    HORARIOS
  */

  const [
    horarios,
    setHorarios
  ] = useState([])

  const [
    horarioForm,
    setHorarioForm
  ] = useState(
    nuevoHorario()
  )

  const [
    horarioEditando,
    setHorarioEditando
  ] = useState(null)

  const [
    guardandoHorario,
    setGuardandoHorario
  ] = useState(false)

  /*
    VALIDAR CONFIGURACIÓN
  */

  useEffect(() => {
    let vivo = true

    ;(async () => {
      try {
        const {
          data: { user },
          error: authError
        } =
          await supabase.auth
            .getUser()

        if (
          authError ||
          !user
        ) {
          router.replace('/')
          return
        }

        const {
          data,
          error: e
        } =
          await supabase.rpc(
            'qiora_config_es_admin'
          )

        if (e) throw e

        if (vivo) {
          setPermitido(
            data === true
          )
        }

      } catch (e) {

        if (vivo) {
          setError(
            e.message ||
            'No se pudo validar el acceso'
          )
        }

      } finally {

        if (vivo) {
          setValidando(false)
        }
      }
    })()

    return () => {
      vivo = false
    }
  }, [router])

  /*
    CATÁLOGOS
  */

  const cargar =
    useCallback(
      async tipo => {

        if (!tipo) return

        setCargando(true)
        setError('')
        setAviso('')

        try {
          const inventario =
            tipo ===
            'herramienta_odoo_inventario'

          const {
            data,
            error: e
          } =
            inventario
              ? await supabase.rpc(
                  'qiora_herramienta_odoo_listar',
                  {
                    p_buscar:
                      busqueda,

                    p_pagina:
                      pagina,

                    p_limite:
                      100
                  }
                )
              : await supabase.rpc(
                  'qiora_config_listar',
                  {
                    p_catalogo:
                      tipo
                  }
                )

          if (e) throw e

          setFilas(
            Array.isArray(
              data?.filas
            )
              ? data.filas
              : []
          )

          setTotal(
            Number(
              data?.total ||
              0
            )
          )

        } catch (e) {

          setError(
            e.message ||
            'Error al cargar'
          )

          setFilas([])

        } finally {

          setCargando(false)
        }
      },
      [
        busqueda,
        pagina
      ]
    )

  /*
    ==========================
    HORARIOS
    ==========================
  */

  async function cargarHorarios() {
    setCargando(true)
    setError('')
    setAviso('')

    try {
      const {
        data,
        error: e
      } =
        await supabase
          .from(
            'config_horarios'
          )
          .select(`
            dia,
            hora_inicio,
            hora_fin,
            activo,
            fecha
          `)
          .order(
            'fecha',
            {
              ascending:
                false
            }
          )
          .order(
            'dia',
            {
              ascending:
                true
            }
          )

      if (e) throw e

      setHorarios(
        Array.isArray(data)
          ? data
          : []
      )

    } catch (e) {

      setError(
        e.message ||
        'No fue posible cargar CONFIG_HORARIOS.'
      )

      setHorarios([])

    } finally {

      setCargando(false)
    }
  }

  function limpiarHorario() {
    setHorarioEditando(
      null
    )

    setHorarioForm(
      nuevoHorario()
    )

    setError('')
  }

  function editarHorario(
    horario
  ) {
    setHorarioEditando({
      dia:
        horario.dia,

      fecha:
        horario.fecha
    })

    setHorarioForm({
      dia:
        String(
          horario.dia ||
          ''
        )
          .trim()
          .toUpperCase(),

      fecha:
        String(
          horario.fecha ||
          ''
        ).slice(
          0,
          10
        ),

      hora_inicio:
        String(
          horario.hora_inicio ||
          ''
        ).slice(
          0,
          5
        ),

      hora_fin:
        String(
          horario.hora_fin ||
          ''
        ).slice(
          0,
          5
        ),

      activo:
        horarioActivo(
          horario.activo
        )
    })

    setError('')
    setAviso('')

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }

  async function guardarHorario() {
    if (guardandoHorario) {
      return
    }

    setGuardandoHorario(
      true
    )

    setError('')
    setAviso('')

    try {
      const dia =
        String(
          horarioForm.dia ||
          ''
        )
          .trim()
          .toUpperCase()

      const fecha =
        String(
          horarioForm.fecha ||
          ''
        ).trim()

      const horaInicio =
        String(
          horarioForm
            .hora_inicio ||
          ''
        ).slice(
          0,
          5
        )

      const horaFin =
        String(
          horarioForm
            .hora_fin ||
          ''
        ).slice(
          0,
          5
        )

      if (
        !DIAS.includes(
          dia
        )
      ) {
        throw new Error(
          'Selecciona un día válido.'
        )
      }

      if (!fecha) {
        throw new Error(
          'Selecciona la fecha.'
        )
      }

      if (!horaInicio) {
        throw new Error(
          'Selecciona la hora de inicio.'
        )
      }

      if (!horaFin) {
        throw new Error(
          'Selecciona la hora de fin.'
        )
      }

      const registro = {
        dia,
        fecha,
        hora_inicio:
          horaInicio,

        hora_fin:
          horaFin,

        activo:
          horarioForm.activo
            ? 'SI'
            : 'NO'
      }

      /*
        EDITAR REGISTRO EXISTENTE
      */
      if (horarioEditando) {
        const {
          error: updateError
        } =
          await supabase
            .from(
              'config_horarios'
            )
            .update(
              registro
            )
            .eq(
              'dia',
              horarioEditando
                .dia
            )
            .eq(
              'fecha',
              horarioEditando
                .fecha
            )

        if (updateError) {
          throw updateError
        }

        setAviso(
          'Horario actualizado correctamente.'
        )

      } else {

        /*
          VERIFICAR SI YA EXISTE
          MISMO DÍA + FECHA.
        */
        const {
          data:
            existente,
          error:
            buscarError
        } =
          await supabase
            .from(
              'config_horarios'
            )
            .select(
              'dia,fecha'
            )
            .eq(
              'dia',
              dia
            )
            .eq(
              'fecha',
              fecha
            )
            .limit(1)
            .maybeSingle()

        if (buscarError) {
          throw buscarError
        }

        if (existente) {
          /*
            Si ya existe ese día y fecha,
            actualizamos para evitar duplicados.
          */
          const {
            error:
              updateError
          } =
            await supabase
              .from(
                'config_horarios'
              )
              .update(
                registro
              )
              .eq(
                'dia',
                dia
              )
              .eq(
                'fecha',
                fecha
              )

          if (updateError) {
            throw updateError
          }

          setAviso(
            'El día y fecha ya existían. El horario fue actualizado.'
          )

        } else {
          const {
            error:
              insertError
          } =
            await supabase
              .from(
                'config_horarios'
              )
              .insert(
                registro
              )

          if (insertError) {
            throw insertError
          }

          setAviso(
            'Horario guardado correctamente.'
          )
        }
      }

      setHorarioEditando(
        null
      )

      setHorarioForm(
        nuevoHorario()
      )

      await cargarHorarios()

    } catch (e) {

      setError(
        e.message ||
        'No fue posible guardar el horario.'
      )

    } finally {

      setGuardandoHorario(
        false
      )
    }
  }

  /*
    ==========================
    TELEGRAM DISTRITOS
    ==========================
  */

  async function cargarTelegramDistritos() {
    try {
      const {
        data: {
          session
        }
      } =
        await supabase.auth
          .getSession()

      if (
        !session
          ?.access_token
      ) {
        return
      }

      const r =
        await fetch(
          '/api/distritos/telegram',
          {
            headers: {
              Authorization:
                'Bearer ' +
                session.access_token
            },

            cache:
              'no-store'
          }
        )

      const j =
        await r.json()

      if (!r.ok) {
        throw new Error(
          j.error ||
          'No se pudo consultar Telegram'
        )
      }

      setConfigTelegram(
        j.distritos ||
        {}
      )

    } catch (e) {

      setError(
        e.message ||
        'No se pudo consultar Telegram'
      )
    }
  }

  async function guardarTelegramDistrito(
    centro,
    token,
    chat
  ) {
    if (
      !token &&
      !chat
    ) {
      return
    }

    const {
      data: {
        session
      }
    } =
      await supabase.auth
        .getSession()

    if (
      !session
        ?.access_token
    ) {
      throw new Error(
        'Sesión caducada'
      )
    }

    const r =
      await fetch(
        '/api/distritos/telegram',
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              'Bearer ' +
              session.access_token
          },

          body:
            JSON.stringify({
              centro,

              token_traspasos:
                token ||
                '',

              chat_traspasos:
                chat ||
                ''
            })
        }
      )

    const j =
      await r.json()

    if (!r.ok) {
      throw new Error(
        j.error ||
        'No se pudo guardar Telegram'
      )
    }

    await cargarTelegramDistritos()
  }

  /*
    ==========================
    DISTRITOS
    ==========================
  */

  async function cargarDistritos() {
    setCargando(true)
    setError('')

    try {
      const {
        data,
        error: e
      } =
        await supabase.rpc(
          'qiora_distritos_listar'
        )

      if (e) throw e

      setDistritos(
        Array.isArray(data)
          ? data
          : []
      )

      await cargarTelegramDistritos()

    } catch (e) {

      setError(
        e.message ||
        'No se pudieron cargar los distritos'
      )

    } finally {

      setCargando(false)
    }
  }

  async function guardarDistrito() {
    if (guardandoDistrito) {
      return
    }

    setGuardandoDistrito(
      true
    )

    setError('')
    setAviso('')

    try {
      const centro =
        String(
          distritoForm.centro ||
          ''
        )
          .trim()
          .toUpperCase()

      const nombre =
        String(
          distritoForm
            .nombre_region ||
          ''
        ).trim()

      if (
        !/^[A-Z]{2,5}[0-9]{1,5}$/
          .test(
            centro
          )
      ) {
        throw new Error(
          'Centro inválido. Ejemplo: MG13, ME13 o MG19.'
        )
      }

      if (!nombre) {
        throw new Error(
          'Captura Nombre o Región.'
        )
      }

      if (!distritoEditando) {
        const {
          data: {
            session
          }
        } =
          await supabase.auth
            .getSession()

        if (
          !session
            ?.access_token
        ) {
          throw new Error(
            'Sesión caducada.'
          )
        }

        const respuesta =
          await fetch(
            '/api/distritos/crear',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',

                Authorization:
                  'Bearer ' +
                  session.access_token
              },

              body:
                JSON.stringify({
                  centro,

                  nombre_region:
                    nombre,

                  token_excel:
                    distritoForm
                      .token_excel ||
                    null,

                  activo:
                    distritoForm
                      .activo
                })
            }
          )

        const resultado =
          await respuesta.json()

        if (!respuesta.ok) {
          throw new Error(
            resultado.error ||
            'No se pudo crear distrito y administrador'
          )
        }

        setAviso(
          'Distrito ' +
          centro +
          ' creado. Administrador: ' +
          resultado.usuario +
          '. Contraseña temporal: ' +
          resultado.clave_temporal +
          ' (cópiala ahora; no se mostrará otra vez).'
        )

      } else {
        const {
          error: e
        } =
          await supabase.rpc(
            'qiora_distritos_guardar',
            {
              p_centro:
                centro,

              p_nombre_region:
                nombre,

              p_token_excel:
                distritoForm
                  .token_excel ||
                null,

              p_activo:
                distritoForm
                  .activo,

              p_centro_original:
                distritoEditando
            }
          )

        if (e) throw e

        setAviso(
          'Distrito actualizado. TOKEN_EXCEL permanece oculto.'
        )
      }

      try {
        await guardarTelegramDistrito(
          centro,
          distritoForm
            .token_traspasos,
          distritoForm
            .chat_traspasos
        )

      } catch (err) {

        setAviso(
          'Distrito guardado, pero TELEGRAM no se guardó: ' +
          err.message
        )
      }

      setDistritoEditando(
        ''
      )

      setDistritoForm({
        centro: '',
        nombre_region: '',
        token_excel: '',
        token_traspasos: '',
        chat_traspasos: '',
        activo: true
      })

      await cargarDistritos()

    } catch (e) {

      setError(
        e.message ||
        'No se pudo guardar el distrito'
      )

    } finally {

      setGuardandoDistrito(
        false
      )
    }
  }

  async function crearAdminExistente(
    centro
  ) {
    if (
      creandoAdminDistrito
    ) {
      return
    }

    if (
      !window.confirm(
        '¿Crear ADMIN_' +
        centro +
        ' para el distrito ' +
        centro +
        '? La contraseña temporal se mostrará solo una vez.'
      )
    ) {
      return
    }

    setCreandoAdminDistrito(
      centro
    )

    setError('')
    setAviso('')

    try {
      const {
        data: {
          session
        }
      } =
        await supabase.auth
          .getSession()

      if (
        !session
          ?.access_token
      ) {
        throw new Error(
          'Sesión caducada. Vuelve a iniciar sesión.'
        )
      }

      const response =
        await fetch(
          '/api/distritos/crear-administrador',
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                'Bearer ' +
                session.access_token
            },

            body:
              JSON.stringify({
                centro
              })
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
          'No se pudo crear administrador'
        )
      }

      setAviso(
        'Administrador creado: ' +
        result.usuario +
        '. CLAVE TEMPORAL: ' +
        result.clave_temporal
      )

      await cargarDistritos()

    } catch (e) {

      setError(
        e.message ||
        'No fue posible crear el administrador'
      )

    } finally {

      setCreandoAdminDistrito(
        ''
      )
    }
  }

  function editarDistrito(
    d
  ) {
    setDistritoEditando(
      d.centro
    )

    setDistritoForm({
      centro:
        d.centro,

      nombre_region:
        d.nombre_region,

      token_excel:
        '',

      token_traspasos:
        '',

      chat_traspasos:
        configTelegram[
          d.centro
        ]?.chat_traspasos ||
        '',

      activo:
        d.activo
    })

    setAviso(
      'Por seguridad, el token no se recupera.'
    )
  }

  /*
    ==========================
    USUARIOS
    ==========================
  */

  async function cargarUsuarios() {
    setCargando(true)
    setError('')
    setAviso('')

    try {
      const {
        data,
        error: e
      } =
        await supabase.rpc(
          'qiora_usuarios_administracion_listar'
        )

      if (e) throw e

      setUsuarios(
        Array.isArray(
          data?.usuarios
        )
          ? data.usuarios
          : []
      )

      setPermisosDisponibles(
        Array.isArray(
          data?.permisos
        )
          ? data.permisos
          : []
      )

    } catch (e) {

      setError(
        e.message ||
        'No se pudieron cargar usuarios'
      )

    } finally {

      setCargando(false)
    }
  }

  async function crearCuentaUsuario() {
    if (guardandoFicha) {
      return
    }

    setGuardandoFicha(
      true
    )

    setError('')
    setAviso('')

    try {
      if (
        !textoNumero(
          nuevoUsuario
            .usuario_almacen
        ) ||
        !nuevoUsuario.clave ||
        !textoNumero(
          nuevoUsuario.nombre
        )
      ) {
        throw new Error(
          'Usuario, clave y nombre son obligatorios.'
        )
      }

      const {
        data: {
          session
        },
        error:
          sessionError
      } =
        await supabase.auth
          .getSession()

      if (
        sessionError ||
        !session
          ?.access_token
      ) {
        throw new Error(
          'La sesión expiró.'
        )
      }

      const response =
        await fetch(
          '/api/usuarios/crear',
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${session.access_token}`
            },

            body:
              JSON.stringify({
                ...nuevoUsuario,

                telegram_chat_id:
                  String(
                    nuevoUsuario
                      .telegram_chat_id ||
                    ''
                  ).trim() ||
                  null
              })
          }
        )

      const resultado =
        await response
          .json()
          .catch(
            () => ({})
          )

      if (
        !response.ok ||
        !resultado.ok
      ) {
        throw new Error(
          resultado.error ||
          'No se pudo crear el usuario'
        )
      }

      setCreandoUsuario(
        false
      )

      setNuevoUsuario(
        nuevoUsuarioVacio()
      )

      await cargarUsuarios()

      setAviso(
        'Cuenta creada correctamente.'
      )

    } catch (e) {

      setError(
        e.message ||
        'No se pudo crear el usuario'
      )

    } finally {

      setGuardandoFicha(
        false
      )
    }
  }

  const cambiarNuevo =
    (
      campo,
      valor
    ) =>
      setNuevoUsuario(
        u => ({
          ...u,
          [campo]:
            valor
        })
      )

  function editarUsuario(
    u
  ) {
    setUsuarioEditando({
      ...u,

      telegram_chat_id:
        u.telegram_chat_id ||
        '',

      permisos: {
        ...(u.permisos || {})
      }
    })

    setError('')
    setAviso('')

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }

  async function guardarFichaUsuario() {
    if (
      !usuarioEditando ||
      guardandoFicha
    ) {
      return
    }

    setGuardandoFicha(
      true
    )

    setError('')
    setAviso('')

    try {
      const {
        data,
        error: e
      } =
        await supabase.rpc(
          'qiora_usuarios_administracion_guardar',
          {
            p_id:
              String(
                usuarioEditando.id
              ),

            p_datos: {
              nombre:
                usuarioEditando.nombre,

              telefono:
                usuarioEditando.telefono,

              puesto:
                usuarioEditando.puesto,

              correo:
                usuarioEditando.correo,

              coordinador:
                usuarioEditando.coordinador,

              numero_empleado:
                usuarioEditando
                  .numero_empleado,

              usuario_ffm:
                usuarioEditando
                  .usuario_ffm,

              fecha_nacimiento:
                usuarioEditando
                  .fecha_nacimiento,

              telegram_chat_id:
                String(
                  usuarioEditando
                    .telegram_chat_id ||
                  ''
                ).trim() ||
                null,

              activo:
                usuarioEditando.activo,

              permisos:
                usuarioEditando.permisos
            }
          }
        )

      if (e) throw e

      if (
        data !== true
      ) {
        throw new Error(
          'No se confirmó el guardado'
        )
      }

      setUsuarioEditando(
        null
      )

      await cargarUsuarios()

      setAviso(
        'Usuario actualizado correctamente.'
      )

    } catch (e) {

      setError(
        e.message ||
        'No se pudo guardar el usuario'
      )

    } finally {

      setGuardandoFicha(
        false
      )
    }
  }

  async function cambiarEstadoUsuario(
    u
  ) {
    if (
      !window.confirm(
        `¿${u.activo ? 'Desactivar' : 'Activar'} a ${u.nombre}?`
      )
    ) {
      return
    }

    setGuardandoFicha(
      true
    )

    setError('')

    try {
      const {
        error: e
      } =
        await supabase.rpc(
          'qiora_usuarios_administracion_guardar',
          {
            p_id:
              String(u.id),

            p_datos: {
              activo:
                !u.activo
            }
          }
        )

      if (e) throw e

      await cargarUsuarios()

      setAviso(
        'Estado actualizado.'
      )

    } catch (e) {

      setError(
        e.message ||
        'No se pudo actualizar el estado'
      )

    } finally {

      setGuardandoFicha(
        false
      )
    }
  }

  const editarCampoUsuario =
    (
      campo,
      valor
    ) =>
      setUsuarioEditando(
        u => ({
          ...u,
          [campo]:
            valor
        })
      )

  const permisosActivos =
    usuarioEditando
      ? Object.values(
          usuarioEditando
            .permisos ||
          {}
        )
          .filter(Boolean)
          .length
      : 0

  /*
    ==========================
    ABRIR OPCIONES
    ==========================
  */

  function abrir(tipo) {
    if (
      tipo ===
      'catalogos'
    ) {
      router.push(
        '/inventarios/catalogos'
      )

      return
    }

    setSeccion(tipo)
    setForm(nuevo())
    setBusqueda('')
    setPagina(1)
    setError('')
    setAviso('')

    if (
      tipo ===
      'usuarios'
    ) {
      cargarUsuarios()

    } else if (
      tipo ===
      'horarios'
    ) {
      cargarHorarios()

    } else if (
      tipo ===
      'distritos'
    ) {
      supabase
        .rpc(
          'qiora_distritos_es_padre'
        )
        .then(
          ({
            data,
            error: e
          }) => {

            setEsPadre(
              !e &&
              data === true
            )

            if (e) {
              setError(
                e.message
              )

            } else if (
              data === true
            ) {
              cargarDistritos()
            }
          }
        )

    } else if (
      tipo !==
      'herramienta_odoo_inventario'
    ) {
      cargar(tipo)
    }
  }

  function editar(
    f
  ) {
    setForm({
      sku:
        f.sku ||
        '',

      material:
        f.material ||
        '',

      herramienta:
        f.herramienta ||
        '',

      costo:
        String(
          f.costo_unitario ??
          f.costo ??
          ''
        ),

      vida_util_meses:
        String(
          f.vida_util_meses ??
          12
        ),

      activo:
        f.activo !== false
    })
  }

  async function guardar(e) {
    e.preventDefault()

    setError('')
    setAviso('')
    setCargando(true)

    try {
      if (
        !form.sku.trim()
      ) {
        throw new Error(
          'Captura SKU'
        )
      }

      if (
        form.costo === '' ||
        !Number.isFinite(
          Number(
            form.costo
          )
        ) ||
        Number(
          form.costo
        ) < 0
      ) {
        throw new Error(
          'Captura un costo válido'
        )
      }

      const {
        error: x
      } =
        await supabase.rpc(
          'qiora_config_guardar_costo',
          {
            p_catalogo:
              seccion,

            p_registro:
              form
          }
        )

      if (x) throw x

      setAviso(
        'Registro guardado en Supabase'
      )

      setForm(
        nuevo()
      )

      await cargar(
        seccion
      )

    } catch (x) {

      setError(
        x.message ||
        'No se pudo guardar'
      )

    } finally {

      setCargando(false)
    }
  }

  useEffect(() => {
    if (
      seccion ===
      'herramienta_odoo_inventario'
    ) {
      cargar(
        seccion
      )
    }
  }, [
    seccion,
    cargar
  ])

  const disponibles =
    filas.filter(
      f =>
        Object.values(f)
          .some(
            v =>
              normal(v)
                .includes(
                  normal(
                    busqueda
                  )
                )
          )
    )

  const editable =
    seccion ===
      'costos_sap' ||
    seccion ===
      'costos_odoo'

  const usuariosFiltrados =
    usuarios.filter(
      u => {

        const coincideActivo =
          filtroActivos ===
            'TODOS' ||
          (
            u.activo
              ? 'SI'
              : 'NO'
          ) ===
            filtroActivos

        const coincideTexto =
          normal([
            u.usuario_almacen,
            u.nombre,
            u.telegram_chat_id
          ].join(' '))
            .includes(
              normal(
                busqueda
              )
            )

        return (
          coincideActivo &&
          coincideTexto
        )
      }
    )

  /*
    ==========================
    RENDER
    ==========================
  */

  return (
    <main style={sCss.base}>

      <div style={sCss.marco}>

        <div style={sCss.cabeceraFija}>

          <button
            style={sCss.regresar}
            onClick={() =>
              seccion
                ? setSeccion('')
                : router.push('/')
            }
          >
            ← {
              seccion
                ? 'Regresar a Configuración'
                : 'Regresar a Acceso Almacén'
            }
          </button>

          <header style={sCss.hero}>

            <h1
              style={{
                margin: 0
              }}
            >
              {
                seccion
                  ? nombres[
                      seccion
                    ]
                  : '⚙ Configuración'
              }
            </h1>

            <p
              style={{
                margin:
                  '6px 0 0'
              }}
            >
              {
                seccion
                  ? 'Administración de catálogos en Supabase'
                  : 'Configuración del módulo Acceso Almacén'
              }
            </p>

          </header>

        </div>

        {error && (

          <p
            role="alert"
            style={sCss.error}
          >
            {error}
          </p>

        )}

        {aviso && (

          <p
            role="status"
            style={sCss.exito}
          >
            {aviso}
          </p>

        )}

        {validando ? (

          <p>
            Validando permisos...
          </p>

        ) : !permitido ? (

          <p>
            No tienes permisos administrativos para Configuración.
          </p>

        ) : !seccion ? (

          /*
            MENÚ PRINCIPAL
          */

          <section style={sCss.panel}>

            <h3>
              Menú configuración
            </h3>

            <div style={sCss.menu}>

              {MENU.map(
                (
                  [
                    label,
                    tipo
                  ]
                ) => (

                  <button
                    key={label}

                    style={{
                      ...sCss.opcion,

                      opacity:
                        tipo
                          ? 1
                          : .68
                    }}

                    onClick={() =>
                      tipo
                        ? abrir(
                            tipo
                          )
                        : setAviso(
                            'El módulo «' +
                            label +
                            '» todavía no está implementado en esta versión web.'
                          )
                    }

                    type="button"
                  >
                    {label}
                  </button>

                )
              )}

            </div>

          </section>

        ) : seccion ===
          'horarios' ? (

          /*
            ==========================
            HORARIOS
            ==========================
          */

          <section style={sCss.panel}>

            <h2>
              Configurar días y horarios
            </h2>

            <p style={sCss.nota}>
              Estos horarios habilitan el módulo Solicitud de Material. Deben coincidir Día + Fecha + Hora y estar activos.
            </p>

            <div style={sCss.cuadriculaUsuarios}>

              <label>
                Día

                <select
                  style={{
                    ...sCss.input,
                    width:
                      '100%',
                    boxSizing:
                      'border-box'
                  }}

                  value={
                    horarioForm.dia
                  }

                  onChange={
                    e =>
                      setHorarioForm(
                        f => ({
                          ...f,
                          dia:
                            e.target
                              .value
                        })
                      )
                  }
                >

                  {DIAS.map(
                    dia => (

                      <option
                        key={dia}
                        value={dia}
                      >
                        {dia}
                      </option>

                    )
                  )}

                </select>

              </label>

              <label>
                Fecha

                <input
                  type="date"

                  style={{
                    ...sCss.input,
                    width:
                      '100%',
                    boxSizing:
                      'border-box'
                  }}

                  value={
                    horarioForm
                      .fecha
                  }

                  onChange={
                    e =>
                      setHorarioForm(
                        f => ({
                          ...f,

                          fecha:
                            e.target
                              .value
                        })
                      )
                  }
                />

              </label>

              <label>
                Hora inicio

                <input
                  type="time"

                  style={{
                    ...sCss.input,
                    width:
                      '100%',
                    boxSizing:
                      'border-box'
                  }}

                  value={
                    horarioForm
                      .hora_inicio
                  }

                  onChange={
                    e =>
                      setHorarioForm(
                        f => ({
                          ...f,

                          hora_inicio:
                            e.target
                              .value
                        })
                      )
                  }
                />

              </label>

              <label>
                Hora fin

                <input
                  type="time"

                  style={{
                    ...sCss.input,
                    width:
                      '100%',
                    boxSizing:
                      'border-box'
                  }}

                  value={
                    horarioForm
                      .hora_fin
                  }

                  onChange={
                    e =>
                      setHorarioForm(
                        f => ({
                          ...f,

                          hora_fin:
                            e.target
                              .value
                        })
                      )
                  }
                />

              </label>

              <label>
                Activo

                <select
                  style={{
                    ...sCss.input,
                    width:
                      '100%',
                    boxSizing:
                      'border-box'
                  }}

                  value={
                    horarioForm
                      .activo
                      ? 'SI'
                      : 'NO'
                  }

                  onChange={
                    e =>
                      setHorarioForm(
                        f => ({
                          ...f,

                          activo:
                            e.target
                              .value ===
                            'SI'
                        })
                      )
                  }
                >
                  <option value="SI">
                    SI
                  </option>

                  <option value="NO">
                    NO
                  </option>

                </select>

              </label>

            </div>

            <div style={sCss.herramientas}>

              <button
                type="button"
                style={sCss.boton}

                disabled={
                  guardandoHorario
                }

                onClick={
                  guardarHorario
                }
              >
                {
                  guardandoHorario
                    ? 'Guardando...'
                    : horarioEditando
                      ? 'Guardar cambios'
                      : 'Guardar horario'
                }
              </button>

              <button
                type="button"
                style={sCss.regresar}

                onClick={
                  limpiarHorario
                }
              >
                Limpiar / Nuevo
              </button>

              <button
                type="button"
                style={sCss.boton}

                disabled={
                  cargando
                }

                onClick={
                  cargarHorarios
                }
              >
                Actualizar lista
              </button>

            </div>

            <div
              style={{
                overflowX:
                  'auto',
                overflowY:
                  'auto',
                maxHeight:
                  '60vh',
                border:
                  '1px solid #427466',
                borderRadius:
                  9
              }}
            >

              <table
                style={{
                  ...sCss.tabla,
                  minWidth:
                    760
                }}
              >

                <thead>

                  <tr>

                    <th style={sCss.th}>
                      Día
                    </th>

                    <th style={sCss.th}>
                      Fecha
                    </th>

                    <th style={sCss.th}>
                      Hora inicio
                    </th>

                    <th style={sCss.th}>
                      Hora fin
                    </th>

                    <th style={sCss.th}>
                      Activo
                    </th>

                    <th style={sCss.th}>
                      Acción
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {horarios.length ? (

                    horarios.map(
                      (
                        h,
                        i
                      ) => (

                        <tr
                          key={
                            `${h.dia}-${h.fecha}-${i}`
                          }
                        >

                          <td style={sCss.td}>
                            {
                              h.dia
                            }
                          </td>

                          <td style={sCss.td}>
                            {
                              String(
                                h.fecha ||
                                ''
                              ).slice(
                                0,
                                10
                              ) ||
                              '-'
                            }
                          </td>

                          <td style={sCss.td}>
                            {
                              String(
                                h.hora_inicio ||
                                ''
                              ).slice(
                                0,
                                5
                              )
                            }
                          </td>

                          <td style={sCss.td}>
                            {
                              String(
                                h.hora_fin ||
                                ''
                              ).slice(
                                0,
                                5
                              )
                            }
                          </td>

                          <td style={sCss.td}>

                            <strong
                              style={{
                                color:
                                  horarioActivo(
                                    h.activo
                                  )
                                    ? '#087e55'
                                    : '#b91c1c'
                              }}
                            >
                              {
                                horarioActivo(
                                  h.activo
                                )
                                  ? 'SI'
                                  : 'NO'
                              }
                            </strong>

                          </td>

                          <td style={sCss.td}>

                            <button
                              type="button"
                              style={sCss.boton}

                              onClick={() =>
                                editarHorario(
                                  h
                                )
                              }
                            >
                              Editar
                            </button>

                          </td>

                        </tr>

                      )
                    )

                  ) : (

                    <tr>

                      <td
                        style={sCss.td}
                        colSpan={6}
                      >
                        No hay horarios configurados.
                      </td>

                    </tr>

                  )}

                </tbody>

              </table>

            </div>

          </section>

        ) : seccion ===
          'distritos' ? (

          /*
            ==========================
            DISTRITOS
            ==========================
          */

          <section style={sCss.panel}>

            <h2>
              Administrar Distritos
            </h2>

            {!esPadre ? (

              <p style={sCss.error}>
                Acceso restringido. Solo ADMIN_PADRE puede consultar y configurar distritos.
              </p>

            ) : (
              <>

                <div style={sCss.cuadriculaUsuarios}>

                  <label>
                    Centro

                    <input
                      style={{
                        ...sCss.input,
                        width:
                          '100%',
                        boxSizing:
                          'border-box'
                      }}

                      value={
                        distritoForm
                          .centro
                      }

                      disabled={
                        !!distritoEditando
                      }

                      onChange={
                        e =>
                          setDistritoForm(
                            f => ({
                              ...f,
                              centro:
                                e.target
                                  .value
                                  .toUpperCase()
                            })
                          )
                      }
                    />

                  </label>

                  <label>
                    Nombre o Región

                    <input
                      style={{
                        ...sCss.input,
                        width:
                          '100%',
                        boxSizing:
                          'border-box'
                      }}

                      value={
                        distritoForm
                          .nombre_region
                      }

                      onChange={
                        e =>
                          setDistritoForm(
                            f => ({
                              ...f,

                              nombre_region:
                                e.target
                                  .value
                            })
                          )
                      }
                    />

                  </label>

                  <label>
                    TOKEN_EXCEL

                    <input
                      type="password"

                      style={{
                        ...sCss.input,
                        width:
                          '100%',
                        boxSizing:
                          'border-box'
                      }}

                      value={
                        distritoForm
                          .token_excel
                      }

                      onChange={
                        e =>
                          setDistritoForm(
                            f => ({
                              ...f,

                              token_excel:
                                e.target
                                  .value
                            })
                          )
                      }
                    />

                  </label>

                  <label>
                    TOKEN_TRASPASOS

                    <input
                      type="password"

                      style={{
                        ...sCss.input,
                        width:
                          '100%',
                        boxSizing:
                          'border-box'
                      }}

                      value={
                        distritoForm
                          .token_traspasos
                      }

                      onChange={
                        e =>
                          setDistritoForm(
                            f => ({
                              ...f,

                              token_traspasos:
                                e.target
                                  .value
                            })
                          )
                      }
                    />

                  </label>

                  <label>
                    CHAT_TRASPASOS

                    <input
                      style={{
                        ...sCss.input,
                        width:
                          '100%',
                        boxSizing:
                          'border-box'
                      }}

                      value={
                        distritoForm
                          .chat_traspasos
                      }

                      onChange={
                        e =>
                          setDistritoForm(
                            f => ({
                              ...f,

                              chat_traspasos:
                                e.target
                                  .value
                            })
                          )
                      }
                    />

                  </label>

                </div>

                <div style={sCss.herramientas}>

                  <button
                    style={sCss.boton}

                    onClick={
                      guardarDistrito
                    }
                  >
                    Guardar distrito
                  </button>

                  <button
                    style={sCss.boton}

                    onClick={
                      cargarDistritos
                    }
                  >
                    Actualizar lista
                  </button>

                </div>

                <div
                  style={{
                    overflowX:
                      'auto'
                  }}
                >

                  <table style={sCss.tabla}>

                    <thead>

                      <tr>

                        {[
                          'Centro',
                          'Nombre',
                          'Activo',
                          'Administrador',
                          'Acción'
                        ].map(
                          h => (

                            <th
                              key={h}
                              style={sCss.th}
                            >
                              {h}
                            </th>

                          )
                        )}

                      </tr>

                    </thead>

                    <tbody>

                      {distritos.map(
                        d => (

                          <tr
                            key={
                              d.centro
                            }
                          >

                            <td style={sCss.td}>
                              {d.centro}
                            </td>

                            <td style={sCss.td}>
                              {d.nombre_region}
                            </td>

                            <td style={sCss.td}>
                              {
                                d.activo
                                  ? 'SI'
                                  : 'NO'
                              }
                            </td>

                            <td style={sCss.td}>
                              {
                                d.tiene_admin
                                  ? 'CREADO'
                                  : 'SIN CREAR'
                              }
                            </td>

                            <td style={sCss.td}>

                              <button
                                style={sCss.boton}

                                onClick={() =>
                                  editarDistrito(
                                    d
                                  )
                                }
                              >
                                Editar
                              </button>

                              {!d.tiene_admin && (

                                <button
                                  style={sCss.boton}

                                  onClick={() =>
                                    crearAdminExistente(
                                      d.centro
                                    )
                                  }
                                >
                                  Crear administrador
                                </button>

                              )}

                            </td>

                          </tr>

                        )
                      )}

                    </tbody>

                  </table>

                </div>

              </>
            )}

          </section>

        ) : seccion ===
          'usuarios' ? (

          /*
            ==========================
            USUARIOS
            ==========================
          */

          <section style={sCss.panel}>

            <h2>
              Gestión de Usuarios
            </h2>

            <div style={sCss.herramientas}>

              <button
                type="button"
                style={sCss.boton}

                onClick={() => {
                  setCreandoUsuario(
                    x => !x
                  )

                  setUsuarioEditando(
                    null
                  )
                }}
              >
                {
                  creandoUsuario
                    ? 'Cancelar creación'
                    : '＋ Crear usuario'
                }
              </button>

            </div>

            {creandoUsuario && (

              <div
                style={{
                  ...sCss.panel,
                  marginBottom:
                    18
                }}
              >

                <h3>
                  Crear nuevo usuario
                </h3>

                <div style={sCss.cuadriculaUsuarios}>

                  {[
                    [
                      'usuario_almacen',
                      'Usuario / Almacén'
                    ],
                    [
                      'clave',
                      'Clave'
                    ],
                    [
                      'nombre',
                      'Nombre'
                    ],
                    [
                      'telefono',
                      'Teléfono'
                    ],
                    [
                      'puesto',
                      'Puesto'
                    ],
                    [
                      'numero_empleado',
                      'Número de empleado'
                    ],
                    [
                      'correo',
                      'Correo'
                    ],
                    [
                      'coordinador',
                      'Coordinador'
                    ],
                    [
                      'usuario_ffm',
                      'Usuario FFM'
                    ],
                    [
                      'telegram_chat_id',
                      'Telegram Chat ID'
                    ]
                  ].map(
                    (
                      [
                        campo,
                        label
                      ]
                    ) => (

                      <label
                        key={campo}
                      >

                        {label}

                        <input
                          style={{
                            ...sCss.input,
                            width:
                              '100%',
                            boxSizing:
                              'border-box'
                          }}

                          type={
                            campo ===
                            'clave'
                              ? 'password'
                              : 'text'
                          }

                          value={
                            nuevoUsuario[
                              campo
                            ] ||
                            ''
                          }

                          onChange={
                            e =>
                              cambiarNuevo(
                                campo,
                                e.target
                                  .value
                              )
                          }
                        />

                      </label>

                    )
                  )}

                  <label>
                    Fecha nacimiento

                    <input
                      type="date"

                      style={{
                        ...sCss.input,
                        width:
                          '100%'
                      }}

                      value={
                        nuevoUsuario
                          .fecha_nacimiento
                      }

                      onChange={
                        e =>
                          cambiarNuevo(
                            'fecha_nacimiento',
                            e.target
                              .value
                          )
                      }
                    />

                  </label>

                </div>

                <h3>
                  Permisos
                </h3>

                <div style={sCss.permisosGrid}>

                  {permisosDisponibles.map(
                    p => (

                      <label
                        key={
                          p.campo
                        }
                        style={
                          sCss.permiso
                        }
                      >

                        <input
                          type="checkbox"

                          checked={
                            nuevoUsuario
                              .permisos?.[
                                p.campo
                              ] ===
                            true
                          }

                          onChange={
                            e =>
                              setNuevoUsuario(
                                u => ({
                                  ...u,

                                  permisos: {
                                    ...u.permisos,

                                    [p.campo]:
                                      e.target
                                        .checked
                                  }
                                })
                              )
                          }
                        />

                        {p.nombre}

                      </label>

                    )
                  )}

                </div>

                <button
                  style={sCss.boton}

                  onClick={
                    crearCuentaUsuario
                  }
                >
                  Guardar nuevo usuario
                </button>

              </div>

            )}

            {usuarioEditando && (

              <div
                style={{
                  ...sCss.panel,
                  marginBottom:
                    18
                }}
              >

                <h3>
                  Editar: {
                    usuarioEditando
                      .usuario_almacen
                  }
                </h3>

                <div style={sCss.cuadriculaUsuarios}>

                  {[
                    [
                      'nombre',
                      'Nombre'
                    ],
                    [
                      'telefono',
                      'Teléfono'
                    ],
                    [
                      'puesto',
                      'Puesto'
                    ],
                    [
                      'numero_empleado',
                      'Número empleado'
                    ],
                    [
                      'correo',
                      'Correo'
                    ],
                    [
                      'coordinador',
                      'Coordinador'
                    ],
                    [
                      'usuario_ffm',
                      'Usuario FFM'
                    ],
                    [
                      'telegram_chat_id',
                      'Telegram Chat ID'
                    ]
                  ].map(
                    (
                      [
                        campo,
                        label
                      ]
                    ) => (

                      <label
                        key={campo}
                      >
                        {label}

                        <input
                          style={{
                            ...sCss.input,
                            width:
                              '100%'
                          }}

                          value={
                            usuarioEditando[
                              campo
                            ] ||
                            ''
                          }

                          onChange={
                            e =>
                              editarCampoUsuario(
                                campo,
                                e.target
                                  .value
                              )
                          }
                        />

                      </label>

                    )
                  )}

                </div>

                <p style={sCss.nota}>
                  Permisos seleccionados: {permisosActivos}
                </p>

                <div style={sCss.permisosGrid}>

                  {permisosDisponibles.map(
                    p => (

                      <label
                        key={
                          p.campo
                        }
                        style={
                          sCss.permiso
                        }
                      >

                        <input
                          type="checkbox"

                          checked={
                            usuarioEditando
                              .permisos?.[
                                p.campo
                              ] ===
                            true
                          }

                          onChange={
                            e =>
                              setUsuarioEditando(
                                u => ({
                                  ...u,

                                  permisos: {
                                    ...u.permisos,

                                    [p.campo]:
                                      e.target
                                        .checked
                                  }
                                })
                              )
                          }
                        />

                        {p.nombre}

                      </label>

                    )
                  )}

                </div>

                <button
                  style={sCss.boton}

                  onClick={
                    guardarFichaUsuario
                  }
                >
                  Guardar usuario y permisos
                </button>

              </div>

            )}

            <div style={sCss.herramientas}>

              <input
                style={sCss.input}

                placeholder="Buscar almacén, técnico o Telegram"

                value={
                  busqueda
                }

                onChange={
                  e =>
                    setBusqueda(
                      e.target
                        .value
                    )
                }
              />

              <select
                style={sCss.input}

                value={
                  filtroActivos
                }

                onChange={
                  e =>
                    setFiltroActivos(
                      e.target
                        .value
                    )
                }
              >
                <option value="TODOS">
                  Todos
                </option>

                <option value="SI">
                  Activos
                </option>

                <option value="NO">
                  No activos
                </option>

              </select>

            </div>

            <p style={sCss.nota}>
              {usuariosFiltrados.length} usuario(s).
            </p>

            <div
              style={{
                overflowX:
                  'auto',
                maxHeight:
                  '65vh',
                overflowY:
                  'auto'
              }}
            >

              <table
                style={{
                  ...sCss.tabla,
                  minWidth:
                    700
                }}
              >

                <thead>

                  <tr>

                    <th style={sCss.th}>
                      Almacén
                    </th>

                    <th style={sCss.th}>
                      Técnico
                    </th>

                    <th style={sCss.th}>
                      Activo
                    </th>

                    <th style={sCss.th}>
                      Acción
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {usuariosFiltrados.map(
                    u => (

                      <tr key={u.id}>

                        <td style={sCss.td}>
                          {u.usuario_almacen}
                        </td>

                        <td style={sCss.td}>
                          {u.nombre}
                        </td>

                        <td style={sCss.td}>
                          {
                            u.activo
                              ? 'SI'
                              : 'NO ACTIVO'
                          }
                        </td>

                        <td style={sCss.td}>

                          <button
                            style={sCss.boton}

                            onClick={() =>
                              editarUsuario(
                                u
                              )
                            }
                          >
                            Editar
                          </button>

                          <button
                            style={{
                              ...sCss.boton,

                              background:
                                u.activo
                                  ? '#b91c1c'
                                  : '#176b4d'
                            }}

                            onClick={() =>
                              cambiarEstadoUsuario(
                                u
                              )
                            }
                          >
                            {
                              u.activo
                                ? 'Desactivar'
                                : 'Activar'
                            }
                          </button>

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          </section>

        ) : (

          /*
            CATÁLOGOS GENERALES
          */

          <section style={sCss.panel}>

            <div style={sCss.herramientas}>

              <input
                style={sCss.input}

                value={
                  busqueda
                }

                onChange={
                  e => {
                    setBusqueda(
                      e.target
                        .value
                    )

                    setPagina(1)
                  }
                }

                placeholder="Buscar"
              />

              <button
                style={sCss.boton}

                onClick={() =>
                  cargar(
                    seccion
                  )
                }
              >
                Actualizar
              </button>

            </div>

            {editable && (

              <form
                onSubmit={
                  guardar
                }

                style={
                  sCss.formulario
                }
              >

                <label>
                  SKU

                  <input
                    style={sCss.input}

                    value={
                      form.sku
                    }

                    onChange={
                      e =>
                        setForm({
                          ...form,

                          sku:
                            e.target
                              .value
                        })
                    }
                  />
                </label>

                <label>
                  Costo

                  <input
                    style={sCss.input}

                    value={
                      form.costo
                    }

                    onChange={
                      e =>
                        setForm({
                          ...form,

                          costo:
                            e.target
                              .value
                        })
                    }
                  />
                </label>

                <button
                  style={sCss.boton}
                  type="submit"
                >
                  Guardar
                </button>

              </form>

            )}

            <div
              style={{
                overflowX:
                  'auto'
              }}
            >

              <table style={sCss.tabla}>

                <thead>

                  <tr>

                    {(CAMPOS[
                      seccion
                    ] || [])
                      .map(
                        (
                          [
                            key,
                            nombre
                          ]
                        ) => (

                          <th
                            key={key}
                            style={sCss.th}
                          >
                            {nombre}
                          </th>

                        )
                      )}

                  </tr>

                </thead>

                <tbody>

                  {disponibles.map(
                    (
                      f,
                      i
                    ) => (

                      <tr key={i}>

                        {(CAMPOS[
                          seccion
                        ] || [])
                          .map(
                            (
                              [
                                key
                              ]
                            ) => (

                              <td
                                key={key}
                                style={sCss.td}
                              >
                                {
                                  String(
                                    f[
                                      key
                                    ] ??
                                    ''
                                  )
                                }
                              </td>

                            )
                          )}

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          </section>

        )}

      </div>

    </main>
  )
}

const sCss = {
  base: {
    minHeight:
      '100vh',
    background:
      '#062d23',
    color:
      '#fff',
    padding:
      16,
    fontFamily:
      'Arial,sans-serif'
  },

  marco: {
    maxWidth:
      1400,
    margin:
      'auto',
    border:
      '1px solid #487d6c',
    borderRadius:
      16,
    padding:
      20,
    background:
      '#06271f'
  },

  cabeceraFija: {
    position:
      'sticky',
    top:
      0,
    zIndex:
      30,
    background:
      '#06271f',
    paddingTop:
      8,
    paddingBottom:
      8,
    borderBottom:
      '1px solid #487d6c',
    marginBottom:
      18
  },

  regresar: {
    border:
      0,
    borderRadius:
      30,
    padding:
      '10px 15px',
    background:
      '#118366',
    color:
      '#fff',
    fontWeight:
      700,
    cursor:
      'pointer',
    marginBottom:
      12
  },

  hero: {
    background:
      'linear-gradient(120deg,#10533f,#18a67b)',
    padding:
      25,
    textAlign:
      'center',
    borderRadius:
      14,
    marginBottom:
      18
  },

  panel: {
    border:
      '1px solid #406f62',
    padding:
      16,
    borderRadius:
      14,
    background:
      '#0b3028'
  },

  menu: {
    display:
      'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(230px,1fr))',
    gap:
      12
  },

  opcion: {
    background:
      '#159b76',
    color:
      '#fff',
    minHeight:
      70,
    border:
      0,
    borderRadius:
      11,
    fontWeight:
      700,
    cursor:
      'pointer'
  },

  herramientas: {
    display:
      'flex',
    gap:
      8,
    marginBottom:
      12,
    flexWrap:
      'wrap'
  },

  formulario: {
    display:
      'flex',
    flexWrap:
      'wrap',
    alignItems:
      'end',
    gap:
      12,
    margin:
      '18px 0'
  },

  input: {
    display:
      'block',
    padding:
      10,
    minWidth:
      160,
    background:
      '#fff',
    color:
      '#142f24',
    borderRadius:
      7,
    border:
      '1px solid #bdd4ca',
    marginTop:
      5
  },

  boton: {
    padding:
      '10px 14px',
    background:
      '#118e6d',
    color:
      '#fff',
    border:
      0,
    borderRadius:
      8,
    fontWeight:
      700,
    cursor:
      'pointer',
    margin:
      3
  },

  tabla: {
    borderCollapse:
      'collapse',
    width:
      '100%',
    minWidth:
      700,
    background:
      '#f8fdfa',
    color:
      '#143126',
    marginBottom:
      12
  },

  th: {
    padding:
      9,
    background:
      '#0d7659',
    color:
      '#fff',
    border:
      '1px solid #add0c1',
    position:
      'sticky',
    top:
      0,
    zIndex:
      2,
    whiteSpace:
      'nowrap'
  },

  td: {
    padding:
      9,
    border:
      '1px solid #c8ded4'
  },

  nota: {
    color:
      '#cce5dc',
    fontSize:
      13
  },

  error: {
    background:
      '#ffe1e1',
    color:
      '#822',
    padding:
      12,
    borderRadius:
      8
  },

  exito: {
    background:
      '#dbffdf',
    color:
      '#174a25',
    padding:
      12,
    borderRadius:
      8
  },

  cuadriculaUsuarios: {
    display:
      'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(240px,1fr))',
    gap:
      14,
    marginBottom:
      22
  },

  permisosGrid: {
    display:
      'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(240px,1fr))',
    gap:
      9,
    marginBottom:
      20
  },

  permiso: {
    display:
      'flex',
    alignItems:
      'center',
    gap:
      8,
    background:
      '#07291f',
    border:
      '1px solid #42685b',
    padding:
      9,
    borderRadius:
      7
  }
}
