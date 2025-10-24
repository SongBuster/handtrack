-- Borrado de todas las tablas en orden
drop table if exists macthes cascade;
drop table if exists players cascade;
drop table if exists teams cascade;
drop table if exists match_tag_configurations cascade;
drop table if exists tags cascade;
drop table if exists sections cascade;
drop table if exists situations cascade;


-- Tabla: teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  user_id uuid references auth.users(id)
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

-- Activar Row Level Security
alter table public.teams enable row level security;

-- Permitir acceso solo a sus propios registros
create policy "Users can view their own teams"
  on public.teams for select
  using (auth.uid() = user_id);

create policy "Users can insert their own teams"
  on public.teams for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own teams"
  on public.teams for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own teams"
  on public.teams
  for delete
  using (auth.uid() = user_id);

-- Tabla: situations
create table if not exists public.situations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid references auth.users(id),
  next_situation_id uuid references public.situations(id) on delete set null
);

alter table if exists public.situations
  add column if not exists user_id uuid references auth.users(id);

create index if not exists idx_situations_user_id on public.situations(user_id);

-- Tabla: sections
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.situations(id) on delete cascade,
  name text not null,
  remember_selection boolean default false
);

create index if not exists idx_sections_situation_id on public.sections(situation_id);

-- Tabla: tags
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete cascade,
  name text not null,
  highlighted boolean default false,
  default_selected boolean default false,
  positive_value int default 0,
  negative_value int default 0,
  automatic_outcome text check (automatic_outcome in ('positive', 'negative')),
  play_finishes boolean default false
);

create index if not exists idx_tags_section_id on public.tags(section_id);

-- Tabla: match_tag_configurations
create table if not exists public.match_tag_configurations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  unique(match_id, tag_id)
);

create index if not exists idx_match_tag_configurations_match_id on public.match_tag_configurations(match_id);
create index if not exists idx_match_tag_configurations_tag_id on public.match_tag_configurations(tag_id);

alter table if exists public.situations enable row level security;
alter table if exists public.sections enable row level security;
alter table if exists public.tags enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'situations'
      and policyname = 'Situations are manageable by owner'
  ) then
    create policy "Situations are manageable by owner" on public.situations
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sections'
      and policyname = 'Sections tied to owned situations'
  ) then
    create policy "Sections tied to owned situations" on public.sections
      using (
        exists (
          select 1
          from public.situations s
          where s.id = sections.situation_id
            and s.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.situations s
          where s.id = sections.situation_id
            and s.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tags'
      and policyname = 'Tags tied to owned situations'
  ) then
    create policy "Tags tied to owned situations" on public.tags
      using (
        exists (
          select 1
          from public.sections sec
          join public.situations s on s.id = sec.situation_id
          where sec.id = tags.section_id
            and s.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.sections sec
          join public.situations s on s.id = sec.situation_id
          where sec.id = tags.section_id
            and s.user_id = auth.uid()
        )
      );
  end if;
end $$;