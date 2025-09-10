#!/usr/bin/env node

/**
 * OAuth State Persistence Kit - Database Schema Setup (External Connection)
 * Creates the required tables for state persistence and code deduplication
 */

const { Pool } = require('pg');

// Use external Railway Postgres URL
const externalUrl = process.env.DATABASE_URL.replace('postgres.railway.internal', 'postgres-production-a322.up.railway.app');
console.log('Using external database URL:', externalUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));

const pool = new Pool({ connectionString: externalUrl });

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
    console.error('❌ Failed to create OAuth tables:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
  } finally {
    await pool.end();
  }
}

createOAuthTables();