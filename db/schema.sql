-- TaskDash schema (Neon Postgres)
-- Run once against your database (Neon SQL editor, or psql "$DATABASE_URL" -f schema.sql)

create table if not exists recur_tasks (
    id          text primary key,
    name        text not null,
    cadence     text not null check (cadence in ('Daily','Weekly','Monthly')),
    weekday     int,
    link_label  text,
    link_url    text,
    source      text not null default 'custom',
    created_at  timestamptz not null default now()
  );

create table if not exists task_checks (
    id          bigserial primary key,
    task_id     text not null,
    period_key  text not null,
    done        boolean not null default true,
    updated_at  timestamptz not null default now(),
    unique (task_id, period_key)
  );

create table if not exists daily_tasks (
    id          bigserial primary key,
    day_key     text not null,
    name        text not null,
    done        boolean not null default false,
    created_at  timestamptz not null default now()
  );

create table if not exists events (
    id          bigserial primary key,
    name        text not null,
    event_date  date not null,
    pillar      text,
    created_at  timestamptz not null default now()
  );

create table if not exists chat_log (
    id          bigserial primary key,
    role        text not null check (role in ('user','bot')),
    content     text not null,
    created_at  timestamptz not null default now()
  );

create index if not exists idx_task_checks_task on task_checks(task_id);
create index if not exists idx_daily_tasks_day on daily_tasks(day_key);
