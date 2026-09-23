/**
 * Ordered, idempotent SQL migrations. Applied by scripts/migrate.ts and automatically on first DB use.
 * Compatible with PostgreSQL 14+ and PGlite (embedded Postgres).
 *
 * Provenance columns (source_id, source_record_id, fetched_at, published_at, last_updated_at,
 * raw_response_hash) are present on every data table.
 */

const PROVENANCE = `
  source_id text not null references data_sources(id),
  source_record_id text,
  fetched_at timestamptz not null default now(),
  published_at timestamptz,
  last_updated_at timestamptz,
  raw_response_hash text`;

// Child tables belong to exactly one company OR one LLP.
const OWNER = `
  company_id uuid references companies(id) on delete cascade,
  llp_id uuid references llps(id) on delete cascade,
  check (num_nonnulls(company_id, llp_id) = 1)`;

export const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: "core_schema",
    sql: `
create table if not exists data_sources (
  id text primary key,
  name text not null,
  category text not null check (category in ('official_government','third_party','demo','ai_derived')),
  url text,
  license text,
  description text,
  last_synced_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  cin text not null unique,
  name text not null,
  normalized_name text not null,
  status text,
  company_class text,
  category text,
  sub_category text,
  listing_status text,
  origin text,
  incorporation_date date,
  roc text,
  state text,
  nic_code text,
  industry text,
  principal_activity text,
  authorized_capital numeric,
  paid_up_capital numeric,
  email text,
  last_agm_date date,
  last_balance_sheet_date date,
  created_at timestamptz not null default now(),
  ${PROVENANCE}
);
create index if not exists companies_normalized_name_idx on companies (normalized_name);
create index if not exists companies_state_idx on companies (state);

create table if not exists llps (
  id uuid primary key default gen_random_uuid(),
  llpin text not null unique,
  name text not null,
  normalized_name text not null,
  status text,
  incorporation_date date,
  roc text,
  state text,
  industry text,
  principal_activity text,
  total_contribution numeric,
  number_of_partners int,
  number_of_designated_partners int,
  email text,
  last_annual_return_date date,
  last_financial_statement_date date,
  created_at timestamptz not null default now(),
  ${PROVENANCE}
);
create index if not exists llps_normalized_name_idx on llps (normalized_name);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  ${OWNER},
  address_type text not null default 'registered',
  line text not null,
  city text,
  state text,
  pincode text,
  country text default 'India',
  effective_from date,
  effective_to date,
  ${PROVENANCE}
);
create index if not exists addresses_company_idx on addresses (company_id);
create index if not exists addresses_llp_idx on addresses (llp_id);

create table if not exists directors (
  id uuid primary key default gen_random_uuid(),
  din text not null unique,
  name text not null,
  normalized_name text not null,
  nationality text,
  din_status text,
  ${PROVENANCE}
);
create index if not exists directors_normalized_name_idx on directors (normalized_name);

create table if not exists company_directors (
  id uuid primary key default gen_random_uuid(),
  director_id uuid not null references directors(id) on delete cascade,
  ${OWNER},
  designation text,
  appointment_date date,
  cessation_date date,
  ${PROVENANCE}
);
create index if not exists company_directors_company_idx on company_directors (company_id);
create index if not exists company_directors_llp_idx on company_directors (llp_id);
create index if not exists company_directors_director_idx on company_directors (director_id);
create unique index if not exists company_directors_uniq on company_directors
  (director_id, coalesce(company_id, llp_id), coalesce(appointment_date, date '1900-01-01'));

create table if not exists filings (
  id uuid primary key default gen_random_uuid(),
  ${OWNER},
  form_type text not null,
  form_description text,
  financial_year text,
  filing_date date,
  due_date date,
  event_date date,
  status text,
  srn text,
  document_available boolean not null default false,
  document_url text,
  ${PROVENANCE}
);
create index if not exists filings_company_idx on filings (company_id, filing_date desc);
create index if not exists filings_llp_idx on filings (llp_id, filing_date desc);

create table if not exists financials (
  id uuid primary key default gen_random_uuid(),
  ${OWNER},
  financial_year text not null,
  period_end date,
  revenue numeric,
  other_income numeric,
  total_income numeric,
  total_expenses numeric,
  depreciation numeric,
  finance_cost numeric,
  profit_before_tax numeric,
  profit_after_tax numeric,
  ebitda numeric,
  net_worth numeric,
  total_assets numeric,
  total_liabilities numeric,
  borrowings numeric,
  paid_up_capital numeric,
  filing_id uuid references filings(id) on delete set null,
  ${PROVENANCE}
);
create unique index if not exists financials_uniq on financials (coalesce(company_id, llp_id), financial_year);

create table if not exists charges (
  id uuid primary key default gen_random_uuid(),
  ${OWNER},
  charge_id text not null,
  holder_name text not null,
  amount numeric,
  creation_date date,
  modification_date date,
  satisfaction_date date,
  status text not null check (status in ('open','satisfied')),
  property_description text,
  ${PROVENANCE}
);
create unique index if not exists charges_uniq on charges (coalesce(company_id, llp_id), charge_id);

create table if not exists company_name_history (
  id uuid primary key default gen_random_uuid(),
  ${OWNER},
  previous_name text not null,
  changed_on date,
  ${PROVENANCE}
);

create table if not exists data_sync_logs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references data_sources(id),
  job_type text not null,
  entity_identifier text,
  status text not null check (status in ('running','success','partial','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_fetched int not null default 0,
  records_upserted int not null default 0,
  error text,
  meta jsonb
);
create index if not exists data_sync_logs_started_idx on data_sync_logs (started_at desc);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null,
  entity_identifier text not null,
  generator text not null,
  model text,
  content jsonb not null,
  data_snapshot_hash text,
  share_token text unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists reports_entity_idx on reports (entity_identifier, created_at desc);

create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_kind text not null,
  entity_identifier text not null,
  entity_name text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, entity_identifier)
);
`,
  },
];

/** Trigram indexes are optional (extension may be unavailable); applied best-effort. */
export const TRIGRAM_SQL = `
create extension if not exists pg_trgm;
create index if not exists companies_name_trgm on companies using gin (normalized_name gin_trgm_ops);
create index if not exists llps_name_trgm on llps using gin (normalized_name gin_trgm_ops);
create index if not exists directors_name_trgm on directors using gin (normalized_name gin_trgm_ops);
`;
