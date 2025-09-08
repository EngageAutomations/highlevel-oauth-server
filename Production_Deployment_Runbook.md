# 🚀 Production Deployment Runbook
## HighLevel OAuth Integration - Single Pass Go-Live

> **⚠️ CRITICAL**: This is a production deployment. Follow each step carefully and validate before proceeding.

---

## 📋 Prerequisites (5 minutes)

### Required Credentials & Resources
- [ ] **HighLevel Client ID** (production)
- [ ] **HighLevel Client Secret** (production)
- [ ] **GitHub Repository URLs**:
  - OAuth Server: `https://github.com/you/oauth-server.git`
  - API Server: `https://github.com/you/api-server.git`
- [ ] **Railway Account** with two empty projects:
  - `oauth-server` (with Postgres attached)
  - `api-server`
- [ ] **PowerShell** with execution policy allowing scripts
- [ ] **Clean terminal history** (no secrets in PowerShell profile/history)

### Security Check
```powershell
# Verify no secrets in PowerShell history
Get-History | Select-String -Pattern "secret|token|key" -CaseSensitive:$false
```

---

## 🎯 Step 1: Deploy to Railway (Production)

### Execute Deployment Script
```powershell
# Navigate to deployment folder
cd "c:\Users\Computer\Documents\Engage Automations\GoHighLevel Ouath 2.1"

# Run deployment (replace with your actual values)
.\deploy_railway.ps1 `
  -HLClientId "YOUR_HL_CLIENT_ID" `
  -HLClientSecret "YOUR_HL_CLIENT_SECRET" `
  -OAuthRepoUrl "https://github.com/you/oauth-server.git" `
  -ApiRepoUrl "https://github.com/you/api-server.git" `
  -Environment "production"
```

### Expected Deployment Actions
- ✅ Create/attach Railway projects & services
- ✅ Configure Railway Variables for both projects
- ✅ Trigger automatic deploys
- ✅ Apply `database_migration.sql`
- ✅ Generate secure encryption keys
- ✅ Configure service-to-service authentication

### Monitor Deployment
- Keep terminal open for warnings/errors
- Note the generated OAuth callback URL
- Save the S2S shared secret for validation

---

## 🔗 Step 2: Configure HighLevel Redirect URI

### Update HighLevel App Settings
1. **Copy OAuth URL** from Railway deployment output:
   ```
   https://<oauth-app>.up.railway.app/oauth/callback
   ```

2. **Update HighLevel Portal**:
   - Navigate to your HighLevel app settings
   - Update Redirect URI to the exact Railway URL
   - **Save changes**

### Validation
- [ ] Redirect URI matches Railway domain exactly
- [ ] No trailing slashes or extra characters
- [ ] HTTPS protocol confirmed

---

## ✅ Step 3: Immediate Production Validation

### Run Automated Validation
```powershell
# Execute validation script
.\validate_deployment.ps1 -S2SSecret "YOUR_GENERATED_S2S_SECRET" -Verbose
```

### Expected Validation Results
- ✅ `/health` endpoints return 200 OK (both services)
- ✅ Database schema present (`installations` table)
- ✅ Security controls active (JWT required)
- ✅ Allow-list enforcement working
- ✅ Proxy test to HighLevel returns 200
- ✅ Rate limiting configured
- ✅ CORS headers present

### If Validation Fails
See **🧯 Triage Fast** section below before proceeding.

---

## 🏢 Step 4: First Real Installation (Production)

### Install from HighLevel
1. **Agency Installation**:
   - Navigate to HighLevel Marketplace
   - Install your app to the agency
   - Complete OAuth flow

2. **Sub-Account Installation**:
   - Install to one location/sub-account
   - Verify OAuth completion

### Verify Installation Data
```powershell
# Check installations table
railway run --service oauth-server -- psql $DATABASE_URL -c "SELECT id, tenant_id, tenant_type, created_at FROM installations;"

# Check admin endpoint (tokens should be masked)
curl -H "Authorization: Bearer <S2S_JWT>" https://<oauth-app>.up.railway.app/admin/installations
```

### Test API Integration
```powershell
# Test live data retrieval
curl "https://<api-app>.up.railway.app/test/contacts?tenantId=<LOCATION_OR_AGENCY_ID>&scope=location"
```

**Expected**: HTTP 200 with live data or empty list

---

## 🔒 Step 5: Security Lockdown

### Final Security Validation
- [ ] **Proxy Allow-List**: Only intended HighLevel paths allowed
- [ ] **Rate Limiting**: Active on `/proxy/hl` endpoint
- [ ] **Token Redaction**: Logs mask sensitive data
- [ ] **Encryption**: Tokens encrypted at rest
- [ ] **JWT Validation**: Service-to-service auth working

### Security Audit Commands
```powershell
# Check recent logs for token leakage
railway logs --service oauth-server --lines 100 | Select-String -Pattern "access_token|refresh_token" -CaseSensitive:$false

# Verify rate limiting
for ($i=1; $i -le 10; $i++) {
    curl -w "%{http_code}\n" https://<oauth-app>.up.railway.app/proxy/hl
}
```

---

## 📊 Day-1 & Week-1 Operations

### Day 1 (Today)
- [ ] **Monitor Metrics**: `/metrics` endpoint shows `token_refresh_total` incrementing
- [ ] **Check Logs**: No 401 authentication loops
- [ ] **Verify Performance**: Response times < 2 seconds
- [ ] **Test Failover**: Confirm graceful error handling

### Week 1
- [ ] **Complete Weekly Report**: Use `Weekly_Operations_Report_Template.md`
- [ ] **Schedule Resilience Test**: Calendar reminder for monthly `resilience_test.js`
- [ ] **Review Metrics**: Token refresh patterns, API usage trends
- [ ] **Security Audit**: Review access logs and error patterns

---

## 🧯 Triage Fast (Emergency Troubleshooting)

### 401/403 from `/proxy/hl`
**Symptoms**: Authentication failures, proxy rejections

**Fixes**:
```powershell
# Check S2S token mismatch
railway variables --service oauth-server | grep S2S_SHARED_SECRET
railway variables --service api-server | grep S2S_SHARED_SECRET

# Verify JWT configuration
# Ensure: aud="oauth-server", TTL ≤ 60s
```

### 403 on Allowed Path
**Symptoms**: Legitimate requests blocked

**Fix**: Update allow-list in OAuth server
```javascript
// Add specific endpoint prefix
const ALLOWED_ENDPOINTS = [
  '/contacts/*',
  '/opportunities/*',
  // Add your endpoint here
];
```
Redeploy OAuth server only.

### OAuth Callback Fails
**Symptoms**: Installation process breaks

**Fixes**:
- **Redirect URI Mismatch**: Ensure HighLevel portal URI exactly matches Railway domain
- **Client Credentials**: Re-enter in Railway variables, redeploy OAuth server

### Missing Installation Row
**Symptoms**: No database entries after install

**Fixes**:
```sql
-- Check database connection
SELECT NOW();

-- Verify table exists
\dt installations;

-- Rerun migration if needed
\i database_migration.sql
```

---

## 🔄 Safe Rollback Procedures

### Service Rollback Priority
1. **API Server First**: Less disruptive to client installs
2. **OAuth Server Last**: Only if absolutely required

### Rollback Steps
```powershell
# Railway rollback to previous build
railway rollback --service api-server

# If variables changed, revert using templates
railway variables set --service api-server < .env.api.template

# OAuth server rollback (LAST RESORT)
railway rollback --service oauth-server
```

### Post-Rollback Validation
- [ ] Health endpoints responding
- [ ] Existing installations still work
- [ ] No token refresh failures

---

## ✅ Definition of Done (Production Go-Live)

### Technical Validation
- [ ] Both apps deployed with `/health` returning 200
- [ ] HighLevel Redirect URI configured to Railway OAuth callback
- [ ] Database schema applied and accessible
- [ ] One agency + one location successfully installed
- [ ] Installation tokens stored and encrypted
- [ ] API `/test/contacts` returns 200 via OAuth proxy

### Security Validation
- [ ] JWT authentication enforced
- [ ] Allow-list blocking unauthorized endpoints
- [ ] Rate limiting active and tested
- [ ] Token encryption verified
- [ ] Logs redacting sensitive data

### Operational Validation
- [ ] Day-1 metrics clean and trending correctly
- [ ] No authentication loops in logs
- [ ] Error handling graceful
- [ ] Performance within SLA (< 2s response times)

### Documentation & Handoff
- [ ] Weekly operations template ready
- [ ] Resilience test scheduled
- [ ] Emergency contacts documented
- [ ] Rollback procedures tested

---

## 📞 Emergency Contacts & Resources

### Critical Resources
- **Railway Dashboard**: https://railway.app/dashboard
- **HighLevel Developer Portal**: https://marketplace.gohighlevel.com/
- **GitHub Repositories**: 
  - OAuth: `https://github.com/you/oauth-server.git`
  - API: `https://github.com/you/api-server.git`

### Monitoring URLs
- **OAuth Health**: `https://<oauth-app>.up.railway.app/health`
- **API Health**: `https://<api-app>.up.railway.app/health`
- **Metrics**: `https://<oauth-app>.up.railway.app/metrics`
- **Admin Panel**: `https://<oauth-app>.up.railway.app/admin/installations`

### Quick Commands
```powershell
# Check service status
railway status

# View recent logs
railway logs --service oauth-server --lines 50
railway logs --service api-server --lines 50

# Emergency restart
railway restart --service oauth-server
railway restart --service api-server
```

---

## 🎉 Post Go-Live Checklist

### Immediate (Next 24 Hours)
- [ ] Monitor error rates and response times
- [ ] Verify token refresh cycles working
- [ ] Check for any memory leaks or performance degradation
- [ ] Confirm all logging and metrics collection active

### Week 1
- [ ] Complete first weekly operations report
- [ ] Review and tune rate limiting if needed
- [ ] Analyze usage patterns and optimize
- [ ] Schedule regular maintenance windows

### Month 1
- [ ] Run first monthly resilience test
- [ ] Review security audit logs
- [ ] Optimize database queries and indexing
- [ ] Plan capacity scaling if needed

---

**🚀 Congratulations! Your HighLevel OAuth integration is now live in production.**

*Remember: OAuth server stability is critical - avoid unnecessary redeployments to prevent client re-installations.*