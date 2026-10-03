const { Pool } = require('pg');

let pool;
let schemaPromise;

function getPool() {
  if (!pool) {
    const connectionString = process.env.neon || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Database connection is not configured');
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function ensureWorkspaceSchema() {
  if (!schemaPromise) {
    const db = getPool();
    schemaPromise = db.query(`
      create table if not exists clients (
        id bigserial primary key,
        name text not null,
        email text,
        phone text,
        service_type text not null default 'PT consult',
        status text not null default 'active',
        next_follow_up date,
        notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists client_sessions (
        id bigserial primary key,
        client_id bigint not null references clients(id) on delete cascade,
        session_type text not null,
        session_date date not null,
        duration_minutes int,
        notes text,
        next_session date,
        created_at timestamptz not null default now()
      );
      create table if not exists training_programs (
        id bigserial primary key,
        name text not null,
        client_id bigint references clients(id) on delete set null,
        client_name text,
        days_per_week int not null default 3,
        weeks int not null default 4,
        status text not null default 'draft',
        content jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists api_usage (
        id bigserial primary key,
        service text not null,
        operation text not null,
        status text not null default 'ok',
        calls int not null default 1,
        input_tokens int not null default 0,
        output_tokens int not null default 0,
        credits numeric,
        created_at timestamptz not null default now()
      );
      create table if not exists links (
        id text primary key,
        title text not null,
        short text,
        category text not null,
        url text,
        description text,
        frequency text,
        pinned boolean not null default false,
        sort int not null default 0
      );
      alter table links drop constraint if exists links_category_check;
      alter table links add column if not exists frequency text;
      alter table events add column if not exists needs_vendor boolean not null default false;
      alter table events add column if not exists expected_attendance int;
      alter table events add column if not exists pipeline_state jsonb not null default '{}'::jsonb;
      alter table events add column if not exists notes text;
      alter table oauth_tokens add column if not exists account_email text;
      create index if not exists idx_client_sessions_client on client_sessions(client_id, session_date desc);
      create index if not exists idx_api_usage_created on api_usage(created_at desc);
    `).catch(err => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

async function trackUsage(service, operation, status = 'ok', data = {}) {
  try {
    await ensureWorkspaceSchema();
    await getPool().query(
      `insert into api_usage (service, operation, status, calls, input_tokens, output_tokens, credits)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [service, operation, status, data.calls || 1, data.inputTokens || 0, data.outputTokens || 0, data.credits ?? null]
    );
  } catch (_) {}
}

module.exports = { getPool, ensureWorkspaceSchema, trackUsage };
