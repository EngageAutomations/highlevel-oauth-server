const { Pool } = require('pg');

async function fixConstraints() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Starting constraint fix...');
    
    // Drop existing partial indexes
    await pool.query('DROP INDEX IF EXISTS hl_installations_location_id_unique;');
    await pool.query('DROP INDEX IF EXISTS hl_installations_agency_id_unique;');
    await pool.query('DROP INDEX IF EXISTS unique_location_install;');
    await pool.query('DROP INDEX IF EXISTS unique_agency_install;');
    
    // Drop existing constraints
    await pool.query('ALTER TABLE hl_installations DROP CONSTRAINT IF EXISTS unique_location_install;');
    await pool.query('ALTER TABLE hl_installations DROP CONSTRAINT IF EXISTS unique_agency_install;');
    
    console.log('✅ Dropped existing indexes and constraints');
    
    // Add proper unique constraints
    await pool.query('ALTER TABLE hl_installations ADD CONSTRAINT unique_location_install UNIQUE (location_id);');
    console.log('✅ Added location_id unique constraint');
    
    await pool.query('ALTER TABLE hl_installations ADD CONSTRAINT unique_agency_install UNIQUE (agency_id);');
    console.log('✅ Added agency_id unique constraint');
    
    // Verify constraints exist
    const constraints = await pool.query(`
      SELECT conname, contype 
      FROM pg_constraint 
      WHERE conrelid = 'hl_installations'::regclass 
      AND contype = 'u'
    `);
    
    console.log('📋 Current unique constraints:');
    constraints.rows.forEach(row => {
      console.log(`  - ${row.conname} (${row.contype})`);
    });
    
    console.log('🎉 Constraint fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Constraint fix failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

fixConstraints().catch(console.error);