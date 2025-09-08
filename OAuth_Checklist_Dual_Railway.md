# 📝 OAuth Checklist: Dual Railway Project Setup

## Overview
This checklist guides you through setting up two separate Railway projects for HighLevel OAuth integration:
1. **OAuth Server** (stable) - Handles OAuth flow and token management
2. **API Server** (iterated often) - Implements business workflows

---

## ✅ Step 1: Create Railway Projects

- [ ] Create Railway project named `oauth-server`
- [ ] Add Postgres service to `oauth-server` project
- [ ] Create separate Railway project named `api-server`
- [ ] Note both project IDs for CLI use

---

## ✅ Step 2: Prepare GitHub Repositories

- [ ] Create GitHub repo for `oauth-server` (Express app)
- [ ] Create GitHub repo for `api-server` (Express app)
- [ ] Connect each repo to matching Railway project for auto-deploy on push to main

---

## ✅ Step 3: Set Environment Variables in Railway

### OAuth Server Variables
```bash
HL_CLIENT_ID=68474924a586bce22a6e64f7-mfa3rwol
HL_CLIENT_SECRET=54e5b66e-88a6-4f71-a8d1-b1c6e0270c88
REDIRECT_URI=https://<oauth-app>.up.railway.app/oauth/callback
DATABASE_URL=<from Railway Postgres>
ENCRYPTION_KEY=<openssl rand -base64 32>
S2S_SHARED_SECRET=<openssl rand -base64 32>
```

### API Server Variables
```bash
OAUTH_BASE_URL=https://<oauth-app>.up.railway.app
S2S_SHARED_SECRET=<same value as oauth-server>
DEFAULT_SCOPE=location
DEFAULT_TENANT_ID=<optional for dev>
PORT=3000
```

**Current Values from environment variables.txt:**
- HL_CLIENT_ID: `68474924a586bce22a6e64f7-mfa3rwol`
- HL_CLIENT_SECRET: `54e5b66e-88a6-4f71-a8d1-b1c6e0270c88`
- Base URL: `https://api.engageautomations.com`
- Encryption Key: `b259db9c-5123-48ae-815c-c6a828618e85-new-secure-encryption-key-2025`

---

## ✅ Step 4: Database Setup (OAuth Server)

- [ ] Run database migration on OAuth Postgres:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT,
  agency_id TEXT,
  access_token TEXT NOT NULL,    -- AES-GCM JSON blob
  refresh_token TEXT NOT NULL,   -- AES-GCM JSON blob
  scopes TEXT[],
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installations_location_id ON installations(location_id);
CREATE INDEX IF NOT EXISTS idx_installations_agency_id ON installations(agency_id);
```

- [ ] Confirm table exists in database

---

## ✅ Step 5: Configure HighLevel App

- [ ] Register app in HighLevel Developer Portal
- [ ] Set Redirect URI: `https://<oauth-app>.up.railway.app/oauth/callback`
- [ ] Update Client ID/Secret in oauth-server Railway variables
- [ ] Configure scopes: `contacts.readonly,calendars.read,campaign.readonly,locations.readonly,users.readonly`

---

## ✅ Step 6: Deploy OAuth Server

- [ ] Create `server.js` with OAuth handling logic
- [ ] Implement routes:
  - `GET /oauth/callback` - code exchange and token storage
  - `POST /proxy/hl` - forwards requests to HighLevel
  - `GET /admin/installations` - read-only installations list
  - `GET /health` and `GET /metrics`
  - `POST /oauth/disconnect` - remove installation tokens
- [ ] Push to GitHub repo
- [ ] Verify Railway auto-deployment
- [ ] Test `GET /health` returns `{ status: "ok" }`

---

## ✅ Step 7: Deploy API Server

- [ ] Create `server.js` with business logic scaffold
- [ ] Implement S2S token signing function
- [ ] Add routes:
  - `GET /health`
  - `POST /workflows/call-hl` - proxy HighLevel API calls
  - `GET /test/contacts` - convenience test route
- [ ] Push to GitHub repo
- [ ] Verify Railway auto-deployment
- [ ] Test `GET /health` works

---

## ✅ Step 8: Test Integration

- [ ] Test Marketplace install flow
- [ ] Confirm `/oauth/callback` runs and adds row to installations table
- [ ] Test `GET /admin/installations` (with S2S token) shows masked entries
- [ ] Test `GET /test/contacts?tenantId=<ID>&scope=location` returns data
- [ ] Verify token refresh mechanism works

---

## ✅ Step 9: Security Checklist

- [ ] Service-to-service JWT auth implemented for `/proxy/hl` and `/admin/*`
- [ ] Tokens stored encrypted at rest in Postgres
- [ ] Proxy restricted to allow-listed HighLevel endpoints
- [ ] No secrets logged in application logs
- [ ] HTTPS enforced on all endpoints

---

## ✅ Step 10: Monitoring & Maintenance

- [ ] Set up health check monitoring
- [ ] Configure metrics collection (`/metrics` endpoint)
- [ ] Set up log aggregation (external log sink)
- [ ] Document deployment procedures
- [ ] Create runbook for common issues

---

## 🚀 Deployment Commands

### Quick variable updates:
```bash
railway variables set --project <ID> --service <SERVICE> KEY=value
railway up --project <ID> --service <SERVICE> --detach
```

### Current Railway Project:
- Project ID: `ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67`
- Token: `42d84861-5a8e-4802-861e-d0afe86a66db`

---

## 📋 Key Principles

1. **OAuth Server Stability**: Once installed via Marketplace, avoid redeployment to prevent forcing client re-installs
2. **API Server Flexibility**: Can be redeployed freely without impacting client installations
3. **Token Security**: All tokens encrypted at rest, never logged or exposed
4. **Service Separation**: API server stores no tokens, relies entirely on OAuth server
5. **Monitoring**: Comprehensive logging and metrics for operational visibility

---

## 📊 Metrics & Monitoring

### Metrics Endpoints

#### OAuth Server Metrics (`GET /metrics`)
```javascript
// Prometheus-compatible metrics
app.get('/metrics', authenticateService, (req, res) => {
  const metrics = {
    // OAuth Flow Metrics
    oauth_installations_total: installationCount,
    oauth_token_refreshes_total: tokenRefreshCount,
    oauth_token_refresh_failures_total: tokenRefreshFailureCount,
    oauth_active_installations: activeInstallationCount,
    
    // Proxy Metrics
    proxy_requests_total: proxyRequestCount,
    proxy_request_duration_seconds: proxyRequestDuration,
    proxy_errors_total: proxyErrorCount,
    proxy_rate_limit_hits_total: rateLimitHitCount,
    
    // Security Metrics
    auth_failures_total: authFailureCount,
    invalid_tokens_total: invalidTokenCount,
    blocked_requests_total: blockedRequestCount,
    
    // System Metrics
    database_connections_active: dbConnectionCount,
    memory_usage_bytes: process.memoryUsage().heapUsed,
    uptime_seconds: process.uptime()
  };
  
  res.set('Content-Type', 'text/plain');
  res.send(Object.entries(metrics)
    .map(([key, value]) => `${key} ${value}`)
    .join('\n'));
});
```

#### API Server Metrics (`GET /metrics`)
```javascript
app.get('/metrics', authenticateService, (req, res) => {
  const metrics = {
    // Business Logic Metrics
    api_requests_total: apiRequestCount,
    api_request_duration_seconds: apiRequestDuration,
    api_errors_total: apiErrorCount,
    
    // HighLevel Integration Metrics
    hl_api_calls_total: hlApiCallCount,
    hl_api_errors_total: hlApiErrorCount,
    hl_rate_limit_hits_total: hlRateLimitCount,
    
    // System Metrics
    memory_usage_bytes: process.memoryUsage().heapUsed,
    uptime_seconds: process.uptime()
  };
  
  res.set('Content-Type', 'text/plain');
  res.send(Object.entries(metrics)
    .map(([key, value]) => `${key} ${value}`)
    .join('\n'));
});
```

### Monitoring Setup

#### Railway Metrics Integration
```bash
# Add to both services
npm install prom-client
```

#### Grafana Dashboard Queries
```promql
# OAuth Installation Rate
rate(oauth_installations_total[5m])

# Token Refresh Success Rate
(rate(oauth_token_refreshes_total[5m]) - rate(oauth_token_refresh_failures_total[5m])) / rate(oauth_token_refreshes_total[5m]) * 100

# Proxy Error Rate
rate(proxy_errors_total[5m]) / rate(proxy_requests_total[5m]) * 100

# Average Response Time
rate(proxy_request_duration_seconds[5m])
```

## 🧪 Testing & Validation

### OAuth Flow Testing
1. **Install Flow**
   ```bash
   # Test marketplace install
   curl "https://<oauth-server>.up.railway.app/oauth/callback?code=test_code&state=test_state"
   ```

2. **Token Validation**
   ```bash
   # Test proxy endpoint
   curl -X POST "https://<oauth-server>.up.railway.app/proxy/hl" \
     -H "Authorization: Bearer <s2s-token>" \
     -H "Content-Type: application/json" \
     -d '{"endpoint": "/locations", "method": "GET"}'
   ```

3. **Health Checks**
   ```bash
   curl "https://<oauth-server>.up.railway.app/health"
   curl "https://<api-server>.up.railway.app/health"
   ```

4. **Metrics Validation**
   ```bash
   # Test metrics endpoints (requires service token)
   curl -H "Authorization: Bearer <service-token>" \
     "https://<oauth-server>.up.railway.app/metrics"
   ```

---

## 🔧 Troubleshooting

- **Token Refresh Issues**: Check `expires_at` timestamps and refresh logic
- **S2S Auth Failures**: Verify shared secret matches between services
- **Database Connection**: Confirm `DATABASE_URL` is correct and accessible
- **HighLevel API Errors**: Check scope permissions and endpoint allow-list
- **Deployment Issues**: Verify GitHub repo connections and Railway project settings

---

*Last Updated: $(date)*
*Environment: Production*
*Status: Ready for Implementation*