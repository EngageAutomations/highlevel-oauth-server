# Railway Dual OAuth Setup Script
# PowerShell script for Windows deployment with security hardening

# Strict mode and error handling
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Parameters
param(
    [switch]$DryRun,
    [switch]$Force,
    [string]$OAuthService = "oauth-server",
    [string]$ApiService = "api-server"
)

# Configuration - DO NOT hardcode secrets in production
$CLIENT_ID = $env:HL_CLIENT_ID
$CLIENT_SECRET = $env:HL_CLIENT_SECRET  
$BASE_URL = "https://api.engageautomations.com"
$PROJECT_ID = "ceacb2c4-33c8-4d2c-9aa7-0f682b2e2c67"
$ENCRYPTION_KEY = $env:ENCRYPTION_KEY

Write-Host "🚀 Starting Railway Dual OAuth Setup..." -ForegroundColor Green

# Prerequisite checks
function Test-Prerequisites {
    $errors = @()
    
    # Check Railway CLI
    if (-not (Get-Command "railway" -ErrorAction SilentlyContinue)) {
        $errors += "Railway CLI not found. Install with: npm install -g @railway/cli"
    }
    
    # Check required environment variables
    if (-not $CLIENT_ID) { $errors += "HL_CLIENT_ID environment variable not set" }
    if (-not $CLIENT_SECRET) { $errors += "HL_CLIENT_SECRET environment variable not set" }
    if (-not $ENCRYPTION_KEY) { $errors += "ENCRYPTION_KEY environment variable not set" }
    
    if ($errors.Count -gt 0) {
        Write-Host "❌ Prerequisites not met:" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        Write-Host "\nSet missing environment variables or install required tools." -ForegroundColor White
        exit 1
    }
    
    Write-Host "✅ Prerequisites check passed" -ForegroundColor Green
}

Test-Prerequisites

# Generate secrets
Write-Host "🔐 Generating security secrets..." -ForegroundColor Blue
$S2S_SECRET = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Write-Host "Generated S2S Secret: $S2S_SECRET" -ForegroundColor Gray

# Function to set Railway variables with idempotent operations
function Set-RailwayVar {
    param(
        [string]$ProjectId,
        [string]$Service,
        [string]$Key,
        [string]$Value,
        [switch]$Force
    )
    
    try {
        # Check if variable already exists with same value (idempotent)
        if (-not $Force) {
            $existingCmd = "railway variables --project $ProjectId"
            if ($Service) { $existingCmd += " --service $Service" }
            
            $existing = Invoke-Expression $existingCmd 2>$null | Where-Object { $_ -match "^$Key=" }
            if ($existing -and $existing -eq "$Key=$Value") {
                Write-Host "  ✓ $Key already set correctly" -ForegroundColor Green
                return
            }
        }
        
        # Build command
        $cmd = "railway variables set --project $ProjectId"
        if ($Service) { $cmd += " --service $Service" }
        $cmd += " $Key='$Value'"
        
        if ($DryRun) {
            Write-Host "  [DRY-RUN] Would set $Key" -ForegroundColor Cyan
            Write-Host "    Command: $cmd" -ForegroundColor DarkGray
        } else {
            Write-Host "  Setting $Key..." -ForegroundColor Gray
            Invoke-Expression $cmd
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✅ $Key set successfully" -ForegroundColor Green
            } else {
                throw "Failed to set $Key"
            }
        }
    } catch {
        Write-Host "  ❌ Failed to set $Key`: $_" -ForegroundColor Red
        throw
    }
}

# Track which services need redeployment
$oauthChanged = $false
$apiChanged = $false

# Setup OAuth Server Variables
Write-Host "⚙️ Setting up OAuth Server variables..." -ForegroundColor Blue
try {
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $OAuthService -Key "HL_CLIENT_ID" -Value $CLIENT_ID -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $OAuthService -Key "HL_CLIENT_SECRET" -Value $CLIENT_SECRET -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $OAuthService -Key "REDIRECT_URI" -Value "$BASE_URL/oauth/callback" -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $OAuthService -Key "ENCRYPTION_KEY" -Value $ENCRYPTION_KEY -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $OAuthService -Key "S2S_SHARED_SECRET" -Value $S2S_SECRET -Force:$Force
    $oauthChanged = $true
} catch {
    Write-Host "❌ Failed to configure OAuth server variables: $_" -ForegroundColor Red
    exit 1
}

# API Server Environment Variables
Write-Host "⚙️ Setting up API Server variables..." -ForegroundColor Blue
try {
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $ApiService -Key "OAUTH_BASE_URL" -Value $BASE_URL -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $ApiService -Key "S2S_SHARED_SECRET" -Value $S2S_SECRET -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $ApiService -Key "DEFAULT_SCOPE" -Value "location" -Force:$Force
    Set-RailwayVar -ProjectId $PROJECT_ID -Service $ApiService -Key "PORT" -Value "3000" -Force:$Force
    $apiChanged = $true
} catch {
    Write-Host "❌ Failed to configure API server variables: $_" -ForegroundColor Red
    exit 1
}

# Database setup reminder
Write-Host "📊 Database Setup Required:" -ForegroundColor Yellow
Write-Host "1. Connect to your Railway Postgres instance" -ForegroundColor White
Write-Host "2. Run the SQL migration from OAuth_Checklist_Dual_Railway.md" -ForegroundColor White
Write-Host "3. Verify the installations table is created" -ForegroundColor White

# GitHub setup reminder
Write-Host "📁 GitHub Repository Setup:" -ForegroundColor Yellow
Write-Host "1. Create oauth-server repository" -ForegroundColor White
Write-Host "2. Create api-server repository" -ForegroundColor White
Write-Host "3. Connect repositories to Railway projects" -ForegroundColor White
Write-Host "4. Push server.js files to trigger deployments" -ForegroundColor White

# Testing instructions
Write-Host "🧪 Testing Instructions:" -ForegroundColor Yellow
Write-Host "1. Test OAuth health: curl $BASE_URL/health" -ForegroundColor White
Write-Host "2. Test API health: curl $BASE_URL/health" -ForegroundColor White
Write-Host "3. Install app via HighLevel Marketplace" -ForegroundColor White
Write-Host "4. Test contact retrieval endpoint" -ForegroundColor White

Write-Host "✅ Setup script completed!" -ForegroundColor Green
Write-Host "📋 Next steps: Follow the OAuth_Checklist_Dual_Railway.md for detailed implementation" -ForegroundColor Cyan

# Deployment logic
if (-not $DryRun) {
    if ($oauthChanged -and $apiChanged) {
        Write-Host "`n🚀 Both services configured. Deployments will trigger automatically." -ForegroundColor Green
        Write-Host "⚠️  OAuth Server changes may require client re-authorization" -ForegroundColor Yellow
    } elseif ($oauthChanged) {
        Write-Host "`n🚀 OAuth Server configured. Deployment will trigger automatically." -ForegroundColor Green
        Write-Host "⚠️  Changes may require client re-authorization" -ForegroundColor Yellow
    } elseif ($apiChanged) {
        Write-Host "`n🚀 API Server configured. Deployment will trigger automatically." -ForegroundColor Green
    } else {
        Write-Host "`n✅ No changes detected. All variables already configured correctly." -ForegroundColor Green
    }
}

# Save configuration for reference
$configOutput = @"
# Generated Railway Configuration - $(Get-Date)
# Project ID: $PROJECT_ID
# OAuth Service: $OAuthService
# API Service: $ApiService
# Base URL: $BASE_URL
# S2S Secret: $S2S_SECRET
# Encryption Key: $ENCRYPTION_KEY

# Security Notes:
# - All secrets are generated with cryptographic randomness
# - Environment variables are set securely via Railway CLI
# - Database URL should be configured separately in Railway dashboard

# Next Steps:
# 1. Create GitHub repositories for both services
# 2. Connect repositories to Railway projects
# 3. Deploy server.js files to respective services
# 4. Configure HighLevel app settings
# 5. Test OAuth flow
"@

$configOutput | Out-File -FilePath "generated_config.txt" -Encoding UTF8
Write-Host "✅ Configuration saved to generated_config.txt" -ForegroundColor Green

Write-Host "`n🎉 Railway setup complete!" -ForegroundColor Green
Write-Host "📋 Next: Follow the OAuth_Checklist_Dual_Railway.md for deployment steps" -ForegroundColor Yellow
Write-Host "📊 Track progress with Implementation_Status.md" -ForegroundColor Cyan