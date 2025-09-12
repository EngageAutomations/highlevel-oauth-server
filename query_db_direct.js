#!/usr/bin/env node

const { Pool } = require('pg');

async function queryDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Connecting to database...');
    
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'hl_installations'
      );
    `);
    
    console.log('📋 Table exists:', tableCheck.rows[0].exists);
    
    if (tableCheck.rows[0].exists) {
      // Get count of installations
      const countResult = await pool.query('SELECT COUNT(*) FROM hl_installations');
      console.log('📊 Total installations:', countResult.rows[0].count);
      
      // Get recent installations
      const recentResult = await pool.query(`
        SELECT id, location_id, agency_id, installation_type, 
               created_at, updated_at, status
        FROM hl_installations 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log('\n🕒 Recent installations:');
      console.log('========================');
      
      if (recentResult.rows.length === 0) {
        console.log('❌ No installations found.');
      } else {
        recentResult.rows.forEach((inst, i) => {
          const tokenType = inst.location_id ? 'LOCATION TOKEN' : 'AGENCY TOKEN';
          const tenantId = inst.location_id || inst.agency_id;
          
          console.log(`${i + 1}. Installation ID: ${inst.id}`);
          console.log(`   Token Type: ${tokenType}`);
          console.log(`   Tenant ID: ${tenantId}`);
          console.log(`   Status: ${inst.status || 'active'}`);
          console.log(`   Created: ${inst.created_at}`);
          console.log(`   Updated: ${inst.updated_at || 'N/A'}`);
          console.log('');
        });
        
        // Answer the user's question about the last installation
        const lastInstall = recentResult.rows[0];
        console.log('\n🎯 ANSWER TO YOUR QUESTION:');
        console.log('============================');
        
        if (lastInstall.location_id) {
          console.log('✅ Your last installation HAS a location token!');
          console.log(`   Location ID: ${lastInstall.location_id}`);
          console.log('   This token can access location-specific data.');
        } else if (lastInstall.agency_id) {
          console.log('⚠️  Your last installation has an AGENCY token.');
          console.log(`   Agency ID: ${lastInstall.agency_id}`);
          console.log('   To get a location token, you need to:');
          console.log('   1. Install the app directly to a specific location/sub-account');
          console.log('   2. Or use the agency token to make requests on behalf of locations');
        }
      }
    } else {
      console.log('❌ hl_installations table does not exist. Database migration may be needed.');
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

queryDatabase();