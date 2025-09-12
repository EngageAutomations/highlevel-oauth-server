#!/usr/bin/env node

const { Pool } = require('pg');

async function queryInstallations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔍 Querying installation statistics...');
    
    // Get installation type breakdown
    const typeStats = await pool.query(`
      SELECT 
        installation_type,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM hl_installations 
      WHERE status = 'active'
      GROUP BY installation_type 
      ORDER BY count DESC
    `);
    
    console.log('\n📊 Installation Type Statistics:');
    console.log('================================');
    
    if (typeStats.rows.length === 0) {
      console.log('No installations found.');
    } else {
      typeStats.rows.forEach(row => {
        console.log(`${row.installation_type}: ${row.count} (${row.percentage}%)`);
      });
    }
    
    // Get total count
    const totalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_installations,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_installations,
        COUNT(CASE WHEN installation_type = 'agency' THEN 1 END) as agency_installs,
        COUNT(CASE WHEN installation_type = 'location' THEN 1 END) as location_installs
      FROM hl_installations
    `);
    
    const stats = totalStats.rows[0];
    console.log('\n📈 Overall Statistics:');
    console.log('======================');
    console.log(`Total Installations: ${stats.total_installations}`);
    console.log(`Active Installations: ${stats.active_installations}`);
    console.log(`Agency Installations: ${stats.agency_installs}`);
    console.log(`Location Installations: ${stats.location_installs}`);
    
    if (stats.total_installations > 0) {
      const agencyPercentage = ((stats.agency_installs / stats.total_installations) * 100).toFixed(2);
      const locationPercentage = ((stats.location_installs / stats.total_installations) * 100).toFixed(2);
      console.log(`\n📊 Breakdown:`);
      console.log(`Agency: ${agencyPercentage}%`);
      console.log(`Location: ${locationPercentage}%`);
    }
    
  } catch (error) {
    console.error('❌ Error querying database:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

queryInstallations();