# 📋 Day-2 Operations Checklist
## Weekly Maintenance Tasks for HighLevel OAuth Integration

---

## 🗓️ Weekly Schedule Overview

| Day | Task Category | Duration | Priority |
|-----|---------------|----------|----------|
| Monday | Security & Health Checks | 15 min | High |
| Tuesday | Performance Monitoring | 10 min | Medium |
| Wednesday | Database Maintenance | 20 min | High |
| Thursday | Error Analysis & Alerts | 15 min | Medium |
| Friday | Backup & Documentation | 10 min | Low |

---

## 📋 Pre-Flight Check

**Date:** [YYYY-MM-DD]  
**Operator:** [Your Name]  
**Start Time:** [HH:MM]  

### Environment Verification
- [ ] **OAuth Server Status**
  ```bash
  curl -f https://your-oauth-app.up.railway.app/health
  ```
  - Status: [✅ Healthy / ⚠️ Warning / ❌ Down]
  - Response Time: [XXXms]

- [ ] **API Server Status**
  ```bash
  curl -f https://your-api-app.up.railway.app/health
  ```
  - Status: [✅ Healthy / ⚠️ Warning / ❌ Down]
  - Response Time: [XXXms]

- [ ] **Database Connectivity**
  ```bash
  psql $DATABASE_URL -c "SELECT version();"
  ```
  - Status: [✅ Connected / ❌ Failed]
  - Version: [PostgreSQL X.X]

---

## 🔒 Security & Compliance Review

### SSL/TLS Certificate Check
- [ ] **OAuth Server Certificate**
  ```bash
  openssl s_client -connect your-oauth-app.up.railway.app:443 -servername your-oauth-app.up.railway.app < /dev/null 2>/dev/null | openssl x509 -noout -dates
  ```
  - Expires: [YYYY-MM-DD]
  - Days Remaining: [XXX]
  - Action Required: [None / Renew Soon / Critical]

- [ ] **API Server Certificate**
  ```bash
  openssl s_client -connect your-api-app.up.railway.app:443 -servername your-api-app.up.railway.app < /dev/null 2>/dev/null | openssl x509 -noout -dates
  ```
  - Expires: [YYYY-MM-DD]
  - Days Remaining: [XXX]
  - Action Required: [None / Renew Soon / Critical]

### Security Audit
- [ ] **Dependency Vulnerability Scan**
  ```bash
  cd /path/to/oauth-server && npm audit
  cd /path/to/api-server && npm audit
  ```
  - OAuth Server: [X vulnerabilities found]
  - API Server: [X vulnerabilities found]
  - Critical Issues: [X]
  - Action Required: [None / Update Dependencies / Immediate Fix]

- [ ] **Access Log Review**
  ```bash
  # Check for suspicious activity in the last 7 days
  grep -E "(40[1-4]|50[0-5])" /var/log/oauth-server.log | tail -20
  grep -E "(40[1-4]|50[0-5])" /var/log/api-server.log | tail -20
  ```
  - Suspicious Activity: [None / Investigated / Escalated]
  - Failed Auth Attempts: [XXX]
  - Rate Limit Violations: [XXX]

- [ ] **Environment Variables Security**
  - [ ] No secrets exposed in logs
  - [ ] Environment variables properly encrypted
  - [ ] No hardcoded credentials in code
  - [ ] S2S tokens rotated (if applicable)

---

## 📊 Performance & Monitoring

### System Metrics Review
- [ ] **OAuth Server Metrics**
  ```bash
  curl -H "Authorization: Bearer $(generate_s2s_token)" https://your-oauth-app.up.railway.app/metrics
  ```
  - CPU Usage (7-day avg): [XX%]
  - Memory Usage (7-day avg): [XX%]
  - Response Time (7-day avg): [XXXms]
  - Error Rate (7-day): [X.XX%]
  - Status: [✅ Normal / ⚠️ Elevated / ❌ Critical]

- [ ] **API Server Metrics**
  ```bash
  curl https://your-api-app.up.railway.app/admin/metrics
  ```
  - CPU Usage (7-day avg): [XX%]
  - Memory Usage (7-day avg): [XX%]
  - Response Time (7-day avg): [XXXms]
  - Request Volume (7-day): [XXX,XXX]
  - Status: [✅ Normal / ⚠️ Elevated / ❌ Critical]

### Database Performance
- [ ] **Database Health Check**
  ```sql
  -- Connection and performance metrics
  SELECT 
    datname,
    numbackends as active_connections,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    temp_files,
    temp_bytes
  FROM pg_stat_database 
  WHERE datname = current_database();
  ```
  - Active Connections: [XX]
  - Cache Hit Ratio: [XX.X%]
  - Temp Files: [XXX]
  - Status: [✅ Optimal / ⚠️ Review / ❌ Action Needed]

- [ ] **Table Statistics**
  ```sql
  -- Table size and activity
  SELECT 
    schemaname,
    tablename,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
  FROM pg_stat_user_tables 
  WHERE schemaname = 'public'
  ORDER BY n_live_tup DESC;
  ```
  - hl_installations rows: [XXX,XXX]
  - hl_audit_log rows: [XXX,XXX]
  - Dead tuple ratio: [X.X%]
  - Last vacuum: [YYYY-MM-DD]
  - Action Required: [None / Manual Vacuum / Investigate]

---

## 🔄 Token Management

### Token Health Assessment
- [ ] **Active Installation Count**
  ```sql
  SELECT 
    COUNT(*) as total_installations,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_installations,
    COUNT(CASE WHEN expires_at < NOW() + INTERVAL '24 hours' THEN 1 END) as expiring_soon,
    COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as expired_tokens
  FROM hl_installations;
  ```
  - Total Installations: [XXX]
  - Active Installations: [XXX]
  - Expiring Soon (24h): [XX]
  - Expired Tokens: [XX]

- [ ] **Token Refresh Analysis**
  ```sql
  SELECT 
    DATE(last_token_refresh) as refresh_date,
    COUNT(*) as refresh_count,
    COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_refreshes
  FROM hl_installations 
  WHERE last_token_refresh >= NOW() - INTERVAL '7 days'
  GROUP BY DATE(last_token_refresh)
  ORDER BY refresh_date DESC;
  ```
  - Successful Refreshes (7 days): [XXX]
  - Failed Refreshes (7 days): [XX]
  - Success Rate: [XX.X%]
  - Action Required: [None / Investigate Failures / Contact Clients]

- [ ] **Problematic Installations**
  ```sql
  -- Find installations with issues
  SELECT 
    installation_id,
    location_id,
    status,
    expires_at,
    last_token_refresh,
    error_count
  FROM hl_installations 
  WHERE 
    status != 'active' 
    OR expires_at < NOW() + INTERVAL '48 hours'
    OR error_count > 5
  ORDER BY expires_at ASC;
  ```
  - Installations Needing Attention: [XX]
  - Critical Issues: [XX]
  - Client Notifications Sent: [XX]

---

## 🔗 API Integration Health

### HighLevel API Connectivity
- [ ] **API Endpoint Testing**
  ```bash
  # Test core HighLevel endpoints
  curl -X GET "https://services.leadconnectorhq.com/locations/" \
    -H "Authorization: Bearer $(get_test_token)" \
    -H "Version: 2021-07-28"
  ```
  - Locations API: [✅ Working / ❌ Failed]
  - Contacts API: [✅ Working / ❌ Failed]
  - Opportunities API: [✅ Working / ❌ Failed]
  - Calendars API: [✅ Working / ❌ Failed]
  - Response Time: [XXXms]

- [ ] **Rate Limit Status**
  ```bash
  # Check rate limit headers from recent requests
  curl -I -X GET "https://services.leadconnectorhq.com/locations/" \
    -H "Authorization: Bearer $(get_test_token)" \
    -H "Version: 2021-07-28"
  ```
  - Rate Limit Remaining: [XXX/1000]
  - Rate Limit Reset: [XXX seconds]
  - Utilization: [XX%]
  - Status: [✅ Normal / ⚠️ High Usage / ❌ Throttled]

### Proxy Performance
- [ ] **Proxy Endpoint Analysis**
  ```sql
  -- Analyze proxy usage patterns
  SELECT 
    DATE(created_at) as request_date,
    COUNT(*) as total_requests,
    COUNT(CASE WHEN event_type = 'api_error' THEN 1 END) as error_requests,
    AVG(CASE WHEN metadata->>'response_time' IS NOT NULL 
        THEN (metadata->>'response_time')::integer END) as avg_response_time
  FROM hl_audit_log 
  WHERE event_type IN ('api_request', 'api_error')
    AND created_at >= NOW() - INTERVAL '7 days'
  GROUP BY DATE(created_at)
  ORDER BY request_date DESC;
  ```
  - Daily Request Volume: [XXX - XXX]
  - Error Rate: [X.XX%]
  - Average Response Time: [XXXms]
  - Trend: [↑ Increasing / ↓ Decreasing / → Stable]

---

## 💾 Backup & Data Integrity

### Backup Verification
- [ ] **Database Backup Status**
  ```bash
  # Check Railway backup status (if available)
  railway status --project oauth-server
  
  # Manual backup verification
  pg_dump $DATABASE_URL --schema-only | head -20
  ```
  - Last Backup: [YYYY-MM-DD HH:MM]
  - Backup Size: [XX GB]
  - Status: [✅ Success / ⚠️ Warning / ❌ Failed]
  - Retention: [XX days]

- [ ] **Data Integrity Check**
  ```sql
  -- Check for data consistency issues
  SELECT 
    'hl_installations' as table_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN installation_id IS NULL THEN 1 END) as null_ids,
    COUNT(CASE WHEN created_at IS NULL THEN 1 END) as null_dates
  FROM hl_installations
  UNION ALL
  SELECT 
    'hl_audit_log' as table_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN id IS NULL THEN 1 END) as null_ids,
    COUNT(CASE WHEN created_at IS NULL THEN 1 END) as null_dates
  FROM hl_audit_log;
  ```
  - Data Consistency: [✅ Good / ⚠️ Minor Issues / ❌ Critical Issues]
  - Null Values Found: [XX]
  - Action Required: [None / Data Cleanup / Investigation]

### Recovery Testing
- [ ] **Recovery Procedure Verification**
  - [ ] Recovery documentation up to date
  - [ ] Recovery scripts tested (last 30 days)
  - [ ] RTO/RPO targets defined and achievable
  - [ ] Emergency contact list current
  - [ ] Last Recovery Test: [YYYY-MM-DD]
  - [ ] Next Scheduled Test: [YYYY-MM-DD]

---

## 📈 Capacity Planning

### Resource Utilization Trends
- [ ] **Growth Analysis**
  ```sql
  -- Installation growth trend
  SELECT 
    DATE_TRUNC('week', created_at) as week_start,
    COUNT(*) as new_installations,
    SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('week', created_at)) as cumulative_total
  FROM hl_installations 
  WHERE created_at >= NOW() - INTERVAL '8 weeks'
  GROUP BY DATE_TRUNC('week', created_at)
  ORDER BY week_start;
  ```
  - Weekly Growth Rate: [X.X%]
  - Monthly Growth Rate: [XX.X%]
  - Projected 30-day Installations: [XXX]

- [ ] **Resource Scaling Assessment**
  - Current OAuth Server Plan: [Railway Plan]
  - Current API Server Plan: [Railway Plan]
  - CPU Utilization Trend: [↑ Increasing / ↓ Decreasing / → Stable]
  - Memory Utilization Trend: [↑ Increasing / ↓ Decreasing / → Stable]
  - Scaling Action Required: [None / Monitor / Scale Up / Optimize]

### Cost Analysis
- [ ] **Monthly Cost Review**
  ```bash
  # Check Railway billing (manual process)
  railway billing --project oauth-server
  railway billing --project api-server
  ```
  - OAuth Server Cost: $[XX.XX]
  - API Server Cost: $[XX.XX]
  - Database Cost: $[XX.XX]
  - Total Monthly Cost: $[XXX.XX]
  - Budget Status: [Under / On Track / Over]
  - Cost per Installation: $[X.XX]

---

## 🚨 Alert & Incident Review

### Active Alerts
- [ ] **Current Alert Status**
  - [ ] No active alerts
  - [ ] **[Alert Name]** - Severity: [High/Medium/Low] - Duration: [XXh XXm]
    - Investigation Status: [Not Started / In Progress / Resolved]
    - Root Cause: [Description]
    - Action Taken: [Description]

### Incident Analysis
- [ ] **Past Week Incidents**
  - Total Incidents: [X]
  - High Severity: [X]
  - Medium Severity: [X]
  - Low Severity: [X]
  - Average Resolution Time: [XXm]
  - Recurring Issues: [None / Description]

- [ ] **Incident Follow-up**
  - [ ] Post-incident reviews completed
  - [ ] Action items from incidents addressed
  - [ ] Process improvements implemented
  - [ ] Documentation updated

---

## 🔧 Maintenance Tasks

### Routine Maintenance
- [ ] **Log Management**
  ```bash
  # Check log sizes and rotate if necessary
  du -sh /var/log/oauth-server.log
  du -sh /var/log/api-server.log
  
  # Archive old logs (if size > 100MB)
  if [ $(stat -f%z /var/log/oauth-server.log) -gt 104857600 ]; then
    gzip /var/log/oauth-server.log
    touch /var/log/oauth-server.log
  fi
  ```
  - OAuth Server Log Size: [XX MB]
  - API Server Log Size: [XX MB]
  - Action Taken: [None / Rotated / Archived]

- [ ] **Database Maintenance**
  ```sql
  -- Manual vacuum if needed (based on dead tuple ratio)
  VACUUM ANALYZE hl_installations;
  VACUUM ANALYZE hl_audit_log;
  
  -- Reindex if fragmentation is high
  REINDEX TABLE hl_installations;
  REINDEX TABLE hl_audit_log;
  ```
  - Vacuum Required: [Yes / No]
  - Reindex Required: [Yes / No]
  - Maintenance Window: [YYYY-MM-DD HH:MM]

- [ ] **Dependency Updates**
  ```bash
  # Check for outdated packages
  cd /path/to/oauth-server && npm outdated
  cd /path/to/api-server && npm outdated
  ```
  - OAuth Server Updates Available: [X packages]
  - API Server Updates Available: [X packages]
  - Security Updates: [X critical]
  - Update Schedule: [YYYY-MM-DD]

### Configuration Review
- [ ] **Environment Variables**
  - [ ] All required variables present
  - [ ] No deprecated variables in use
  - [ ] Values within expected ranges
  - [ ] Secrets properly secured

- [ ] **Rate Limiting Configuration**
  - [ ] Rate limits appropriate for current load
  - [ ] No excessive rate limit violations
  - [ ] Whitelist/blacklist up to date

- [ ] **CORS and Security Headers**
  - [ ] CORS policy restrictive and appropriate
  - [ ] Security headers properly configured
  - [ ] CSP policy up to date

---

## 📊 Reporting & Documentation

### Weekly Report Preparation
- [ ] **Metrics Collection**
  - [ ] System performance metrics gathered
  - [ ] Security metrics compiled
  - [ ] Business metrics calculated
  - [ ] Cost analysis completed

- [ ] **Report Generation**
  - [ ] Weekly Operations Report updated
  - [ ] Key stakeholders identified
  - [ ] Action items documented
  - [ ] Trends and projections included

### Documentation Updates
- [ ] **Operational Documentation**
  - [ ] Runbooks updated with new procedures
  - [ ] Troubleshooting guides current
  - [ ] Contact information verified
  - [ ] Emergency procedures tested

- [ ] **Technical Documentation**
  - [ ] API documentation current
  - [ ] Database schema documented
  - [ ] Configuration changes logged
  - [ ] Architecture diagrams updated

---

## ✅ Sign-off & Next Steps

### Completion Summary
**Completion Time:** [HH:MM]  
**Total Duration:** [XX minutes]  

### Issues Identified
1. **[Issue Description]**
   - Severity: [High/Medium/Low]
   - Impact: [Description]
   - Action Required: [Description]
   - Owner: [Name]
   - Due Date: [YYYY-MM-DD]

2. **[Issue Description]**
   - Severity: [High/Medium/Low]
   - Impact: [Description]
   - Action Required: [Description]
   - Owner: [Name]
   - Due Date: [YYYY-MM-DD]

### Recommendations
- [ ] [Recommendation 1]
- [ ] [Recommendation 2]
- [ ] [Recommendation 3]

### Next Week Focus
- [ ] [Priority item 1]
- [ ] [Priority item 2]
- [ ] [Priority item 3]

### Operator Sign-off
**Operator:** [Your Name]  
**Date:** [YYYY-MM-DD]  
**Time:** [HH:MM]  
**Status:** [✅ Complete / ⚠️ Issues Found / ❌ Critical Issues]  

**Notes:**
[Any additional notes or observations]

---

## 📞 Emergency Procedures

### Escalation Matrix
1. **Level 1 - Minor Issues**
   - Self-resolve using runbooks
   - Document in weekly report
   - No immediate escalation required

2. **Level 2 - Moderate Issues**
   - Notify team lead within 2 hours
   - Create incident ticket
   - Begin investigation

3. **Level 3 - Critical Issues**
   - Immediate escalation to on-call
   - Notify stakeholders within 30 minutes
   - Activate incident response plan

### Emergency Contacts
- **Primary On-Call:** [Name] - [Phone] - [Email]
- **Secondary On-Call:** [Name] - [Phone] - [Email]
- **Team Lead:** [Name] - [Phone] - [Email]
- **Railway Support:** support@railway.app
- **HighLevel Support:** [Support contact]

### Quick Reference Commands
```bash
# Emergency health check
curl -f https://your-oauth-app.up.railway.app/health && echo "OAuth OK" || echo "OAuth DOWN"
curl -f https://your-api-app.up.railway.app/health && echo "API OK" || echo "API DOWN"

# Database emergency check
psql $DATABASE_URL -c "SELECT COUNT(*) FROM hl_installations WHERE status = 'active';"

# Railway status check
railway status --project oauth-server
railway status --project api-server

# Emergency restart (use with caution)
railway redeploy --project oauth-server
railway redeploy --project api-server
```

---

**Checklist Version:** 2.1.0  
**Last Updated:** [YYYY-MM-DD]  
**Next Review:** [YYYY-MM-DD]  
**Owner:** Operations Team

*This checklist should be completed weekly and results documented in the Weekly Operations Report.*