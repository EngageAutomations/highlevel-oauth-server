const {Client} = require('pg');

// Use public Railway Postgres URL
const publicDbUrl = 'postgresql://postgres:dxoBlqqcISFiOWhmWkfqOWQCibmqLeum@postgres-production-a322.up.railway.app:5432/railway';

const sql = `
CREATE TABLE IF NOT EXISTS oauth_state (
  state        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);

CREATE TABLE IF NOT EXISTS oauth_used_codes (
  code        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);
`;

(async () => {
  const c = new Client({
    connectionString: publicDbUrl,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();
  await c.query(sql);
  console.log('Tables ready.');
  await c.end();
})().catch(e => {
  console.error(e.stack || e);
  process.exit(1);
});