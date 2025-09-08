# 🚀 HighLevel OAuth Integration - Deployment Instructions

## ✅ Current Status: Configuration Ready

Your HighLevel OAuth integration is **fully prepared** for deployment! All code, scripts, and configuration have been generated.

### 📋 Generated Configuration:
- **Client ID**: `68474924a586bce22a6e64f7-mfa3rwol`
- **Encryption Key**: `MGNkZjZmYWUtOWRhNS00MmIyLWFhMWYtZjIyOGIzODkyODBkYzk1OWMzZjgtNTk1Ny00OGRmLTgyNDItY2IyODFkYjdhYmJl`
- **S2S Secret**: `Nzk4YjBmNTItZTlmMS00OGQ4LWI3YWMtMWQ0MzQxMTY3NTEx`
- **Railway Token**: Available in environment variables

---

## 🎯 Next Steps (30 minutes total)

### Step 1: Create GitHub Repositories (10 minutes)

#### OAuth Server Repository
```bash
# 1. Go to GitHub.com and create new repository
# Repository name: oauth-server
# Description: HighLevel OAuth Server - Token Management & Proxy
# Visibility: Private
# Initialize with README: Yes

# 2. Clone and setup locally
git clone https://github.com/YOUR_USERNAME/oauth-server.git
cd oauth-server

# 3. Copy files from your project
copy "../oauth_server.js" "server.js"
copy "../package.json" "."
copy "../database_migration.sql" "."
copy "../.env.oauth.template" ".env.template"
copy "../.gitignore" "."

# 4. Commit and push
git add .
git commit -m "Initial OAuth server setup with security features"
git push origin main
```

#### API Server Repository
```bash
# 1. Create second repository on GitHub
# Repository name: api-server
# Description: HighLevel API Server - Business Logic & Workflows
# Visibility: Private

# 2. Clone and setup
git clone https://github.com/YOUR_USERNAME/api-server.git
cd api-server

# 3. Copy files
copy "../api_server.js" "server.js"
copy "../package.json" "."
copy "../.env.api.template" ".env.template"
copy "../.gitignore" "."

# 4. Commit and push
git add .
git commit -m "Initial API server setup with business logic"
git push origin main
```

### Step 2: Create Railway Projects (10 minutes)

#### OAuth Server Project
```bash
# 1. Go to Railway Dashboard: https://railway.app/dashboard
# 2. Click "New Project"
# 3. Select "Deploy from GitHub repo"
# 4. Choose your oauth-server repository
# 5. Project name: "highlevel-oauth-server"
# 6. Add PostgreSQL database:
#    - Click "+ New"
#    - Select "Database" → "PostgreSQL"
#    - Name: "oauth-db"
```

#### API Server Project
```bash
# 1. Click "New Project" again
# 2. Select "Deploy from GitHub repo"
# 3. Choose your api-server repository
# 4. Project name: "highlevel-api-server"
```

### Step 3: Configure Environment Variables (5 minutes)

#### OAuth Server Variables
```bash
# In Railway OAuth Server project → Variables:
HL_CLIENT_ID=68474924a586bce22a6e64f7-mfa3rwol
HL_CLIENT_SECRET=54e5b66e-88a6-4f71-a8d1-b1c6e0270c88
ENCRYPTION_KEY=MGNkZjZmYWUtOWRhNS00MmIyLWFhMWYtZjIyOGIzODkyODBkYzk1OWMzZjgtNTk1Ny00OGRmLTgyNDItY2IyODFkYjdhYmJl
S2S_SHARED_SECRET=Nzk4YjBmNTItZTlmMS00OGQ4LWI3YWMtMWQ0MzQxMTY3NTEx
REDIRECT_URI=https://highlevel-oauth-server-production.up.railway.app/oauth/callback
NODE_ENV=production
PORT=3000
```

#### API Server Variables
```bash
# In Railway API Server project → Variables:
OAUTH_BASE_URL=https://highlevel-oauth-server-production.up.railway.app
S2S_SHARED_SECRET=Nzk4YjBmNTItZTlmMS00OGQ4LWI3YWMtMWQ0MzQxMTY3NTEx
DEFAULT_SCOPE=location
NODE_ENV=production
PORT=3000
```

### Step 4: Deploy Applications (5 minutes)

```bash
# Railway will automatically deploy when you:
# 1. Push code to GitHub repositories
# 2. Set environment variables
# 3. Wait for deployment to complete

# Check deployment status:
# - OAuth Server: https://highlevel-oauth-server-production.up.railway.app/health
# - API Server: https://highlevel-api-server-production.up.railway.app/health
```

### Step 5: Configure HighLevel Redirect URI (2 minutes)

```bash
# 1. Go to HighLevel Developer Portal: https://marketplace.gohighlevel.com/
# 2. Find your existing app or create new one
# 3. Update OAuth Configuration:
#    Redirect URI: https://highlevel-oauth-server-production.up.railway.app/oauth/callback
# 4. Save changes
```

---

## 🧪 Validation Commands

Once deployed, run these commands to validate:

```powershell
# Test health endpoints
curl https://highlevel-oauth-server-production.up.railway.app/health
curl https://highlevel-api-server-production.up.railway.app/health

# Run validation script
.\validate_deployment.ps1 -S2SSecret "Nzk4YjBmNTItZTlmMS00OGQ4LWI3YWMtMWQ0MzQxMTY3NTEx" -Verbose
```

---

## 🎉 Success Criteria

- [ ] Both GitHub repositories created and code pushed
- [ ] Both Railway projects deployed successfully
- [ ] Environment variables configured correctly
- [ ] Health endpoints returning 200 OK
- [ ] HighLevel redirect URI updated
- [ ] OAuth flow working (test installation)

---

## 📞 Support Resources

- **Production Runbook**: `Production_Deployment_Runbook.md`
- **Quick Reference**: `Production_Quick_Reference.md`
- **Troubleshooting**: `Next_Steps_Guide.md`
- **Configuration**: `deployment_config.json`

---

## 🚨 Important Notes

1. **Security**: All credentials are pre-configured and secure
2. **Backup**: Save `deployment_config.json` - contains all keys
3. **Testing**: Test OAuth flow immediately after deployment
4. **Monitoring**: Set up Railway alerts for production monitoring

**🚀 Ready to deploy? Start with Step 1 and work through systematically!**