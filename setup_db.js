#!/usr/bin/env node

/**
 * Database Setup Script - Runs on Railway to create tables
 * This script will be deployed and run within Railway's environment
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupDatabase() {
  try {
    console.log('🔧 Setting up OAuth database tables...');
    
    // Create oauth_state table
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
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
    `);
    
    // Create oauth_used_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_used_codes (
        code        TEXT PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
    `);
    
    // Create index for oauth_used_codes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);
    `);
    
    console.log('✅ Database setup complete!');
    console.log('   - oauth_state table created');
    console.log('   - oauth_used_codes table created');
    console.log('   - Indexes created for performance');
    
    // Test the tables by inserting and removing a test record
    const testState = 'test_' + Date.now();
    await pool.query(
      'INSERT INTO oauth_state (state, client_id, redirect_uri, expires_at) VALUES ($1, $2, $3, $4)',
      [testState, 'test_client', 'test_uri', new Date(Date.now() + 60000)]
    );
    
    const result = await pool.query('SELECT COUNT(*) FROM oauth_state WHERE state = $1', [testState]);
    console.log('🧪 Test insert successful, count:', result.rows[0].count);
    
    await pool.query('DELETE FROM oauth_state WHERE state = $1', [testState]);
    console.log('🧹 Test cleanup complete');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();