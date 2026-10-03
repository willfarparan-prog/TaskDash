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
      needs_vendor boolean not null default false,
      expected_attendance int,
      pipeline_state jsonb not null default '{}'::jsonb,
      notes text,
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

-- v3 additions: Google Calendar OAuth + week-strip cache + manual work blocks

create table if not exists oauth_tokens (
      id            text primary key default 'google',
      access_token  text not null,
      refresh_token text,
      expires_at    timestamptz not null,
      scope         text,
      account_email text,
      updated_at    timestamptz not null default now()
    );

create table if not exists manual_blocks (
      id          bigserial primary key,
      title       text not null,
      block_date  date not null,
      start_time  text not null,
      end_time    text not null,
      source      text not null default 'adobe',
      created_at  timestamptz not null default now()
    );

create index if not exists idx_manual_blocks_date on manual_blocks(block_date);

-- v4: playbook link registry (URLs live here, not in the repo)
create table if not exists links (
      id          text primary key,
      title       text not null,
      short       text,
      category    text not null check (category in ('daily','reporting','forms','hr_sop','marketing')),
      url         text,
      description text,
      pinned      boolean not null default false,
      sort        int not null default 0
    );

-- v5: coach command center records
create table if not exists clients (
      id              bigserial primary key,
      name            text not null,
      email           text,
      phone           text,
      service_type    text not null default 'PT consult',
      status          text not null default 'active',
      next_follow_up  date,
      notes           text,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    );

create table if not exists client_sessions (
      id                bigserial primary key,
      client_id         bigint not null references clients(id) on delete cascade,
      session_type      text not null,
      session_date      date not null,
      duration_minutes  int,
      notes             text,
      next_session      date,
      created_at        timestamptz not null default now()
    );

create table if not exists training_programs (
      id              bigserial primary key,
      name            text not null,
      client_id       bigint references clients(id) on delete set null,
      client_name     text,
      days_per_week   int not null default 3,
      weeks           int not null default 4,
      status          text not null default 'draft',
      content         jsonb not null default '[]'::jsonb,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    );

create table if not exists api_usage (
      id             bigserial primary key,
      service        text not null,
      operation      text not null,
      status         text not null default 'ok',
      calls          int not null default 1,
      input_tokens   int not null default 0,
      output_tokens  int not null default 0,
      credits        numeric,
      created_at     timestamptz not null default now()
    );

create index if not exists idx_client_sessions_client on client_sessions(client_id, session_date desc);
create index if not exists idx_api_usage_created on api_usage(created_at desc);
