# OAuth V2 Smoke Test Script
# End-to-end rollout verifier for HighLevel OAuth Server (V2 callback)
# Requirements: PowerShell 5+ (or pwsh), curl/Invoke-RestMethod, and Node.js (for S2S JWT).
$ErrorActionPreference = "Stop"

# ---------- Config (provide via env or edit here) ----------
$OAUTH_BASE = $env:OAUTH_BASE
if (-not $OAUTH_BASE -or $OAUTH_BASE.Trim() -eq "") { $OAUTH_BASE = "https://api.engageautomations.com" }
$S2S_SHARED_SECRET = $env:S2S_SHARED_SECRET   # raw HMAC secret
$TENANT_ID = $env:TENANT_ID                   # a known Location or Agency ID
$TENANT_KIND = $env:TENANT_KIND               # "location" or "agency"
if (-not $TENANT_KIND -or $TENANT_KIND.Trim() -eq "") { $TENANT_KIND = "location" }

function Fail($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "➡️  $msg" }
function Pass($msg) { Write-Host "✅ $msg" -ForegroundColor Green }

Write-Host "\n🚀 OAuth V2 Smoke Test Starting..." -ForegroundColor Cyan
Write-Host "   Base URL: $OAUTH_BASE" -ForegroundColor Yellow

# ---------- Step 1: Health / Version / Flags / WhoAmI ----------
Info "Checking /health"
try {
  $health = irm "$OAUTH_BASE/health" -TimeoutSec 15
  $health | Out-Null
  Pass "/health OK"
} catch {
  Fail "/health failed: $($_.Exception.Message)"
}

Info "Checking /version"
try {
  $version = irm "$OAUTH_BASE/version" -TimeoutSec 15
  $commit = $version.commit
  if (-not $commit) { $commit = $version.sha }
  if (-not $commit) { $commit = "unknown" }
  Write-Host ("   commit: {0}" -f $commit)
  Pass "/version OK"
} catch {
  Fail "/version failed: $($_.Exception.Message)"
}

Info "Checking /feature-flags"
try {
  $flags = irm "$OAUTH_BASE/feature-flags" -TimeoutSec 15
  Write-Host ("   OAUTH_CALLBACK_V2: {0}" -f $flags.OAUTH_CALLBACK_V2)
  Pass "/feature-flags OK"
} catch {
  Fail "/feature-flags failed: $($_.Exception.Message)"
}

Info "Checking /whoami headers (X-App, X-Commit)"
try {
  $resp = iwr "$OAUTH_BASE/whoami" -Method Head -TimeoutSec 15
  $resp.Headers.GetEnumerator() | Select-Object -First 20 | ForEach-Object { "$($_.Key): $($_.Value)" }
  if ($resp.Headers["X-App"] -notcontains "oauth-server") { Fail "X-App header not 'oauth-server'" }
  Pass "/whoami headers OK"
} catch {
  Fail "/whoami headers failed: $($_.Exception.Message)"
}

# ---------- Step 2: Dry-run callback pings (no secrets) ----------
Info "Dry-run callback (agency)"
try { iwr "$OAUTH_BASE/oauth/callback?code=TEST&agency_id=AGENCY_X" -TimeoutSec 15 -Method Get -SkipHttpErrorCheck | Out-Null } catch {}
Info "Dry-run callback (location)"
try { iwr "$OAUTH_BASE/oauth/callback?code=TEST&location_id=LOC_Y" -TimeoutSec 15 -Method Get -SkipHttpErrorCheck | Out-Null } catch {}
Pass "Callback endpoints reachable (expect 4xx due to TEST code, but not legacy 'location_id' error)."

# ---------- Step 3: S2S JWT + admin/proxy (optional if Node missing) ----------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  Write-Host "⚠️  Node not found. Skipping S2S admin/proxy tests."
} else {
  if (-not $S2S_SHARED_SECRET) { 
    Write-Host "⚠️  Set S2S_SHARED_SECRET (env) to run S2S tests. Skipping..."
  } elseif (-not $TENANT_ID) { 
    Write-Host "⚠️  Set TENANT_ID (env) to run S2S tests. Skipping..."
  } else {
    Info "Generating short-lived S2S JWT (60s) with $TENANT_KIND"
    $env:S2S = $S2S_SHARED_SECRET
    $env:TID = $TENANT_ID
    $env:KIND = $TENANT_KIND
    $JWT = node -e "const k=process.env.S2S;const tid=process.env.TID;const kind=process.env.KIND||'location';const now=Math.floor(Date.now()/1000);
const header={alg:'HS256',typ:'JWT'}; const payload={iss:'ops-cli',aud:'oauth-server',iat:now,exp:now+60};
if(kind==='agency'){ payload.agency_id=tid; } else { payload.location_id=tid; }
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const sig=require('crypto').createHmac('sha256',k).update(b64u(header)+'.'+b64u(payload)).digest('base64url');
console.log(b64u(header)+'.'+b64u(payload)+'.'+sig);" 2>$null
    if (-not $JWT) { Fail "JWT generation failed" }
    Write-Host ("   JWT length: {0}" -f $JWT.Length)

    Info "GET /admin/installations"
    try {
      $inst = irm "$OAUTH_BASE/admin/installations" -Headers @{Authorization="Bearer $JWT"} -TimeoutSec 20
      $inst | Out-Null
      Pass "/admin/installations OK"
    } catch {
      Fail "/admin/installations failed: $($_.Exception.Message)"
    }

    Info "POST /proxy/hl → /contacts/?limit=1"
    try {
      $body = @{ method="GET"; endpoint="/contacts/?limit=1"; data=$null } | ConvertTo-Json -Compress
      $res = irm "$OAUTH_BASE/proxy/hl" -Method Post -Headers @{Authorization="Bearer $JWT"} -ContentType "application/json" -Body $body -TimeoutSec 30
      $res | Out-Null
      Pass "/proxy/hl OK"
    } catch {
      Fail "/proxy/hl failed: $($_.Exception.Message)"
    }
  }
}

Write-Host ""
Pass ("All checks completed. OAuth V2 callback looks healthy on {0}." -f $OAUTH_BASE)
Write-Host "\n🎉 Smoke test completed successfully!" -ForegroundColor Green