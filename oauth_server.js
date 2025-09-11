#!/usr/bin/env node

/**
 * ============================================================
 * HighLevel OAuth Integration - OAuth Server
 * ============================================================
 * 
 * Updated: Force redeploy with environment variables
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
const cookieParser = require('cookie-parser');
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
app.use(cookieParser());

// Service fingerprinting
app.use((req, res, next) => {
  res.setHeader('X-App', 'oauth-server');
  res.setHeader('X-Commit', process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown');
  next();
});

// Service identification endpoint
app.get('/whoami', (req, res) => {
  res.json({
    app: 'oauth-server',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown',
    timestamp: new Date().toISOString(),
    version: '1.0.1'
  });
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
  let retryCount = 0;
  const maxRetries = 5;
  const retryDelay = 2000; // 2 seconds
  
  while (retryCount < maxRetries) {
    try {
      logger.info(`🔧 Starting database initialization (attempt ${retryCount + 1}/${maxRetries})...`);
      
      // Test database connection
      await db.query('SELECT NOW()');
      logger.info('✅ Database connection successful');
      
      // Create oauth_state table
      logger.info('Creating oauth_state table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS oauth_state (
          state        TEXT PRIMARY KEY,
          client_id    TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at   TIMESTAMPTZ NOT NULL
        );
      `);
      logger.info('✅ oauth_state table created/verified');
      
      // Create index for oauth_state
      logger.info('Creating oauth_state index...');
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state(expires_at);
      `);
      logger.info('✅ oauth_state index created/verified');
      
      // Create oauth_used_codes table
      logger.info('Creating oauth_used_codes table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS oauth_used_codes (
          code        TEXT PRIMARY KEY,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at  TIMESTAMPTZ NOT NULL
        );
      `);
      logger.info('✅ oauth_used_codes table created/verified');
      
      // Create index for oauth_used_codes
      logger.info('Creating oauth_used_codes index...');
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expires ON oauth_used_codes(expires_at);
      `);
      logger.info('✅ oauth_used_codes index created/verified');
      
      // Create hl_installations table
      logger.info('Creating hl_installations table...');
      await db.query(`
        CREATE TABLE IF NOT EXISTS hl_installations (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          location_id       TEXT,
          agency_id         TEXT,
          access_token      TEXT NOT NULL,
          refresh_token     TEXT NOT NULL,
          scopes            TEXT[] NOT NULL DEFAULT '{}',
          expires_at        TIMESTAMPTZ NOT NULL,
          installation_type TEXT DEFAULT 'location' CHECK (installation_type IN ('location', 'agency')),
          status            TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'error')),
          created_at        TIMESTAMPTZ DEFAULT now(),
          updated_at        TIMESTAMPTZ DEFAULT now(),
          last_token_refresh TIMESTAMPTZ DEFAULT now(),
          install_ip        INET,
          user_agent        TEXT,
          CONSTRAINT unique_location_install UNIQUE (location_id),
          CONSTRAINT unique_agency_install UNIQUE (agency_id),
          CONSTRAINT require_tenant_id CHECK (
            (location_id IS NOT NULL AND agency_id IS NULL) OR 
            (location_id IS NULL AND agency_id IS NOT NULL)
          )
        );
      `);
      logger.info('✅ hl_installations table created/verified');
      
      // Migration: Fix existing table schema if needed
      logger.info('Checking and migrating hl_installations schema...');
      try {
        // Check if location_id has NOT NULL constraint
        const constraintCheck = await db.query(`
          SELECT column_name, is_nullable 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'hl_installations' 
          AND column_name = 'location_id';
        `);
        
        if (constraintCheck.rows.length > 0 && constraintCheck.rows[0].is_nullable === 'NO') {
          logger.info('🔄 Migrating location_id to allow NULL values...');
          
          // Drop old unique constraint if exists
          await db.query(`
            ALTER TABLE hl_installations 
            DROP CONSTRAINT IF EXISTS hl_installations_location_id_key;
          `);
          
          // Remove NOT NULL constraint
          await db.query(`
            ALTER TABLE hl_installations 
            ALTER COLUMN location_id DROP NOT NULL;
          `);
          
          // Recreate unique constraint on location_id (for non-null values)
          await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS hl_installations_location_id_unique 
            ON hl_installations (location_id) 
            WHERE location_id IS NOT NULL;
          `);
          
          logger.info('✅ location_id migration completed');
        }
        
        // Ensure agency_id column exists
        const agencyIdCheck = await db.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'hl_installations' 
          AND column_name = 'agency_id';
        `);
        
        if (agencyIdCheck.rows.length === 0) {
          logger.info('➕ Adding missing agency_id column...');
          await db.query(`
            ALTER TABLE hl_installations 
            ADD COLUMN agency_id TEXT;
          `);
          logger.info('✅ agency_id column added');
        }
        
        // Ensure proper constraints exist
        await db.query(`
          ALTER TABLE hl_installations 
          DROP CONSTRAINT IF EXISTS require_tenant_id;
        `);
        
        await db.query(`
          ALTER TABLE hl_installations 
          ADD CONSTRAINT require_tenant_id CHECK (
            (location_id IS NOT NULL AND agency_id IS NULL) OR 
            (location_id IS NULL AND agency_id IS NOT NULL)
          );
        `);
        
        // Drop existing partial indexes if they exist
        await db.query(`
          DROP INDEX IF EXISTS hl_installations_location_id_unique;
        `);
        
        await db.query(`
          DROP INDEX IF EXISTS hl_installations_agency_id_unique;
        `);
        
        // Add proper unique constraints (not partial indexes)
        await db.query(`
          ALTER TABLE hl_installations 
          DROP CONSTRAINT IF EXISTS unique_location_install;
        `);
        
        await db.query(`
          ALTER TABLE hl_installations 
          DROP CONSTRAINT IF EXISTS unique_agency_install;
        `);
        
        // Create regular unique constraints (will work with ON CONFLICT)
        await db.query(`
          ALTER TABLE hl_installations 
          DROP CONSTRAINT IF EXISTS unique_location_install;
        `);
        
        await db.query(`
          ALTER TABLE hl_installations 
          DROP CONSTRAINT IF EXISTS unique_agency_install;
        `);
        
        await db.query(`
          ALTER TABLE hl_installations 
          ADD CONSTRAINT unique_location_install UNIQUE (location_id);
        `);
        
        await db.query(`
          ALTER TABLE hl_installations 
          ADD CONSTRAINT unique_agency_install UNIQUE (agency_id);
        `);
        
        // Run additional constraint fix to ensure proper setup
        const { fixConstraintsOnRailway } = require('./fix_constraints_railway.js');
        await fixConstraintsOnRailway();
        
        logger.info('✅ Schema migration completed successfully - MANUAL UPSERT VERSION 2025-01-11');
        
      } catch (migrationError) {
        logger.error('⚠️ Schema migration failed:', migrationError.message);
        // Don't fail startup, just log the error
      }
      
      // Create indexes for hl_installations
      logger.info('Creating hl_installations indexes...');
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_hl_installations_expires ON hl_installations(expires_at);
        CREATE INDEX IF NOT EXISTS idx_hl_installations_agency ON hl_installations(agency_id);
        CREATE INDEX IF NOT EXISTS idx_hl_installations_status ON hl_installations(status);
      `);
      logger.info('✅ hl_installations indexes created/verified');
      
      // Create mark_tokens_for_refresh function
      logger.info('Creating mark_tokens_for_refresh function...');
      await db.query(`
        CREATE OR REPLACE FUNCTION mark_tokens_for_refresh(hours_before_expiry INTEGER)
        RETURNS TABLE(tenant_id TEXT, expires_at TIMESTAMPTZ) AS $$
        BEGIN
          RETURN QUERY
          SELECT 
            location_id as tenant_id,
            hi.expires_at
          FROM hl_installations hi
          WHERE hi.status = 'active'
            AND hi.expires_at <= NOW() + (hours_before_expiry || ' hours')::INTERVAL
            AND (hi.last_token_refresh IS NULL OR hi.last_token_refresh < NOW() - INTERVAL '30 minutes');
        END;
        $$ LANGUAGE plpgsql;
      `);
      logger.info('✅ mark_tokens_for_refresh function created/verified');
      
      // Verify tables exist
      const result = await db.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('oauth_state', 'oauth_used_codes', 'hl_installations')
        ORDER BY table_name;
      `);
      
      const tables = result.rows.map(r => r.table_name);
      logger.info('📋 Verified tables exist:', tables);
      
      if (tables.length === 3) {
        logger.info('🎉 Database initialization completed successfully!');
        return; // Success, exit the retry loop
      } else {
        throw new Error(`Expected 3 tables, found ${tables.length}: ${tables.join(', ')}`);
      }
      
    } catch (error) {
      retryCount++;
      logger.error(`❌ Database initialization failed (attempt ${retryCount}/${maxRetries}):`, {
        message: error.message,
        code: error.code,
        sqlState: error.sqlState,
        detail: error.detail,
        hint: error.hint
      });
      
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        logger.error('💥 Cannot connect to database.');
        if (retryCount >= maxRetries) {
          logger.error('💥 Max retries reached. Exiting...');
          process.exit(1);
        }
      } else if (retryCount >= maxRetries) {
        logger.error('💥 Max retries reached for table creation. Starting server anyway...');
        return; // Don't exit, let server start
      }
      
      if (retryCount < maxRetries) {
        logger.info(`⏳ Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
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
    // AES-256-CBC requires exactly 32 bytes
    if (this.key.length > 32) {
      this.key = this.key.slice(0, 32);
    }
  }
  
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
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
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
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
      
      // Calculate expiry time with validation
      const validExpiresIn = tokens.expires_in && !isNaN(tokens.expires_in) ? tokens.expires_in : 3600;
      if (!tokens.expires_in || isNaN(tokens.expires_in)) {
        console.warn('Invalid expires_in in saveInstallation, using 3600 seconds default');
      }
      const expiresAt = new Date(Date.now() + (validExpiresIn * 1000));
      
      // Insert or update installation using manual upsert
      let result;
      
      if (locationId) {
        // Location-based installation - check if exists first
        const existing = await client.query(
          'SELECT id FROM hl_installations WHERE location_id = $1',
          [locationId]
        );
        
        if (existing.rows.length > 0) {
          // Update existing
          result = await client.query(
            `UPDATE hl_installations SET
               access_token = $2,
               refresh_token = $3,
               scopes = $4,
               expires_at = $5,
               updated_at = NOW(),
               last_token_refresh = NOW(),
               status = 'active'
             WHERE location_id = $1
             RETURNING id`,
            [
              locationId,
              encryptedAccessToken,
              encryptedRefreshToken,
              scopes,
              expiresAt
            ]
          );
        } else {
          // Insert new
          result = await client.query(
            `INSERT INTO hl_installations 
             (location_id, agency_id, access_token, refresh_token, scopes, expires_at, install_ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              locationId,
              agencyId,
              encryptedAccessToken,
              encryptedRefreshToken,
              scopes,
              expiresAt,
              installIp,
              userAgent
            ]
          );
        }
      } else {
        // Agency-based installation - check if exists first
        const existing = await client.query(
          'SELECT id FROM hl_installations WHERE agency_id = $1',
          [agencyId]
        );
        
        if (existing.rows.length > 0) {
          // Update existing
          result = await client.query(
            `UPDATE hl_installations SET
               access_token = $2,
               refresh_token = $3,
               scopes = $4,
               expires_at = $5,
               updated_at = NOW(),
               last_token_refresh = NOW(),
               status = 'active'
             WHERE agency_id = $1
             RETURNING id`,
            [
              agencyId,
              encryptedAccessToken,
              encryptedRefreshToken,
              scopes,
              expiresAt
            ]
          );
        } else {
          // Insert new
          result = await client.query(
            `INSERT INTO hl_installations 
             (location_id, agency_id, access_token, refresh_token, scopes, expires_at, install_ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              locationId,
              agencyId,
              encryptedAccessToken,
              encryptedRefreshToken,
              scopes,
              expiresAt,
              installIp,
              userAgent
            ]
          );
        }
      }
      
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
    
    // Validate and fix expires_in field
    if (!tokens.expires_in || isNaN(tokens.expires_in)) {
      console.warn('Invalid or missing expires_in in updateTokens, defaulting to 3600 seconds');
      tokens.expires_in = 3600;
    }
    
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
  
  // Agency/Company endpoints
  /^\/companies\/[\w-]+\/locations$/,
  /^\/agencies\/[\w-]+\/locations$/,
  /^\/companies\/[\w-]+$/,
  /^\/agencies\/[\w-]+$/,
  
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
  
  // Products and stores endpoints
  /^\/products/,
  /^\/stores/,
];

function isEndpointAllowed(endpoint) {
  return ALLOWED_ENDPOINTS.some(pattern => pattern.test(endpoint));
}

// Routes

// Health check
app.get('/health', async (req, res) => {
  // If create_tables parameter is provided, attempt table creation
  if (req.query.create_tables === 'true') {
    try {
      logger.info('Table creation requested via health endpoint');
      await initializeDatabase();
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        environment: config.nodeEnv,
        tables_created: true
      });
      return;
    } catch (error) {
      logger.error('Table creation failed via health endpoint:', error);
      res.status(500).json({ 
        status: 'error', 
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        environment: config.nodeEnv,
        tables_created: false,
        error: error.message
      });
      return;
    }
  }
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    environment: config.nodeEnv
  });
});

// Force table creation endpoint
app.get('/admin/create-tables', async (req, res) => {
  try {
    logger.info('Manual table creation requested');
    await initializeDatabase();
    res.json({ 
      status: 'success', 
      message: 'Tables created successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Manual table creation failed:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Force table creation endpoint (for debugging)
app.post('/admin/create-tables', async (req, res) => {
  try {
    logger.info('🔧 Manual table creation requested...');
    
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
    
    // Verify tables exist
    const result = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('oauth_state', 'oauth_used_codes')
      ORDER BY table_name;
    `);
    
    const tables = result.rows.map(r => r.table_name);
    logger.info('✅ Manual table creation completed:', tables);
    
    res.json({
      success: true,
      message: 'Tables created successfully',
      tables: tables,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('❌ Manual table creation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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

     // Set cookie fallback for state (belt-and-suspenders approach)
     res.cookie('hl_oauth_state', state, {
       httpOnly: true,
       secure: true,
       sameSite: 'lax',   // allows HL → your domain redirect to send cookie
       maxAge: 20 * 60 * 1000
     });
    
     // If caller asks for JSON (e.g., your CLI/tests), honor it; else 302 for browsers/Marketplace
     const wantsJson = 
       (req.get('accept') || '').includes('application/json') || 
       'json' in req.query;

     if (wantsJson) {
       return res.json({ authorize_url: auth.toString(), state });
     } else {
       return res.redirect(302, auth.toString());
     }
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
        
        // Fallback: if DB lookup missed, compare cookie
        if (!st && req.cookies?.hl_oauth_state === state) {
          logger.info('DB missed but cookie matched - using cookie fallback', { state: state?.substring(0, 8) + '...' });
          st = { clientId: config.hlClientId, redirect: config.redirectUri };
        }
        
        if (!st) {
          logger.warn('Invalid or expired state (Postgres)', { state: state?.substring(0, 8) + '...' });
          return res.status(400).json({ error: 'Invalid or expired state' });
        }
        logger.info('State verified with Postgres persistence', { state: state?.substring(0, 8) + '...' });
      } else {
        // Fallback to legacy in-memory storage
        st = loadState(state);
        if (!st) {
          logger.warn('Invalid or expired state (legacy)', { state: state?.substring(0, 8) + '...' });
          return res.status(400).json({ error: 'Invalid or expired state' });
        }
        logger.info('State verified with legacy in-memory storage', { state: state?.substring(0, 8) + '...' });
      }
      
      // Clear cookie on success path
      res.clearCookie('hl_oauth_state', { httpOnly: true, secure: true, sameSite: 'lax' });
      
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

      // Auto-detect user_type with fallback mechanism
        const locIdHint = location_id || null;
        const agIdHint = company_id || agency_id || null;
        
        // Build a preferred order to try - use HighLevel's correct user_type values
        let tryOrder = [];
        if (locIdHint) {
          // Try location-based types first (HighLevel uses 'Location' for locations)
          tryOrder = ['Location', 'Agency'];
        } else if (agIdHint) {
          // Try agency-based types first (HighLevel uses 'Agency' for agencies/companies)
          tryOrder = ['Agency', 'Location'];
        } else {
          // No hints; try all possible values starting with most common
          tryOrder = ['Location', 'Agency'];
        }

        // Token exchange with fallback
        async function postToken(userType) {
          const params = new URLSearchParams();
          params.set('client_id', config.hlClientId);
          params.set('client_secret', config.hlClientSecret);
          params.set('grant_type', 'authorization_code');
          params.set('code', code);
          params.set('redirect_uri', config.redirectUri);
          params.set('user_type', userType);
          
          console.log('TOKEN EXCHANGE ATTEMPT:', {
            user_type: userType,
            endpoint: `${config.hlApiBase}/oauth/token`
          });
          
          const response = await axios.post(`${config.hlApiBase}/oauth/token`, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
          });
          
          return response.data;
        }
        
        async function exchangeCodeWithFallback() {
          let lastErr;
          for (const userType of tryOrder) {
            try {
              return await postToken(userType);
            } catch (e) {
              const status = e?.response?.status;
              // If this looks like a user_type mismatch, try the other one
              // 400: Bad Request, 401: Unauthorized, 422: Unprocessable Entity (invalid enum)
              const likelyMismatch = status === 400 || status === 401 || status === 422;
              if (!likelyMismatch) throw e;
              lastErr = e;
              console.log(`Token exchange failed for user_type=${userType} (status ${status}), trying next...`);
            }
          }
          throw lastErr || new Error('Token exchange failed for all user types');
        }

        let tokens;

        try {
          // Token exchange with fallback mechanism
          tokens = await exchangeCodeWithFallback();
          console.log(`Token exchange succeeded with tryOrder: ${tryOrder}`);
          
          // LOG THE ACTUAL TOKEN RESPONSE TO SEE WHAT FIELDS ARE AVAILABLE
          console.log('FULL TOKEN RESPONSE:', JSON.stringify(tokens, null, 2));
          
          // Validate and fix expires_in field
          if (!tokens.expires_in || isNaN(tokens.expires_in)) {
            console.warn('Invalid or missing expires_in, defaulting to 3600 seconds (1 hour)');
            tokens.expires_in = 3600; // Default to 1 hour
          }
          
        } catch (err) {
          const status = err.response?.status || 500;
          const data = err.response?.data;
          console.error('TOKEN EXCHANGE ERROR', {
            status,
            data,
            tryOrder,
            had: {
              location_id: !!location_id,
              company_id: !!company_id,
              agency_id: !!agency_id,
            }
          });
          return res.status(status).json({ error: 'OAuth callback failed', detail: data || err.message });
        }
        
        // Mark code as used after successful exchange
        markUsed(code);
      const scopes = tokens.scope ? tokens.scope.split(' ') : [];

      // After we have tokens, first check if tenant info is in the token response
      let finalLocationId = locIdHint || tokens.locationId || tokens.location_id;
      let finalAgencyId = agIdHint || tokens.companyId || tokens.company_id || tokens.agencyId || tokens.agency_id;
      
      console.log('TENANT INFO CHECK:', {
        fromUrlParams: { locIdHint, agIdHint },
        fromTokens: { 
          locationId: tokens.locationId, 
          location_id: tokens.location_id,
          companyId: tokens.companyId,
          company_id: tokens.company_id,
          agencyId: tokens.agencyId,
          agency_id: tokens.agency_id
        },
        final: { finalLocationId, finalAgencyId }
      });
      
      // If we still don't have tenant info, use enhanced introspection as fallback
      if (!finalLocationId && !finalAgencyId) {
        try {
          const { enhancedTenantIntrospection } = require('./fix_tenant_introspection');
          const discovered = await enhancedTenantIntrospection(tokens.access_token, config);
          finalLocationId = discovered.locationId;
          finalAgencyId = discovered.agencyId;
          logger.info('Enhanced tenant introspection result:', { finalLocationId, finalAgencyId });
        } catch (e) {
          logger.warn('Enhanced tenant introspection failed:', e.message);
          // Fallback to basic /users/me as last resort
          try {
            const me = await axios.get(`${config.hlApiBase}/users/me`, {
              headers: { 
                'Authorization': `Bearer ${tokens.access_token}`,
                'Version': '2021-07-28'
              },
              timeout: 12000
            }).then(r => r.data);
            finalLocationId = me.locationId || me.location_id || null;
            finalAgencyId = me.companyId || me.agencyId || me.company_id || me.agency_id || null;
          } catch (fallbackError) {
            logger.warn('Fallback /users/me also failed:', fallbackError.message);
          }
        }
      }
       
      // Validate that we have at least one tenant identifier
      if (!finalLocationId && !finalAgencyId) {
        logger.error('OAuth callback failed: No tenant identifier found', {
          fromUrlParams: { locIdHint, agIdHint },
          fromTokens: { 
            locationId: tokens.locationId, 
            location_id: tokens.location_id,
            companyId: tokens.companyId,
            company_id: tokens.company_id,
            agencyId: tokens.agencyId,
            agency_id: tokens.agency_id
          }
        });
        return res.status(400).json({
          error: 'OAuth callback failed',
          detail: 'Unable to determine tenant identifier (location_id or agency_id) from OAuth response'
        });
      }
       
       if (finalLocationId) {
         // Optional: fetch parent agency for future-proofing
         let parentAgencyId = finalAgencyId;
         try {
           const locMeta = await axios.get(`${config.hlApiBase}/locations/${finalLocationId}`, {
             headers: { 
               'Authorization': `Bearer ${tokens.access_token}`,
               'Version': '2021-07-28'
             },
             timeout: 12000
           }).then(r => r.data);
           parentAgencyId = parentAgencyId || locMeta?.companyId || locMeta?.agencyId || null;
         } catch {}
         
         // Store location installation
         await saveInstallation({
           installation_scope: 'location',
           location_id: finalLocationId,
           agency_id: parentAgencyId,
           access_token: tokens.access_token,
           refresh_token: tokens.refresh_token,
           expires_at: tokens.expires_at || new Date(Date.now() + 3600000).toISOString(),
           scopes: scopes.join(' ')
         }, req);
         
         return res.status(200).send(`
           <html><head><title>Location Connected</title></head>
           <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
             <h2>✅ Location Connected Successfully</h2>
             <p>You can close this window.</p>
             <script>setTimeout(() => window.close(), 2000);</script>
           </body></html>
         `);
       }
       
       if (finalAgencyId) {
         // Store agency installation
         await saveInstallation({
           installation_scope: 'agency',
           agency_id: finalAgencyId,
           access_token: tokens.access_token,
           refresh_token: tokens.refresh_token,
           expires_at: tokens.expires_at || new Date(Date.now() + 3600000).toISOString(),
           scopes: scopes.join(' ')
         }, req);
         
         return res.status(200).send(`
           <html><head><title>Agency Connected</title></head>
           <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
             <h2>✅ Agency Connected Successfully</h2>
             <p>You can close this window.</p>
             <script>setTimeout(() => window.close(), 2000);</script>
           </body></html>
         `);
       }
       
       // Still nothing? Clear, actionable error
       return res.status(202).json({
         error: 'Missing tenant identifier',
         detail: 'OAuth succeeded but tenant could not be inferred. Please reinstall and select a Location or Agency.'
       });
       
       logger.debug({ 
         triedUserTypes: tryOrder, 
         selected: tokens.user_type || 'unknown', 
         meSeen: !!me?.id, 
         loc: !!finalLocationId, 
         ag: !!finalAgencyId 
       });

    } catch (error) {
      logger.error('OAuth callback error (V2):', error);
      return res.status(500).json({
        error: 'OAuth callback failed',
        detail: error.message
      });
    }
  });

  // Helper function to save installation
  async function saveInstallation(installData, req) {
    const { installation_scope, location_id, agency_id, access_token, refresh_token, expires_at, scopes } = installData;
    
    // Use existing InstallationDB.saveInstallation method
    return await InstallationDB.saveInstallation(
      location_id,
      agency_id,
      { access_token, refresh_token, expires_at, scope: scopes },
      scopes.split(' '),
      req
    );
  }
} else {
  // Only register V1 when V2 is OFF (legacy behavior)
  // V1 legacy handler removed - V2 handler at line 944 is the active implementation
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
        
        // Validate expires_in for audit log
        const validExpiresIn = newTokens.expires_in && !isNaN(newTokens.expires_in) ? newTokens.expires_in : 3600;
        
        await auditLog(installation.id, 'token_refresh', {
          old_expires_at: installation.expires_at,
          new_expires_at: new Date(Date.now() + (validExpiresIn * 1000))
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

// Force database initialization endpoint
app.get('/admin/init-db', async (req, res) => {
  try {
    logger.info('🔧 Database initialization requested via endpoint...');
    await initializeDatabase();
    res.json({ 
      status: 'success', 
      message: 'Database initialized successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Database initialization failed via endpoint:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize database and start server
(async () => {
  try {
    logger.info('Starting database initialization...');
    await initializeDatabase();
    logger.info('Database initialization completed successfully');
    
    const server = app.listen(config.port, () => {
      logger.info(`🚀 OAuth Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Redirect URI: ${config.redirectUri}`);
      logger.info(`Commit SHA: ${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown'}`);
    });
  } catch (error) {
    logger.error('Failed to initialize server:', {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    
    // Try to start server anyway but log the issue
    logger.warn('Starting server despite initialization failure - tables may need manual creation');
    
    const server = app.listen(config.port, () => {
      logger.info(`🚀 OAuth Server running on port ${config.port} (with initialization warnings)`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Redirect URI: ${config.redirectUri}`);
      logger.info(`Commit SHA: ${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown'}`);
    });
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