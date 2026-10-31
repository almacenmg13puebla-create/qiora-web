'use client'

import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const MENU = [
  ['Accesos especiales', null, 'admin_padre'],
  ['Actualizar máximos', 'catalogos', 'materiales'],
  ['Materiales', 'materiales', 'materiales'],
  ['Distritos', 'distritos', 'admin_padre'],
  ['Horarios', 'horarios', 'configuracion'],
  ['Costos SAP', 'costos_sap', 'configuracion'],
  ['Costos ODOO', 'costos_odoo', 'odoo'],
  ['Herramienta ODOO', 'herramienta_odoo_inventario', 'odoo'],
  ['Exportar fechas', null, 'admin_padre'],
  ['Usuarios', 'usuarios', 'usuarios'],
  ['RECUS TP', null, 'admin_padre'],
  ['Actualizar macro Excel', null, 'admin_padre'],
  ['Grupos de materiales', 'grupos_materiales', 'materiales']
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
  distrito: '',
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

  const [perfilActual, setPerfilActual] = useState(null)

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

  // Permisos que ADMIN_PADRE asigna al administrador de cada distrito.
  const [centroPermisosSeleccionado, setCentroPermisosSeleccionado] = useState('')
  const [permisosAdminDistrito, setPermisosAdminDistrito] = useState({})
  const [guardandoPermisosDistrito, setGuardandoPermisosDistrito] = useState(false)

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
    VALIDAR ADMIN
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

        const [adminResult, perfilResult] = await Promise.all([
          supabase.rpc('qiora_config_es_admin'),
          supabase.rpc('qiora_mi_perfil')
        ])

        if (adminResult.error) throw adminResult.error
        if (perfilResult.error) throw perfilResult.error

        const perfil = perfilResult.data
        const puesto = String(perfil?.puesto || '').trim().toUpperCase()
        const esPadreActual = puesto === 'ADMIN_PADRE'
        const autorizado = esPadreActual || perfil?.administrar_permisos === true

        if (vivo) {
          setPerfilActual(perfil || null)
          setEsPadre(esPadreActual)
          setPermitido(adminResult.data === true && autorizado)
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

        if (!tipo) {
          return
        }

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

          if (e) {
            throw e
          }

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
    ==============================
    HORARIOS - CONFIG_HORARIOS
    ==============================
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

      if (e) {
        throw e
      }

      setHorarios(
        Array.isArray(data)
          ? data
          : []
      )

    } catch (e) {

      console.error(
        'ERROR CONFIG_HORARIOS:',
        e
      )

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
    setAviso('')
  }

  function editarHorario(
    horario
  ) {
    setHorarioEditando({
      dia:
        String(
          horario.dia ||
          ''
        ),

      fecha:
        String(
          horario.fecha ||
          ''
        ).slice(
          0,
          10
        )
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
    if (
      guardandoHorario
    ) {
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
        SI ESTAMOS EDITANDO
      */
      if (
        horarioEditando
      ) {
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
              horarioEditando
                .dia
            )
            .eq(
              'fecha',
              horarioEditando
                .fecha
            )

        if (
          updateError
        ) {
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

        if (
          buscarError
        ) {
          throw buscarError
        }

        if (
          existente
        ) {
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

          if (
            updateError
          ) {
            throw updateError
          }

          setAviso(
            'El horario ya existía y fue actualizado.'
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

          if (
            insertError
          ) {
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

      console.error(
        'ERROR GUARDANDO CONFIG_HORARIOS:',
        e
      )

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
    ==============================
    DISTRITOS
    ==============================
  */

  async function guardarDistrito() {
    if (guardandoDistrito) return

    setGuardandoDistrito(true)
    setError('')
    setAviso('')

    try {
      const centro = String(distritoForm.centro || '').trim().toUpperCase()
      const nombreRegion = String(distritoForm.nombre_region || '').trim()
      const tokenExcel = String(distritoForm.token_excel || '').trim()
      const tokenTraspasos = String(distritoForm.token_traspasos || '').trim()
      const chatTraspasos = String(distritoForm.chat_traspasos || '').trim()

      if (!centro) throw new Error('Captura el código del centro, por ejemplo MG22.')
      if (!nombreRegion) throw new Error('Captura el nombre o región del distrito.')

      if (!distritoEditando) {
        if (!distritoForm.activo) {
          throw new Error('El distrito debe crearse activo. Puedes desactivarlo después.')
        }

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Sesión caducada. Inicia sesión nuevamente.')

        const response = await fetch('/api/distritos/crear', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            centro,
            nombre_region: nombreRegion,
            activo: true,
            token_excel: tokenExcel || null,
          }),
        })
        const resultado = await response.json().catch(() => ({}))
        if (!response.ok || !resultado.ok) {
          throw new Error(resultado.error || 'No se pudo crear el distrito.')
        }

        // El endpoint crea el distrito y su ADMIN_CENTRO con clave temporal.
        setAviso(
          `Distrito ${centro} y usuario ${resultado.usuario} creados. ` +
          `Clave temporal: ${resultado.clave_temporal}. Guarda esta clave ahora.`
        )

        try {
          await guardarTelegramDistrito(centro, tokenTraspasos, chatTraspasos)
        } catch (telegramError) {
          throw new Error(
            `El distrito y su administrador ya se crearon. ` +
            `Usuario: ${resultado.usuario}. Clave temporal: ${resultado.clave_temporal}. ` +
            `No se guardó la configuración de traspasos: ${telegramError.message}`
          )
        }
      } else {
        const { data, error: e } = await supabase.rpc('qiora_distritos_guardar', {
          p_centro: centro,
          p_nombre_region: nombreRegion,
          p_token_excel: tokenExcel || null,
          p_activo: Boolean(distritoForm.activo),
          p_centro_original: distritoEditando,
        })
        if (e) throw e
        if (data !== true) throw new Error('Supabase no confirmó el guardado.')

        await guardarTelegramDistrito(centro, tokenTraspasos, chatTraspasos)
        setAviso(`Distrito ${centro} actualizado correctamente.`)
      }

      setDistritoEditando('')
      setDistritoForm({
        centro: '',
        nombre_region: '',
        token_excel: '',
        token_traspasos: '',
        chat_traspasos: '',
        activo: true,
      })
      await cargarDistritos()
    } catch (e) {
      setError(e?.message || 'No se pudo guardar el distrito.')
    } finally {
      setGuardandoDistrito(false)
    }
  }

  async function crearAdminDistrito(centro) {
    if (!window.confirm(`¿Crear el administrador ADMIN_${centro}?`)) return
    setError('')
    setAviso('')
    setGuardandoDistrito(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sesión caducada. Inicia sesión nuevamente.')

      const response = await fetch('/api/distritos/crear-administrador', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ centro }),
      })
      const resultado = await response.json().catch(() => ({}))
      if (!response.ok || !resultado.ok) {
        throw new Error(resultado.error || 'No se pudo crear el administrador.')
      }

      setAviso(
        `Administrador creado: ${resultado.usuario}. Centro: ${resultado.centro}. ` +
        `Clave temporal: ${resultado.clave_temporal}. Guarda esta clave ahora.`
      )
      await cargarDistritos()
    } catch (e) {
      setError(e?.message || 'No se pudo crear el administrador del distrito.')
    } finally {
      setGuardandoDistrito(false)
    }
  }

  function nuevoDistrito() {
    setDistritoEditando('')
    setDistritoForm({
      centro: '',
      nombre_region: '',
      token_excel: '',
      token_traspasos: '',
      chat_traspasos: '',
      activo: true,
    })
    setError('')
    setAviso('')
  }

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

      if (e) {
        throw e
      }

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

  function editarDistrito(d) {
    setDistritoEditando(d.centro)
    setDistritoForm({
      centro: d.centro,
      nombre_region: d.nombre_region || '',
      token_excel: '',
      token_traspasos: '',
      chat_traspasos: configTelegram[d.centro]?.chat_traspasos || '',
      activo: d.activo === true,
    })
    setError('')
    setAviso('')
  }

  /*
    ==============================
    USUARIOS
    ==============================
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

      if (e) {
        throw e
      }

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
    if (
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
      if (esPadre && !String(nuevoUsuario.distrito || '').trim()) {
        throw new Error('Selecciona el distrito donde se creará el usuario.')
      }

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
        }
      } =
        await supabase.auth
          .getSession()

      if (
        !session
          ?.access_token
      ) {
        throw new Error(
          'Sesión expirada.'
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
        'Usuario creado correctamente.'
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
        ...(u.permisos ||
        {})
      }
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

      if (e) {
        throw e
      }

      if (
        data !== true
      ) {
        throw new Error(
          'No se confirmó el guardado.'
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

    try {
      const {
        error: e
      } =
        await supabase.rpc(
          'qiora_usuarios_administracion_guardar',
          {
            p_id:
              String(
                u.id
              ),

            p_datos: {
              activo:
                !u.activo
            }
          }
        )

      if (e) {
        throw e
      }

      await cargarUsuarios()

    } catch (e) {

      setError(
        e.message ||
        'No se pudo actualizar'
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

  function seleccionarCentroPermisos(centro) {
    const codigo = String(centro || '').trim().toUpperCase()
    setCentroPermisosSeleccionado(codigo)
    const admin = usuarios.find(u =>
      String(u.distrito || '').trim().toUpperCase() === codigo &&
      String(u.puesto || '').trim().toUpperCase() === `ADMIN_${codigo}`
    ) || usuarios.find(u =>
      String(u.distrito || '').trim().toUpperCase() === codigo &&
      String(u.usuario_almacen || '').trim().toUpperCase() === `ADMIN_${codigo}`
    )
    setPermisosAdminDistrito({ ...(admin?.permisos || {}) })
  }

  async function guardarPermisosAdminDistrito() {
    if (guardandoPermisosDistrito) return
    const codigo = centroPermisosSeleccionado
    const admin = usuarios.find(u =>
      String(u.distrito || '').trim().toUpperCase() === codigo &&
      (String(u.puesto || '').trim().toUpperCase() === `ADMIN_${codigo}` ||
       String(u.usuario_almacen || '').trim().toUpperCase() === `ADMIN_${codigo}`)
    )
    if (!admin) {
      setError(`No se encontró ADMIN_${codigo}. Crea primero el administrador del distrito.`)
      return
    }
    setGuardandoPermisosDistrito(true)
    setError('')
    setAviso('')
    try {
      const { data, error: rpcError } = await supabase.rpc('qiora_usuarios_administracion_guardar', {
        p_id: String(admin.id),
        p_datos: { permisos: permisosAdminDistrito }
      })
      if (rpcError) throw rpcError
      if (data !== true) throw new Error('Supabase no confirmó el guardado de permisos.')
      await cargarUsuarios()
      setAviso(`Permisos de ADMIN_${codigo} guardados correctamente.`)
    } catch (e) {
      setError(e?.message || 'No se pudieron guardar los permisos del administrador.')
    } finally {
      setGuardandoPermisosDistrito(false)
    }
  }

  /*
    PERMISOS DEL MENU DE CONFIGURACION
    Las opciones sin permiso explícito quedan reservadas a ADMIN_PADRE.
  */
  const puedeAbrirMenu = permiso => {
    if (esPadre) return true
    if (!perfilActual || !permiso || permiso === 'admin_padre') return false
    return perfilActual[permiso] === true
  }

  const menuVisible = MENU.filter(([, , permiso]) => puedeAbrirMenu(permiso))

  /*
    ABRIR SECCIONES
  */

  function abrir(
    tipo
  ) {
    const opcion = MENU.find(item => item[1] === tipo)
    if (opcion && !puedeAbrirMenu(opcion[2])) {
      setError('No tienes permiso para abrir esta sección.')
      return
    }

    if (
      tipo ===
      'catalogos'
    ) {
      router.push(
        '/inventarios/catalogos'
      )

      return
    }

    setSeccion(
      tipo
    )

    setBusqueda('')
    setPagina(1)
    setError('')
    setAviso('')

    if (
      tipo ===
      'horarios'
    ) {
      cargarHorarios()

    } else if (
      tipo ===
      'usuarios'
    ) {
      cargarUsuarios()
      supabase.rpc('qiora_distritos_es_padre').then(({ data, error: e }) => {
        const padre = !e && data === true
        setEsPadre(padre)
        if (padre) cargarDistritos()
      })

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

            if (
              !e &&
              data === true
            ) {
              cargarDistritos()
              cargarUsuarios()
            }
          }
        )

    } else if (
      tipo !==
      'herramienta_odoo_inventario'
    ) {
      cargar(
        tipo
      )
    }
  }

  const usuariosFiltrados =
    usuarios.filter(
      u => {

        const activo =
          filtroActivos ===
            'TODOS' ||
          (
            u.activo
              ? 'SI'
              : 'NO'
          ) ===
            filtroActivos

        const texto =
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
          activo &&
          texto
        )
      }
    )

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

  return (
    <main style={css.base}>

      <div style={css.marco}>

        <button
          style={css.regresar}

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

        <header style={css.hero}>

          <h1>
            {
              seccion
                ? nombres[
                    seccion
                  ]
                : '⚙ Configuración'
            }
          </h1>

          <p>
            Administración de catálogos en Supabase
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

        {validando ? (

          <p>
            Validando permisos...
          </p>

        ) : !permitido ? (

          <p>
            Sin permisos.
          </p>

        ) : !seccion ? (

          <section style={css.panel}>

            <h3>
              Menú configuración
            </h3>

            <div style={css.menu}>

              {menuVisible.length === 0 && (
                <p style={css.nota}>No tienes opciones de configuración delegadas.</p>
              )}

              {menuVisible.map(
                (
                  [
                    label,
                    tipo
                  ]
                ) => (

                  <button
                    key={label}

                    style={{
                      ...css.opcion,

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
                            `${label} todavía no está implementado.`
                          )
                    }
                  >
                    {label}
                  </button>

                )
              )}

            </div>

          </section>

        ) : seccion ===
          'horarios' ? (

          <section style={css.panel}>

            <h2>
              Configurar días y horarios
            </h2>

            <p style={css.nota}>
              Estos horarios controlan Solicitud de Material. Deben coincidir día, fecha y hora y estar activos.
            </p>

            <div style={css.grid}>

              <label>
                Día

                <select
                  style={css.input}

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
                  style={css.input}

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
                  style={css.input}

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
                  style={css.input}

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
                  style={css.input}

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

            <div style={css.botones}>

              <button
                style={css.boton}

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
                style={css.boton}

                onClick={
                  limpiarHorario
                }
              >
                Limpiar / Nuevo
              </button>

              <button
                style={css.boton}

                onClick={
                  cargarHorarios
                }
              >
                Actualizar lista
              </button>

            </div>

            <div style={css.scroll}>

              <table style={css.tabla}>

                <thead>

                  <tr>
                    <th style={css.th}>
                      Día
                    </th>

                    <th style={css.th}>
                      Fecha
                    </th>

                    <th style={css.th}>
                      Hora inicio
                    </th>

                    <th style={css.th}>
                      Hora fin
                    </th>

                    <th style={css.th}>
                      Activo
                    </th>

                    <th style={css.th}>
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

                          <td style={css.td}>
                            {h.dia}
                          </td>

                          <td style={css.td}>
                            {
                              String(
                                h.fecha ||
                                ''
                              ).slice(
                                0,
                                10
                              )
                            }
                          </td>

                          <td style={css.td}>
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

                          <td style={css.td}>
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

                          <td style={css.td}>
                            {
                              horarioActivo(
                                h.activo
                              )
                                ? 'SI'
                                : 'NO'
                            }
                          </td>

                          <td style={css.td}>

                            <button
                              style={css.boton}

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
                        style={css.td}
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

          <section style={css.panel}>
            <h2>Administrar Distritos</h2>
            <p style={css.nota}>
              Crea y actualiza distritos. Solo ADMIN_PADRE puede modificar este catálogo.
            </p>

            {!esPadre ? (
              <div style={css.error}>
                El usuario no está siendo reconocido por qiora_distritos_es_padre().
                Verifica la sesión y vuelve a entrar.
              </div>
            ) : (
              <>
                <div style={css.grid}>
                  <label>
                    Código del centro
                    <input
                      style={css.input}
                      value={distritoForm.centro}
                      disabled={Boolean(distritoEditando)}
                      placeholder="MG13"
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        centro: e.target.value.toUpperCase()
                      }))}
                    />
                  </label>

                  <label>
                    Nombre / región
                    <input
                      style={css.input}
                      value={distritoForm.nombre_region}
                      placeholder="Nombre de la región"
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        nombre_region: e.target.value
                      }))}
                    />
                  </label>

                  <label>
                    Token Excel (opcional)
                    <input
                      style={css.input}
                      value={distritoForm.token_excel}
                      placeholder={distritoEditando ? 'Dejar vacío para conservar el actual' : 'Token Excel'}
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        token_excel: e.target.value
                      }))}
                    />
                  </label>

                  <label>
                    TOKEN_TRASPASOS (opcional)
                    <input
                      style={css.input}
                      type="password"
                      value={distritoForm.token_traspasos}
                      placeholder="Dejar vacío para conservar el actual"
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        token_traspasos: e.target.value
                      }))}
                    />
                  </label>

                  <label>
                    CHAT_TRASPASOS (opcional)
                    <input
                      style={css.input}
                      value={distritoForm.chat_traspasos}
                      placeholder="ID del chat"
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        chat_traspasos: e.target.value
                      }))}
                    />
                  </label>

                  <label>
                    Estado
                    <select
                      style={css.input}
                      value={distritoForm.activo ? 'SI' : 'NO'}
                      onChange={e => setDistritoForm(f => ({
                        ...f,
                        activo: e.target.value === 'SI'
                      }))}
                    >
                      <option value="SI">Activo</option>
                      <option value="NO">Inactivo</option>
                    </select>
                  </label>
                </div>

                <div style={css.botones}>
                  <button
                    type="button"
                    style={css.boton}
                    disabled={guardandoDistrito}
                    onClick={guardarDistrito}
                  >
                    {guardandoDistrito ? 'Guardando...' : distritoEditando ? 'Guardar cambios' : 'Crear distrito'}
                  </button>
                  <button
                    type="button"
                    style={css.boton}
                    onClick={nuevoDistrito}
                  >
                    Nuevo / Limpiar
                  </button>
                  <button
                    type="button"
                    style={css.boton}
                    disabled={cargando}
                    onClick={cargarDistritos}
                  >
                    {cargando ? 'Actualizando...' : 'Actualizar lista'}
                  </button>
                </div>

                <div style={css.scroll}>
                  <table style={css.tabla}>
                    <thead>
                      <tr>
                        {['Centro', 'Nombre / Región', 'Activo', 'Token Excel', 'Administrador', 'Acción'].map(x => (
                          <th key={x} style={css.th}>{x}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {distritos.length ? distritos.map(d => (
                        <tr key={d.centro}>
                          <td style={css.td}>{d.centro}</td>
                          <td style={css.td}>{d.nombre_region}</td>
                          <td style={css.td}>{d.activo ? 'SI' : 'NO'}</td>
                          <td style={css.td}>{d.tiene_token ? 'Configurado' : 'No configurado'}</td>
                          <td style={css.td}>{d.tiene_admin ? 'SI' : 'NO'}</td>
                          <td style={css.td}>
                            <button
                              type="button"
                              style={css.boton}
                              onClick={() => editarDistrito(d)}
                            >
                              Editar
                            </button>
                            {d.tiene_admin && (
                              <button
                                type="button"
                                style={{ ...css.boton, background: '#0b765a' }}
                                onClick={() => seleccionarCentroPermisos(d.centro)}
                              >
                                Permisos ADMIN_{d.centro}
                              </button>
                            )}
                            {!d.tiene_admin && d.activo && (
                              <button
                                type="button"
                                style={css.boton}
                                disabled={guardandoDistrito}
                                onClick={() => crearAdminDistrito(d.centro)}
                              >
                                Crear ADMIN_{d.centro}
                              </button>
                            )}
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td style={css.td} colSpan={6}>
                            {cargando ? 'Cargando distritos...' : 'No hay distritos devueltos por Supabase.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <section style={{ ...css.subpanel, marginTop: 18 }}>
                  <h2>Permisos del administrador del centro</h2>
                  <p style={css.nota}>ADMIN_PADRE define qué módulos tendrá habilitados cada administrador de distrito. Estos permisos limitan lo que el ADMIN_MG puede asignar a sus propios usuarios.</p>
                  <div style={css.grid}>
                    <label>
                      Centro seleccionado
                      <select
                        style={css.input}
                        value={centroPermisosSeleccionado}
                        onChange={e => seleccionarCentroPermisos(e.target.value)}
                      >
                        <option value="">Selecciona un distrito</option>
                        {distritos.filter(d => d.activo).map(d => (
                          <option key={d.centro} value={d.centro}>{d.centro} — {d.nombre_region}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Administrador
                      <input
                        style={css.input}
                        readOnly
                        value={centroPermisosSeleccionado ? `ADMIN_${centroPermisosSeleccionado}` : ''}
                        placeholder="Se asigna al seleccionar el centro"
                      />
                    </label>
                  </div>

                  {centroPermisosSeleccionado && !usuarios.some(u =>
                    String(u.distrito || '').trim().toUpperCase() === centroPermisosSeleccionado &&
                    (String(u.puesto || '').trim().toUpperCase() === `ADMIN_${centroPermisosSeleccionado}` ||
                     String(u.usuario_almacen || '').trim().toUpperCase() === `ADMIN_${centroPermisosSeleccionado}`)
                  ) && (
                    <div style={css.error}>No se encontró el administrador de este distrito. Créalo primero desde la tabla de distritos.</div>
                  )}

                  <h3>Módulos y permisos</h3>
                  <div style={css.permisos}>
                    {permisosDisponibles.filter(p => !['administrar_distritos'].includes(p.campo)).map(p => (
                      <label key={p.campo} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <input
                          type="checkbox"
                          checked={permisosAdminDistrito?.[p.campo] === true}
                          disabled={!centroPermisosSeleccionado || !usuarios.some(u =>
                            String(u.distrito || '').trim().toUpperCase() === centroPermisosSeleccionado &&
                            (String(u.puesto || '').trim().toUpperCase() === `ADMIN_${centroPermisosSeleccionado}` ||
                             String(u.usuario_almacen || '').trim().toUpperCase() === `ADMIN_${centroPermisosSeleccionado}`)
                          )}
                          onChange={e => setPermisosAdminDistrito(prev => ({ ...prev, [p.campo]: e.target.checked }))}
                        />
                        {p.nombre}
                      </label>
                    ))}
                  </div>
                  <div style={css.botones}>
                    <button
                      type="button"
                      style={css.boton}
                      disabled={guardandoPermisosDistrito || !centroPermisosSeleccionado}
                      onClick={guardarPermisosAdminDistrito}
                    >
                      {guardandoPermisosDistrito ? 'Guardando...' : 'Guardar permisos'}
                    </button>
                    <button
                      type="button"
                      style={{ ...css.boton, background: '#315b50' }}
                      disabled={!centroPermisosSeleccionado}
                      onClick={() => seleccionarCentroPermisos(centroPermisosSeleccionado)}
                    >
                      Restablecer
                    </button>
                    {centroPermisosSeleccionado && <span style={{ alignSelf: 'center', color: '#bdebd9', fontSize: 13 }}>Permisos para ADMIN_{centroPermisosSeleccionado}</span>}
                  </div>
                </section>
              </>
            )}
          </section>

        ) : seccion ===
          'usuarios' ? (

          <section style={css.panel}>

            <h2>
              Gestión de Usuarios
            </h2>

            <button
              style={css.boton}

              onClick={() => {
                setCreandoUsuario(
                  x => !x
                )

                setUsuarioEditando(
                  null
                )
              }}
            >
              + Crear usuario
            </button>

            {creandoUsuario && (

              <div style={css.subpanel}>

                <h3>
                  Crear usuario
                </h3>

                <div style={css.grid}>

                  {esPadre && (
                    <label>
                      Distrito del usuario
                      <select
                        style={css.input}
                        value={nuevoUsuario.distrito || ''}
                        onChange={e => cambiarNuevo('distrito', e.target.value)}
                        required
                      >
                        <option value="">Selecciona un distrito</option>
                        {distritos.filter(d => d.activo).map(d => (
                          <option key={d.centro} value={d.centro}>
                            {d.centro} — {d.nombre_region}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {[
                    ['usuario_almacen', 'Usuario / Almacén'],
                    ['clave', 'Clave'],
                    ['nombre', 'Nombre'],
                    ['telefono', 'Teléfono'],
                    ['puesto', 'Puesto'],
                    ['numero_empleado', 'Número empleado'],
                    ['correo', 'Correo'],
                    ['coordinador', 'Coordinador'],
                    ['usuario_ffm', 'Usuario FFM'],
                    ['telegram_chat_id', 'Telegram Chat ID']
                  ].map(
                    ([campo, label]) => (

                      <label key={campo}>
                        {label}

                        <input
                          style={css.input}

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

                </div>

                <h3>Permisos de módulos</h3>
                <div style={css.permisos}>
                  {permisosDisponibles.map(p => (
                    <label key={p.campo}>
                      <input
                        type="checkbox"
                        checked={nuevoUsuario.permisos?.[p.campo] === true}
                        onChange={e => setNuevoUsuario(u => ({
                          ...u,
                          permisos: {
                            ...(u.permisos || {}),
                            [p.campo]: e.target.checked,
                          },
                        }))}
                      />
                      {' '}{p.nombre}
                    </label>
                  ))}
                </div>

                <button
                  style={css.boton}
                  onClick={crearCuentaUsuario}
                >
                  Guardar usuario
                </button>

              </div>

            )}

            {usuarioEditando && (

              <div style={css.subpanel}>

                <h3>
                  Editar {
                    usuarioEditando
                      .usuario_almacen
                  }
                </h3>

                <div style={css.grid}>

                  {[
                    ['nombre', 'Nombre'],
                    ['telefono', 'Teléfono'],
                    ['puesto', 'Puesto'],
                    ['numero_empleado', 'Número empleado'],
                    ['correo', 'Correo'],
                    ['coordinador', 'Coordinador'],
                    ['usuario_ffm', 'Usuario FFM'],
                    ['telegram_chat_id', 'Telegram Chat ID']
                  ].map(
                    ([campo, label]) => (

                      <label key={campo}>
                        {label}

                        <input
                          style={css.input}

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

                <h3>
                  Permisos
                </h3>

                <div style={css.permisos}>

                  {permisosDisponibles.map(
                    p => (

                      <label
                        key={
                          p.campo
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
                  style={css.boton}
                  onClick={
                    guardarFichaUsuario
                  }
                >
                  Guardar cambios
                </button>

              </div>

            )}

            <div style={css.botones}>

              <input
                style={css.input}

                placeholder="Buscar técnico"

                value={
                  busqueda
                }

                onChange={
                  e =>
                    setBusqueda(
                      e.target.value
                    )
                }
              />

              <select
                style={css.input}

                value={
                  filtroActivos
                }

                onChange={
                  e =>
                    setFiltroActivos(
                      e.target.value
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

            <div style={css.scroll}>

              <table style={css.tabla}>

                <thead>

                  <tr>
                    <th style={css.th}>
                      Almacén
                    </th>

                    <th style={css.th}>
                      Técnico
                    </th>

                    <th style={css.th}>
                      Activo
                    </th>

                    <th style={css.th}>
                      Acción
                    </th>
                  </tr>

                </thead>

                <tbody>

                  {usuariosFiltrados.map(
                    u => (

                      <tr key={u.id}>

                        <td style={css.td}>
                          {
                            u.usuario_almacen
                          }
                        </td>

                        <td style={css.td}>
                          {
                            u.nombre
                          }
                        </td>

                        <td style={css.td}>
                          {
                            u.activo
                              ? 'SI'
                              : 'NO ACTIVO'
                          }
                        </td>

                        <td style={css.td}>

                          <button
                            style={css.boton}
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
                              ...css.boton,

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

          <section style={css.panel}>

            <input
              style={css.input}
              value={busqueda}

              onChange={
                e =>
                  setBusqueda(
                    e.target.value
                  )
              }

              placeholder="Buscar"
            />

            <button
              style={css.boton}

              onClick={() =>
                cargar(
                  seccion
                )
              }
            >
              Actualizar
            </button>

            <div style={css.scroll}>

              <table style={css.tabla}>

                <thead>

                  <tr>

                    {(CAMPOS[
                      seccion
                    ] || [])
                      .map(
                        ([key, label]) => (

                          <th
                            key={key}
                            style={css.th}
                          >
                            {label}
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
                            ([key]) => (

                              <td
                                key={key}
                                style={css.td}
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

const css = {
  base: {
    minHeight: '100vh',
    background: '#062d23',
    color: '#fff',
    padding: 16,
    fontFamily: 'Arial,sans-serif'
  },

  marco: {
    maxWidth: 1400,
    margin: 'auto',
    border: '1px solid #487d6c',
    borderRadius: 16,
    padding: 20,
    background: '#06271f'
  },

  hero: {
    background:
      'linear-gradient(120deg,#10533f,#18a67b)',
    padding: 25,
    textAlign: 'center',
    borderRadius: 14,
    marginBottom: 18
  },

  panel: {
    border: '1px solid #406f62',
    padding: 16,
    borderRadius: 14,
    background: '#0b3028',
    marginBottom: 15
  },

  subpanel: {
    border: '1px solid #406f62',
    padding: 16,
    borderRadius: 12,
    background: '#082a23',
    margin: '15px 0'
  },

  menu: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(210px,1fr))',
    gap: 12
  },

  opcion: {
    background: '#159b76',
    color: '#fff',
    minHeight: 70,
    border: 0,
    borderRadius: 11,
    fontWeight: 700,
    cursor: 'pointer'
  },

  regresar: {
    border: 0,
    borderRadius: 30,
    padding: '10px 15px',
    background: '#118366',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 12
  },

  grid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(190px,1fr))',
    gap: 12,
    marginBottom: 18
  },

  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: 10,
    background: '#fff',
    color: '#142f24',
    borderRadius: 7,
    border: '1px solid #bdd4ca',
    marginTop: 5
  },

  botones: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    margin: '15px 0'
  },

  boton: {
    padding: '10px 14px',
    background: '#118e6d',
    color: '#fff',
    border: 0,
    borderRadius: 8,
    fontWeight: 700,
    cursor: 'pointer',
    margin: 3
  },

  scroll: {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: '60vh'
  },

  tabla: {
    borderCollapse: 'collapse',
    width: '100%',
    minWidth: 700,
    background: '#f8fdfa',
    color: '#143126'
  },

  th: {
    padding: 9,
    background: '#0d7659',
    color: '#fff',
    border: '1px solid #add0c1'
  },

  td: {
    padding: 9,
    border: '1px solid #c8ded4'
  },

  permisos: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(220px,1fr))',
    gap: 10,
    marginBottom: 15
  },

  nota: {
    color: '#cce5dc',
    fontSize: 13
  },

  error: {
    background: '#ffe1e1',
    color: '#822',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12
  },

  exito: {
    background: '#dbffdf',
    color: '#174a25',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12
  }
}
