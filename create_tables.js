#!/usr/bin/env node

/**
 * Simple table creation script for Railway deployment
 */

const { Pool } = require('pg');

async function createTables() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 Creating OAuth tables...');
    
    // Create oauth_state table
    console.log('Creating oauth_state table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state        TEXT PRIMARY KEY,
        client_id    TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      );
    `);
    
    // Create index for oauth_state
    console.log('Creating oauth_state index...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
    `);
    
    // Create oauth_used_codes table
    console.log('Creating oauth_used_codes table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_used_codes (
        code        TEXT PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
    `);
    
    // Create index for oauth_used_codes
    console.log('Creating oauth_used_codes index...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);
    `);
    
    console.log('✅ Tables created successfully!');
    
    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('oauth_state', 'oauth_used_codes')
      ORDER BY table_name;
    `);
    
    console.log('📋 Verified tables:', result.rows.map(r => r.table_name));
    
  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  createTables();
}

module.exports = createTables;