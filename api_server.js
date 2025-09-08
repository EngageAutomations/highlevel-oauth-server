#!/usr/bin/env node

/**
 * ============================================================
 * HighLevel OAuth Integration - API Server
 * ============================================================
 * 
 * This server handles:
 * - Business workflow implementations
 * - Client-facing API endpoints
 * - Integration with OAuth server for HighLevel access
 * - Custom business logic and data processing
 * - Webhook handling from HighLevel
 * 
 * Security Features:
 * - JWT-based service-to-service authentication
 * - Request validation and sanitization
 * - Rate limiting per client
 * - Comprehensive logging and monitoring
 * - No direct token storage (relies on OAuth server)
 * 
 * Environment Variables Required:
 * - OAUTH_BASE_URL: OAuth server base URL
 * - S2S_SHARED_SECRET: Service-to-service JWT secret
 * - DEFAULT_SCOPE: Default HighLevel API scope
 * - NODE_ENV: Environment (development/production)
 * - DATABASE_URL: Optional local database for business data
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const winston = require('winston');
const { body, param, query, validationResult } = require('express-validator');
const crypto = require('crypto');

// Configuration
const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // OAuth Server integration
  oauthBaseUrl: process.env.OAUTH_BASE_URL,
  s2sSecret: process.env.S2S_SHARED_SECRET,
  defaultScope: process.env.DEFAULT_SCOPE || 'locations/read contacts/read',
  
  // Optional local database
  databaseUrl: process.env.DATABASE_URL,
  
  // Webhook verification
  webhookSecret: process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')
};

// Validate required environment variables
const requiredEnvVars = ['OAUTH_BASE_URL', 'S2S_SHARED_SECRET'];

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
  max: config.nodeEnv === 'production' ? 200 : 1000, // requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Stricter rate limiting for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
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
  defaultMeta: { service: 'api-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// JWT utilities for S2S communication
function generateS2SToken(payload) {
  return jwt.sign({
    iss: 'api-server',
    aud: 'oauth-server',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    ...payload
  }, config.s2sSecret);
}

// OAuth Server API client
class OAuthServerAPI {
  static async makeProxyRequest(locationId, agencyId, method, endpoint, data = null, headers = {}) {
    try {
      const token = generateS2SToken({
        location_id: locationId,
        agency_id: agencyId
      });
      
      const response = await axios.post(`${config.oauthBaseUrl}/proxy/hl`, {
        method,
        endpoint,
        data,
        headers
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      return response;
    } catch (error) {
      logger.error('OAuth server proxy request failed:', {
        method,
        endpoint,
        error: error.message,
        status: error.response?.status,
        locationId,
        agencyId
      });
      throw error;
    }
  }
  
  static async getInstallations() {
    try {
      const token = generateS2SToken({});
      
      const response = await axios.get(`${config.oauthBaseUrl}/admin/installations`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get installations from OAuth server:', error);
      throw error;
    }
  }
  
  static async getMetrics() {
    try {
      const token = generateS2SToken({});
      
      const response = await axios.get(`${config.oauthBaseUrl}/metrics`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get metrics from OAuth server:', error);
      throw error;
    }
  }
}

// HighLevel API wrapper with business logic
class HighLevelService {
  constructor(locationId, agencyId) {
    this.locationId = locationId;
    this.agencyId = agencyId;
  }
  
  async getLocation() {
    const endpoint = `/locations/${this.locationId}`;
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'GET',
      endpoint
    );
    return response.data;
  }
  
  async getContacts(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/locations/${this.locationId}/contacts${queryString ? '?' + queryString : ''}`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'GET',
      endpoint
    );
    return response.data;
  }
  
  async createContact(contactData) {
    const endpoint = `/locations/${this.locationId}/contacts`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'POST',
      endpoint,
      contactData
    );
    return response.data;
  }
  
  async updateContact(contactId, updateData) {
    const endpoint = `/contacts/${contactId}`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'PUT',
      endpoint,
      updateData
    );
    return response.data;
  }
  
  async getOpportunities(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/locations/${this.locationId}/opportunities${queryString ? '?' + queryString : ''}`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'GET',
      endpoint
    );
    return response.data;
  }
  
  async createOpportunity(opportunityData) {
    const endpoint = `/locations/${this.locationId}/opportunities`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'POST',
      endpoint,
      opportunityData
    );
    return response.data;
  }
  
  async getCalendars() {
    const endpoint = `/locations/${this.locationId}/calendars`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'GET',
      endpoint
    );
    return response.data;
  }
  
  async createAppointment(calendarId, appointmentData) {
    const endpoint = `/calendars/${calendarId}/events`;
    
    const response = await OAuthServerAPI.makeProxyRequest(
      this.locationId,
      this.agencyId,
      'POST',
      endpoint,
      appointmentData
    );
    return response.data;
  }
}

// Validation middleware
function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
}

// Tenant validation middleware
function validateTenant(req, res, next) {
  const { location_id, agency_id } = req.params;
  
  if (!location_id && !agency_id) {
    return res.status(400).json({ error: 'Missing location_id or agency_id' });
  }
  
  req.tenant = {
    locationId: location_id,
    agencyId: agency_id
  };
  
  next();
}

// Webhook signature verification
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-hl-signature'];
  const payload = JSON.stringify(req.body);
  
  if (!signature) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(payload)
    .digest('hex');
  
  if (signature !== `sha256=${expectedSignature}`) {
    logger.warn('Invalid webhook signature', { signature, ip: req.ip });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  next();
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    environment: config.nodeEnv,
    oauth_server: config.oauthBaseUrl
  });
});

// Get location information
app.get('/api/locations/:location_id',
  param('location_id').isString().notEmpty(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const location = await service.getLocation();
      
      res.json(location);
    } catch (error) {
      logger.error('Get location failed:', {
        locationId: req.tenant.locationId,
        error: error.message
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to get location',
        message: error.message
      });
    }
  }
);

// Get contacts
app.get('/api/locations/:location_id/contacts',
  param('location_id').isString().notEmpty(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  query('query').optional().isString(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const contacts = await service.getContacts(req.query);
      
      res.json(contacts);
    } catch (error) {
      logger.error('Get contacts failed:', {
        locationId: req.tenant.locationId,
        error: error.message
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to get contacts',
        message: error.message
      });
    }
  }
);

// Create contact
app.post('/api/locations/:location_id/contacts',
  param('location_id').isString().notEmpty(),
  body('firstName').isString().notEmpty(),
  body('lastName').optional().isString(),
  body('email').optional().isEmail(),
  body('phone').optional().isString(),
  body('tags').optional().isArray(),
  body('customFields').optional().isObject(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const contact = await service.createContact(req.body);
      
      logger.info('Contact created successfully', {
        locationId: req.tenant.locationId,
        contactId: contact.id
      });
      
      res.status(201).json(contact);
    } catch (error) {
      logger.error('Create contact failed:', {
        locationId: req.tenant.locationId,
        error: error.message,
        contactData: req.body
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to create contact',
        message: error.message
      });
    }
  }
);

// Update contact
app.put('/api/contacts/:contact_id',
  param('contact_id').isString().notEmpty(),
  body('locationId').isString().notEmpty(),
  validateRequest,
  async (req, res) => {
    try {
      const { locationId, ...updateData } = req.body;
      const service = new HighLevelService(locationId, null);
      const contact = await service.updateContact(req.params.contact_id, updateData);
      
      logger.info('Contact updated successfully', {
        locationId,
        contactId: req.params.contact_id
      });
      
      res.json(contact);
    } catch (error) {
      logger.error('Update contact failed:', {
        contactId: req.params.contact_id,
        error: error.message
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to update contact',
        message: error.message
      });
    }
  }
);

// Get opportunities
app.get('/api/locations/:location_id/opportunities',
  param('location_id').isString().notEmpty(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  query('status').optional().isString(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const opportunities = await service.getOpportunities(req.query);
      
      res.json(opportunities);
    } catch (error) {
      logger.error('Get opportunities failed:', {
        locationId: req.tenant.locationId,
        error: error.message
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to get opportunities',
        message: error.message
      });
    }
  }
);

// Create opportunity
app.post('/api/locations/:location_id/opportunities',
  param('location_id').isString().notEmpty(),
  body('title').isString().notEmpty(),
  body('contactId').isString().notEmpty(),
  body('status').optional().isString(),
  body('value').optional().isNumeric(),
  body('source').optional().isString(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const opportunity = await service.createOpportunity(req.body);
      
      logger.info('Opportunity created successfully', {
        locationId: req.tenant.locationId,
        opportunityId: opportunity.id
      });
      
      res.status(201).json(opportunity);
    } catch (error) {
      logger.error('Create opportunity failed:', {
        locationId: req.tenant.locationId,
        error: error.message,
        opportunityData: req.body
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to create opportunity',
        message: error.message
      });
    }
  }
);

// Get calendars
app.get('/api/locations/:location_id/calendars',
  param('location_id').isString().notEmpty(),
  validateRequest,
  validateTenant,
  async (req, res) => {
    try {
      const service = new HighLevelService(req.tenant.locationId, req.tenant.agencyId);
      const calendars = await service.getCalendars();
      
      res.json(calendars);
    } catch (error) {
      logger.error('Get calendars failed:', {
        locationId: req.tenant.locationId,
        error: error.message
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to get calendars',
        message: error.message
      });
    }
  }
);

// Create appointment
app.post('/api/calendars/:calendar_id/appointments',
  param('calendar_id').isString().notEmpty(),
  body('locationId').isString().notEmpty(),
  body('contactId').isString().notEmpty(),
  body('startTime').isISO8601(),
  body('endTime').isISO8601(),
  body('title').isString().notEmpty(),
  validateRequest,
  async (req, res) => {
    try {
      const { locationId, ...appointmentData } = req.body;
      const service = new HighLevelService(locationId, null);
      const appointment = await service.createAppointment(req.params.calendar_id, appointmentData);
      
      logger.info('Appointment created successfully', {
        locationId,
        calendarId: req.params.calendar_id,
        appointmentId: appointment.id
      });
      
      res.status(201).json(appointment);
    } catch (error) {
      logger.error('Create appointment failed:', {
        calendarId: req.params.calendar_id,
        error: error.message,
        appointmentData: req.body
      });
      
      const status = error.response?.status || 500;
      res.status(status).json({
        error: 'Failed to create appointment',
        message: error.message
      });
    }
  }
);

// Webhook endpoint for HighLevel events
app.post('/webhooks/highlevel',
  verifyWebhookSignature,
  body('type').isString().notEmpty(),
  body('locationId').isString().notEmpty(),
  validateRequest,
  async (req, res) => {
    try {
      const { type, locationId, data } = req.body;
      
      logger.info('Webhook received', {
        type,
        locationId,
        timestamp: new Date().toISOString()
      });
      
      // Process webhook based on type
      switch (type) {
        case 'contact.created':
          await handleContactCreated(locationId, data);
          break;
        case 'contact.updated':
          await handleContactUpdated(locationId, data);
          break;
        case 'opportunity.created':
          await handleOpportunityCreated(locationId, data);
          break;
        case 'opportunity.updated':
          await handleOpportunityUpdated(locationId, data);
          break;
        case 'appointment.created':
          await handleAppointmentCreated(locationId, data);
          break;
        default:
          logger.warn('Unknown webhook type', { type, locationId });
      }
      
      res.json({ success: true, message: 'Webhook processed successfully' });
    } catch (error) {
      logger.error('Webhook processing failed:', {
        error: error.message,
        body: req.body
      });
      
      res.status(500).json({
        error: 'Webhook processing failed',
        message: error.message
      });
    }
  }
);

// Admin endpoints
app.get('/admin/installations', strictLimiter, async (req, res) => {
  try {
    const installations = await OAuthServerAPI.getInstallations();
    res.json(installations);
  } catch (error) {
    logger.error('Failed to get installations:', error);
    res.status(500).json({ error: 'Failed to get installations' });
  }
});

app.get('/admin/metrics', strictLimiter, async (req, res) => {
  try {
    const oauthMetrics = await OAuthServerAPI.getMetrics();
    
    const apiMetrics = {
      server_uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
    
    res.json({
      oauth_server: oauthMetrics,
      api_server: apiMetrics
    });
  } catch (error) {
    logger.error('Failed to get metrics:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Webhook handlers (implement your business logic here)
async function handleContactCreated(locationId, contactData) {
  logger.info('Processing contact created webhook', { locationId, contactId: contactData.id });
  // Implement your business logic here
}

async function handleContactUpdated(locationId, contactData) {
  logger.info('Processing contact updated webhook', { locationId, contactId: contactData.id });
  // Implement your business logic here
}

async function handleOpportunityCreated(locationId, opportunityData) {
  logger.info('Processing opportunity created webhook', { locationId, opportunityId: opportunityData.id });
  // Implement your business logic here
}

async function handleOpportunityUpdated(locationId, opportunityData) {
  logger.info('Processing opportunity updated webhook', { locationId, opportunityId: opportunityData.id });
  // Implement your business logic here
}

async function handleAppointmentCreated(locationId, appointmentData) {
  logger.info('Processing appointment created webhook', { locationId, appointmentId: appointmentData.id });
  // Implement your business logic here
}

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
    process.exit(0);
  });
});

// Start server
const server = app.listen(config.port, () => {
  logger.info(`🚀 API Server running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`OAuth Server: ${config.oauthBaseUrl}`);
});

module.exports = app;