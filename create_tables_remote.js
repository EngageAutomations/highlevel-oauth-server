#!/usr/bin/env node

const { Pool } = require('pg');

async function createTables() {
  console.log('🔧 Starting database table creation...');
  
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Test connection
    console.log('Testing database connection...');
    await db.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Create oauth_state table
    console.log('Creating oauth_state table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state        TEXT PRIMARY KEY,
        client_id    TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      );
    `);
    console.log('✅ oauth_state table created/verified');

    // Create oauth_used_codes table
    console.log('Creating oauth_used_codes table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS oauth_used_codes (
        code        TEXT PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
    `);
    console.log('✅ oauth_used_codes table created/verified');

    // Create indexes
    console.log('Creating indexes...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);');
    console.log('✅ Indexes created/verified');

    // Verify tables exist
    const result = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('oauth_state', 'oauth_used_codes')
      ORDER BY table_name;
    `);

    const tables = result.rows.map(r => r.table_name);
    console.log('📋 Verified tables exist:', tables);

    if (tables.length === 2) {
      console.log('🎉 Database tables created successfully!');
      process.exit(0);
    } else {
      throw new Error(`Expected 2 tables, found ${tables.length}: ${tables.join(', ')}`);
    }

  } catch (error) {
    console.error('❌ Error creating tables:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    process.exit(1);
  } finally {
    await db.end();
  }
}

createTables();