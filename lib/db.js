const crypto = require("crypto");
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

// Every table, column and index Task Dash needs. Each statement is safe to
// re-run; ensureWorkspaceSchema only runs them when this text changes.
const SCHEMA_SQL = `
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
      create table if not exists recur_tasks (
        id text primary key,
        name text not null,
        cadence text not null,
        weekday int,
        link_label text,
        link_url text,
        source text not null default 'custom',
        created_at timestamptz not null default now()
      );
      alter table recur_tasks drop constraint if exists recur_tasks_cadence_check;
      alter table recur_tasks add column if not exists month_day int;
      alter table recur_tasks add column if not exists anchor_date date;
      alter table recur_tasks add column if not exists lead_days int not null default 0;
      alter table recur_tasks add column if not exists time_label text;
      alter table recur_tasks add column if not exists sort int not null default 100;
      create table if not exists task_checks (
        id bigserial primary key,
        task_id text not null,
        period_key text not null,
        done boolean not null default true,
        updated_at timestamptz not null default now(),
        unique (task_id, period_key)
      );
      create table if not exists daily_tasks (
        id bigserial primary key,
        day_key text not null,
        name text not null,
        done boolean not null default false,
        created_at timestamptz not null default now()
      );
      -- New-client checklist: null = not tracked; otherwise step -> date done.
      alter table clients add column if not exists onboarding jsonb;
      alter table clients add column if not exists first_session date;
      alter table clients add column if not exists nutrition_intake jsonb;
      create table if not exists client_meal_plans (
        id bigserial primary key,
        client_id bigint not null references clients(id) on delete cascade,
        intake jsonb not null,
        plan jsonb not null,
        model text,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_client_meal_plans_client on client_meal_plans(client_id, created_at desc);
      -- Live training sessions: what was lifted, set by set, for one program day.
      create table if not exists workout_logs (
        id bigserial primary key,
        client_id bigint not null references clients(id) on delete cascade,
        program_id bigint references training_programs(id) on delete set null,
        program_name text,
        day_index int not null default 0,
        day_name text,
        week_index int not null default 0,
        entries jsonb not null default '[]'::jsonb,
        notes text,
        status text not null default 'in_progress',
        session_id bigint references client_sessions(id) on delete set null,
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create index if not exists idx_workout_logs_client on workout_logs(client_id, started_at desc);
      -- Docs from the manager: uploaded files (private Vercel Blob) or links.
      create table if not exists docs (
        id bigserial primary key,
        kind text not null default 'link',
        title text not null,
        url text,
        blob_pathname text,
        file_name text,
        content_type text,
        size_bytes int,
        category text,
        tags jsonb not null default '[]'::jsonb,
        summary text,
        action_items jsonb not null default '[]'::jsonb,
        from_person text,
        received_on date,
        note text,
        status text not null default 'inbox',
        pinned boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists idx_docs_status on docs(status, created_at desc);
      -- One-off tasks carry over until done; done_on is the day they were ticked.
      alter table daily_tasks add column if not exists done_on text;
      create table if not exists app_errors (
        id bigserial primary key,
        source text not null,
        message text not null,
        stack text,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_app_errors_created on app_errors(created_at desc);
      create table if not exists app_meta (
        key text primary key,
        applied_at timestamptz not null default now()
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
    `;

// Identifies this exact schema + seed data + private link catalog. When the
// marker is already in app_meta, a cold start skips setup with one query.
function schemaVersion() {
  const hash = crypto.createHash("sha256");
  hash.update(SCHEMA_SQL);
  hash.update(JSON.stringify(require("../db/stock-programs.json")));
  hash.update(
    JSON.stringify(require("../db/stock-programs-training-card.json")),
  );
  hash.update(JSON.stringify(require("../task-schedule").BUILTIN_TASKS));
  hash.update(process.env.WORK_SOURCE_LINKS_JSON || "");
  return `schema:${hash.digest("hex").slice(0, 20)}`;
}

async function ensureWorkspaceSchema() {
  if (!schemaPromise) {
    const db = getPool();
    schemaPromise = (async () => {
      const version = schemaVersion();
      const current = await db
        .query("select 1 from app_meta where key=$1", [version])
        .catch(() => ({ rows: [] })); // app_meta doesn't exist yet
      if (current.rows.length) return;
      await db.query(SCHEMA_SQL);
      await syncPrivateSourceLinks(db);
      await seedStockPrograms(db);
      await seedStockPrograms(
        db,
        require("../db/stock-programs-training-card.json"),
        "stock_seed_trainingcard_v1",
      );
      await seedBuiltinTasks(db);
      await db.query(
        "insert into app_meta (key) values ($1) on conflict do nothing",
        [version],
      );
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

// One-time imports of stock program libraries (the TC Nexus sheet, then the
// EXOS_Adobe training cards), each marked by its own key.
// The app_meta marker means templates deleted later are never re-created.
const STOCK_SEED_KEY = "stock_seed_tcnexus_v1";

async function seedStockPrograms(
  db,
  programs = require("../db/stock-programs.json"),
  seedKey = STOCK_SEED_KEY,
) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const marked = await client.query(
      "insert into app_meta (key) values ($1) on conflict do nothing returning key",
      [seedKey],
    );
    if (!marked.rows.length) {
      await client.query("commit");
      return 0;
    }
    let inserted = 0;
    for (const p of programs) {
      const result = await client.query(
        `insert into training_programs (name,client_id,client_name,days_per_week,weeks,status,content,is_stock,goal,level,sport,emphasis)
         select $1,null,null,$2,$3,'active',$4::jsonb,true,$5,$6,$7,$8
         where not exists (select 1 from training_programs where is_stock=true and lower(name)=lower($1))`,
        [
          p.name,
          p.days_per_week,
          p.weeks,
          JSON.stringify(p.content),
          p.goal || null,
          p.level || null,
          p.sport || null,
          p.emphasis || null,
        ],
      );
      inserted += result.rowCount;
    }
    await client.query("commit");
    return inserted;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// One-time copy of the formerly hard-coded recurring duties into recur_tasks.
async function seedBuiltinTasks(
  db,
  tasks = require("../task-schedule").BUILTIN_TASKS,
) {
  const marked = await db.query(
    "insert into app_meta (key) values ('recur_seed_builtin_v1') on conflict do nothing returning key",
  );
  if (!marked.rows.length) return 0;
  const { normalizeSchedule } = require("../task-schedule");
  let inserted = 0;
  for (const [index, task] of tasks.entries()) {
    const r = normalizeSchedule(task);
    const result = await db.query(
      `insert into recur_tasks (id,name,cadence,weekday,month_day,anchor_date,lead_days,time_label,sort,source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'builtin') on conflict (id) do nothing`,
      [
        task.id,
        task.name,
        r.cadence,
        r.weekday,
        r.monthDay,
        r.anchorDate,
        r.leadDays,
        r.timeLabel || null,
        index + 1,
      ],
    );
    inserted += result.rowCount;
  }
  return inserted;
}

// Usage rows older than 90 days are dropped once per server instance; the
// Connections page only totals the current month.
let usagePruned = false;

async function trackUsage(service, operation, status = "ok", data = {}) {
  try {
    await ensureWorkspaceSchema();
    if (!usagePruned) {
      usagePruned = true;
      await getPool().query(
        "delete from api_usage where created_at < now() - interval '90 days'",
      );
    }
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

module.exports = {
  getPool,
  ensureWorkspaceSchema,
  seedStockPrograms,
  seedBuiltinTasks,
  trackUsage,
};
