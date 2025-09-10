# HighLevel OAuth Integration - Railway Deployment Kit

🚀 **Complete automation suite for deploying HighLevel OAuth integration on Railway with dual-server architecture**

## 📋 Overview

This deployment kit provides everything needed to deploy a production-ready HighLevel OAuth integration using Railway's platform. The architecture separates concerns between OAuth token management and business logic for maximum stability and security.

### 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   OAuth Server  │    │   API Server    │
│   (Stable)      │◄───┤   (Iterable)    │
├─────────────────┤    ├─────────────────┤
│ • Token Storage │    │ • Business Logic│
│ • OAuth Flow    │    │ • Workflows     │
│ • Proxy API     │    │ • Client APIs   │
│ • Security      │    │ • Webhooks      │
└─────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
│   (Railway)     │
└─────────────────┘
```

## 📁 Project Structure

```
.
├── 🚀 Deployment & Automation
│   ├── deploy_railway.ps1           # Main deployment script
│   ├── validate_deployment.ps1      # Post-deployment validation
│   └── database_migration.sql       # Database schema setup
│
├── 🖥️ Server Applications
│   ├── oauth_server.js              # OAuth & token management server
│   ├── api_server.js                # Business logic & client API server
│   └── package.json                 # Dependencies for both servers
│
├── ⚙️ Configuration
│   ├── .env.oauth.template          # OAuth server environment template
│   └── .env.api.template            # API server environment template
│
├── 📋 Operations & Monitoring
│   ├── Go_Live_Checklist.md         # Pre-production validation checklist
│   ├── Weekly_Operations_Report_Template.md  # Weekly ops reporting
│   ├── Day2_Operations_Checklist.md # Weekly maintenance tasks
│   └── resilience_test.js           # Monthly automated testing
│
└── 📚 Documentation
    ├── README.md                    # This file
    └── OAuth_Checklist_Dual_Railway.md  # Original requirements
```

## 🚀 Quick Start (10-Minute Deploy)

### Prerequisites

1. **Install Required Tools:**
   ```powershell
   # Railway CLI
   npm install -g @railway/cli
   
   # Login to Railway
   railway login
   ```

2. **HighLevel App Setup:**
   - Create app in HighLevel Marketplace
   - Note your `CLIENT_ID` and `CLIENT_SECRET`
   - Set redirect URI to: `https://api.engageautomations.com/oauth/callback`

### Automated Deployment

```powershell
# Clone or download this repository
cd "path\to\HighLevel OAuth 2.1"

# Run the automated deployment script
.\deploy_railway.ps1 `
  -HLClientId "your-highlevel-client-id" `
  -HLClientSecret "your-highlevel-client-secret" `
  -OAuthRepoUrl "https://github.com/yourusername/oauth-server.git" `
  -ApiRepoUrl "https://github.com/yourusername/api-server.git"
```

### Validation

```powershell
# Validate the deployment
.\validate_deployment.ps1 -S2SSecret "your-generated-s2s-secret" -Verbose
```

## 📖 Manual Deployment Guide

### Step 1: Repository Setup

1. **Create two GitHub repositories:**
   - `oauth-server` - Copy `oauth_server.js`, `package.json`, `.env.oauth.template`
   - `api-server` - Copy `api_server.js`, `package.json`, `.env.api.template`

2. **Test locally:**
   ```bash
   # In each repository
   npm install
   node oauth_server.js  # or api_server.js
   ```

### Step 2: Railway Projects

1. **Create OAuth Server Project:**
   ```bash
   railway project create oauth-server
   railway add postgres  # Attach PostgreSQL
   railway deploy
   ```

2. **Create API Server Project:**
   ```bash
   railway project create api-server
   railway deploy
   ```

### Step 3: Environment Variables

**OAuth Server:**
```bash
railway variables set HL_CLIENT_ID="your-client-id"
railway variables set HL_CLIENT_SECRET="your-client-secret"
railway variables set REDIRECT_URI="https://api.engageautomations.com/oauth/callback"
railway variables set DATABASE_URL="postgresql://..."  # From Railway Postgres
railway variables set ENCRYPTION_KEY="$(openssl rand -base64 32)"
railway variables set S2S_SHARED_SECRET="$(openssl rand -base64 32)"
```

**API Server:**
```bash
railway variables set OAUTH_BASE_URL="https://api.engageautomations.com"
railway variables set S2S_SHARED_SECRET="same-as-oauth-server"
railway variables set DEFAULT_SCOPE="location"
```

### Step 4: Database Migration

```sql
-- Run in Railway Postgres console
-- Copy contents from database_migration.sql
CREATE TABLE IF NOT EXISTS hl_installations (
  id SERIAL PRIMARY KEY,
  -- ... (see database_migration.sql for full schema)
);
```

### Step 5: Go-Live Validation

Follow the comprehensive checklist in <mcfile name="Go_Live_Checklist.md" path="c:\Users\Computer\Documents\Engage Automations\GoHighLevel Ouath 2.1\Go_Live_Checklist.md"></mcfile>

## 🔧 Configuration Details

### OAuth Server Environment

| Variable | Description | Required |
|----------|-------------|----------|
| `HL_CLIENT_ID` | HighLevel app client ID | ✅ |
| `HL_CLIENT_SECRET` | HighLevel app client secret | ✅ |
| `REDIRECT_URI` | OAuth callback URL | ✅ |
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `ENCRYPTION_KEY` | AES-256 encryption key (base64) | ✅ |
| `S2S_SHARED_SECRET` | Service-to-service auth secret | ✅ |
| `NODE_ENV` | Environment (production/development) | ⚠️ |
| `PORT` | Server port (default: 3000) | ⚠️ |

### API Server Environment

| Variable | Description | Required |
|----------|-------------|----------|
| `OAUTH_BASE_URL` | OAuth server base URL | ✅ |
| `S2S_SHARED_SECRET` | Must match OAuth server | ✅ |
| `DEFAULT_SCOPE` | Default HighLevel scope | ✅ |
| `NODE_ENV` | Environment (production/development) | ⚠️ |
| `PORT` | Server port (default: 3000) | ⚠️ |

## 🔒 Security Features

### OAuth Server Security
- 🔐 **AES-256 Encryption** - All tokens encrypted at rest
- 🛡️ **JWT Authentication** - Service-to-service communication
- 🚫 **Endpoint Allow-listing** - Restricted HighLevel API access
- ⚡ **Rate Limiting** - DDoS protection
- 📝 **Audit Logging** - Complete access trail
- 🔒 **HTTPS Only** - TLS encryption in transit

### API Server Security
- 🔑 **JWT Validation** - All requests authenticated
- ✅ **Request Validation** - Input sanitization
- 🛡️ **CORS Protection** - Cross-origin security
- 📊 **Rate Limiting** - API abuse prevention
- 🔍 **Webhook Verification** - Signature validation

## 📊 Monitoring & Operations

### Health Endpoints
- **OAuth Server:** `GET /health` - System status
- **API Server:** `GET /health` - System status
- **Metrics:** `GET /metrics` - Performance data

### Weekly Operations

1. **Run Weekly Report:**
   ```powershell
   # Use template in Weekly_Operations_Report_Template.md
   ```

2. **Execute Day-2 Checklist:**
   ```powershell
   # Follow Day2_Operations_Checklist.md
   ```

3. **Monthly Resilience Test:**
   ```bash
   node resilience_test.js
   ```

## 🚨 Troubleshooting

### Common Issues

**Deployment Fails:**
```powershell
# Check prerequisites
.\deploy_railway.ps1 -DryRun

# Validate after fixes
.\validate_deployment.ps1 -Verbose
```

**Health Checks Fail:**
```bash
# Check Railway logs
railway logs

# Verify environment variables
railway variables
```

**Database Connection Issues:**
```sql
-- Test in Railway Postgres console
SELECT 1;

-- Check table exists
\dt hl_installations
```

**Authentication Errors:**
```bash
# Verify S2S secret matches between servers
echo $S2S_SHARED_SECRET

# Test with curl
curl -H "Authorization: Bearer $S2S_SECRET" https://oauth-url/admin/installations
```

### Emergency Procedures

**OAuth Server Down:**
1. Check Railway deployment status
2. Verify environment variables
3. Check database connectivity
4. Review application logs
5. Redeploy if necessary (⚠️ **Will require client re-installs**)

**API Server Down:**
1. Check Railway deployment status
2. Verify OAuth server connectivity
3. Check environment variables
4. Redeploy (✅ **Safe - no client impact**)

## 📞 Support & Maintenance

### Regular Tasks
- **Daily:** Monitor health endpoints
- **Weekly:** Run operations checklist
- **Monthly:** Execute resilience tests
- **Quarterly:** Security audit and updates

### Key Metrics to Monitor
- Response times (< 500ms target)
- Error rates (< 1% target)
- Token refresh success rate (> 99%)
- Database connection pool usage
- Memory and CPU utilization

### Scaling Considerations
- **OAuth Server:** Vertical scaling only (maintain session consistency)
- **API Server:** Horizontal scaling supported
- **Database:** Railway Postgres auto-scaling

## 🔄 Updates & Maintenance

### Safe Update Process

**API Server Updates (Safe):**
```bash
# Update code
git push origin main

# Railway auto-deploys
# No client impact
```

**OAuth Server Updates (Risky):**
```bash
# Only for critical security updates
# Plan maintenance window
# Notify clients of potential re-install requirement
```

### Version Management
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Tag releases in Git
- Maintain changelog
- Test in staging environment first

## 📚 Additional Resources

- **HighLevel API Documentation:** [https://highlevel.stoplight.io/](https://highlevel.stoplight.io/)
- **Railway Documentation:** [https://docs.railway.app/](https://docs.railway.app/)
- **OAuth 2.0 Specification:** [https://tools.ietf.org/html/rfc6749](https://tools.ietf.org/html/rfc6749)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Test thoroughly
4. Submit pull request
5. Update documentation

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**⚠️ Important Notes:**
- Always test in staging before production
- Keep secrets secure and rotate regularly
- Monitor logs for security events
- Backup database regularly
- Follow Railway best practices

**🎯 Success Criteria:**
- ✅ Health endpoints return 200 OK
- ✅ OAuth flow completes successfully
- ✅ Tokens stored and refreshed automatically
- ✅ API calls proxy correctly to HighLevel
- ✅ Security tests pass
- ✅ Performance meets SLA requirements

**Need Help?** Check the troubleshooting section or review the operational checklists for step-by-step guidance.