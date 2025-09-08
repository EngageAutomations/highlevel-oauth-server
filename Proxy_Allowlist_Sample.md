# 🛡️ Proxy Endpoint Allow-List Sample

## Overview

This document provides a sample allow-list configuration for the OAuth server's `/proxy/hl` endpoint. The allow-list restricts which HighLevel API endpoints can be accessed through the proxy, enhancing security by preventing unauthorized API access.

## Implementation

### Environment Variable Configuration

```bash
# Add to OAuth server environment variables
HL_ALLOWED_ENDPOINTS="contacts,opportunities,calendars,locations,users,webhooks,custom-fields,tags,pipelines,campaigns"

# Or use JSON format for more complex rules
HL_ALLOWED_ENDPOINTS_JSON='{"endpoints":["contacts","opportunities"],"methods":["GET","POST"],"rate_limit":100}'
```

### Code Implementation (Node.js/Express)

```javascript
// proxy-allowlist.js
const ALLOWED_ENDPOINTS = {
  // Core CRM endpoints
  'contacts': {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    paths: ['/contacts', '/contacts/*'],
    rate_limit: 100 // requests per minute
  },
  'opportunities': {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    paths: ['/opportunities', '/opportunities/*'],
    rate_limit: 50
  },
  'locations': {
    methods: ['GET'],
    paths: ['/locations', '/locations/*'],
    rate_limit: 20
  },
  
  // Calendar and scheduling
  'calendars': {
    methods: ['GET', 'POST', 'PUT'],
    paths: ['/calendars', '/calendars/*', '/appointments', '/appointments/*'],
    rate_limit: 30
  },
  
  // User management
  'users': {
    methods: ['GET'],
    paths: ['/users', '/users/*'],
    rate_limit: 10
  },
  
  // Webhooks
  'webhooks': {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    paths: ['/webhooks', '/webhooks/*'],
    rate_limit: 5
  },
  
  // Custom fields and tags
  'custom-fields': {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    paths: ['/custom-fields', '/custom-fields/*'],
    rate_limit: 20
  },
  'tags': {
    methods: ['GET', 'POST', 'DELETE'],
    paths: ['/tags', '/tags/*'],
    rate_limit: 30
  },
  
  // Pipelines and campaigns
  'pipelines': {
    methods: ['GET'],
    paths: ['/pipelines', '/pipelines/*'],
    rate_limit: 10
  },
  'campaigns': {
    methods: ['GET', 'POST'],
    paths: ['/campaigns', '/campaigns/*'],
    rate_limit: 15
  }
};

// Middleware function
function validateProxyRequest(req, res, next) {
  const { method, path } = req;
  const targetPath = req.body.path || req.query.path;
  
  // Extract endpoint category from path
  const endpointCategory = extractEndpointCategory(targetPath);
  
  if (!endpointCategory || !ALLOWED_ENDPOINTS[endpointCategory]) {
    return res.status(403).json({
      error: 'Endpoint not allowed',
      code: 'ENDPOINT_FORBIDDEN',
      allowed_endpoints: Object.keys(ALLOWED_ENDPOINTS)
    });
  }
  
  const config = ALLOWED_ENDPOINTS[endpointCategory];
  
  // Check HTTP method
  if (!config.methods.includes(method)) {
    return res.status(405).json({
      error: 'Method not allowed for this endpoint',
      code: 'METHOD_NOT_ALLOWED',
      allowed_methods: config.methods
    });
  }
  
  // Check path pattern
  const pathAllowed = config.paths.some(pattern => {
    if (pattern.endsWith('/*')) {
      return targetPath.startsWith(pattern.slice(0, -2));
    }
    return targetPath === pattern;
  });
  
  if (!pathAllowed) {
    return res.status(403).json({
      error: 'Path not allowed for this endpoint category',
      code: 'PATH_FORBIDDEN',
      allowed_paths: config.paths
    });
  }
  
  // Rate limiting (implement with redis or memory store)
  const rateLimitKey = `${req.user.locationId}:${endpointCategory}`;
  if (!checkRateLimit(rateLimitKey, config.rate_limit)) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      limit: config.rate_limit,
      window: '1 minute'
    });
  }
  
  next();
}

function extractEndpointCategory(path) {
  // Extract category from HighLevel API path
  const pathSegments = path.split('/').filter(Boolean);
  
  // Handle versioned APIs (e.g., /v1/contacts)
  if (pathSegments[0] && pathSegments[0].match(/^v\d+$/)) {
    return pathSegments[1];
  }
  
  return pathSegments[0];
}

function checkRateLimit(key, limit) {
  // Implement rate limiting logic
  // This is a simplified example - use Redis in production
  const now = Date.now();
  const window = 60000; // 1 minute
  
  if (!global.rateLimitStore) {
    global.rateLimitStore = new Map();
  }
  
  const record = global.rateLimitStore.get(key) || { count: 0, resetTime: now + window };
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + window;
  } else {
    record.count++;
  }
  
  global.rateLimitStore.set(key, record);
  
  return record.count <= limit;
}

module.exports = { validateProxyRequest, ALLOWED_ENDPOINTS };
```

### Usage in Express Route

```javascript
// In your OAuth server routes
const { validateProxyRequest } = require('./proxy-allowlist');

app.post('/proxy/hl', 
  authenticateServiceToken,
  validateProxyRequest,
  async (req, res) => {
    try {
      // Your existing proxy logic here
      const response = await forwardToHighLevel(req.body);
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: 'Proxy request failed' });
    }
  }
);
```

## Security Considerations

### 1. Endpoint Categories

```javascript
// Categorize endpoints by risk level
const RISK_LEVELS = {
  LOW: ['contacts', 'custom-fields', 'tags'],
  MEDIUM: ['opportunities', 'calendars', 'campaigns'],
  HIGH: ['users', 'webhooks', 'locations'],
  CRITICAL: ['billing', 'integrations', 'api-keys']
};

// Apply different restrictions based on risk
function getRiskLevel(endpoint) {
  for (const [level, endpoints] of Object.entries(RISK_LEVELS)) {
    if (endpoints.includes(endpoint)) {
      return level;
    }
  }
  return 'UNKNOWN';
}
```

### 2. Dynamic Allow-List Updates

```javascript
// Allow-list management endpoint (admin only)
app.put('/admin/allowlist', authenticateAdmin, (req, res) => {
  const { endpoint, config } = req.body;
  
  // Validate configuration
  if (!validateEndpointConfig(config)) {
    return res.status(400).json({ error: 'Invalid endpoint configuration' });
  }
  
  // Update allow-list
  ALLOWED_ENDPOINTS[endpoint] = config;
  
  // Log the change
  console.log(`Allow-list updated: ${endpoint}`, config);
  
  res.json({ message: 'Allow-list updated successfully' });
});
```

### 3. Monitoring and Alerting

```javascript
// Monitor blocked requests
function logBlockedRequest(req, reason) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    locationId: req.user?.locationId,
    path: req.body.path,
    method: req.method,
    reason: reason,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  };
  
  console.warn('Blocked proxy request:', logEntry);
  
  // Send to monitoring service
  if (process.env.NODE_ENV === 'production') {
    sendToMonitoring('proxy.request.blocked', logEntry);
  }
}
```

## Configuration Examples

### Basic Allow-List (Environment Variable)

```bash
# Simple comma-separated list
HL_ALLOWED_ENDPOINTS="contacts,opportunities,calendars"

# With rate limits
HL_ALLOWED_ENDPOINTS="contacts:100,opportunities:50,calendars:30"
```

### Advanced JSON Configuration

```json
{
  "endpoints": {
    "contacts": {
      "methods": ["GET", "POST", "PUT"],
      "paths": ["/contacts", "/contacts/*"],
      "rate_limit": 100,
      "require_scopes": ["contacts.read", "contacts.write"]
    },
    "opportunities": {
      "methods": ["GET", "POST"],
      "paths": ["/opportunities", "/opportunities/*"],
      "rate_limit": 50,
      "require_scopes": ["opportunities.read"]
    }
  },
  "global_settings": {
    "default_rate_limit": 10,
    "block_unknown_endpoints": true,
    "log_all_requests": false
  }
}
```

## Testing the Allow-List

### Test Script

```bash
#!/bin/bash
# test-allowlist.sh

OAUTH_SERVER="https://your-oauth-server.up.railway.app"
S2S_TOKEN="your-service-token"

echo "🧪 Testing proxy allow-list..."

# Test allowed endpoint
echo "Testing allowed endpoint (contacts)..."
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/contacts",
    "locationId": "test-location"
  }'

# Test blocked endpoint
echo "Testing blocked endpoint (billing)..."
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/billing",
    "locationId": "test-location"
  }'

# Test method restriction
echo "Testing method restriction..."
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "DELETE",
    "path": "/users",
    "locationId": "test-location"
  }'

echo "✅ Allow-list testing complete"
```

## Deployment Notes

1. **Environment Setup**: Add `HL_ALLOWED_ENDPOINTS` to Railway environment variables
2. **Monitoring**: Enable request logging for blocked attempts
3. **Updates**: Use admin endpoint to update allow-list without redeployment
4. **Testing**: Run test script after any allow-list changes

## Best Practices

- ✅ Start with minimal permissions and expand as needed
- ✅ Use rate limiting to prevent abuse
- ✅ Log all blocked requests for security monitoring
- ✅ Regularly review and update the allow-list
- ✅ Test allow-list changes in staging environment first
- ❌ Don't allow wildcard access to sensitive endpoints
- ❌ Don't set rate limits too high initially
- ❌ Don't forget to monitor for blocked legitimate requests