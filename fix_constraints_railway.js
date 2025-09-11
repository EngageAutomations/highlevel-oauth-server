// This script should be run on Railway to fix database constraints
const { Pool } = require('pg');

async function fixConstraintsOnRailway() {
  // Use Railway's internal DATABASE_URL
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔧 [Railway] Starting constraint fix...');
    
    // Check current table structure
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'hl_installations'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Current table structure:');
    tableInfo.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Drop ALL existing constraints and indexes
    console.log('🗑️ Dropping existing constraints...');
    await pool.query('ALTER TABLE hl_installations DROP CONSTRAINT IF EXISTS unique_location_install CASCADE;');
    await pool.query('ALTER TABLE hl_installations DROP CONSTRAINT IF EXISTS unique_agency_install CASCADE;');
    await pool.query('DROP INDEX IF EXISTS hl_installations_location_id_unique CASCADE;');
    await pool.query('DROP INDEX IF EXISTS hl_installations_agency_id_unique CASCADE;');
    await pool.query('DROP INDEX IF EXISTS unique_location_install CASCADE;');
    await pool.query('DROP INDEX IF EXISTS unique_agency_install CASCADE;');
    
    // Add new unique constraints
    console.log('➕ Adding new unique constraints...');
    await pool.query('ALTER TABLE hl_installations ADD CONSTRAINT unique_location_install UNIQUE (location_id);');
    console.log('✅ Added location_id unique constraint');
    
    await pool.query('ALTER TABLE hl_installations ADD CONSTRAINT unique_agency_install UNIQUE (agency_id);');
    console.log('✅ Added agency_id unique constraint');
    
    // Verify final state
    const finalConstraints = await pool.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'hl_installations'::regclass
    `);
    
    console.log('📋 Final constraints:');
    finalConstraints.rows.forEach(row => {
      console.log(`  - ${row.conname} (${row.contype}): ${row.definition}`);
    });
    
    console.log('🎉 [Railway] Constraint fix completed successfully!');
    
  } catch (error) {
    console.error('❌ [Railway] Constraint fix failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await pool.end();
  }
}

// Only run if this is the main module
if (require.main === module) {
  fixConstraintsOnRailway().catch(console.error);
}

module.exports = { fixConstraintsOnRailway };