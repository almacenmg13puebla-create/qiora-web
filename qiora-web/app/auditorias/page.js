const { data: usuarioTecnico, error: tecnicoError } =
  await supabase
    .rpc('obtener_tecnico_auditoria', {
      p_almacen: almacen4,
    })
    .maybeSingle()
