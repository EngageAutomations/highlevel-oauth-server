#!/usr/bin/env node

const { Pool } = require('pg');

async function checkTableSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Checking hl_installations table schema...');
    
    // Get table columns
    const schemaResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'hl_installations' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📋 Current table columns:');
    console.log('=========================');
    schemaResult.rows.forEach(col => {
      console.log(`- ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });
    
    // Try to get installations with available columns only
    console.log('\n🔍 Querying existing installations...');
    const installResult = await pool.query(`
      SELECT id, location_id, agency_id, scopes, expires_at, 
             status, created_at, updated_at, last_token_refresh
      FROM hl_installations 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log(`\n📊 Found ${installResult.rows.length} installations`);
    
    if (installResult.rows.length > 0) {
      console.log('\n🕒 Recent installations:');
      console.log('========================');
      
      installResult.rows.forEach((inst, i) => {
        // Determine token type based on which ID is present
        const tokenType = inst.location_id ? 'LOCATION TOKEN' : 'AGENCY TOKEN';
        const tenantId = inst.location_id || inst.agency_id;
        
        console.log(`${i + 1}. Installation ID: ${inst.id}`);
        console.log(`   Token Type: ${tokenType}`);
        console.log(`   Tenant ID: ${tenantId}`);
        console.log(`   Status: ${inst.status || 'active'}`);
        console.log(`   Scopes: ${inst.scopes || 'N/A'}`);
        console.log(`   Created: ${inst.created_at}`);
        console.log(`   Expires: ${inst.expires_at}`);
        console.log('');
      });
      
      // Answer the user's question
      const lastInstall = installResult.rows[0];
      console.log('\n🎯 ANSWER TO YOUR QUESTION:');
      console.log('============================');
      
      if (lastInstall.location_id) {
        console.log('✅ Your last installation HAS a location token!');
        console.log(`   Location ID: ${lastInstall.location_id}`);
        console.log('   This token can access location-specific data like:');
        console.log('   - Contacts for this location');
        console.log('   - Opportunities for this location');
        console.log('   - Calendars for this location');
        console.log('   - Location settings and users');
      } else if (lastInstall.agency_id) {
        console.log('⚠️  Your last installation has an AGENCY token.');
        console.log(`   Agency ID: ${lastInstall.agency_id}`);
        console.log('\n   To get a LOCATION token, you have two options:');
        console.log('   \n   Option 1: Install directly to a location');
        console.log('   - Go to a specific sub-account/location in HighLevel');
        console.log('   - Install your app from that location\'s marketplace');
        console.log('   - This will create a location-specific token');
        console.log('   \n   Option 2: Use agency token with location context');
        console.log('   - Your agency token can make requests on behalf of locations');
        console.log('   - Include the location ID in your API requests');
        console.log('   - Example: /contacts?locationId=<LOCATION_ID>');
      }
    } else {
      console.log('❌ No installations found in the database.');
      console.log('   You may need to install your app from the HighLevel marketplace first.');
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    if (error.code === '42P01') {
      console.log('   The hl_installations table does not exist.');
      console.log('   You may need to run the database migration first.');
    }
  } finally {
    await pool.end();
  }
}

checkTableSchema();