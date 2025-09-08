# 🚀 Next Steps Guide
## HighLevel OAuth Integration - Infrastructure Setup & Deployment

> **Current Status**: All code and scripts are ready. Now we need to set up cloud infrastructure and deploy.

---

## 🎯 Phase 1: GitHub Repository Setup (15 minutes)

### Step 1.1: Create OAuth Server Repository
```bash
# Create new repository on GitHub
# Repository name: oauth-server
# Description: HighLevel OAuth Server - Token Management & Proxy
# Visibility: Private (recommended for production)
```

### Step 1.2: Create API Server Repository
```bash
# Create new repository on GitHub
# Repository name: api-server
# Description: HighLevel API Server - Business Logic & Workflows
# Visibility: Private (recommended for production)
```

### Step 1.3: Initialize and Push OAuth Server
```powershell
# Create OAuth server directory and files
mkdir oauth-server
cd oauth-server

# Initialize git
git init
git branch -M main

# Copy OAuth server files
copy "..\oauth_server.js" "server.js"
copy "..\package.json" "."
copy "..\database_migration.sql" "."
copy "..\resilience_test.js" "."
copy "..\.env.oauth.template" ".env.template"
copy "..\.gitignore" "."

# Create README for OAuth server
echo "# HighLevel OAuth Server\n\nToken management and secure proxy for HighLevel API integration.\n\n## Setup\n1. Copy .env.template to .env\n2. Configure environment variables\n3. Deploy to Railway\n\n## Security\n- AES-256 token encryption\n- JWT service-to-service auth\n- Rate limiting and CORS protection" > README.md

# Commit and push
git add .
git commit -m "Initial OAuth server setup with security features"
git remote add origin https://github.com/YOUR_USERNAME/oauth-server.git
git push -u origin main

cd ..
```

### Step 1.4: Initialize and Push API Server
```powershell
# Create API server directory and files
mkdir api-server
cd api-server

# Initialize git
git init
git branch -M main

# Copy API server files
copy "..\api_server.js" "server.js"
copy "..\package.json" "."
copy "..\.env.api.template" ".env.template"
copy "..\.gitignore" "."

# Create README for API server
echo "# HighLevel API Server\n\nBusiness logic and workflow automation for HighLevel integration.\n\n## Setup\n1. Copy .env.template to .env\n2. Configure OAuth server URL\n3. Deploy to Railway\n\n## Features\n- Secure OAuth proxy integration\n- Business workflow automation\n- Webhook handling" > README.md

# Commit and push
git add .
git commit -m "Initial API server setup with business logic"
git remote add origin https://github.com/YOUR_USERNAME/api-server.git
git push -u origin main

cd ..
```

---

## 🚂 Phase 2: Railway Project Setup (10 minutes)

### Step 2.1: Create OAuth Server Project
```bash
# In Railway Dashboard (https://railway.app/dashboard):
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose your oauth-server repository
4. Project name: "highlevel-oauth-server"
5. Add Postgres database:
   - Click "+ New"
   - Select "Database" → "PostgreSQL"
   - Name: "oauth-db"
```

### Step 2.2: Create API Server Project
```bash
# In Railway Dashboard:
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose your api-server repository
4. Project name: "highlevel-api-server"
```

### Step 2.3: Note Railway URLs
```
# Save these URLs for configuration:
OAuth Server: https://highlevel-oauth-server-production.up.railway.app
API Server: https://highlevel-api-server-production.up.railway.app
```

---

## 🔑 Phase 3: HighLevel App Registration (5 minutes)

### Step 3.1: Register Application
```bash
# Go to HighLevel Developer Portal:
# https://marketplace.gohighlevel.com/

1. Click "Create New App"
2. Fill in app details:
   - App Name: "Your Integration Name"
   - Description: "OAuth integration for [your purpose]"
   - Category: Select appropriate category
   - Scopes: Select required permissions

3. OAuth Configuration:
   - Redirect URI: https://highlevel-oauth-server-production.up.railway.app/oauth/callback
   - Webhook URL: https://highlevel-api-server-production.up.railway.app/webhooks/hl

4. Save and note:
   - Client ID
   - Client Secret
```

---

## ⚙️ Phase 4: Automated Deployment (5 minutes)

### Step 4.1: Prepare Deployment
```powershell
# Ensure you have:
# ✅ HighLevel Client ID
# ✅ HighLevel Client Secret
# ✅ GitHub repository URLs
# ✅ Railway projects created
```

### Step 4.2: Execute Deployment
```powershell
# Run the automated deployment script
.\deploy_railway.ps1 `
  -HLClientId "YOUR_HL_CLIENT_ID" `
  -HLClientSecret "YOUR_HL_CLIENT_SECRET" `
  -OAuthRepoUrl "https://github.com/YOUR_USERNAME/oauth-server.git" `
  -ApiRepoUrl "https://github.com/YOUR_USERNAME/api-server.git" `
  -Environment "production"
```

### Step 4.3: Validate Deployment
```powershell
# Run validation script with generated S2S secret
.\validate_deployment.ps1 -S2SSecret "GENERATED_S2S_SECRET" -Verbose
```

---

## 🧪 Phase 5: Production Testing (10 minutes)

### Step 5.1: Health Check
```powershell
# Test both services
curl https://highlevel-oauth-server-production.up.railway.app/health
curl https://highlevel-api-server-production.up.railway.app/health

# Expected: Both return 200 OK with status "healthy"
```

### Step 5.2: First Installation
```bash
# From HighLevel:
1. Go to your agency/location
2. Navigate to Settings → Integrations
3. Find your app and click "Install"
4. Complete OAuth flow
5. Verify installation success
```

### Step 5.3: Test API Integration
```powershell
# Test live data retrieval
$tenantId = "YOUR_LOCATION_ID"
curl "https://highlevel-api-server-production.up.railway.app/test/contacts?tenantId=$tenantId&scope=location"

# Expected: 200 OK with contact data or empty array
```

---

## 📊 Phase 6: Monitoring Setup (5 minutes)

### Step 6.1: Verify Metrics
```powershell
# Check metrics endpoint
curl https://highlevel-oauth-server-production.up.railway.app/metrics

# Look for:
# - token_refresh_total
# - proxy_requests_total
# - auth_failures_total
```

### Step 6.2: Set Up Alerts
```bash
# In Railway Dashboard:
1. Go to each project
2. Navigate to "Observability"
3. Set up alerts for:
   - High error rates (>5%)
   - Response time spikes (>5s)
   - Memory usage (>80%)
```

---

## ✅ Success Criteria

### Technical Validation
- [ ] Both Railway services deployed and healthy
- [ ] Database migration applied successfully
- [ ] HighLevel OAuth flow working
- [ ] API endpoints returning data
- [ ] Security controls active (JWT, rate limiting)
- [ ] Metrics collection working

### Business Validation
- [ ] At least one successful installation
- [ ] Live data retrieval working
- [ ] Webhook processing functional
- [ ] Error handling graceful

---

## 🚨 Troubleshooting Quick Reference

### Common Issues & Fixes

**Deployment Fails**
```powershell
# Check Railway logs
railway logs --service oauth-server
railway logs --service api-server

# Common fixes:
# - Verify environment variables
# - Check database connection
# - Ensure GitHub repo access
```

**OAuth Flow Fails**
```bash
# Verify redirect URI matches exactly
# Check HighLevel app configuration
# Confirm client ID/secret are correct
```

**API Returns 401/403**
```powershell
# Check S2S secret matches between services
railway variables --service oauth-server | grep S2S
railway variables --service api-server | grep S2S
```

---

## 📞 Support Resources

### Documentation
- **Production Runbook**: `Production_Deployment_Runbook.md`
- **Quick Reference**: `Production_Quick_Reference.md`
- **Operations Checklist**: `Day2_Operations_Checklist.md`

### Emergency Contacts
- **Railway Status**: https://status.railway.app/
- **HighLevel Status**: https://status.gohighlevel.com/
- **GitHub Status**: https://www.githubstatus.com/

---

## 🎉 Next Steps After Go-Live

1. **Week 1**: Complete first weekly operations report
2. **Month 1**: Run monthly resilience test
3. **Ongoing**: Monitor metrics and optimize performance
4. **Scale**: Add additional features and integrations

---

**🚀 Ready to deploy? Start with Phase 1 and work through each phase systematically.**

*Remember: Take your time with each phase and validate before moving to the next step.*