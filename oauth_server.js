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
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const winston = require('winston');
const { promisify } = require('util');

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.nodeEnv === 'production' ? 100 : 1000, // requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Stricter rate limiting for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Rate limit exceeded for sensitive endpoint' }
});

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

// Test database connection
db.query('SELECT NOW()', (err, result) => {
  if (err) {
    logger.error('Database connection failed:', err);
    process.exit(1);
  }
  logger.info('Database connected successfully');
});

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
    try {
      // Determine user_type based on which ID is provided
      const userType = locationId ? 'location' : 'company';
      
      const tokenData = {
        client_id: config.hlClientId,
        client_secret: config.hlClientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config.redirectUri,
        user_type: userType
      };
      
      const response = await axios.post(`${config.hlApiBase}/oauth/token`, 
        new URLSearchParams(tokenData).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      logger.error('Token exchange failed:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        locationId,
        agencyId
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

// Read feature flags for OAuth behavior (safe defaults)
const OAUTH_CALLBACK_V2 = process.env.OAUTH_CALLBACK_V2 === '1';
const OAUTH_CALLBACK_LOG = process.env.OAUTH_CALLBACK_LOG === '1';
// Force redeploy to pick up env vars

// OAuth callback
app.get('/oauth/callback', strictLimiter, async (req, res) => {
  // Debug logging if enabled
  if (OAUTH_CALLBACK_LOG) {
    const safeQuery = { ...req.query };
    if (typeof safeQuery.code === 'string' && safeQuery.code.length) {
      safeQuery.code = '[redacted]';
    }
    logger.info('CALLBACK DEBUG', {
      originalUrl: req.originalUrl,
      method: req.method,
      query: safeQuery,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
        'x-forwarded-for': req.headers['x-forwarded-for']
      }
    });
  }

  // Feature-flagged behavior: V1 (legacy) vs V2 (robust)
  if (!OAUTH_CALLBACK_V2) {
    try {
      const { code, location_id } = req.query;
      if (!code || !location_id) {
        return res.status(400).json({ error: 'Missing required parameters: code and location_id' });
      }
      // Exchange and store for location installs only (legacy behavior)
      const tokens = await HighLevelAPI.exchangeCodeForTokens(code, location_id, null);
      const scopes = tokens.scope ? tokens.scope.split(' ') : [];
      await InstallationDB.saveInstallation(location_id, null, tokens, scopes, req);
      return res.send('✅ Connected (V1). You can close this window.');
    } catch (error) {
      logger.error('OAuth callback (V1) failed:', {
        error: error.message,
        data: error.response?.data,
        query: req.query,
        ip: req.ip
      });
      return res.status(500).json({ error: 'OAuth callback failed', detail: error.response?.data || error.message });
    }
  }

  // ===== V2 (new, robust logic) =====
  try {
    const { code, location_id, agency_id, company_id } = req.query;
    if (!code) {
      logger.warn('OAuth callback missing code parameter', { query: req.query, ip: req.ip });
      return res.status(400).json({ error: 'Missing required parameter: code', got: req.query });
    }

    // Decide user_type + tenant key
    let locationId = location_id || null;
    let companyId = company_id || agency_id || null; // HighLevel expects 'company' for agency installs

    // Exchange the code for tokens
    const tokens = await HighLevelAPI.exchangeCodeForTokens(code, locationId, companyId);
    const scopes = tokens.scope ? tokens.scope.split(' ') : [];

    // Optional: best-effort tenant introspection if none present
    if (!locationId && !companyId && tokens.access_token) {
      try {
        const me = await axios.get(`${config.hlApiBase}/users/me`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          timeout: 15000
        });
        companyId = me.data?.companyId || me.data?.agencyId || companyId || null;
        locationId = me.data?.locationId || locationId || null;
      } catch (e) {
        logger.warn('Tenant introspection failed:', e.response?.data || e.message);
      }
    }

    // If still no tenant, accept but ask for explicit re-install
    if (!locationId && !companyId) {
      return res.status(202).send('Connected, but tenant not provided. Please re-install choosing Agency or Location explicitly.');
    }

    // Save installation
    const installationId = await InstallationDB.saveInstallation(
      locationId,
      companyId,
      tokens,
      scopes,
      req
    );

    logger.info('OAuth installation successful (V2)', {
      installationId,
      locationId,
      agencyId: companyId,
      scopes
    });

    return res.send('✅ Connected to HighLevel (V2). You can close this window.');
  } catch (error) {
    logger.error('OAuth callback (V2) failed:', {
      error: error.message,
      data: error.response?.data,
      query: req.query,
      ip: req.ip
    });
    return res.status(500).json({ error: 'OAuth callback failed', detail: error.response?.data || error.message });
  }
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
app.post('/oauth/disconnect', strictLimiter, async (req, res) => {
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

// Start server
const server = app.listen(config.port, () => {
  logger.info(`🚀 OAuth Server running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Redirect URI: ${config.redirectUri}`);
  logger.info(`Commit SHA: ${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown'}`);
});

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