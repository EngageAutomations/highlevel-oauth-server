#!/usr/bin/env node

/**
 * Migration script to update hl_installations table schema
 * Fixes the null location_id constraint violation by allowing nullable location_id
 */

const { Pool } = require('pg');

async function migrateHlInstallations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 Starting hl_installations table migration...');
    
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'hl_installations'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ hl_installations table does not exist. Creating new table...');
      
      // Create the table with correct schema
      await pool.query(`
        CREATE TABLE hl_installations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          location_id TEXT,
          agency_id TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          token_type TEXT NOT NULL DEFAULT 'Bearer',
          expires_at TIMESTAMPTZ,
          scope TEXT,
          installation_type TEXT DEFAULT 'location',
          status TEXT DEFAULT 'active',
          install_ip INET,
          user_agent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          
          -- Constraints
          CONSTRAINT require_tenant_id CHECK (
            (location_id IS NOT NULL AND agency_id IS NULL) OR 
            (location_id IS NULL AND agency_id IS NOT NULL)
          ),
          CONSTRAINT unique_location UNIQUE (location_id),
          CONSTRAINT unique_agency UNIQUE (agency_id)
        );
      `);
      
      console.log('✅ Created hl_installations table with correct schema');
      return;
    }
    
    console.log('📋 Table exists. Checking current schema...');
    
    // Get current column info
    const columns = await pool.query(`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'hl_installations'
      ORDER BY ordinal_position;
    `);
    
    console.log('Current columns:', columns.rows);
    
    // Check if location_id has NOT NULL constraint
    const locationIdColumn = columns.rows.find(col => col.column_name === 'location_id');
    
    if (locationIdColumn && locationIdColumn.is_nullable === 'NO') {
      console.log('🔄 Removing NOT NULL constraint from location_id...');
      
      // Drop existing constraints first
      await pool.query(`
        ALTER TABLE hl_installations 
        DROP CONSTRAINT IF EXISTS hl_installations_location_id_key;
      `);
      
      // Alter column to allow NULL
      await pool.query(`
        ALTER TABLE hl_installations 
        ALTER COLUMN location_id DROP NOT NULL;
      `);
      
      console.log('✅ Removed NOT NULL constraint from location_id');
    }
    
    // Add agency_id column if it doesn't exist
    const agencyIdColumn = columns.rows.find(col => col.column_name === 'agency_id');
    if (!agencyIdColumn) {
      console.log('➕ Adding agency_id column...');
      await pool.query(`
        ALTER TABLE hl_installations 
        ADD COLUMN agency_id TEXT;
      `);
      console.log('✅ Added agency_id column');
    }
    
    // Add other missing columns
    const requiredColumns = [
      { name: 'installation_type', type: 'TEXT', default: "'location'" },
      { name: 'status', type: 'TEXT', default: "'active'" },
      { name: 'install_ip', type: 'INET', default: null },
      { name: 'user_agent', type: 'TEXT', default: null }
    ];
    
    for (const col of requiredColumns) {
      const exists = columns.rows.find(c => c.column_name === col.name);
      if (!exists) {
        console.log(`➕ Adding ${col.name} column...`);
        const defaultClause = col.default ? ` DEFAULT ${col.default}` : '';
        await pool.query(`
          ALTER TABLE hl_installations 
          ADD COLUMN ${col.name} ${col.type}${defaultClause};
        `);
        console.log(`✅ Added ${col.name} column`);
      }
    }
    
    // Add the tenant ID constraint
    console.log('🔄 Adding tenant ID constraint...');
    await pool.query(`
      ALTER TABLE hl_installations 
      DROP CONSTRAINT IF EXISTS require_tenant_id;
    `);
    
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD CONSTRAINT require_tenant_id CHECK (
        (location_id IS NOT NULL AND agency_id IS NULL) OR 
        (location_id IS NULL AND agency_id IS NOT NULL)
      );
    `);
    
    console.log('✅ Added tenant ID constraint');
    
    // Add unique constraints
    console.log('🔄 Adding unique constraints...');
    await pool.query(`
      ALTER TABLE hl_installations 
      DROP CONSTRAINT IF EXISTS unique_location;
    `);
    
    await pool.query(`
      ALTER TABLE hl_installations 
      DROP CONSTRAINT IF EXISTS unique_agency;
    `);
    
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD CONSTRAINT unique_location UNIQUE (location_id);
    `);
    
    await pool.query(`
      ALTER TABLE hl_installations 
      ADD CONSTRAINT unique_agency UNIQUE (agency_id);
    `);
    
    console.log('✅ Added unique constraints');
    
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrateHlInstallations();
}

module.exports = migrateHlInstallations;