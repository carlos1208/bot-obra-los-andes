-- Solo estado técnico. Los datos de la obra viven en el Google Sheet.

create table public.updates_procesados (
  update_id   bigint primary key,
  recibido_en timestamptz not null default now()
);

-- Una sesión activa por usuario y chat. El código la da por vencida a las 2 h.
create table public.sesiones (
  chat_id        bigint not null,
  user_id        bigint not null,
  flujo          text   not null,
  paso           text   not null,
  datos          jsonb  not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table public.album_buffer (
  id             bigint generated always as identity primary key,
  media_group_id text  not null,
  update         jsonb not null,
  recibido_en    timestamptz not null default clock_timestamp()
);
create index album_buffer_grupo on public.album_buffer (media_group_id);

create table public.cola_reintentos (
  id              bigint generated always as identity primary key,
  update          jsonb not null,
  intentos        int   not null default 0,
  proximo_intento timestamptz not null default now(),
  error           text,
  creado_en       timestamptz not null default now()
);
create index cola_reintentos_proximo on public.cola_reintentos (proximo_intento);

create table public.errores (
  id       bigint generated always as identity primary key,
  cuando   timestamptz not null default now(),
  contexto text,
  detalle  text
);

-- Nadie entra por la API pública: solo las Edge Functions con la clave secreta.
alter table public.updates_procesados enable row level security;
alter table public.sesiones           enable row level security;
alter table public.album_buffer       enable row level security;
alter table public.cola_reintentos    enable row level security;
alter table public.errores            enable row level security;

revoke all on public.updates_procesados, public.sesiones, public.album_buffer,
  public.cola_reintentos, public.errores from anon, authenticated;
