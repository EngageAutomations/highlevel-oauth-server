const { Pool } = require('pg');
const logger = console;

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixConstraintIssues() {
  const client = await db.connect();
  
  try {
    logger.info('🔧 Starting constraint fix process...');
    
    // 1. Check current constraints and indexes
    logger.info('📋 Checking current constraints...');
    const constraintsResult = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'hl_installations'::regclass
      ORDER BY conname;
    `);
    
    logger.info('Current constraints:', constraintsResult.rows);
    
    // 2. Check current indexes
    logger.info('📋 Checking current indexes...');
    const indexesResult = await client.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = 'hl_installations'
      ORDER BY indexname;
    `);
    
    logger.info('Current indexes:', indexesResult.rows);
    
    // 3. Check if we need to create a composite unique index for location_id + agency_id
    const hasCompositeIndex = indexesResult.rows.some(row => 
      row.indexdef.includes('location_id') && row.indexdef.includes('agency_id') && row.indexdef.includes('UNIQUE')
    );
    
    if (!hasCompositeIndex) {
      logger.info('🔨 Creating composite unique index for location_id + agency_id...');
      
      // First, check for duplicates that would prevent index creation
      const duplicatesResult = await client.query(`
        SELECT location_id, agency_id, COUNT(*) as count
        FROM hl_installations 
        WHERE location_id IS NOT NULL AND agency_id IS NOT NULL
        GROUP BY location_id, agency_id
        HAVING COUNT(*) > 1;
      `);
      
      if (duplicatesResult.rows.length > 0) {
        logger.warn('⚠️ Found duplicates that need to be resolved:', duplicatesResult.rows);
        
        // Keep the most recent record for each duplicate group
        for (const dup of duplicatesResult.rows) {
          logger.info(`Cleaning up duplicates for location_id: ${dup.location_id}, agency_id: ${dup.agency_id}`);
          
          await client.query(`
            DELETE FROM hl_installations 
            WHERE location_id = $1 AND agency_id = $2 
            AND id NOT IN (
              SELECT id FROM hl_installations 
              WHERE location_id = $1 AND agency_id = $2 
              ORDER BY created_at DESC 
              LIMIT 1
            )
          `, [dup.location_id, dup.agency_id]);
        }
      }
      
      // Create the composite unique index
      await client.query(`
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_hl_installations_location_agency 
        ON hl_installations (location_id, agency_id) 
        WHERE location_id IS NOT NULL AND agency_id IS NOT NULL;
      `);
      
      logger.info('✅ Composite unique index created successfully');
    } else {
      logger.info('✅ Composite unique index already exists');
    }
    
    // 4. Check for any remaining ON CONFLICT usage in the database
    logger.info('🔍 Checking for any stored procedures or functions with ON CONFLICT...');
    const functionsResult = await client.query(`
      SELECT 
        proname as function_name,
        prosrc as source_code
      FROM pg_proc 
      WHERE prosrc ILIKE '%ON CONFLICT%';
    `);
    
    if (functionsResult.rows.length > 0) {
      logger.warn('⚠️ Found functions with ON CONFLICT:', functionsResult.rows);
    } else {
      logger.info('✅ No stored functions with ON CONFLICT found');
    }
    
    logger.info('🎉 Constraint fix process completed successfully!');
    
  } catch (error) {
    logger.error('❌ Error during constraint fix:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
    throw error;
  } finally {
    client.release();
  }
}

// Run the fix
if (require.main === module) {
  fixConstraintIssues()
    .then(() => {
      logger.info('✅ Constraint fix completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Constraint fix failed:', error);
      process.exit(1);
    });
}

module.exports = { fixConstraintIssues };