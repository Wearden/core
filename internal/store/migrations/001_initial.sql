CREATE TABLE IF NOT EXISTS wearden_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id bigserial PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('viewer','operator','admin')), active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_tokens (
 hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('access','refresh')), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS user_tokens_expiry ON user_tokens(expires_at);
CREATE TABLE IF NOT EXISTS assets (id bigserial PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS credentials (asset_id bigint PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE, username text NOT NULL, auth_type text NOT NULL, encrypted bytea NOT NULL);
CREATE TABLE IF NOT EXISTS agents (
 id text PRIMARY KEY, asset_id bigint UNIQUE REFERENCES assets(id) ON DELETE SET NULL,
 hostname text NOT NULL, os text NOT NULL CHECK(os IN ('linux','windows')), version text NOT NULL,
 benchmark_id text NOT NULL, token_hash text NOT NULL UNIQUE, revoked boolean NOT NULL DEFAULT false,
 interval_seconds integer NOT NULL DEFAULT 3600 CHECK(interval_seconds BETWEEN 60 AND 604800),
 last_seen timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS enrollment_tokens (
 hash text PRIMARY KEY, os text NOT NULL CHECK(os IN ('linux','windows')), benchmark_id text NOT NULL,
 expires_at timestamptz NOT NULL, remaining integer NOT NULL DEFAULT 1 CHECK(remaining>=0), created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(collection,id)
);
CREATE INDEX IF NOT EXISTS documents_data ON documents USING gin(data);
CREATE TABLE IF NOT EXISTS reports (
 agent_id text NOT NULL REFERENCES agents(id), report_id text NOT NULL, digest text NOT NULL,
 scan_id text NOT NULL, data jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agent_id,report_id)
);
CREATE TABLE IF NOT EXISTS agent_jobs (
 id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), scan_id text NOT NULL,
 benchmark_id text NOT NULL, rule_ids jsonb NOT NULL, state text NOT NULL DEFAULT 'queued',
 created_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 UNIQUE(agent_id,scan_id)
);
CREATE INDEX IF NOT EXISTS agent_jobs_queue ON agent_jobs(agent_id,state,created_at);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), username text,
 action text NOT NULL, target text, success boolean NOT NULL, ip text, detail text
);
CREATE TABLE IF NOT EXISTS host_samples (
 id bigserial PRIMARY KEY, asset_id bigint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 checked_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_schedules (
 id text PRIMARY KEY, data jsonb NOT NULL, next_run timestamptz NOT NULL, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS host_result_ids;
CREATE SEQUENCE IF NOT EXISTS finding_ids;
INSERT INTO wearden_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS action_jobs (
 id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), run_id text NOT NULL,
 action text NOT NULL, group_id text NOT NULL DEFAULT '', task jsonb NOT NULL, state text NOT NULL DEFAULT 'queued',
 result jsonb, result_digest text, created_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS action_jobs_queue ON action_jobs(agent_id,state,created_at);

CREATE TABLE IF NOT EXISTS action_result_history (
 task_id text NOT NULL REFERENCES action_jobs(id), revision integer NOT NULL CHECK(revision IN (0,1)),
 digest text NOT NULL, data jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,revision)
);

ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS request_digest text;
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id);
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS enrolled_at timestamptz;
