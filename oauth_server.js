#!/usr/bin/env node

/**
 * ============================================================
 * HighLevel OAuth Integration - OAuth Server
 * ============================================================
 * 
 * This server handles:
 * - HighLevel Marketplace OAuth installations
 * - Token exchange and secure storage
 * - Token refresh automation
 * - Secure proxy API to HighLevel
 * - Service-to-service authentication
 * 
 * Security Features:
 * - AES-256 token encryption at rest
 * - JWT-based service-to-service auth
 * - Endpoint allow-listing for proxy
 * - Rate limiting and request validation
 * - Comprehensive audit logging
 * 
 * Environment Variables Required:
 * - HL_CLIENT_ID: HighLevel app client ID
 * - HL_CLIENT_SECRET: HighLevel app client secret
 * - REDIRECT_URI: OAuth callback URL
 * - DATABASE_URL: PostgreSQL connection string
 * - ENCRYPTION_KEY: Base64 encoded encryption key (32+ bytes)
 * - S2S_SHARED_SECRET: Service-to-service JWT secret
 * - NODE_ENV: Environment (development/production)
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
// const rateLimit = require('express-rate-limit'); // Removed - not needed for oauth server
const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const winston = require('winston');
const { promisify } = require('util');

// OAuth State Persistence Kit - Import helpers
const { createState, consumeState, markCodeUsed, isCodeUsed, cleanupExpired } = require('./helpers/oauthStore.js');

// Feature flag helper
const ff = (k) => process.env[k] === '1';

// Legacy code deduplication (kept for backward compatibility)
const usedCodes = new Map(); // code -> expiresAt
const markUsed = (code, ms = 5 * 60 * 1000) => usedCodes.set(code, Date.now() + ms);
const isUsed = (code) => {
  const t = usedCodes.get(code);
  if (!t) return false;
  if (Date.now() > t) { usedCodes.delete(code); return false; }
  return true;
};

// State verification to prevent client/redirect mismatches
const stateStore = new Map(); // state -> {clientId, redirect, exp}
const saveState = (state, data, ttlMs) => stateStore.set(state, {...data, exp: Date.now() + ttlMs});
const loadState = (state) => {
  const v = stateStore.get(state);
  if (!v) return null;
  if (Date.now() > v.exp) { stateStore.delete(state); return null; }
  return v;
};

// Cleanup expired codes every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, expiresAt] of usedCodes.entries()) {
    if (now > expiresAt) {
      usedCodes.delete(code);
    }
  }
}, 10 * 60 * 1000);

// Configuration
const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // HighLevel OAuth
  hlClientId: process.env.HL_CLIENT_ID,
  hlClientSecret: process.env.HL_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
  
  // Database
  databaseUrl: process.env.DATABASE_URL,
  
  // Security
  encryptionKey: process.env.ENCRYPTION_KEY,
  s2sSecret: process.env.S2S_SHARED_SECRET,
  
  // HighLevel API
  hlApiBase: 'https://services.leadconnectorhq.com',
  hlAuthBase: 'https://marketplace.leadconnectorhq.com'
};

// Validate required environment variables
const requiredEnvVars = [
  'HL_CLIENT_ID', 'HL_CLIENT_SECRET', 'REDIRECT_URI',
  'DATABASE_URL', 'ENCRYPTION_KEY', 'S2S_SHARED_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize Express app
const app = express();

// Trust proxy for Railway deployment
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: config.nodeEnv === 'production' ? false : true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Service fingerprinting
app.use((req, res, next) => {
  res.setHeader('X-App', 'oauth-server');
  res.setHeader('X-Commit', process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown');
  next();
});

// Service identification endpoint
app.get('/whoami', (req, res) => {
  res.json({ app: 'oauth-server', commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown' });
});

// Feature flags endpoint for runtime configuration visibility
app.get('/feature-flags', (req, res) => {
  res.json({
    OAUTH_CALLBACK_V2: process.env.OAUTH_CALLBACK_V2,
    OAUTH_CALLBACK_LOG: process.env.OAUTH_CALLBACK_LOG,
    OAUTH_STATE_PERSISTENCE: process.env.OAUTH_STATE_PERSISTENCE,
    STATE_TTL_MIN: process.env.STATE_TTL_MIN,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'
  });
});

// Rate limiting (temporarily disabled for debugging)
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: config.nodeEnv === 'production' ? 100 : 1000, // requests per window
//   message: { error: 'Too many requests, please try again later' },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// app.use(limiter);

// Stricter rate limiting for sensitive endpoints (temporarily disabled for debugging)
// const strictLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 20,
//   message: { error: 'Rate limit exceeded for sensitive endpoint' }
// });

// Logger setup
const logger = winston.createLogger({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'oauth-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Database connection
const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database and create tables
async function initializeDatabase() {
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    logger.info('Database connected successfully');
    
    // Create OAuth tables if they don't exist
    logger.info('Creating OAuth tables if needed...');
    
    // Create oauth_state table
    await db.query(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state        TEXT PRIMARY KEY,
        client_id    TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      );
    `);
    
    // Create index for oauth_state
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
    `);
    
    // Create oauth_used_codes table
    await db.query(`
      CREATE TABLE IF NOT EXISTS oauth_used_codes (
        code        TEXT PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
    `);
    
    // Create index for oauth_used_codes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);
    `);
    
    logger.info('✅ OAuth tables ready');
  } catch (error) {
    if (error.message.includes('connection')) {
      logger.error('Database connection failed:', error);
      process.exit(1);
    } else {
      logger.error('Failed to create OAuth tables:', {
        error: error.message,
        stack: error.stack,
        code: error.code
      });
      // Don\'t exit - but this is a serious issue
      throw error;
    }
  }
}

// Database initialization will be called before server starts

// Encryption utilities
class TokenEncryption {
  constructor(key) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length < 32) {
      throw new Error('Encryption key must be at least 32 bytes');
    }
  }
  
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.key);
    cipher.setAutoPadding(true);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }
  
  decrypt(encryptedText) {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipher('aes-256-cbc', this.key);
    decipher.setAutoPadding(true);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

const tokenEncryption = new TokenEncryption(config.encryptionKey);

// JWT utilities
function generateS2SToken(payload) {
  return jwt.sign({
    iss: 'oauth-server',
    aud: 'api-server',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    ...payload
  }, config.s2sSecret);
}

function verifyS2SToken(token) {
  try {
    return jwt.verify(token, config.s2sSecret);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// S2S Authentication middleware
function authenticateS2S(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const payload = verifyS2SToken(token);
    req.auth = payload;
    next();
  } catch (error) {
    logger.warn('S2S authentication failed:', { error: error.message, ip: req.ip });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Audit logging
async function auditLog(installationId, eventType, eventData, req) {
  try {
    await db.query(
      `INSERT INTO hl_audit_log (installation_id, event_type, event_data, ip_address, user_agent, endpoint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        installationId,
        eventType,
        JSON.stringify(eventData),
        req.ip,
        req.get('User-Agent'),
        req.originalUrl
      ]
    );
  } catch (error) {
    logger.error('Audit logging failed:', error);
  }
}

// HighLevel API client
class HighLevelAPI {
  static async exchangeCodeForTokens(code, locationId, agencyId) {
    // Determine user_type based on which ID is provided
    // HighLevel expects 'Location' or 'Company' (capitalized)
    const userType = locationId ? 'Location' : 'Company';
    
    const tokenData = {
      client_id: config.hlClientId,
      client_secret: config.hlClientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: config.redirectUri,
      user_type: userType
    };

    try {
      
      const response = await axios.post(`${config.hlApiBase}/oauth/token`, 
        new URLSearchParams(tokenData).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      logger.error('TOKEN EXCHANGE ERROR', {
        status,
        data,
        sent: tokenData ? new URLSearchParams(tokenData).toString() : 'tokenData not available',
        error: error.message,
        locationId,
        agencyId,
        url: `${config.hlApiBase}/oauth/token`
      });
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }
  
  static async refreshToken(refreshToken) {
    try {
      const body = new URLSearchParams({
        client_id: config.hlClientId,
        client_secret: config.hlClientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString();
      const response = await axios.post(
        `${config.hlApiBase}/oauth/token`,
        body,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000
        }
      );
      return response.data;
    } catch (error) {
      logger.error('Token refresh failed:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error('Failed to refresh access token');
    }
  }
  
  static async makeAPICall(accessToken, method, endpoint, data = null, headers = {}) {
    try {
      const response = await axios({
        method,
        url: `${config.hlApiBase}${endpoint}`,
        data,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 30000
      });
      
      return response;
    } catch (error) {
      logger.error('HighLevel API call failed:', {
        method,
        endpoint,
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }
}

// Database operations
class InstallationDB {
  static async saveInstallation(locationId, agencyId, tokens, scopes, req) {
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Encrypt tokens
      const encryptedAccessToken = tokenEncryption.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokenEncryption.encrypt(tokens.refresh_token);
      
      // Calculate expiry time
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
      
      // Insert or update installation
      const result = await client.query(
        `INSERT INTO hl_installations 
         (location_id, agency_id, access_token, refresh_token, scopes, expires_at, install_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (location_id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           scopes = EXCLUDED.scopes,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW(),
           last_token_refresh = NOW(),
           status = 'active'
         RETURNING id`,
        [
          locationId,
          agencyId,
          encryptedAccessToken,
          encryptedRefreshToken,
          scopes,
          expiresAt,
          req.ip,
          req.get('User-Agent')
        ]
      );
      
      const installationId = result.rows[0].id;
      
      await client.query('COMMIT');
      
      // Audit log
      await auditLog(installationId, 'install', {
        location_id: locationId,
        agency_id: agencyId,
        scopes: scopes,
        expires_at: expiresAt
      }, req);
      
      return installationId;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  static async getInstallation(locationId, agencyId) {
    const query = locationId 
      ? 'SELECT * FROM hl_installations WHERE location_id = $1 AND status = $2'
      : 'SELECT * FROM hl_installations WHERE agency_id = $1 AND status = $2';
    
    const result = await db.query(query, [locationId || agencyId, 'active']);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const installation = result.rows[0];
    
    // Decrypt tokens
    try {
      installation.access_token = tokenEncryption.decrypt(installation.access_token);
      installation.refresh_token = tokenEncryption.decrypt(installation.refresh_token);
    } catch (error) {
      logger.error('Token decryption failed:', { installationId: installation.id });
      throw new Error('Token decryption failed');
    }
    
    return installation;
  }
  
  static async updateTokens(installationId, tokens) {
    const encryptedAccessToken = tokenEncryption.encrypt(tokens.access_token);
    const encryptedRefreshToken = tokenEncryption.encrypt(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    
    await db.query(
      `UPDATE hl_installations 
       SET access_token = $1, refresh_token = $2, expires_at = $3, 
           last_token_refresh = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [encryptedAccessToken, encryptedRefreshToken, expiresAt, installationId]
    );
  }
  
  static async revokeInstallation(locationId, agencyId) {
    const query = locationId
      ? 'UPDATE hl_installations SET status = $1, updated_at = NOW() WHERE location_id = $2'
      : 'UPDATE hl_installations SET status = $1, updated_at = NOW() WHERE agency_id = $2';
    
    await db.query(query, ['revoked', locationId || agencyId]);
  }
}

// Endpoint allow-list for proxy
const ALLOWED_ENDPOINTS = [
  // Location endpoints
  /^\/locations\/[\w-]+$/,
  /^\/locations\/[\w-]+\/contacts/,
  /^\/locations\/[\w-]+\/opportunities/,
  /^\/locations\/[\w-]+\/calendars/,
  /^\/locations\/[\w-]+\/users/,
  /^\/locations\/[\w-]+\/custom-fields/,
  /^\/locations\/[\w-]+\/tags/,
  /^\/locations\/[\w-]+\/workflows/,
  
  // Contact endpoints
  /^\/contacts\/[\w-]+$/,
  /^\/contacts\/[\w-]+\/notes/,
  /^\/contacts\/[\w-]+\/tasks/,
  /^\/contacts\/[\w-]+\/appointments/,
  
  // Opportunity endpoints
  /^\/opportunities\/[\w-]+$/,
  /^\/opportunities\/[\w-]+\/notes/,
  
  // Calendar endpoints
  /^\/calendars\/[\w-]+\/events/,
  /^\/calendars\/[\w-]+\/slots/,
];

function isEndpointAllowed(endpoint) {
  return ALLOWED_ENDPOINTS.some(pattern => pattern.test(endpoint));
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    environment: config.nodeEnv
  });
});



// Version endpoint (no auth)
app.get('/version', (req, res) => {
  res.json({
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv
  });
});

// Metrics endpoint (S2S authenticated)
app.get('/metrics', authenticateS2S, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM hl_installation_metrics');
    const metrics = result.rows[0] || {};
    
    res.json({
      ...metrics,
      server_uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Metrics query failed:', error);
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// Tripwire logger (earliest)
app.use((req, res, next) => {
  if (req.path === '/oauth/callback') {
    console.log('TRIPWIRE: reached app-level for /oauth/callback', {
      url: req.originalUrl,
      v2: ff('OAUTH_CALLBACK_V2'),
      v1: !ff('OAUTH_CALLBACK_V2')
    });
  }
  next();
});

// OAuth start endpoint - generates consistent authorize URLs
app.get('/oauth/start', async (req, res) => {
  try {
    const clientId = config.hlClientId;
    const redirect = config.redirectUri;
    const scopes = (process.env.HL_SCOPES || '').split(',').map(s => s.trim()).join(' ');
    
    // Use the "choose location" authorize URL from HL docs
    const auth = new URL('https://marketplace.leadconnectorhq.com/choose-location');
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirect);
    if (scopes) auth.searchParams.set('scope', scopes);
    
    // Generate state for verification
    const state = crypto.randomBytes(12).toString('base64url');
    auth.searchParams.set('state', state);
    
    // Store state using Postgres-backed persistence (errorfix2)
     if (ff('OAUTH_STATE_PERSISTENCE')) {
       await createState(state, { clientId, redirect }, 10 * 60 * 1000);
       logger.info('OAuth state created with Postgres persistence', { state: state.substring(0, 8) + '...' });
     } else {
       // Fallback to legacy in-memory storage
       saveState(state, { clientId, redirect }, 10 * 60 * 1000);
       logger.info('OAuth state created with legacy in-memory storage', { state: state.substring(0, 8) + '...' });
     }
    
     res.json({ authorize_url: auth.toString() });
   } catch (error) {
     logger.error('Error in /oauth/start endpoint', { error: error.message, stack: error.stack });
     res.status(500).json({ error: 'Internal server error' });
   }
 });

// STRICT: if V2 is on, do NOT register V1 at all.
if (ff('OAUTH_CALLBACK_V2')) {
  app.get('/oauth/callback', async (req, res) => {
    console.log('HANDLER: V2 main entered', { query: { ...req.query, code: '[redacted]' } });
    try {
      const { code, state, location_id, company_id, agency_id } = req.query;

      if (!code) return res.status(400).json({ error: 'Missing required parameter: code' });
      
      // Verify state using Postgres-backed persistence (errorfix2)
      let st;
      if (ff('OAUTH_STATE_PERSISTENCE')) {
        st = await consumeState(state);
        if (!st) {
          logger.warn('Invalid or expired state (Postgres)', { state: state?.substring(0, 8) + '...' });
          return res.status(400).json({ error: 'Invalid or expired state' });
        }
        logger.info('State verified with Postgres persistence', { state: state.substring(0, 8) + '...' });
      } else {
        // Fallback to legacy in-memory storage
        st = loadState(state);
        if (!st) {
          logger.warn('Invalid or expired state (legacy)', { state: state?.substring(0, 8) + '...' });
          return res.status(400).json({ error: 'Invalid or expired state' });
        }
        logger.info('State verified with legacy in-memory storage', { state: state.substring(0, 8) + '...' });
      }
      
      // Sanity check - helps catch common mismatch
      if (st.clientId !== config.hlClientId || st.redirect !== config.redirectUri) {
        logger.error('Client/redirect mismatch vs. authorize state', { 
          expected: { clientId: config.hlClientId, redirect: config.redirectUri },
          actual: { clientId: st.clientId, redirect: st.redirect }
        });
        return res.status(400).json({ error: 'Client/redirect mismatch vs. authorize state' });
      }
      
      // Check for code reuse using Postgres-backed deduplication (errorfix2)
      if (ff('OAUTH_STATE_PERSISTENCE')) {
        const codeUsed = await isCodeUsed(code);
        if (codeUsed) {
          logger.warn('CODE REUSE DETECTED (Postgres)', { code: code.substring(0, 10) + '...' });
          return res.status(409).json({ error: 'Auth code already used' });
        }
        // Mark code as used immediately
        await markCodeUsed(code, 5 * 60 * 1000); // 5 minute TTL
        logger.info('Code marked as used (Postgres)', { code: code.substring(0, 10) + '...' });
      } else {
        // Fallback to legacy in-memory code deduplication
        if (isUsed(code)) {
          logger.warn('CODE REUSE DETECTED (legacy)', { code: code.substring(0, 10) + '...' });
          return res.status(409).json({ error: 'Auth code already used' });
        }
        // Mark code as used immediately
        markUsed(code, 5 * 60 * 1000); // 5 minute TTL
        logger.info('Code marked as used (legacy)', { code: code.substring(0, 10) + '...' });
      }

      // Robust approach: exchange code first, then introspect if tenant missing
        const hadTenant = !!(location_id || company_id || agency_id);
        const hasLocation = Boolean(location_id);
        const hasCompany = Boolean(company_id || agency_id);
        
        // Pick the correct user_type exactly as HighLevel expects (lowercase)
        let userType = hasLocation ? 'location' : (hasCompany ? 'company' : undefined);

        const createTokenForm = (type) => {
          const params = new URLSearchParams();
          params.set('client_id', config.hlClientId);
          params.set('client_secret', config.hlClientSecret);
          params.set('grant_type', 'authorization_code');
          params.set('code', code);
          params.set('redirect_uri', config.redirectUri);
          
          // Only set user_type if it's a valid enum value (lowercase)
          if (type === 'location' || type === 'company') {
            params.set('user_type', type);
          }
          return params;
        };

        let tokens;
        let attempted = [];
        
        const attemptTokenExchange = async (ut) => {
          attempted.push(ut);
          const formData = createTokenForm(ut);
          console.log('TOKEN EXCHANGE ATTEMPT:', {
            user_type: ut,
            form_params: Object.fromEntries(formData.entries()),
            endpoint: `${config.hlApiBase}/oauth/token`
          });
          const response = await axios.post(`${config.hlApiBase}/oauth/token`, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
          });
          return response.data;
        };

        try {
          if (userType) {
            // We have a hint, try it first
            tokens = await attemptTokenExchange(userType);
          } else {
            // No tenant hint, try location first
            try {
              tokens = await attemptTokenExchange('location');
              userType = 'location';
            } catch (e1) {
              const isInvalidGrant = (e1.response?.status === 400 || e1.response?.status === 401) && 
                String(e1.response?.data?.error || e1.response?.data || '').includes('invalid_grant');
              if (!isInvalidGrant) throw e1;
              
              // Try company
              tokens = await attemptTokenExchange('company');
              userType = 'company';
            }
          }
        } catch (err) {
          const status = err.response?.status || 500;
          const data = err.response?.data;
          console.error('TOKEN EXCHANGE ERROR', {
            status,
            data,
            sending: {
              endpoint: `${config.hlApiBase}/oauth/token`,
              user_type: userType || attempted.join(','),
              redirect_uri: config.redirectUri,
            },
            had: {
              location_id: !!location_id,
              company_id: !!company_id,
              agency_id: !!agency_id,
            }
          });
          // Return the actual status code from HighLevel instead of always 500
          return res.status(status).json({ error: 'OAuth callback failed', detail: data || err.message });
        }
        
        // Mark code as used after successful exchange
        markUsed(code);
      const scopes = tokens.scope ? tokens.scope.split(' ') : [];

      // Discover tenant via /users/me introspection
       let finalLocationId = location_id || null;
       let finalAgencyId = company_id || agency_id || null;
       
       if (!hadTenant || (!finalLocationId && !finalAgencyId)) {
         try {
           const me = await axios.get(`${config.hlApiBase}/users/me`, {
             headers: { Authorization: `Bearer ${tokens.access_token}` },
             timeout: 15000
           });
           
           // Prefer query params if present, else use introspected values
           finalLocationId = finalLocationId || me.data?.locationId || null;
           finalAgencyId = finalAgencyId || me.data?.companyId || me.data?.agencyId || null;
         } catch (e) {
           logger.warn('Tenant introspection failed:', e.response?.data || e.message);
         }
       }
       
       // Final check: if still no tenant after introspection
       if (!finalLocationId && !finalAgencyId) {
         return res.status(202).json({
           error: 'Missing tenant identifier',
           detail: 'Provider did not supply tenant info; please re-install and explicitly choose Agency or a Location.'
         });
       }

      // Save installation with discovered tenant
       const installationId = await InstallationDB.saveInstallation(
         finalLocationId,
         finalAgencyId,
         tokens,
         scopes,
         req
       );

       logger.info('OAuth installation successful (V2)', {
         installationId,
         locationId: finalLocationId,
         agencyId: finalAgencyId,
         scopes,
         hadTenant,
         userType
       });

      return res.send('✅ Connected (V2). You can close this window.');
    } catch (err) {
      logger.error('V2 callback handler error:', err);
      return res.status(500).json({ error: 'OAuth callback failed', detail: err.message });
    }
  });
} else {
  // Only register V1 when V2 is OFF (legacy behavior)
  app.get('/oauth/callback', (req, res) => {
    console.log('HANDLER: V1 legacy entered', { query: { ...req.query, code: '[redacted]' } });
    const { code, location_id } = req.query;
    if (!code || !location_id) {
      return res.status(400).json({ error: 'Missing required parameters: code and location_id' });
    }
    // Legacy flow would go here - but we're keeping V2 enabled
    return res.status(500).json({ error: 'V1 legacy handler should not be active' });
  });
}

// Ultimate catch-all to prove ordering
app.all('/oauth/callback', (req, res) => {
  console.error('FALLBACK: reached catch-all after handlers. Route ordering wrong.', {
    query: { ...req.query, code: '[redacted]' }
  });
  return res.status(500).json({ error: 'Misrouted: catch-all hit after expected handlers' });
});

// Proxy endpoint for HighLevel API calls
app.post('/proxy/hl', authenticateS2S, async (req, res) => {
  const { method, endpoint, data, headers = {} } = req.body;
  const { location_id, agency_id } = req.auth;
  
  if (!method || !endpoint) {
    return res.status(400).json({ error: 'Missing method or endpoint' });
  }
  
  if (!location_id && !agency_id) {
    return res.status(400).json({ error: 'Missing location_id or agency_id in token' });
  }
  
  // Check endpoint allow-list
  if (!isEndpointAllowed(endpoint)) {
    logger.warn('Blocked disallowed endpoint access', {
      endpoint,
      locationId: location_id,
      agencyId: agency_id,
      ip: req.ip
    });
    return res.status(403).json({ error: 'Endpoint not allowed' });
  }
  
  try {
    // Get installation and tokens
    const installation = await InstallationDB.getInstallation(location_id, agency_id);
    
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }
    
    // Check if token needs refresh
    const now = new Date();
    const expiresAt = new Date(installation.expires_at);
    const refreshThreshold = new Date(now.getTime() + (5 * 60 * 1000)); // 5 minutes
    
    let accessToken = installation.access_token;
    
    if (expiresAt <= refreshThreshold) {
      logger.info('Refreshing access token', { installationId: installation.id });
      
      try {
        const newTokens = await HighLevelAPI.refreshToken(installation.refresh_token);
        await InstallationDB.updateTokens(installation.id, newTokens);
        accessToken = newTokens.access_token;
        
        await auditLog(installation.id, 'token_refresh', {
          old_expires_at: installation.expires_at,
          new_expires_at: new Date(Date.now() + (newTokens.expires_in * 1000))
        }, req);
        
      } catch (refreshError) {
        logger.error('Token refresh failed:', {
          installationId: installation.id,
          error: refreshError.message
        });
        
        await auditLog(installation.id, 'error', {
          type: 'token_refresh_failed',
          error: refreshError.message
        }, req);
        
        return res.status(401).json({ error: 'Token refresh failed' });
      }
    }
    
    // Make API call to HighLevel
    const response = await HighLevelAPI.makeAPICall(
      accessToken,
      method,
      endpoint,
      data,
      headers
    );
    
    // Audit log successful API call
    await auditLog(installation.id, 'api_call', {
      method,
      endpoint,
      status_code: response.status
    }, req);
    
    res.status(response.status).json(response.data);
    
  } catch (error) {
    logger.error('Proxy request failed:', {
      method,
      endpoint,
      error: error.message,
      status: error.response?.status
    });
    
    const status = error.response?.status || 500;
    const errorData = error.response?.data || { error: 'Proxy request failed' };
    
    res.status(status).json(errorData);
  }
});

// Admin endpoint - list installations (S2S authenticated)
app.get('/admin/installations', authenticateS2S, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, location_id, agency_id, scopes, expires_at, installation_type, 
              status, created_at, updated_at, last_token_refresh
       FROM hl_installations 
       ORDER BY created_at DESC
       LIMIT 100`
    );
    
    res.json(result.rows);
  } catch (error) {
    logger.error('Failed to retrieve installations:', error);
    res.status(500).json({ error: 'Failed to retrieve installations' });
  }
});

// Disconnect/revoke installation
app.post('/oauth/disconnect', /* strictLimiter, */ async (req, res) => {
  const { location_id, agency_id } = req.body;
  
  if (!location_id && !agency_id) {
    return res.status(400).json({ error: 'Missing location_id or agency_id' });
  }
  
  try {
    await InstallationDB.revokeInstallation(location_id, agency_id);
    
    logger.info('Installation revoked', {
      locationId: location_id,
      agencyId: agency_id,
      ip: req.ip
    });
    
    res.json({ success: true, message: 'Installation revoked successfully' });
    
  } catch (error) {
    logger.error('Failed to revoke installation:', {
      error: error.message,
      locationId: location_id,
      Agencyid: agency_id
    });
    
    res.status(500).json({ error: 'Failed to revoke installation' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    db.end(() => {
      logger.info('Database connections closed');
      process.exit(0);
    });
  });
});

// Initialize database and start server
(async () => {
  try {
    await initializeDatabase();
    
    const server = app.listen(config.port, () => {
      logger.info(`🚀 OAuth Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Redirect URI: ${config.redirectUri}`);
      logger.info(`Commit SHA: ${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown'}`);
    });
  } catch (error) {
    logger.error('Failed to initialize server:', error);
    process.exit(1);
  }
})();

// Background token refresh job (runs every hour)
setInterval(async () => {
  try {
    const result = await db.query(
      'SELECT * FROM mark_tokens_for_refresh(1)' // 1 hour before expiry
    );
    
    for (const row of result.rows) {
      try {
        const installation = await InstallationDB.getInstallation(
          row.tenant_id.startsWith('loc_') ? row.tenant_id : null,
          row.tenant_id.startsWith('ag_') ? row.tenant_id : null
        );
        
        if (installation) {
          const newTokens = await HighLevelAPI.refreshToken(installation.refresh_token);
          await InstallationDB.updateTokens(installation.id, newTokens);
          
          logger.info('Background token refresh successful', {
            installationId: installation.id,
            tenantId: row.tenant_id
          });
        }
      } catch (error) {
        logger.error('Background token refresh failed:', {
          tenantId: row.tenant_id,
          error: error.message
        });
      }
    }
  } catch (error) {
    logger.error('Background token refresh job failed:', error);
  }
}, 60 * 60 * 1000); // Every hour

module.exports = app;