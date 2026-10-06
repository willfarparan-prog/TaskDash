const { Pool } = require("pg");

let pool;
let schemaPromise;

function getPool() {
  if (!pool) {
    const connectionString = process.env.neon || process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("Database connection is not configured");
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function ensureWorkspaceSchema() {
  if (!schemaPromise) {
    const db = getPool();
    schemaPromise = (async () => {
      await db.query(
        `
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
      alter table training_programs add column if not exists is_stock boolean not null default false;
      alter table training_programs add column if not exists source_program_id bigint references training_programs(id) on delete set null;
      alter table training_programs add column if not exists goal text;
      alter table training_programs add column if not exists level text;
      alter table training_programs add column if not exists sport text;
      alter table training_programs add column if not exists emphasis text;
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
      create table if not exists booking_settings (
        id int primary key default 1 check (id = 1),
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table if not exists booking_requests (
        id bigserial primary key,
        booking_code text unique not null,
        visitor_name text not null,
        visitor_email text,
        reason text not null,
        notes text,
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        status text not null default 'confirmed',
        google_event_id text,
        calendar_sync_status text not null default 'pending',
        created_at timestamptz not null default now()
      );
      create unique index if not exists idx_booking_active_slot on booking_requests(starts_at) where status in ('pending','confirmed');
      create index if not exists idx_booking_upcoming on booking_requests(starts_at, status);
      alter table events add column if not exists needs_vendor boolean not null default false;
      alter table events add column if not exists expected_attendance int;
      alter table events add column if not exists pipeline_state jsonb not null default '{}'::jsonb;
      alter table events add column if not exists notes text;
      alter table events add column if not exists start_time text;
      alter table events add column if not exists end_time text;
      alter table events add column if not exists location text;
      alter table events add column if not exists description text;
      alter table events add column if not exists equipment text;
      alter table events add column if not exists catering_needed boolean not null default false;
      alter table events add column if not exists catering_budget text;
      alter table events add column if not exists menu_ideas text;
      alter table events add column if not exists event_link text;
      alter table events add column if not exists drafts jsonb not null default '{}'::jsonb;
      alter table oauth_tokens add column if not exists account_email text;
      create index if not exists idx_client_sessions_client on client_sessions(client_id, session_date desc);
      create index if not exists idx_training_programs_client on training_programs(client_id, updated_at desc);
      create index if not exists idx_training_programs_stock on training_programs(is_stock, level, emphasis);
      create index if not exists idx_api_usage_created on api_usage(created_at desc);
    `,
      );
      await syncPrivateSourceLinks(db);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function syncPrivateSourceLinks(db) {
  const raw = process.env.WORK_SOURCE_LINKS_JSON;
  if (!raw) return;

  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch {
    throw new Error("WORK_SOURCE_LINKS_JSON must be valid JSON");
  }
  if (!Array.isArray(catalog)) {
    throw new Error("WORK_SOURCE_LINKS_JSON must contain an array");
  }

  const links = catalog
    .filter(
      (link) =>
        link &&
        typeof link.id === "string" &&
        typeof link.title === "string" &&
        typeof link.category === "string" &&
        typeof link.url === "string" &&
        /^https:\/\//i.test(link.url),
    )
    .map((link, index) => ({
      id: link.id.slice(0, 100),
      title: link.title.slice(0, 200),
      short: String(link.short || "").slice(0, 80) || null,
      category: link.category.slice(0, 80),
      url: link.url.slice(0, 4000),
      description: String(link.description || "").slice(0, 1000) || null,
      frequency: String(link.frequency || "").slice(0, 120) || null,
      pinned: Boolean(link.pinned),
      sort: Number.isFinite(Number(link.sort)) ? Number(link.sort) : index,
    }));

  if (!links.length) return;
  await db.query(
    `insert into links (id, title, short, category, url, description, frequency, pinned, sort)
     select id, title, short, category, url, description, frequency, pinned, sort
     from jsonb_to_recordset($1::jsonb) as source(
       id text,
       title text,
       short text,
       category text,
       url text,
       description text,
       frequency text,
       pinned boolean,
       sort int
     )
     on conflict (id) do update set
       title = excluded.title,
       short = excluded.short,
       category = excluded.category,
       url = excluded.url,
       description = excluded.description,
       frequency = excluded.frequency,
       pinned = excluded.pinned,
       sort = excluded.sort`,
    [JSON.stringify(links)],
  );
}

async function trackUsage(service, operation, status = "ok", data = {}) {
  try {
    await ensureWorkspaceSchema();
    await getPool().query(
      `insert into api_usage (service, operation, status, calls, input_tokens, output_tokens, credits)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        service,
        operation,
        status,
        data.calls || 1,
        data.inputTokens || 0,
        data.outputTokens || 0,
        data.credits ?? null,
      ],
    );
  } catch (_) {}
}

module.exports = { getPool, ensureWorkspaceSchema, trackUsage };
