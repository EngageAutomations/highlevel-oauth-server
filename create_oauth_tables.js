#!/usr/bin/env node

/**
 * OAuth State Persistence Kit - Database Schema Setup
 * Creates the required tables for state persistence and code deduplication
 */

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createOAuthTables() {
  try {
    console.log('Creating OAuth State Persistence tables...');
    
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
    
    console.log('✅ OAuth State Persistence tables created successfully');
    console.log('   - oauth_state (with expires index)');
    console.log('   - oauth_used_codes (with expires index)');
    
  } catch (error) {
    console.log('❌ Failed to create OAuth tables:');
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('DATABASE_URL length:', process.env.DATABASE_URL?.length || 0);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  createOAuthTables();
}

module.exports = { createOAuthTables };