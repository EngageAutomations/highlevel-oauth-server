# 🚀 Production Quick Reference Card
## HighLevel OAuth Integration - Essential Commands & URLs

---

## 🔗 Critical URLs

### Health & Status
```
OAuth Health:    https://api.engageautomations.com/health
API Health:      https://api-server-production-8a99.up.railway.app/health
Metrics:         https://api.engageautomations.com/metrics
Admin Panel:     https://api.engageautomations.com/admin/installations
```

### Management Dashboards
```
Railway:         https://railway.app/dashboard
HighLevel:       https://marketplace.gohighlevel.com/
GitHub OAuth:    https://github.com/you/oauth-server.git
GitHub API:      https://github.com/you/api-server.git
```

---

## ⚡ Essential Commands

### Service Status & Logs
```powershell
# Check all services
railway status

# View recent logs (last 50 lines)
railway logs --service oauth-server --lines 50
railway logs --service api-server --lines 50

# Follow live logs
railway logs --service oauth-server --follow
```

### Database Operations
```powershell
# Connect to database
railway run --service oauth-server -- psql $DATABASE_URL

# Quick installation check
railway run --service oauth-server -- psql $DATABASE_URL -c "SELECT COUNT(*) FROM installations;"

# View recent installations
railway run --service oauth-server -- psql $DATABASE_URL -c "SELECT tenant_id, tenant_type, created_at FROM installations ORDER BY created_at DESC LIMIT 10;"
```

### Environment Variables
```powershell
# List all variables
railway variables --service oauth-server
railway variables --service api-server

# Set specific variable
railway variables set KEY=value --service oauth-server
```

---

## 🚨 Emergency Procedures

### Service Restart
```powershell
# Restart individual service
railway restart --service oauth-server
railway restart --service api-server

# Restart all services
railway restart
```

### Quick Health Check
```powershell
# Test all endpoints
curl https://api-server-production-8a99.up.railway.app/health
curl https://api.engageautomations.com/health
curl https://api.engageautomations.com/metrics
```

### Rollback to Previous Version
```powershell
# Rollback API server (safer first)
railway rollback --service api-server

# Rollback OAuth server (last resort)
railway rollback --service oauth-server
```

---

## 🔍 Troubleshooting Quick Fixes

### 401/403 Authentication Errors
```powershell
# Check S2S secret match
railway variables --service oauth-server | grep S2S_SHARED_SECRET
railway variables --service api-server | grep S2S_SHARED_SECRET

# Test JWT generation
curl -X POST https://api-server-production-8a99.up.railway.app/test/jwt
```

### Database Connection Issues
```sql
-- Test connection
SELECT NOW();

-- Check table exists
\dt installations;

-- Verify indexes
\di installations_*;
```

### Rate Limiting Test
```powershell
# Test rate limits (should get 429 after limit)
for ($i=1; $i -le 20; $i++) {
    curl -w "%{http_code}\n" -s https://api.engageautomations.com/proxy/hl
}
```

---

## 📊 Monitoring Queries

### Key Metrics to Watch
```
token_refresh_total     - Should increment regularly
proxy_requests_total    - API usage volume
auth_failures_total     - Should remain low
response_time_seconds   - Should be < 2s
```

### Database Health Queries
```sql
-- Installation count by type
SELECT tenant_type, COUNT(*) FROM installations GROUP BY tenant_type;

-- Recent token refreshes
SELECT tenant_id, last_token_refresh FROM installations 
WHERE last_token_refresh > NOW() - INTERVAL '1 hour';

-- Failed installations (if tracking)
SELECT * FROM installations WHERE status = 'failed' OR access_token IS NULL;
```

---

## 🔧 Configuration Quick Reference

### Critical Environment Variables
```
OAuth Server:
- HL_CLIENT_ID
- HL_CLIENT_SECRET
- DATABASE_URL
- ENCRYPTION_KEY
- S2S_SHARED_SECRET
- REDIRECT_URI

API Server:
- OAUTH_BASE_URL
- S2S_SHARED_SECRET
- DEFAULT_SCOPE
```

### Security Settings
```
JWT TTL:           60 seconds
Rate Limit:        100 req/min per IP
Token Encryption:  AES-256-GCM
CORS Origins:      *.gohighlevel.com
```

---

## 📞 Escalation Contacts

### Service Issues
1. **Check Railway Status**: https://status.railway.app/
2. **Review Recent Deployments**: Railway dashboard
3. **Check HighLevel Status**: https://status.gohighlevel.com/

### Data Issues
1. **Database Backup**: Railway automatic backups
2. **Token Recovery**: Re-run OAuth flow for affected tenants
3. **Migration Rollback**: Restore from backup if needed

---

## 🎯 Daily Checklist (2 minutes)

- [ ] Check `/health` endpoints (both services)
- [ ] Review error count in logs (< 1% error rate)
- [ ] Verify recent installations in database
- [ ] Check metrics for anomalies
- [ ] Confirm no 401 loops in logs

---

## 📋 Weekly Tasks (15 minutes)

- [ ] Run `validate_deployment.ps1` full check
- [ ] Review and rotate logs if needed
- [ ] Check database performance metrics
- [ ] Update `Weekly_Operations_Report_Template.md`
- [ ] Verify backup integrity

---

## 🚀 Performance Baselines

```
Response Times:
- /health:        < 100ms
- /proxy/hl:      < 2000ms
- /oauth/callback: < 1000ms

Error Rates:
- Overall:        < 1%
- Auth failures:  < 0.1%
- Timeouts:       < 0.5%

Resource Usage:
- Memory:         < 512MB per service
- CPU:            < 50% average
- Database:       < 100 connections
```

---

**💡 Pro Tips:**
- Keep this card bookmarked for quick access
- Test commands in staging first when possible
- Always check logs after making changes
- OAuth server restarts affect all clients - use sparingly
- API server can be restarted freely without client impact

**🔥 Remember: OAuth server stability = happy clients!**