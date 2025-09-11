// Enhanced Tenant Introspection with Multiple Fallback Mechanisms
// This file contains improved logic to replace the failing /users/me introspection

const axios = require('axios');

// Console-based logging to avoid winston dependency issues
const logger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ''),
  debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta ? JSON.stringify(meta) : '')
};

/**
 * Enhanced tenant introspection with multiple fallback strategies
 * @param {string} accessToken - The HighLevel access token
 * @param {object} config - Configuration object with hlApiBase
 * @returns {Promise<{locationId: string|null, agencyId: string|null}>}
 */
async function discoverTenantInfo(accessToken, config) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Version': '2021-07-28',
    'Accept': 'application/json'
  };

  // Strategy 1: Try /users/me (current approach)
  try {
    logger.info('Attempting tenant discovery via /users/me');
    const response = await axios.get(`${config.hlApiBase}/users/me`, {
      headers,
      timeout: 10000
    });
    
    const locationId = response.data?.locationId || response.data?.location_id || null;
    const agencyId = response.data?.companyId || response.data?.company_id || 
                    response.data?.agencyId || response.data?.agency_id || null;
    
    if (locationId || agencyId) {
      logger.info('Tenant discovered via /users/me', { locationId, agencyId });
      return { locationId, agencyId };
    }
  } catch (error) {
    logger.warn('Strategy 1 (/users/me) failed:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
  }

  // Strategy 2: Try /locations endpoint (list accessible locations)
  try {
    logger.info('Attempting tenant discovery via /locations');
    const response = await axios.get(`${config.hlApiBase}/locations/`, {
      headers,
      timeout: 10000,
      params: { limit: 1 } // Just need one to identify context
    });
    
    const locations = response.data?.locations || response.data?.data || [];
    if (locations.length > 0) {
      const location = locations[0];
      const locationId = location.id || location._id || null;
      const agencyId = location.companyId || location.company_id || 
                      location.agencyId || location.agency_id || null;
      
      if (locationId || agencyId) {
        logger.info('Tenant discovered via /locations', { locationId, agencyId });
        return { locationId, agencyId };
      }
    }
  } catch (error) {
    logger.warn('Strategy 2 (/locations) failed:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
  }

  // Strategy 3: Try /companies endpoint (for agency-level tokens)
  try {
    logger.info('Attempting tenant discovery via /companies');
    const response = await axios.get(`${config.hlApiBase}/companies/`, {
      headers,
      timeout: 10000,
      params: { limit: 1 }
    });
    
    const companies = response.data?.companies || response.data?.data || [];
    if (companies.length > 0) {
      const company = companies[0];
      const agencyId = company.id || company._id || null;
      
      if (agencyId) {
        logger.info('Tenant discovered via /companies', { locationId: null, agencyId });
        return { locationId: null, agencyId };
      }
    }
  } catch (error) {
    logger.warn('Strategy 3 (/companies) failed:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
  }

  // Strategy 4: Try /oauth/userinfo endpoint (if available)
  try {
    logger.info('Attempting tenant discovery via /oauth/userinfo');
    const response = await axios.get(`${config.hlApiBase}/oauth/userinfo`, {
      headers,
      timeout: 10000
    });
    
    const locationId = response.data?.locationId || response.data?.location_id || null;
    const agencyId = response.data?.companyId || response.data?.company_id || 
                    response.data?.agencyId || response.data?.agency_id || null;
    
    if (locationId || agencyId) {
      logger.info('Tenant discovered via /oauth/userinfo', { locationId, agencyId });
      return { locationId, agencyId };
    }
  } catch (error) {
    logger.warn('Strategy 4 (/oauth/userinfo) failed:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
  }

  // Strategy 5: Try token introspection endpoint
  try {
    logger.info('Attempting tenant discovery via token introspection');
    const response = await axios.post(`${config.hlApiBase}/oauth/introspect`, 
      new URLSearchParams({ token: accessToken }).toString(), {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });
    
    const locationId = response.data?.locationId || response.data?.location_id || null;
    const agencyId = response.data?.companyId || response.data?.company_id || 
                    response.data?.agencyId || response.data?.agency_id || null;
    
    if (locationId || agencyId) {
      logger.info('Tenant discovered via token introspection', { locationId, agencyId });
      return { locationId, agencyId };
    }
  } catch (error) {
    logger.warn('Strategy 5 (token introspection) failed:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
  }

  // All strategies failed
  logger.error('All tenant discovery strategies failed');
  return { locationId: null, agencyId: null };
}

/**
 * Alternative approach: Parse tenant info from token payload (JWT)
 * @param {string} accessToken - The access token (if it's a JWT)
 * @returns {object|null} Decoded token payload or null
 */
function tryParseTokenPayload(accessToken) {
  try {
    // Check if token looks like a JWT (has 3 parts separated by dots)
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    // Decode the payload (middle part)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    const locationId = payload.locationId || payload.location_id || null;
    const agencyId = payload.companyId || payload.company_id || 
                    payload.agencyId || payload.agency_id || null;
    
    if (locationId || agencyId) {
      logger.info('Tenant info extracted from JWT token', { locationId, agencyId });
      return { locationId, agencyId };
    }
    
    return null;
  } catch (error) {
    logger.debug('Token is not a valid JWT or does not contain tenant info');
    return null;
  }
}

/**
 * Main function to replace the current introspection logic
 * @param {string} accessToken - The HighLevel access token
 * @param {object} config - Configuration object
 * @returns {Promise<{locationId: string|null, agencyId: string|null}>}
 */
async function enhancedTenantIntrospection(accessToken, config) {
  // First try to parse token payload if it's a JWT
  const jwtResult = tryParseTokenPayload(accessToken);
  if (jwtResult && (jwtResult.locationId || jwtResult.agencyId)) {
    return jwtResult;
  }
  
  // Fall back to API-based discovery
  return await discoverTenantInfo(accessToken, config);
}

module.exports = {
  enhancedTenantIntrospection,
  discoverTenantInfo,
  tryParseTokenPayload
};

// Usage example for replacing the current logic in oauth_server.js:
/*
const { enhancedTenantIntrospection } = require('./fix_tenant_introspection');

// Replace the current introspection block with:
if (!hadTenant || (!finalLocationId && !finalAgencyId)) {
  try {
    const discovered = await enhancedTenantIntrospection(tokens.access_token, config);
    finalLocationId = finalLocationId || discovered.locationId;
    finalAgencyId = finalAgencyId || discovered.agencyId;
  } catch (e) {
    logger.warn('Enhanced tenant introspection failed:', e.message);
  }
}
*/