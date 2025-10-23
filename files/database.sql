-- Tabla: teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text
);

-- Índices opcionales
create index if not exists idx_teams_name on public.teams(name);

-- Tabla: players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  number int not null,
  name text not null,
  position text,
  active boolean default true
);

-- Índices útiles
create index if not exists idx_players_team_id on public.players(team_id);
create index if not exists idx_players_number on public.players(number);

-- Tabla: matches
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  my_team_id uuid not null references public.teams(id) on delete cascade,
  rival_name text not null,
  is_home boolean default true,
  date timestamptz default now(),
  location text,
  competition text,
  active boolean default false,
  current_time_ms bigint default 0
);

-- Índices útiles
create index if not exists idx_matches_my_team_id on public.matches(my_team_id);
create index if not exists idx_matches_active on public.matches(active);
