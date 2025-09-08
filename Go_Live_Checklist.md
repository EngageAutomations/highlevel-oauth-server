# HighLevel OAuth Integration - Go-Live Preflight Checklist

> **Critical**: Complete ALL items before deploying to production. Each checkbox represents a potential point of failure that could impact client installations.

## 📋 Pre-Deployment Validation

### Environment Configuration

#### OAuth Server Environment
- [ ] **HL_CLIENT_ID** - Verified with HighLevel Marketplace
- [ ] **HL_CLIENT_SECRET** - Verified with HighLevel Marketplace  
- [ ] **REDIRECT_URI** - Matches Railway deployment URL exactly
- [ ] **DATABASE_URL** - Railway Postgres connection tested
- [ ] **ENCRYPTION_KEY** - Base64 encoded, 32+ bytes, securely generated
- [ ] **S2S_SHARED_SECRET** - Base64 encoded, 32+ bytes, matches API server
- [ ] **NODE_ENV** - Set to `production`
- [ ] **PORT** - Set to Railway's default (usually 3000)

#### API Server Environment
- [ ] **OAUTH_BASE_URL** - Points to OAuth server Railway URL
- [ ] **S2S_SHARED_SECRET** - Matches OAuth server exactly
- [ ] **DEFAULT_SCOPE** - Set to required HighLevel scopes
- [ ] **NODE_ENV** - Set to `production`
- [ ] **PORT** - Set to Railway's default

#### Validation Commands
```bash
# Test environment variables are accessible
echo "OAuth URL: $OAUTH_BASE_URL"
echo "S2S Secret length: ${#S2S_SHARED_SECRET}"
echo "Encryption key length: ${#ENCRYPTION_KEY}"

# Verify base64 encoding
echo $ENCRYPTION_KEY | base64 -d > /dev/null && echo "✓ Encryption key valid" || echo "✗ Invalid encryption key"
echo $S2S_SHARED_SECRET | base64 -d > /dev/null && echo "✓ S2S secret valid" || echo "✗ Invalid S2S secret"
```

### Database Readiness

#### Schema Deployment
- [ ] **Migration Script** - `database_migration.sql` executed successfully
- [ ] **Tables Created** - `hl_installations`, `hl_audit_log` exist
- [ ] **Indexes Created** - All performance indexes in place
- [ ] **Functions Created** - Utility functions operational
- [ ] **Permissions Set** - Database roles configured correctly

#### Database Validation
```sql
-- Verify table structure
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('hl_installations', 'hl_audit_log')
ORDER BY table_name, ordinal_position;

-- Verify indexes
SELECT tablename, indexname 
FROM pg_indexes 
WHERE tablename IN ('hl_installations', 'hl_audit_log');

-- Test metrics view
SELECT * FROM hl_installation_metrics;

-- Test utility functions
SELECT * FROM mark_tokens_for_refresh(24);
```

### Code Deployment

#### OAuth Server Deployment
- [ ] **Repository Connected** - GitHub repo linked to Railway project
- [ ] **Build Successful** - Latest commit deployed without errors
- [ ] **Health Endpoint** - `/health` returns 200 OK
- [ ] **Metrics Endpoint** - `/metrics` accessible with S2S auth
- [ ] **Database Connection** - Server can connect to Postgres
- [ ] **Encryption Working** - Token encryption/decryption functional

#### API Server Deployment
- [ ] **Repository Connected** - GitHub repo linked to Railway project
- [ ] **Build Successful** - Latest commit deployed without errors
- [ ] **Health Endpoint** - `/health` returns 200 OK
- [ ] **OAuth Integration** - Can communicate with OAuth server
- [ ] **S2S Authentication** - JWT tokens working correctly

#### Deployment Validation
```bash
# Test OAuth server health
curl -f https://your-oauth-server.up.railway.app/health

# Test API server health
curl -f https://your-api-server.up.railway.app/health

# Test S2S authentication
OAUTH_TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({iss:'test',aud:'oauth-server',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300}, process.env.S2S_SHARED_SECRET))")
curl -H "Authorization: Bearer $OAUTH_TOKEN" https://your-oauth-server.up.railway.app/metrics
```

## 🔒 Security Validation

### Authentication & Authorization
- [ ] **Unauthorized Access Blocked** - Protected endpoints return 401
- [ ] **Invalid Tokens Rejected** - Malformed JWTs return 401
- [ ] **Expired Tokens Rejected** - Expired JWTs return 401
- [ ] **Token Validation Working** - Valid S2S tokens accepted
- [ ] **Scope Validation** - Tokens validated for required scopes

### Data Protection
- [ ] **Token Encryption** - Access/refresh tokens encrypted at rest
- [ ] **Secure Headers** - Security headers in HTTP responses
- [ ] **HTTPS Only** - All endpoints force HTTPS
- [ ] **No Token Logging** - Tokens not logged in plaintext
- [ ] **Environment Secrets** - No secrets in code/logs

### Security Test Commands
```bash
# Test unauthorized access
curl -i https://your-oauth-server.up.railway.app/admin/installations
# Should return 401

# Test invalid token
curl -i -H "Authorization: Bearer invalid.jwt.token" https://your-oauth-server.up.railway.app/admin/installations
# Should return 401

# Test security headers
curl -I https://your-oauth-server.up.railway.app/health
# Should include security headers
```

## 🔗 HighLevel Integration

### Marketplace Configuration
- [ ] **App Registered** - App exists in HighLevel Marketplace
- [ ] **Redirect URI** - Matches deployed OAuth server exactly
- [ ] **Scopes Configured** - Required permissions set
- [ ] **Webhook URLs** - If applicable, pointing to correct endpoints
- [ ] **App Status** - Set to "Live" or "Published"

### OAuth Flow Testing
- [ ] **Authorization URL** - Generates correct HighLevel auth URL
- [ ] **Callback Handling** - `/oauth/callback` processes codes correctly
- [ ] **Token Exchange** - Code → token exchange working
- [ ] **Token Storage** - Tokens stored encrypted in database
- [ ] **Token Refresh** - Refresh token flow operational

### Integration Test Script
```bash
# Test OAuth callback (replace with actual auth code)
curl -X POST "https://your-oauth-server.up.railway.app/oauth/callback?code=test_auth_code&location_id=test_location"

# Test proxy endpoint
OAUTH_TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({iss:'api-server',aud:'oauth-server',location_id:'test_location',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300}, process.env.S2S_SHARED_SECRET))")
curl -X POST -H "Authorization: Bearer $OAUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"method":"GET","endpoint":"/locations/test_location","headers":{}}' \
  https://your-oauth-server.up.railway.app/proxy/hl
```

## 📊 Performance & Monitoring

### Performance Benchmarks
- [ ] **Response Times** - Health endpoints < 500ms
- [ ] **Database Queries** - All queries < 1000ms
- [ ] **Memory Usage** - Servers using < 512MB at idle
- [ ] **CPU Usage** - Servers using < 50% at idle
- [ ] **Concurrent Requests** - Can handle 10+ simultaneous requests

### Monitoring Setup
- [ ] **Railway Metrics** - Built-in monitoring enabled
- [ ] **Health Checks** - Automated health monitoring
- [ ] **Error Tracking** - Application errors logged
- [ ] **Performance Metrics** - Response time tracking
- [ ] **Database Monitoring** - Connection pool and query performance

### Load Testing
```bash
# Install artillery for load testing
npm install -g artillery

# Create load test config
cat > load-test.yml << EOF
config:
  target: 'https://your-oauth-server.up.railway.app'
  phases:
    - duration: 60
      arrivalRate: 5
scenarios:
  - name: "Health check load test"
    requests:
      - get:
          url: "/health"
EOF

# Run load test
artillery run load-test.yml
```

## 🚨 Disaster Recovery

### Backup Verification
- [ ] **Database Backups** - Railway automated backups enabled
- [ ] **Code Backups** - GitHub repositories up to date
- [ ] **Environment Backups** - Environment variables documented
- [ ] **Recovery Procedures** - Rollback steps documented
- [ ] **Recovery Testing** - Backup restoration tested

### Rollback Preparation
- [ ] **Previous Version** - Last working deployment tagged
- [ ] **Rollback Scripts** - Automated rollback procedures ready
- [ ] **Database Rollback** - Schema rollback scripts prepared
- [ ] **Communication Plan** - Client notification procedures ready
- [ ] **Monitoring Alerts** - Failure detection configured

## 📞 Support & Documentation

### Documentation Complete
- [ ] **API Documentation** - All endpoints documented
- [ ] **Integration Guide** - Client integration instructions
- [ ] **Troubleshooting Guide** - Common issues and solutions
- [ ] **Operations Manual** - Day-to-day operations procedures
- [ ] **Security Procedures** - Incident response procedures

### Support Readiness
- [ ] **Support Contacts** - On-call personnel identified
- [ ] **Escalation Procedures** - Issue escalation paths defined
- [ ] **Monitoring Alerts** - Alert notifications configured
- [ ] **Client Communication** - Support channels established
- [ ] **Issue Tracking** - Bug/issue tracking system ready

## 🎯 Final Pre-Launch Validation

### End-to-End Testing
- [ ] **Complete OAuth Flow** - Full install → token → API call cycle
- [ ] **Token Refresh Flow** - Automatic token refresh working
- [ ] **Error Handling** - Graceful error responses
- [ ] **Edge Cases** - Invalid inputs handled correctly
- [ ] **Cross-Browser Testing** - OAuth flow works in major browsers

### Resilience Testing
- [ ] **Resilience Script** - `resilience_test.js` passes all tests
- [ ] **Failure Recovery** - Services recover from temporary failures
- [ ] **Database Failover** - Handles database connection issues
- [ ] **Rate Limiting** - Handles high request volumes
- [ ] **Security Scanning** - No critical vulnerabilities detected

### Final Validation Script
```bash
#!/bin/bash
# Run comprehensive pre-launch validation

echo "🚀 Starting Go-Live Validation..."

# Test all health endpoints
echo "Testing health endpoints..."
curl -f https://your-oauth-server.up.railway.app/health || exit 1
curl -f https://your-api-server.up.railway.app/health || exit 1

# Run resilience tests
echo "Running resilience tests..."
node resilience_test.js --oauth-url=https://your-oauth-server.up.railway.app --api-url=https://your-api-server.up.railway.app || exit 1

# Test database connectivity
echo "Testing database..."
psql $DATABASE_URL -c "SELECT * FROM hl_installation_metrics;" || exit 1

# Validate environment variables
echo "Validating environment..."
[ -n "$HL_CLIENT_ID" ] || { echo "Missing HL_CLIENT_ID"; exit 1; }
[ -n "$HL_CLIENT_SECRET" ] || { echo "Missing HL_CLIENT_SECRET"; exit 1; }
[ -n "$ENCRYPTION_KEY" ] || { echo "Missing ENCRYPTION_KEY"; exit 1; }
[ -n "$S2S_SHARED_SECRET" ] || { echo "Missing S2S_SHARED_SECRET"; exit 1; }

echo "✅ All validations passed! Ready for Go-Live."
```

## ✅ Go-Live Approval

### Sign-off Required
- [ ] **Technical Lead** - All technical requirements met
- [ ] **Security Review** - Security checklist completed
- [ ] **Operations Team** - Monitoring and support ready
- [ ] **Product Owner** - Business requirements satisfied
- [ ] **Final Testing** - All tests passing

### Go-Live Execution
- [ ] **Deployment Window** - Scheduled maintenance window
- [ ] **Team Availability** - Support team on standby
- [ ] **Monitoring Active** - All monitoring systems enabled
- [ ] **Communication Sent** - Stakeholders notified
- [ ] **Rollback Ready** - Rollback procedures prepared

---

## 📋 Checklist Summary

**Total Items**: 85+  
**Critical Items**: 45+  
**Security Items**: 15+  
**Performance Items**: 10+  

### Completion Status
- [ ] **Environment Configuration** (8/8)
- [ ] **Database Readiness** (5/5)
- [ ] **Code Deployment** (8/8)
- [ ] **Security Validation** (10/10)
- [ ] **HighLevel Integration** (8/8)
- [ ] **Performance & Monitoring** (10/10)
- [ ] **Disaster Recovery** (10/10)
- [ ] **Support & Documentation** (10/10)
- [ ] **Final Pre-Launch Validation** (11/11)
- [ ] **Go-Live Approval** (10/10)

**🎯 Ready for Production**: All items must be checked before go-live.

---

*Last Updated: Generated for HighLevel OAuth Integration v2.1*  
*Next Review: After each major deployment*