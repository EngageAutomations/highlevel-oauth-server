#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSchema() {
  try {
    console.log('Checking database schema...');
    
    // Check existing tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('\nExisting tables:');
    tablesResult.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
    
    // Check if oauth_state table exists
    const stateTableExists = tablesResult.rows.some(row => row.table_name === 'oauth_state');
    const usedCodesTableExists = tablesResult.rows.some(row => row.table_name === 'oauth_used_codes');
    
    console.log('\nRequired tables for errorfix2:');
    console.log(`- oauth_state: ${stateTableExists ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`- oauth_used_codes: ${usedCodesTableExists ? '✅ EXISTS' : '❌ MISSING'}`);
    
    if (!stateTableExists || !usedCodesTableExists) {
      console.log('\n🔧 Need to create missing tables for OAuth State Persistence Kit');
    } else {
      console.log('\n✅ All required tables exist');
    }
    
  } catch (error) {
    console.error('Database check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema();