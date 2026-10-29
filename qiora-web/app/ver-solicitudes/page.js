{
  modulo.permiso === 'ver_solicitud' && modulo.disponible ? (
    <a
      className="qiora-module-action"
      href="/ver-solicitudes"
    >
      Ver solicitudes
    </a>
  ) : modulo.disponible ? (
    <a
      className="qiora-module-action"
      href={modulo.ruta}
    >
      Abrir módulo
    </a>
  ) : (
    <button
      className="qiora-module-action"
      type="button"
      disabled
    >
      En preparación
    </button>
  )
}
