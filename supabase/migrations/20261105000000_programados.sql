-- Avisos programados: pg_cron llama a la Edge Function «programado» con pg_net.
-- La URL y el secreto se leen de Vault (programado_url y programado_secreto); se crean a mano (README, fase 6).
-- pg_cron usa UTC y Bogotá es UTC−5.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema extensions;

-- Fuera de public: no queda expuesta por la API.
create schema if not exists interno;
revoke all on schema interno from public, anon, authenticated;

create or replace function interno.llamar_programado(tarea text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'programado_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Programado-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'programado_secreto')
    ),
    body := jsonb_build_object('tarea', tarea),
    timeout_milliseconds := 60000
  );
$$;
revoke all on function interno.llamar_programado(text) from public, anon, authenticated;

-- Lunes 07:00 en Bogotá: objetivos y lo esperado de la semana.
select cron.schedule('programado-lunes', '0 12 * * 1', $$select interno.llamar_programado('lunes')$$);
-- Lunes a sábado 17:00 en Bogotá: avisos del día y, el sábado, el cierre de la semana.
select cron.schedule('programado-diario', '0 22 * * 1-6', $$select interno.llamar_programado('diario')$$);
