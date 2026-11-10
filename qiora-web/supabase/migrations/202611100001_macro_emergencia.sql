-- QIORA MACRO DE EMERGENCIA MULTIDISTRITO
-- Ejecutar primero en Supabase SQL Editor sobre una copia/entorno de pruebas.
-- El token maestro se guarda como SHA-256 hexadecimal; nunca en texto plano.

create table if not exists public.qiora_macro_emergencia_token (
  singleton boolean primary key default true check (singleton is true),
  token_hash text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

create table if not exists public.qiora_macro_emergencia_distritos (
  centro text primary key references public.qiora_distritos(centro) on update cascade on delete cascade,
  autorizado boolean not null default false,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

create table if not exists public.qiora_macro_emergencia_permisos (
  centro text not null references public.qiora_distritos(centro) on update cascade on delete cascade,
  proceso text not null,
  nivel text not null default 'BLOQUEADO'
    check (nivel in ('BLOQUEADO','CONSULTAR','PREPARAR','EJECUTAR')),
  requiere_aprobacion boolean not null default false,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  primary key (centro, proceso),
  check (proceso in (
    'MB52','IQ09','STOCK_TECNICOS','ACTUALIZAR_SUPABASE','CONSULTAS_SAP',
    'TRASPASOS','RECOLECCIONES','MOVIMIENTOS_ALMACEN','AUDITORIAS'
  ))
);

create table if not exists public.qiora_macro_emergencia_ejecuciones (
  id uuid primary key default gen_random_uuid(),
  ejecucion_id text not null,
  distrito text not null references public.qiora_distritos(centro) on update cascade,
  proceso text not null,
  operacion text not null default 'CONSULTAR',
  estado text not null default 'INICIADO'
    check (estado in ('INICIADO','PREPARADO','EN_APROBACION','REALIZADO','ERROR','CANCELADO')),
  pc text,
  usuario_excel text,
  registros_descargados integer,
  registros_cargados integer,
  documento_sap text,
  mensaje text,
  iniciado_en timestamptz not null default now(),
  finalizado_en timestamptz,
  aprobado_por uuid,
  metadata jsonb not null default '{}'::jsonb,
  unique (ejecucion_id, distrito, proceso)
);

create index if not exists qiora_macro_ejecuciones_distrito_fecha_idx
  on public.qiora_macro_emergencia_ejecuciones (distrito, iniciado_en desc);
create index if not exists qiora_macro_ejecuciones_estado_idx
  on public.qiora_macro_emergencia_ejecuciones (estado, iniciado_en desc);

alter table public.qiora_macro_emergencia_token enable row level security;
alter table public.qiora_macro_emergencia_distritos enable row level security;
alter table public.qiora_macro_emergencia_permisos enable row level security;
alter table public.qiora_macro_emergencia_ejecuciones enable row level security;

revoke all on public.qiora_macro_emergencia_token from anon, authenticated;
revoke all on public.qiora_macro_emergencia_distritos from anon, authenticated;
revoke all on public.qiora_macro_emergencia_permisos from anon, authenticated;
revoke all on public.qiora_macro_emergencia_ejecuciones from anon, authenticated;
grant all on public.qiora_macro_emergencia_token to service_role;
grant all on public.qiora_macro_emergencia_distritos to service_role;
grant all on public.qiora_macro_emergencia_permisos to service_role;
grant all on public.qiora_macro_emergencia_ejecuciones to service_role;

-- Comprueba el token maestro, el estado del distrito y el permiso por proceso.
create or replace function public.qiora_macro_emergencia_autorizar_hash(
  p_token_hash text,
  p_distrito text,
  p_proceso text,
  p_operacion text default 'CONSULTAR'
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_d text := upper(btrim(coalesce(p_distrito,'')));
  v_p text := upper(btrim(coalesce(p_proceso,'')));
  v_o text := upper(btrim(coalesce(p_operacion,'CONSULTAR')));
  v_nivel text;
  v_aprobacion boolean;
  v_requiere integer;
  v_concedido integer;
begin
  if not exists (
    select 1 from public.qiora_macro_emergencia_token t
    where t.singleton is true and t.activo is true and t.token_hash = p_token_hash
  ) then
    return jsonb_build_object('ok',false,'permitido',false,'error','TOKEN_MAESTRO_INVALIDO');
  end if;
  if v_d !~ '^[A-Z]{2,5}[0-9]{1,5}$' or v_o not in ('CONSULTAR','PREPARAR','EJECUTAR') then
    return jsonb_build_object('ok',false,'permitido',false,'error','PARAMETROS_INVALIDOS');
  end if;
  if not exists (select 1 from public.qiora_distritos d where d.centro=v_d and d.activo is true) then
    return jsonb_build_object('ok',true,'permitido',false,'error','DISTRITO_INACTIVO');
  end if;
  if not exists (select 1 from public.qiora_macro_emergencia_distritos d where d.centro=v_d and d.autorizado is true) then
    return jsonb_build_object('ok',true,'permitido',false,'error','DISTRITO_NO_AUTORIZADO');
  end if;
  select p.nivel, p.requiere_aprobacion
    into v_nivel, v_aprobacion
  from public.qiora_macro_emergencia_permisos p
  where p.centro=v_d and p.proceso=v_p;
  if not found then
    return jsonb_build_object('ok',true,'permitido',false,'error','PROCESO_NO_AUTORIZADO');
  end if;
  v_requiere := case v_o when 'CONSULTAR' then 1 when 'PREPARAR' then 2 else 3 end;
  v_concedido := case v_nivel when 'CONSULTAR' then 1 when 'PREPARAR' then 2 when 'EJECUTAR' then 3 else 0 end;
  if v_concedido < v_requiere then
    return jsonb_build_object('ok',true,'permitido',false,'error','NIVEL_INSUFICIENTE','nivel',v_nivel);
  end if;
  if v_o='EJECUTAR' and v_aprobacion then
    return jsonb_build_object('ok',true,'permitido',false,'requiere_aprobacion',true,'error','APROBACION_ADMIN_PADRE_REQUERIDA','nivel',v_nivel);
  end if;
  return jsonb_build_object('ok',true,'permitido',true,'requiere_aprobacion',v_aprobacion,'nivel',v_nivel);
end;
$function$;

-- Valida ambos permisos y reutiliza el token individual guardado en el esquema privado.
-- El token individual nunca se entrega a Excel.
create or replace function public.qiora_macro_emergencia_inventario_lote(
  p_token_hash text, p_distrito text, p_tipo text, p_lote text,
  p_offset integer, p_filas jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_d text := upper(btrim(coalesce(p_distrito,'')));
  v_tipo text := upper(btrim(coalesce(p_tipo,'')));
  v_proceso text;
  v_token text;
  v_permiso jsonb;
  v_actualizacion jsonb;
begin
  v_proceso := case v_tipo when 'STOCK_ALMACEN' then 'MB52'
                           when 'IQ09_EQUIPOS' then 'IQ09'
                           when 'STOCK_TECNICOS' then 'STOCK_TECNICOS' else '' end;
  if v_proceso='' then raise exception 'TIPO_INVALIDO'; end if;
  v_permiso := public.qiora_macro_emergencia_autorizar_hash(p_token_hash,v_d,v_proceso,'EJECUTAR');
  if coalesce((v_permiso->>'permitido')::boolean,false) is not true then
    raise exception '%', coalesce(v_permiso->>'error','PROCESO_NO_AUTORIZADO');
  end if;
  v_actualizacion := public.qiora_macro_emergencia_autorizar_hash(p_token_hash,v_d,'ACTUALIZAR_SUPABASE','EJECUTAR');
  if coalesce((v_actualizacion->>'permitido')::boolean,false) is not true then
    raise exception 'ACTUALIZAR_SUPABASE_NO_AUTORIZADO';
  end if;
  select t.token_excel into v_token from qiora_privado.distritos_tokens t where t.centro=v_d;
  if v_token is null then raise exception 'TOKEN_DISTRITO_NO_CONFIGURADO'; end if;
  return public.qiora_excel_inventario_lote(v_d,v_token,v_tipo,p_lote,p_offset,p_filas);
end;
$function$;

-- El commit original puede omitir filas validas estructuralmente. Si el total insertado
-- no coincide con el total recibido, esta funcion lanza una excepcion y PostgreSQL revierte
-- tambien los DELETE/INSERT realizados por la funcion original dentro de esta transaccion.
create or replace function public.qiora_macro_emergencia_inventario_commit(
  p_token_hash text, p_distrito text, p_tipo text, p_lote text, p_total integer
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_d text := upper(btrim(coalesce(p_distrito,'')));
  v_tipo text := upper(btrim(coalesce(p_tipo,'')));
  v_proceso text;
  v_token text;
  v_permiso jsonb;
  v_actualizacion jsonb;
  v_resultado jsonb;
  v_insertados integer;
begin
  v_proceso := case v_tipo when 'STOCK_ALMACEN' then 'MB52'
                           when 'IQ09_EQUIPOS' then 'IQ09'
                           when 'STOCK_TECNICOS' then 'STOCK_TECNICOS' else '' end;
  if v_proceso='' then raise exception 'TIPO_INVALIDO'; end if;
  v_permiso := public.qiora_macro_emergencia_autorizar_hash(p_token_hash,v_d,v_proceso,'EJECUTAR');
  if coalesce((v_permiso->>'permitido')::boolean,false) is not true then
    raise exception '%', coalesce(v_permiso->>'error','PROCESO_NO_AUTORIZADO');
  end if;
  v_actualizacion := public.qiora_macro_emergencia_autorizar_hash(p_token_hash,v_d,'ACTUALIZAR_SUPABASE','EJECUTAR');
  if coalesce((v_actualizacion->>'permitido')::boolean,false) is not true then
    raise exception 'ACTUALIZAR_SUPABASE_NO_AUTORIZADO';
  end if;
  select t.token_excel into v_token from qiora_privado.distritos_tokens t where t.centro=v_d;
  if v_token is null then raise exception 'TOKEN_DISTRITO_NO_CONFIGURADO'; end if;
  v_resultado := public.qiora_excel_inventario_commit(v_d,v_token,v_tipo,p_lote,p_total);
  v_insertados := coalesce((v_resultado->>'registros')::integer,-1);
  if v_insertados <> p_total then
    raise exception 'ARCHIVO_INCOMPLETO: recibidos %, insertados %; inventario anterior conservado', p_total, v_insertados;
  end if;
  return v_resultado;
end;
$function$;

revoke all on function public.qiora_macro_emergencia_autorizar_hash(text,text,text,text) from public, anon, authenticated;
revoke all on function public.qiora_macro_emergencia_inventario_lote(text,text,text,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.qiora_macro_emergencia_inventario_commit(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.qiora_macro_emergencia_autorizar_hash(text,text,text,text) to service_role;
grant execute on function public.qiora_macro_emergencia_inventario_lote(text,text,text,text,integer,jsonb) to service_role;
grant execute on function public.qiora_macro_emergencia_inventario_commit(text,text,text,text,integer) to service_role;

-- Endurece tambien la ruta tradicional con token individual, sin romper compatibilidad.
create or replace function public.qiora_excel_inventario_commit_seguro(
  p_distrito text, p_token text, p_tipo text, p_lote text, p_total integer
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_resultado jsonb;
  v_insertados integer;
begin
  v_resultado := public.qiora_excel_inventario_commit(p_distrito,p_token,p_tipo,p_lote,p_total);
  v_insertados := coalesce((v_resultado->>'registros')::integer,-1);
  if v_insertados <> p_total then
    raise exception 'ARCHIVO_INCOMPLETO: recibidos %, insertados %; inventario anterior conservado', p_total, v_insertados;
  end if;
  return v_resultado;
end;
$function$;
revoke all on function public.qiora_excel_inventario_commit_seguro(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.qiora_excel_inventario_commit_seguro(text,text,text,text,integer) to service_role;
