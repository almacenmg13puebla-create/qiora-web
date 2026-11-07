'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const s = x =>
  String(x ?? '').trim()

const n = x =>
  Number(x || 0)

const uuid = () =>
  crypto.randomUUID()

const TOKEN_KEY =
  'qiora_material_borrador_token_v2'

const DIAS = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO'
]

/*
  Obtiene día y hora de Ciudad de México
  sin depender de la zona horaria del dispositivo.
*/
function fechaHoraMexico() {
  const partes =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'America/Mexico_City',

        weekday:
          'short',

        hour:
          '2-digit',

        minute:
          '2-digit',

        hour12:
          false
      }
    ).formatToParts(
      new Date()
    )

  const get =
    tipo =>
      partes.find(
        p =>
          p.type === tipo
      )?.value || ''

  const weekday =
    get('weekday')
      .toLowerCase()

  const mapaDias = {
    sun: 'DOMINGO',
    mon: 'LUNES',
    tue: 'MARTES',
    wed: 'MIERCOLES',
    thu: 'JUEVES',
    fri: 'VIERNES',
    sat: 'SABADO'
  }

  const hora =
    get('hour')
      .padStart(2, '0')

  const minuto =
    get('minute')
      .padStart(2, '0')

  return {
    dia:
      mapaDias[
        weekday
      ] || '',

    hora:
      `${hora}:${minuto}`
  }
}

/*
  Determina si una hora está dentro
  del horario configurado.

  También admite horarios que crucen
  medianoche, por ejemplo:
  22:00 - 02:00
*/
function dentroHorario(
  actual,
  inicio,
  fin
) {
  if (
    !actual ||
    !inicio ||
    !fin
  ) {
    return false
  }

  const a =
    actual.slice(0, 5)

  const i =
    inicio.slice(0, 5)

  const f =
    fin.slice(0, 5)

  if (i <= f) {
    return (
      a >= i &&
      a <= f
    )
  }

  return (
    a >= i ||
    a <= f
  )
}

export default function SolicitudMaterial() {
  const router =
    useRouter()

  const [
    ctx,
    C
  ] = useState(null)

  const [
    token,
    T
  ] = useState('')

  const [
    almacen,
    A
  ] = useState('')

  const [
    ref,
    R
  ] = useState('')

  const [
    cantidad,
    Q
  ] = useState(1)

  const [
    items,
    I
  ] = useState([])

  const [
    busy,
    B
  ] = useState(false)

  const [
    err,
    E
  ] = useState('')

  const [
    ok,
    O
  ] = useState('')

  /*
    ESTADO DEL HORARIO
  */
  const [
    validandoHorario,
    setValidandoHorario
  ] = useState(true)

  const [
    horarioHabilitado,
    setHorarioHabilitado
  ] = useState(false)

  const [
    horarioInfo,
    setHorarioInfo
  ] = useState(null)

  const [
    mensajeHorario,
    setMensajeHorario
  ] = useState('')

  const rpc =
    async (
      name,
      args
    ) => {

      const {
        data,
        error
      } =
        await supabase.rpc(
          name,
          args
        )

      if (error) {
        throw error
      }

      return data
    }

  /*
    VALIDAR CONFIG_HORARIOS
  */
  const validarHorario =
    useCallback(
      async () => {

        setValidandoHorario(
          true
        )

        try {
          const {
            dia,
            hora
          } =
            fechaHoraMexico()

          if (!dia) {
            throw new Error(
              'No fue posible determinar el día actual.'
            )
          }

          const {
            data,
            error
          } =
            await supabase
              .from(
                'config_horarios'
              )
              .select(
                `
                  dia,
                  hora_inicio,
                  hora_fin,
                  activo,
                  fecha
                `
              )
              .ilike(
                'dia',
                dia
              )
              .limit(1)
              .maybeSingle()

          if (error) {
            throw error
          }

          /*
            Si no existe registro,
            el módulo queda cerrado.
          */
          if (!data) {
            setHorarioHabilitado(
              false
            )

            setHorarioInfo(
              null
            )

            setMensajeHorario(
              `Solicitud de Material cerrada. No existe horario configurado para ${dia}.`
            )

            return false
          }

          const activo =
            data.activo === true ||
            s(
              data.activo
            )
              .toUpperCase() ===
              'SI'

          const inicio =
            s(
              data.hora_inicio
            ).slice(
              0,
              5
            )

          const fin =
            s(
              data.hora_fin
            ).slice(
              0,
              5
            )

          const abierto =
            activo &&
            dentroHorario(
              hora,
              inicio,
              fin
            )

          setHorarioInfo({
            dia,
            hora,
            inicio,
            fin,
            activo
          })

          setHorarioHabilitado(
            abierto
          )

          if (!activo) {
            setMensajeHorario(
              `Solicitud de Material deshabilitada para ${dia}.`
            )

          } else if (
            !abierto
          ) {
            setMensajeHorario(
              `Fuera de horario. ${dia}: ${inicio} a ${fin}. Hora actual: ${hora}.`
            )

          } else {
            setMensajeHorario(
              `Horario habilitado: ${dia} de ${inicio} a ${fin}.`
            )
          }

          return abierto

        } catch (e) {

          console.error(
            'ERROR CONFIG_HORARIOS:',
            e
          )

          /*
            Si falla la consulta,
            bloqueamos por seguridad.
          */
          setHorarioHabilitado(
            false
          )

          setHorarioInfo(
            null
          )

          setMensajeHorario(
            'No fue posible validar CONFIG_HORARIOS. Solicitud de Material permanece cerrada.'
          )

          return false

        } finally {

          setValidandoHorario(
            false
          )
        }
      },
      []
    )

  /*
    VOLVER A VALIDAR CADA MINUTO.
    Así el módulo se cierra cuando termina
    el horario aunque la página siga abierta.
  */
  useEffect(() => {
    validarHorario()

    const intervalo =
      setInterval(
        () => {
          validarHorario()
        },
        60000
      )

    return () =>
      clearInterval(
        intervalo
      )

  }, [
    validarHorario
  ])

  /*
    CARGAR CONTEXTO Y RESERVAS.
  */
  const cargar =
    useCallback(
      async (
        t,
        a = ''
      ) => {

        const c =
          await rpc(
            'qiora_material_contexto',
            {
              p_almacen:
                a || null
            }
          )

        const r =
          await rpc(
            'qiora_material_mis_reservas',
            {
              p_token: t
            }
          )

        C(c)

        A(
          c.almacen
        )

        I(
          Array.isArray(r)
            ? r
            : []
        )
      },
      []
    )

  async function cambiarAlmacen(
    v
  ) {
    A(
      s(v)
        .replace(
          /\D/g,
          ''
        )
        .slice(
          0,
          4
        )
    )

    R('')
    E('')
    O('')
  }

  async function consultarAlmacen() {
    if (
      !horarioHabilitado
    ) {
      E(
        mensajeHorario ||
        'Solicitud de Material está fuera de horario.'
      )
      return
    }

    if (
      items.length
    ) {
      E(
        'Hay materiales reservados para ' +
        ctx?.almacen +
        '. Elimínalos o envía la solicitud antes de cambiar de almacén; no se eliminarán automáticamente.'
      )

      A(
        ctx?.almacen ||
        ''
      )

      return
    }

    if (
      !/^\d{1,4}$/
        .test(
          almacen
        )
    ) {
      E(
        'Introduce un almacén de 1 a 4 dígitos.'
      )

      return
    }

    B(true)
    E('')

    try {
      await cargar(
        token,
        almacen
      )

    } catch (e) {

      E(
        e.message
      )

      A(
        ctx?.almacen ||
        ''
      )

    } finally {

      B(false)
    }
  }

  /*
    RECUPERAR BORRADOR.
  */
  useEffect(() => {
    let vivo = true

    ;(async () => {
      try {
        const {
          data: auth,
          error:
            authError
        } =
          await supabase.auth
            .getUser()

        if (
          authError ||
          !auth?.user
        ) {
          throw Error(
            'Inicia sesión para consultar las reservas.'
          )
        }

        /*
          El borrador vigente se recupera
          desde Supabase.
        */
        const {
          data: d,
          error: de
        } =
          await supabase.rpc(
            'qiora_material_borrador_actual'
          )

        if (de) {
          throw de
        }

        const key =
          TOKEN_KEY +
          ':' +
          auth.user.id

        const t =
          d?.token ||
          localStorage
            .getItem(
              key
            ) ||
          uuid()

        localStorage
          .setItem(
            key,
            t
          )

        if (!vivo) {
          return
        }

        T(t)

        await cargar(
          t,
          d?.almacen ||
          ''
        )

      } catch (e) {

        if (vivo) {
          E(
            e.message
          )
        }
      }
    })()

    return () => {
      vivo = false
    }

  }, [
    cargar
  ])

  /*
    CATÁLOGO
  */
  const catalogo =
    ctx?.catalogo ||
    []

  const grupos =
    [
      ...new Set(
        catalogo
          .map(
            m =>
              s(
                m.grupo
              )
          )
          .filter(
            g =>
              g &&
              ![
                'CONSUMIBLE',
                'CONSUMIBLES',
                'MATERIAL',
                'MATERIALES'
              ].includes(
                g.toUpperCase()
              )
          )
      )
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.localeCompare(
            b,
            'es'
          )
      )

  const esGrupo =
    ref.startsWith(
      'GRUPO:'
    )

  const nombreGrupo =
    esGrupo
      ? ref.slice(6)
      : ''

  const miembros =
    esGrupo
      ? catalogo.filter(
          m =>
            s(
              m.grupo
            )
              .toUpperCase() ===
            nombreGrupo
              .toUpperCase()
        )
      : []

  const seleccion =
    esGrupo
      ? null
      : catalogo.find(
          m =>
            s(
              m.sku
            ) ===
            ref
        )

  const grupo =
    esGrupo
      ? nombreGrupo
      : (
          [
            'CONSUMIBLE',
            'CONSUMIBLES',
            'MATERIAL',
            'MATERIALES'
          ].includes(
            s(
              seleccion
                ?.grupo
            )
              .toUpperCase()
          )
            ? 'SKU:' +
              ref
            : s(
                seleccion
                  ?.grupo ||
                ''
              )
        )

  // Todos los valores del catálogo y de captura se manejan en unidades físicas.
  // FACTOR_EMPAQUE es informativo; nunca multiplica la cantidad capturada.
  const maximo =
    esGrupo
      ? Math.max(
          0,
          ...miembros.map(m => n(m.maximo))
        )
      : n(seleccion?.maximo)

  const factorEmpaque =
    esGrupo ? 1 : Math.max(1, n(seleccion?.factor_empaque) || 1)

  const minimoReposicion =
    esGrupo
      ? Math.max(0, ...miembros.map(m => n(m.minimo_reposicion)))
      : n(seleccion?.minimo_reposicion)

  const cantidadReposicion =
    esGrupo
      ? Math.max(1, ...miembros.map(m => n(m.cantidad_reposicion)))
      : Math.max(1, n(seleccion?.cantidad_reposicion) || 1)

  const skus =
    esGrupo
      ? new Set(
          miembros
            .map(
              m =>
                s(
                  m.sku
                )
            )
        )
      : new Set(
          ref
            ? [
                ref
              ]
            : []
        )

  const stockTec =
    (
      ctx
        ?.stock_tecnicos ||
      []
    )
      .filter(
        x =>
          skus.has(
            s(
              x.sku
            )
          )
      )
      .reduce(
        (
          a,
          x
        ) =>
          a +
          n(
            x.disponible
          ),
        0
      )

  const reservas =
    ctx?.reservas ||
    []

  const pendiente =
    reservas
      .filter(
        x =>
          s(
            x.tecnico_almacen
          )
            .padStart(
              4,
              '0'
            ) ===
          s(
            almacen
          )
            .padStart(
              4,
              '0'
            ) &&
          (
            grupo
              ? s(
                  x.grupo
                )
                  .toUpperCase() ===
                grupo
                  .toUpperCase()
              : skus.has(
                  s(
                    x.sku
                  )
                )
          )
      )
      .reduce(
        (
          a,
          x
        ) =>
          a +
          n(
            x.cantidad
          ),
        0
      )

  const origenCentral =
    s(ctx?.origen_central) ||
    ('ME' + s(ctx?.distrito).slice(-2))

  const lotesCentral =
    (
      ctx
        ?.stock_almacen ||
      []
    )
      .filter(
        x =>
          s(
            x.origen
          )
            .toUpperCase() ===
          origenCentral
            .toUpperCase() &&

          skus.has(
            s(
              x.sku
            )
          ) &&

          (
            !esGrupo ||
            s(
              x.lote
            )
              .toUpperCase()
              .startsWith(
                'TPE'
              )
          )
      )

  const stockCentral =
    lotesCentral
      .reduce(
        (
          a,
          x
        ) =>
          a +
          n(
            x.disponible
          ),
        0
      )

  const pendienteCentral =
    reservas
      .filter(
        x =>
          s(
            x.origen
          )
            .toUpperCase() ===
          origenCentral
            .toUpperCase() &&

          skus.has(
            s(
              x.sku
            )
          ) &&

          (
            !esGrupo ||
            s(
              x.lote
            )
              .toUpperCase()
              .startsWith(
                'TPE'
              )
          )
      )
      .reduce(
        (
          a,
          x
        ) =>
          a +
          n(
            x.cantidad
          ),
        0
      )

  const disponibleCentral =
    Math.max(
      0,
      stockCentral -
      pendienteCentral
    )

  const restoMaximo =
    maximo > 0
      ? Math.max(
          0,
          maximo -
          stockTec -
          pendiente
        )
      : null

  const opcionesSku =
    catalogo.filter(
      m =>
        !s(
          m.grupo
        ) ||
        [
          'CONSUMIBLE',
          'CONSUMIBLES',
          'MATERIAL',
          'MATERIALES'
        ].includes(
          s(
            m.grupo
          )
            .toUpperCase()
        )
    )

  /*
    AGREGAR MATERIAL
  */
  async function agregar() {
    /*
      VOLVEMOS A VALIDAR JUSTO ANTES
      DE RESERVAR.
    */
    const abierto =
      await validarHorario()

    if (!abierto) {
      E(
        mensajeHorario ||
        'Solicitud de Material está fuera de horario.'
      )

      return
    }

    B(true)
    E('')
    O('')

    try {
      if (
        almacen !==
        ctx?.almacen
      ) {
        throw Error(
          'Primero consulta y confirma el almacén del técnico.'
        )
      }

      if (!ref) {
        throw Error(
          'Selecciona material o grupo.'
        )
      }

      if (
        !Number.isInteger(
          Number(
            cantidad
          )
        ) ||
        Number(
          cantidad
        ) < 1
      ) {
        throw Error(
          'Cantidad inválida.'
        )
      }

      if (
        restoMaximo !==
          null &&
        Number(
          cantidad
        ) >
          restoMaximo
      ) {
        throw Error(
          'MÁXIMO ALCANZADO: el técnico tiene ' +
          stockTec +
          ' y ' +
          pendiente +
          ' reservado; máximo ' +
          maximo +
          '.'
        )
      }

      if (
        Number(
          cantidad
        ) >
        disponibleCentral
      ) {
        throw Error(
          'SIN EXISTENCIAS: todas las unidades del almacén central están agotadas o reservadas.'
        )
      }

      await rpc(
        'qiora_material_reservar',
        {
          p_token:
            token,

          p_almacen:
            almacen,

          p_referencia:
            ref,

          p_cantidad:
            Number(
              cantidad
            )
        }
      )

      await cargar(
        token,
        almacen
      )

      O(
        'Material validado y reservado.'
      )

    } catch (e) {

      E(
        e.message
      )

    } finally {

      B(false)
    }
  }

  /*
    ELIMINAR RESERVA.

    Se permite incluso fuera de horario para
    no dejar materiales bloqueados.
  */
  async function eliminar(
    id
  ) {
    B(true)
    E('')

    try {
      await rpc(
        'qiora_material_eliminar',
        {
          p_token:
            token,

          p_reserva_id:
            id
        }
      )

      await cargar(
        token,
        almacen
      )

      O(
        'Reserva liberada.'
      )

    } catch (e) {

      E(
        e.message
      )

    } finally {

      B(false)
    }
  }

  /*
    ENVIAR SOLICITUD
  */
  async function enviar() {
    /*
      Validamos otra vez para impedir que alguien
      deje abierta la página y envíe después
      de que cierre el horario.
    */
    const abierto =
      await validarHorario()

    if (!abierto) {
      E(
        mensajeHorario ||
        'Solicitud de Material está fuera de horario.'
      )

      return
    }

    B(true)
    E('')

    try {
      const d =
        await rpc(
          'qiora_material_enviar',
          {
            p_token:
              token
          }
        )

      O(
        'SOLICITUD ENVIADA: ' +
        d.folio +
        ' · PENDIENTE'
      )

      const t =
        uuid()

      const {
        data: auth
      } =
        await supabase.auth
          .getUser()

      if (
        auth?.user
      ) {
        localStorage
          .setItem(
            TOKEN_KEY +
            ':' +
            auth.user.id,
            t
          )
      }

      T(t)
      I([])

      await cargar(
        t,
        almacen
      )

    } catch (e) {

      E(
        e.message
      )

    } finally {

      B(false)
    }
  }

  return (
    <main className="qmat">

      <div className="wrap">

        <button
          onClick={() =>
            router.push('/')
          }
        >
          ← Regresar al menú
        </button>

        <header>

          <h1>
            Solicitud de Material
          </h1>

          <p>
            La fecha de entrega se asigna automáticamente según el día de solicitud.
          </p>

        </header>

        {/* ESTADO DEL HORARIO */}

        <section
          className={
            horarioHabilitado
              ? 'horario abierto'
              : 'horario cerrado'
          }
        >

          <strong>
            {validandoHorario
              ? '⏳ Validando horario...'
              : horarioHabilitado
                ? '✅ SOLICITUD DE MATERIAL HABILITADA'
                : '🔒 SOLICITUD DE MATERIAL CERRADA'}
          </strong>

          {!validandoHorario && (
            <p>
              {mensajeHorario}
            </p>
          )}

          {horarioInfo && (
            <small>
              {horarioInfo.dia}
              {' · '}
              {horarioInfo.inicio}
              {' a '}
              {horarioInfo.fin}
              {' · Hora actual '}
              {horarioInfo.hora}
            </small>
          )}

        </section>

        <section className="panel">

          <div className="fields">

            <label>
              Almacén (1 a 4 dígitos)

              <input
                inputMode="numeric"
                maxLength={4}

                value={
                  almacen
                }

                disabled={
                  !horarioHabilitado
                }

                readOnly={
                  !ctx
                    ?.puede_cambiar_almacen
                }

                onChange={
                  e =>
                    cambiarAlmacen(
                      e.target
                        .value
                    )
                }

                onBlur={() => {
                  if (
                    horarioHabilitado &&
                    ctx
                      ?.puede_cambiar_almacen &&
                    almacen &&
                    almacen !==
                      ctx?.almacen
                  ) {
                    consultarAlmacen()
                  }
                }}
              />

            </label>

            <label>
              Técnico

              <input
                value={
                  almacen ===
                  ctx?.almacen
                    ? ctx?.tecnico ||
                      'Nombre no registrado'
                    : 'Consultando almacén...'
                }
                readOnly
              />

            </label>

          </div>

        </section>

        <section className="panel">

          <label>
            Material

            <select
              value={ref}

              disabled={
                !horarioHabilitado
              }

              onChange={e => {
                const valor = e.target.value
                R(valor)
                const material = catalogo.find(m => s(m.sku) === valor)
                const sugerida = Math.max(1, n(material?.cantidad_reposicion) || 1)
                const limiteTecnico = restoMaximo === null ? Infinity : restoMaximo
                const limiteDisponible = Math.min(limiteTecnico, disponibleCentral)
                Q(String(Math.max(1, Math.min(sugerida, limiteDisponible))))
              }}
            >
              <option value="">
                Seleccione material o grupo
              </option>

              {opcionesSku.map(
                x => (
                  <option
                    key={
                      x.sku
                    }
                    value={
                      x.sku
                    }
                  >
                    {x.sku}{' '}
                    {x.material}{' '}
                    MÁXIMO{' '}
                    {
                      x.maximo ??
                      '—'
                    }
                  </option>
                )
              )}

              {grupos.map(
                g => (
                  <option
                    key={
                      'g' +
                      g
                    }
                    value={
                      'GRUPO:' +
                      g
                    }
                  >
                    {g}{' '}
                    MÁXIMO{' '}
                    {
                      Math.max(
                        0,
                        ...catalogo
                          .filter(
                            m =>
                              s(
                                m.grupo
                              ) ===
                              g
                          )
                          .map(
                            m =>
                              n(
                                m.maximo
                              )
                          )
                      )
                    }
                  </option>
                )
              )}

            </select>

          </label>

          <label>
            Cantidad física (piezas, metros o unidades)

            <input
              type="number"
              min="1"
              max={restoMaximo === null ? disponibleCentral : Math.min(restoMaximo, disponibleCentral)}
              step="1"

              disabled={
                !horarioHabilitado
              }

              value={
                cantidad
              }

              onChange={
                e =>
                  Q(
                    e.target
                      .value
                  )
              }
            />

          </label>

          <div className="chips">

            <span>Máximo del técnico: {maximo > 0 ? maximo : 'Sin límite configurado'}</span>
            <span>Stock técnico: {stockTec}</span>
            <span>Reservado: {pendiente}</span>
            <span>Disponible para solicitar: {restoMaximo === null ? disponibleCentral : Math.min(restoMaximo, disponibleCentral)}</span>
            <span>Empaque: {factorEmpaque} unidades por empaque (referencia)</span>
            <span>Reposición sugerida: {cantidadReposicion} unidades</span>
            {minimoReposicion > 0 && <span>Umbral de reposición: {minimoReposicion} unidades</span>}

          </div>

          <p className="muted">
            La cantidad se captura directamente en unidades físicas. Puedes solicitar una caja completa o una cantidad menor (por ejemplo, 285 o 223 metros). El factor de empaque no multiplica esta cantidad.
          </p>

          <button
            className="orange"

            onClick={
              agregar
            }

            disabled={
              validandoHorario ||
              !horarioHabilitado ||
              busy ||
              almacen !==
                ctx?.almacen ||
              !token ||
              !ref ||
              disponibleCentral <=
                0 ||
              (
                restoMaximo !==
                  null &&
                restoMaximo <=
                  0
              )
            }
          >
            {
              !horarioHabilitado
                ? '🔒 Fuera de horario'
                : '+ Agregar Material'
            }
          </button>

        </section>

        <section className="panel">

          <h3>
            Materiales agregados
          </h3>

          <div className="scroll">

            <table>

              <thead>

                <tr>

                  <th>
                    SKU
                  </th>

                  <th>
                    Material
                  </th>

                  <th>
                    Cantidad
                  </th>

                  <th>
                    Lote
                  </th>

                  <th>
                    Acción
                  </th>

                </tr>

              </thead>

              <tbody>

                {items.length
                  ? items.map(
                      x => (

                        <tr
                          key={
                            x.id
                          }
                        >

                          <td>
                            {
                              x.sku
                            }
                          </td>

                          <td>
                            {
                              x.material
                            }
                          </td>

                          <td>
                            {
                              x.cantidad
                            }
                          </td>

                          <td>
                            {
                              x.lote ||
                              '—'
                            }
                          </td>

                          <td>

                            <button
                              className="red"

                              disabled={
                                busy
                              }

                              onClick={() =>
                                eliminar(
                                  x.id
                                )
                              }
                            >
                              Eliminar
                            </button>

                          </td>

                        </tr>

                      )
                    )
                  : (

                    <tr>

                      <td
                        colSpan="5"
                      >
                        Sin materiales agregados.
                      </td>

                    </tr>

                  )}

              </tbody>

            </table>

          </div>

          <button
            className="green"

            disabled={
              validandoHorario ||
              !horarioHabilitado ||
              busy ||
              !items.length
            }

            onClick={
              enviar
            }
          >
            {
              !horarioHabilitado
                ? '🔒 Solicitudes cerradas'
                : 'Enviar Solicitud'
            }
          </button>

        </section>

        {
          ctx
            ?.puede_cambiar_almacen &&
          items.length >
            0 && (

            <p className="nota">
              Para cambiar de almacén, primero elimina o envía los materiales reservados para {ctx.almacen}. Recargar no cancela esas reservas.
            </p>

          )
        }

        {err && (

          <div
            className="error"
            role="alert"
          >

            <b>
              NO SE PUEDE AGREGAR / ENVIAR
            </b>

            <p>
              {err}
            </p>

            <button
              onClick={() =>
                E('')
              }
            >
              Aceptar
            </button>

          </div>

        )}

        {ok && (

          <div className="success">
            {ok}
          </div>

        )}

      </div>

      <style jsx>{styles}</style>

    </main>
  )
}

const styles = `
.qmat{
  min-height:100vh;
  background:linear-gradient(145deg,#052b22,#021811);
  color:white;
  padding:16px;
  font:14px Arial;
}

.wrap{
  max-width:920px;
  margin:auto;
}

.qmat header,
.qmat .panel,
.qmat .horario{
  border:1px solid #3b766b;
  border-radius:14px;
  padding:19px;
  margin:15px 0;
  background:#072d26;
}

.qmat header{
  text-align:center;
  background:linear-gradient(115deg,#07543e,#17a27a);
}

.qmat h1{
  margin:0;
  font-size:27px;
}

.qmat h3{
  margin-top:0;
}

.qmat p{
  font-size:13px;
}

.horario{
  text-align:center;
}

.horario.abierto{
  background:#0a4938;
  border-color:#1bb47e;
}

.horario.cerrado{
  background:#572323;
  border-color:#b94a4a;
}

.horario strong{
  display:block;
  font-size:16px;
}

.horario small{
  display:block;
  margin-top:7px;
  opacity:.9;
}

.fields{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:13px;
}

.qmat label{
  display:block;
  font-weight:bold;
  margin-bottom:12px;
}

.qmat input,
.qmat select{
  width:100%;
  display:block;
  padding:12px;
  margin-top:5px;
  border-radius:9px;
  border:1px solid #bfd4cf;
  background:#f7fafb;
  color:#132a25;
  box-sizing:border-box;
}

.qmat input:disabled,
.qmat select:disabled{
  background:#d8dfdd;
  color:#6d7774;
  cursor:not-allowed;
}

.qmat button{
  cursor:pointer;
  border:0;
  padding:11px 17px;
  border-radius:9px;
  background:#10886e;
  color:white;
  font-weight:bold;
  margin:5px;
}

.qmat button:disabled{
  opacity:.5;
  cursor:not-allowed;
}

.qmat .orange{
  background:#f17811;
  width:100%;
  margin:9px 0;
}

.qmat .green{
  background:#12a65d;
  width:100%;
  margin:17px 0 0;
}

.qmat .red{
  background:#dc3333;
}

.chips{
  display:flex;
  gap:7px;
  flex-wrap:wrap;
}

.chips span{
  background:#0b856b;
  padding:8px;
  border-radius:8px;
}

.scroll{
  overflow-x:auto;
}

.qmat table{
  width:100%;
  border-collapse:collapse;
  background:#f8faf9;
  color:#123329;
}

.qmat th{
  background:#087456;
  color:#fff;
}

.qmat td,
.qmat th{
  padding:10px;
  border:1px solid #cedbd6;
}

.qmat .error{
  position:fixed;
  left:50%;
  top:36%;
  transform:translate(-50%,-25%);
  background:white;
  color:#be2525;
  padding:28px;
  border-radius:16px;
  text-align:center;
  max-width:460px;
  width:92%;
  box-shadow:0 0 0 100vw #0009;
  z-index:10;
}

.qmat .error button{
  background:#d33;
}

.qmat .nota{
  padding:10px;
  background:#18483d;
  color:#e5fff6;
  border-radius:9px;
}

.qmat .success{
  padding:12px;
  background:#bbf9d4;
  color:#07542b;
  border-radius:9px;
}

@media(max-width:640px){
  .fields{
    grid-template-columns:1fr;
  }
}
`
