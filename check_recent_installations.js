#!/usr/bin/env node

const axios = require('axios');
const jwt = require('jsonwebtoken');

async function checkRecentInstallations() {
  try {
    // Generate S2S token with proper claims
    const token = jwt.sign({
      iss: 'ops-cli',
      aud: 'oauth-server',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
    }, process.env.S2S_SHARED_SECRET || 'fallback');
    
    console.log('🔍 Fetching recent installations...');
    
    const response = await axios.get('https://api.engageautomations.com/admin/installations', {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      timeout: 10000
    });
    
    const installations = response.data;
    
    if (installations.length === 0) {
      console.log('❌ No installations found.');
      return;
    }
    
    console.log(`\n📊 Found ${installations.length} total installations`);
    console.log('\n🕒 Most Recent Installations:');
    console.log('================================');
    
    // Show last 5 installations
    const recent = installations.slice(-5).reverse();
    
    recent.forEach((inst, i) => {
      const tokenType = inst.location_id ? 'LOCATION TOKEN' : 'AGENCY TOKEN';
      const tenantId = inst.location_id || inst.agency_id;
      const status = inst.status || 'unknown';
      
      console.log(`${i + 1}. Installation ID: ${inst.id}`);
      console.log(`   Token Type: ${tokenType}`);
      console.log(`   Tenant ID: ${tenantId}`);
      console.log(`   Status: ${status}`);
      console.log(`   Created: ${inst.created_at}`);
      console.log(`   Updated: ${inst.updated_at || 'N/A'}`);
      console.log('');
    });
    
    // Show the very latest installation details
    const latest = installations[installations.length - 1];
    console.log('🎯 YOUR MOST RECENT INSTALLATION:');
    console.log('==================================');
    console.log(`Token Type: ${latest.location_id ? 'LOCATION TOKEN' : 'AGENCY TOKEN'}`);
    console.log(`Tenant ID: ${latest.location_id || latest.agency_id}`);
    console.log(`Status: ${latest.status || 'active'}`);
    console.log(`Scopes: ${latest.scopes || 'N/A'}`);
    console.log(`Created: ${latest.created_at}`);
    
    if (latest.location_id) {
      console.log('\n✅ You have a LOCATION token!');
      console.log(`   Location ID: ${latest.location_id}`);
      if (latest.agency_id) {
        console.log(`   Parent Agency ID: ${latest.agency_id}`);
      }
    } else {
      console.log('\n🏢 You have an AGENCY token.');
      console.log(`   Agency ID: ${latest.agency_id}`);
      console.log('\n❓ To get a location token, you would need to:');
      console.log('   1. Install the app to a specific location/sub-account');
      console.log('   2. Or use the agency token to access location data (if scopes allow)');
    }
    
  } catch (error) {
    console.error('❌ Error fetching installations:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n🔑 Authentication failed. Check S2S_SHARED_SECRET environment variable.');
    }
  }
}

checkRecentInstallations();