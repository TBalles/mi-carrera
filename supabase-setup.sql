-- ════════════════════════════════════════════════════════
--  Setup de la base de datos para "Mi Carrera"
--  Correr una sola vez en: Supabase → SQL Editor → New query
-- ════════════════════════════════════════════════════════

-- Tabla clave-valor: cada usuario guarda sus datos (estados, notas, historial)
create table if not exists public.user_data (
  user_id    uuid        not null references auth.users on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

-- Activar Row Level Security: nadie ve filas que no sean suyas
alter table public.user_data enable row level security;

-- Políticas: el usuario sólo puede leer/escribir sus propias filas
create policy "leer datos propios"      on public.user_data
  for select using (auth.uid() = user_id);

create policy "insertar datos propios"  on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "actualizar datos propios" on public.user_data
  for update using (auth.uid() = user_id);

create policy "borrar datos propios"    on public.user_data
  for delete using (auth.uid() = user_id);
