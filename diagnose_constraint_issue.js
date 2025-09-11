#!/usr/bin/env node

/**
 * ON CONFLICT Constraint Diagnostic Script
 * 
 * This script connects to Railway PostgreSQL and performs a comprehensive
 * analysis of the hl_installations table to identify the root cause of
 * the "no unique or exclusion constraint matching the ON CONFLICT specification" error.
 */

const { Client } = require('pg');
require('dotenv').config();

async function diagnoseConstraintIssue() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL environment variable not found');
    console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE')));
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('🔍 Connected to Railway PostgreSQL for constraint analysis\n');

    // 1. Examine table structure
    console.log('=== 1. TABLE STRUCTURE ANALYSIS ===');
    const tableStructure = await client.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'hl_installations'
      ORDER BY ordinal_position;
    `);
    
    console.log('📋 hl_installations table columns:');
    tableStructure.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });

    // 2. List all constraints
    console.log('\n=== 2. CONSTRAINT ANALYSIS ===');
    const constraints = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(c.oid) as constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'hl_installations'
      ORDER BY contype, conname;
    `);

    console.log('🔒 Constraints on hl_installations:');
    if (constraints.rows.length === 0) {
      console.log('  ⚠️  NO CONSTRAINTS FOUND - This might be the problem!');
    } else {
      constraints.rows.forEach(row => {
        const typeMap = {
          'p': 'PRIMARY KEY',
          'u': 'UNIQUE',
          'f': 'FOREIGN KEY',
          'c': 'CHECK'
        };
        console.log(`  - ${row.constraint_name} (${typeMap[row.constraint_type] || row.constraint_type}): ${row.constraint_definition}`);
      });
    }

    // 3. List all indexes
    console.log('\n=== 3. INDEX ANALYSIS ===');
    const indexes = await client.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'hl_installations'
      ORDER BY indexname;
    `);

    console.log('📊 Indexes on hl_installations:');
    if (indexes.rows.length === 0) {
      console.log('  ⚠️  NO INDEXES FOUND');
    } else {
      indexes.rows.forEach(row => {
        console.log(`  - ${row.indexname}: ${row.indexdef}`);
      });
    }

    // 4. Check for duplicate data on potential natural keys
    console.log('\n=== 4. DUPLICATE DATA ANALYSIS ===');
    
    // Check if location_id column exists and has duplicates
    const locationIdCheck = await client.query(`
      SELECT COUNT(*) as total_rows
      FROM hl_installations;
    `);
    console.log(`📈 Total rows in table: ${locationIdCheck.rows[0].total_rows}`);

    // Check for duplicates on location_id (if it exists)
    try {
      const locationDupes = await client.query(`
        SELECT location_id, COUNT(*) as count
        FROM hl_installations
        WHERE location_id IS NOT NULL
        GROUP BY location_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10;
      `);
      
      if (locationDupes.rows.length > 0) {
        console.log('🚨 DUPLICATE location_id values found:');
        locationDupes.rows.forEach(row => {
          console.log(`  - location_id: ${row.location_id} (${row.count} duplicates)`);
        });
      } else {
        console.log('✅ No duplicate location_id values found');
      }
    } catch (err) {
      console.log(`⚠️  location_id column check failed: ${err.message}`);
    }

    // Check for duplicates on external_id (if it exists)
    try {
      const externalDupes = await client.query(`
        SELECT external_id, COUNT(*) as count
        FROM hl_installations
        WHERE external_id IS NOT NULL
        GROUP BY external_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10;
      `);
      
      if (externalDupes.rows.length > 0) {
        console.log('🚨 DUPLICATE external_id values found:');
        externalDupes.rows.forEach(row => {
          console.log(`  - external_id: ${row.external_id} (${row.count} duplicates)`);
        });
      } else {
        console.log('✅ No duplicate external_id values found');
      }
    } catch (err) {
      console.log(`⚠️  external_id column check failed: ${err.message}`);
    }

    // Check for duplicates on provider + location_id combination
    try {
      const providerLocationDupes = await client.query(`
        SELECT provider, location_id, COUNT(*) as count
        FROM hl_installations
        WHERE provider IS NOT NULL AND location_id IS NOT NULL
        GROUP BY provider, location_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 10;
      `);
      
      if (providerLocationDupes.rows.length > 0) {
        console.log('🚨 DUPLICATE (provider, location_id) combinations found:');
        providerLocationDupes.rows.forEach(row => {
          console.log(`  - provider: ${row.provider}, location_id: ${row.location_id} (${row.count} duplicates)`);
        });
      } else {
        console.log('✅ No duplicate (provider, location_id) combinations found');
      }
    } catch (err) {
      console.log(`⚠️  (provider, location_id) combination check failed: ${err.message}`);
    }

    // 5. Sample some actual data
    console.log('\n=== 5. SAMPLE DATA ===');
    const sampleData = await client.query(`
      SELECT *
      FROM hl_installations
      ORDER BY id DESC
      LIMIT 3;
    `);
    
    if (sampleData.rows.length > 0) {
      console.log('📄 Sample records (latest 3):');
      sampleData.rows.forEach((row, index) => {
        console.log(`  Record ${index + 1}:`);
        Object.keys(row).forEach(key => {
          let value = row[key];
          if (typeof value === 'string' && value.length > 50) {
            value = value.substring(0, 50) + '...';
          }
          console.log(`    ${key}: ${value}`);
        });
        console.log('');
      });
    } else {
      console.log('📄 No data found in table');
    }

    // 6. Diagnosis summary
    console.log('\n=== 6. DIAGNOSIS SUMMARY ===');
    
    const hasConstraints = constraints.rows.length > 0;
    const hasUniqueConstraints = constraints.rows.some(row => row.constraint_type === 'u');
    const hasPrimaryKey = constraints.rows.some(row => row.constraint_type === 'p');
    
    console.log('🔍 Analysis Results:');
    console.log(`  - Table exists: ✅`);
    console.log(`  - Has constraints: ${hasConstraints ? '✅' : '❌'}`);
    console.log(`  - Has unique constraints: ${hasUniqueConstraints ? '✅' : '❌'}`);
    console.log(`  - Has primary key: ${hasPrimaryKey ? '✅' : '❌'}`);
    console.log(`  - Total rows: ${locationIdCheck.rows[0].total_rows}`);
    
    if (!hasConstraints) {
      console.log('\n🚨 ROOT CAUSE IDENTIFIED:');
      console.log('   The table has NO CONSTRAINTS defined!');
      console.log('   ON CONFLICT requires a unique constraint or primary key to work.');
      console.log('   This explains why "no unique or exclusion constraint matching" error occurs.');
    } else if (!hasUniqueConstraints && !hasPrimaryKey) {
      console.log('\n🚨 ROOT CAUSE IDENTIFIED:');
      console.log('   The table has constraints but NO UNIQUE constraints or PRIMARY KEY!');
      console.log('   ON CONFLICT requires a unique constraint to target.');
    } else {
      console.log('\n🤔 CONSTRAINTS EXIST - Need to check ON CONFLICT syntax:');
      console.log('   The table has proper constraints. The issue might be:');
      console.log('   1. ON CONFLICT targeting wrong columns');
      console.log('   2. ON CONFLICT syntax not matching actual constraint names');
      console.log('   3. Partial indexes or conditional constraints');
    }

  } catch (error) {
    console.error('❌ Error during constraint analysis:', error);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the diagnostic
if (require.main === module) {
  console.log('🚀 Starting ON CONFLICT Constraint Diagnostic...\n');
  diagnoseConstraintIssue()
    .then(() => {
      console.log('\n✅ Diagnostic completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Diagnostic failed:', error);
      process.exit(1);
    });
}

module.exports = { diagnoseConstraintIssue };