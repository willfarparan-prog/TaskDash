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

-- v3 additions: Google Calendar OAuth + week-strip cache + manual work blocks

create table if not exists oauth_tokens (
      id            text primary key default 'google',
      access_token  text not null,
      refresh_token text,
      expires_at    timestamptz not null,
      scope         text,
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
