# 🚀 Quick Reference Card - Dual Railway OAuth Setup

## Current Configuration

### HighLevel App Details
- **Client ID**: `68474924a586bce22a6e64f7-mfa3rwol`
- **Client Secret**: `54e5b66e-88a6-4f71-a8d1-b1c6e0270c88`
- **Base URL**: `https://api.engageautomations.com`
- **Scopes**: `contacts.readonly,calendars.read,campaign.readonly,locations.readonly,users.readonly`

### Railway Project
- **Project ID**: `ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67`
- **Token**: `42d84861-5a8e-4802-861e-d0afe86a66db`

---

## Essential Commands

### Generate Secrets
```bash
# Generate encryption key
openssl rand -base64 32

# Generate S2S shared secret
openssl rand -base64 32
```

### Railway CLI Commands
```bash
# Set environment variable
railway variables set --project ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67 KEY=value

# Deploy service
railway up --project ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67 --detach

# View logs
railway logs --project ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67
```

---

## Database Schema (OAuth Server)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT,
  agency_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scopes TEXT[],
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Key Endpoints

### OAuth Server
- `GET /health` - Health check
- `GET /oauth/callback` - OAuth callback
- `POST /proxy/hl` - HighLevel API proxy
- `GET /admin/installations` - List installations
- `POST /oauth/disconnect` - Remove tokens

### API Server
- `GET /health` - Health check
- `POST /workflows/call-hl` - Business logic proxy
- `GET /test/contacts` - Test endpoint

---

## Environment Variables Template

### OAuth Server
```env
HL_CLIENT_ID=68474924a586bce22a6e64f7-mfa3rwol
HL_CLIENT_SECRET=54e5b66e-88a6-4f71-a8d1-b1c6e0270c88
REDIRECT_URI=https://api.engageautomations.com/oauth/callback
DATABASE_URL=<railway-postgres-url>
ENCRYPTION_KEY=<base64-key>
S2S_SHARED_SECRET=<base64-secret>
```

### API Server
```env
OAUTH_BASE_URL=https://api.engageautomations.com
S2S_SHARED_SECRET=<same-as-oauth-server>
DEFAULT_SCOPE=location
PORT=3000
```

---

## 🧪 Copy-Pasteable Test Commands

### Environment Setup
```bash
# Set your Railway URLs (replace with actual URLs)
export OAUTH_SERVER="https://api.engageautomations.com"
export API_SERVER="https://api-server-production-8a99.up.railway.app"
export S2S_TOKEN="your-service-to-service-jwt-token"
export HL_LOCATION_ID="your-highlevel-location-id"
```

### 1. Health Checks
```bash
# OAuth Server Health
curl -v "$OAUTH_SERVER/health" | jq .

# API Server Health  
curl -v "$API_SERVER/health" | jq .

# Expected Response:
# {"status": "healthy", "timestamp": "2024-01-15T10:30:00Z", "uptime": 3600}
```

### 2. OAuth Flow Testing
```bash
# Simulate HighLevel marketplace install callback
curl -v "$OAUTH_SERVER/oauth/callback?code=test_auth_code&state=secure_random_state" \
  -H "Content-Type: application/json" | jq .

# Expected: Redirect or success response with installation confirmation
```

### 3. Service-to-Service Authentication
```bash
# Generate service token (run this in your OAuth server environment)
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({service:'api-server',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300}, process.env.S2S_SHARED_SECRET));"

# Test service authentication
curl -v "$OAUTH_SERVER/admin/installations" \
  -H "Authorization: Bearer $S2S_TOKEN" | jq .
```

### 4. Proxy Endpoint Testing
```bash
# Test HighLevel locations endpoint
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "'$HL_LOCATION_ID'",
    "endpoint": "/locations",
    "method": "GET"
  }' | jq .

# Test HighLevel contacts endpoint
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "'$HL_LOCATION_ID'",
    "endpoint": "/contacts",
    "method": "GET",
    "params": {"limit": 10}
  }' | jq .

# Test HighLevel opportunities endpoint
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "'$HL_LOCATION_ID'",
    "endpoint": "/opportunities",
    "method": "GET"
  }' | jq .
```

### 5. Error Testing
```bash
# Test invalid endpoint (should be blocked)
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "'$HL_LOCATION_ID'",
    "endpoint": "/admin/users",
    "method": "GET"
  }' | jq .
# Expected: 403 Forbidden

# Test invalid service token
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer invalid_token" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "/locations", "method": "GET"}' | jq .
# Expected: 401 Unauthorized

# Test missing location ID
curl -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "/contacts", "method": "GET"}' | jq .
# Expected: 400 Bad Request
```

### 6. Metrics Testing
```bash
# OAuth Server Metrics
curl -H "Authorization: Bearer $S2S_TOKEN" \
  "$OAUTH_SERVER/metrics" | head -20

# API Server Metrics
curl -H "Authorization: Bearer $S2S_TOKEN" \
  "$API_SERVER/metrics" | head -20

# Expected: Prometheus-format metrics
```

### 7. Database Testing
```bash
# Test installation lookup (via admin endpoint)
curl -H "Authorization: Bearer $S2S_TOKEN" \
  "$OAUTH_SERVER/admin/installations" | jq '.[] | {locationId, createdAt, status}'

# Expected: Array of installations without sensitive token data
```

### 8. Load Testing
```bash
# Simple load test (requires 'ab' - Apache Bench)
ab -n 100 -c 10 -H "Authorization: Bearer $S2S_TOKEN" \
  "$OAUTH_SERVER/health"

# Or using curl in a loop
for i in {1..10}; do
  curl -s "$OAUTH_SERVER/health" > /dev/null && echo "Request $i: OK" || echo "Request $i: FAILED"
done
```

### 9. Security Testing
```bash
# Test HTTPS redirect (should redirect HTTP to HTTPS)
curl -v "https://api.engageautomations.com/health"

# Test CORS headers
curl -v -H "Origin: https://unauthorized-domain.com" \
  "$OAUTH_SERVER/health"

# Test rate limiting (send many requests quickly)
for i in {1..50}; do curl -s "$OAUTH_SERVER/health" & done; wait
```

### 10. Integration Testing Script
```bash
#!/bin/bash
# save as test_integration.sh

set -e

echo "🧪 Starting OAuth Integration Tests..."

# Health checks
echo "1. Testing health endpoints..."
curl -f "$OAUTH_SERVER/health" > /dev/null && echo "✅ OAuth server healthy"
curl -f "$API_SERVER/health" > /dev/null && echo "✅ API server healthy"

# Service auth
echo "2. Testing service authentication..."
curl -f -H "Authorization: Bearer $S2S_TOKEN" \
  "$OAUTH_SERVER/admin/installations" > /dev/null && echo "✅ Service auth working"

# Proxy functionality
echo "3. Testing proxy functionality..."
curl -f -X POST "$OAUTH_SERVER/proxy/hl" \
  -H "Authorization: Bearer $S2S_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locationId":"'$HL_LOCATION_ID'","endpoint":"/locations","method":"GET"}' \
  > /dev/null && echo "✅ Proxy working"

echo "🎉 All tests passed!"
```

---

## Security Checklist
- ✅ Tokens encrypted at rest
- ✅ S2S authentication between services
- ✅ No secrets in logs
- ✅ HTTPS enforced
- ✅ Endpoint allow-listing

---

## Deployment Strategy
1. **OAuth Server**: Deploy once, keep stable
2. **API Server**: Deploy frequently for business logic updates
3. **Variables**: Update via Railway dashboard or CLI
4. **Monitoring**: Use `/health` and `/metrics` endpoints

---

*Quick access for development and deployment operations*