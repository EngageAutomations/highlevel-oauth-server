#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function fixTableSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Fixing hl_installations table schema...');
    
    // Add installation_type column if it doesn't exist
    console.log('➕ Adding installation_type column...');
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD COLUMN IF NOT EXISTS installation_type TEXT DEFAULT 'location';
    `);
    
    // Add status column if it doesn't exist
    console.log('➕ Adding status column...');
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
    `);
    
    // Add install_ip column if it doesn't exist
    console.log('➕ Adding install_ip column...');
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD COLUMN IF NOT EXISTS install_ip INET;
    `);
    
    // Add user_agent column if it doesn't exist
    console.log('➕ Adding user_agent column...');
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD COLUMN IF NOT EXISTS user_agent TEXT;
    `);
    
    // Add last_token_refresh column if it doesn't exist
    console.log('➕ Adding last_token_refresh column...');
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD COLUMN IF NOT EXISTS last_token_refresh TIMESTAMPTZ DEFAULT now();
    `);
    
    console.log('✅ Schema fix completed successfully!');
    
    // Verify the columns were added
    console.log('🔍 Verifying table schema...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'hl_installations' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📋 Current table columns:');
    console.log('=========================');
    result.rows.forEach(col => {
      console.log(`- ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });
    
    console.log('\n🎉 Table schema is now fixed! The admin/installations endpoint should work.');
    
  } catch (error) {
    console.error('❌ Schema fix failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixTableSchema();