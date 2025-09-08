#!/usr/bin/env node

/**
 * ============================================================
 * HighLevel OAuth Integration - Monthly Resilience Test
 * ============================================================
 * 
 * This script performs comprehensive testing of both OAuth and API servers
 * to validate security, functionality, and resilience.
 * 
 * Run monthly or after major deployments to ensure system health.
 * 
 * Usage:
 *   node resilience_test.js --oauth-url=https://oauth.railway.app --api-url=https://api.railway.app
 * 
 * Environment Variables Required:
 *   - S2S_SHARED_SECRET: Service-to-service authentication secret
 *   - TEST_LOCATION_ID: Test HighLevel location ID
 *   - SLACK_WEBHOOK_URL: (Optional) For notifications
 * ============================================================
 */

const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { performance } = require('perf_hooks');

// Configuration
const config = {
  oauthUrl: process.argv.find(arg => arg.startsWith('--oauth-url='))?.split('=')[1] || process.env.OAUTH_BASE_URL,
  apiUrl: process.argv.find(arg => arg.startsWith('--api-url='))?.split('=')[1] || process.env.API_BASE_URL,
  s2sSecret: process.env.S2S_SHARED_SECRET,
  testLocationId: process.env.TEST_LOCATION_ID || 'test-location-resilience',
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  timeout: 30000, // 30 seconds
  retries: 3
};

// Test results storage
const testResults = {
  timestamp: new Date().toISOString(),
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: [],
  metrics: {
    totalDuration: 0,
    avgResponseTime: 0,
    slowestEndpoint: null,
    fastestEndpoint: null
  }
};

// Utility functions
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, message, data };
  
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
  
  return logEntry;
}

function generateS2SToken(payload = {}) {
  if (!config.s2sSecret) {
    throw new Error('S2S_SHARED_SECRET not configured');
  }
  
  return jwt.sign({
    iss: 'resilience-test',
    aud: 'oauth-server',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    ...payload
  }, config.s2sSecret);
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    
    const req = https.request(url, {
      timeout: config.timeout,
      ...options
    }, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        try {
          const parsedData = data ? JSON.parse(data) : null;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: parsedData,
            duration,
            url
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data,
            duration,
            url
          });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${config.timeout}ms`));
    });
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

async function runTest(name, testFn, category = 'general') {
  const startTime = performance.now();
  
  try {
    log('info', `Running test: ${name}`);
    const result = await testFn();
    const duration = performance.now() - startTime;
    
    testResults.tests.push({
      name,
      category,
      status: 'passed',
      duration,
      result
    });
    
    testResults.passed++;
    log('success', `✓ ${name} (${duration.toFixed(2)}ms)`);
    
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    
    testResults.tests.push({
      name,
      category,
      status: 'failed',
      duration,
      error: error.message,
      stack: error.stack
    });
    
    testResults.failed++;
    log('error', `✗ ${name} (${duration.toFixed(2)}ms)`, { error: error.message });
    
    throw error;
  }
}

// Test suites
class HealthTests {
  static async oauthHealthCheck() {
    const response = await makeRequest(`${config.oauthUrl}/health`);
    
    if (response.statusCode !== 200) {
      throw new Error(`OAuth health check failed: ${response.statusCode}`);
    }
    
    if (!response.data || response.data.status !== 'healthy') {
      throw new Error('OAuth server reports unhealthy status');
    }
    
    return { responseTime: response.duration, status: response.data };
  }
  
  static async apiHealthCheck() {
    const response = await makeRequest(`${config.apiUrl}/health`);
    
    if (response.statusCode !== 200) {
      throw new Error(`API health check failed: ${response.statusCode}`);
    }
    
    return { responseTime: response.duration, status: response.data };
  }
  
  static async oauthMetrics() {
    const token = generateS2SToken();
    const response = await makeRequest(`${config.oauthUrl}/metrics`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.statusCode !== 200) {
      throw new Error(`Metrics endpoint failed: ${response.statusCode}`);
    }
    
    // Validate metrics structure
    const metrics = response.data;
    const requiredMetrics = ['total_installations', 'active_installations', 'avg_response_time'];
    
    for (const metric of requiredMetrics) {
      if (!(metric in metrics)) {
        throw new Error(`Missing required metric: ${metric}`);
      }
    }
    
    return metrics;
  }
}

class SecurityTests {
  static async unauthorizedAccess() {
    // Test accessing protected endpoint without token
    const response = await makeRequest(`${config.oauthUrl}/admin/installations`);
    
    if (response.statusCode !== 401) {
      throw new Error(`Expected 401 for unauthorized access, got ${response.statusCode}`);
    }
    
    return { blocked: true };
  }
  
  static async invalidTokenAccess() {
    // Test with invalid JWT token
    const response = await makeRequest(`${config.oauthUrl}/admin/installations`, {
      headers: {
        'Authorization': 'Bearer invalid.jwt.token',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.statusCode !== 401) {
      throw new Error(`Expected 401 for invalid token, got ${response.statusCode}`);
    }
    
    return { blocked: true };
  }
  
  static async expiredTokenAccess() {
    // Generate expired token
    const expiredToken = jwt.sign({
      iss: 'resilience-test',
      aud: 'oauth-server',
      iat: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      exp: Math.floor(Date.now() / 1000) - 1800  // 30 minutes ago
    }, config.s2sSecret);
    
    const response = await makeRequest(`${config.oauthUrl}/admin/installations`, {
      headers: {
        'Authorization': `Bearer ${expiredToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.statusCode !== 401) {
      throw new Error(`Expected 401 for expired token, got ${response.statusCode}`);
    }
    
    return { blocked: true };
  }
  
  static async rateLimitTest() {
    // Test rate limiting by making rapid requests
    const requests = [];
    const token = generateS2SToken();
    
    for (let i = 0; i < 20; i++) {
      requests.push(
        makeRequest(`${config.oauthUrl}/health`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(e => ({ error: e.message }))
      );
    }
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.some(r => r.statusCode === 429);
    
    // Rate limiting is optional but recommended
    if (!rateLimited) {
      testResults.warnings++;
      log('warning', 'No rate limiting detected - consider implementing');
    }
    
    return { rateLimited, totalRequests: responses.length };
  }
}

class FunctionalTests {
  static async proxyEndpoint() {
    const token = generateS2SToken({ location_id: config.testLocationId });
    
    // Test proxy endpoint with allowed HighLevel API call
    const response = await makeRequest(`${config.oauthUrl}/proxy/hl`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        method: 'GET',
        endpoint: '/locations/' + config.testLocationId,
        headers: {}
      })
    });
    
    // Should get 401/403 for test location (expected)
    if (![200, 401, 403, 404].includes(response.statusCode)) {
      throw new Error(`Unexpected proxy response: ${response.statusCode}`);
    }
    
    return { proxyWorking: true, statusCode: response.statusCode };
  }
  
  static async installationsEndpoint() {
    const token = generateS2SToken();
    
    const response = await makeRequest(`${config.oauthUrl}/admin/installations`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.statusCode !== 200) {
      throw new Error(`Installations endpoint failed: ${response.statusCode}`);
    }
    
    // Validate response structure
    if (!Array.isArray(response.data)) {
      throw new Error('Installations endpoint should return array');
    }
    
    return { installationCount: response.data.length };
  }
  
  static async databaseConnectivity() {
    // Test database connectivity through metrics endpoint
    const metrics = await HealthTests.oauthMetrics();
    
    // If we can get metrics, database is working
    if (typeof metrics.total_installations !== 'number') {
      throw new Error('Database connectivity issue - invalid metrics');
    }
    
    return { connected: true, totalInstallations: metrics.total_installations };
  }
}

class PerformanceTests {
  static async responseTimeTest() {
    const endpoints = [
      { name: 'OAuth Health', url: `${config.oauthUrl}/health` },
      { name: 'API Health', url: `${config.apiUrl}/health` }
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      const times = [];
      
      // Make 5 requests to get average
      for (let i = 0; i < 5; i++) {
        const response = await makeRequest(endpoint.url);
        times.push(response.duration);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      
      results.push({
        name: endpoint.name,
        avgResponseTime: avgTime,
        maxResponseTime: maxTime,
        url: endpoint.url
      });
      
      // Warn if response time is too slow
      if (avgTime > 2000) {
        testResults.warnings++;
        log('warning', `Slow response time for ${endpoint.name}: ${avgTime.toFixed(2)}ms`);
      }
    }
    
    return results;
  }
  
  static async concurrencyTest() {
    // Test handling concurrent requests
    const concurrentRequests = 10;
    const requests = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        makeRequest(`${config.oauthUrl}/health`)
          .catch(e => ({ error: e.message }))
      );
    }
    
    const startTime = performance.now();
    const responses = await Promise.all(requests);
    const totalTime = performance.now() - startTime;
    
    const successful = responses.filter(r => r.statusCode === 200).length;
    const failed = responses.filter(r => r.error || r.statusCode !== 200).length;
    
    if (failed > concurrentRequests * 0.1) { // Allow 10% failure rate
      throw new Error(`Too many concurrent request failures: ${failed}/${concurrentRequests}`);
    }
    
    return {
      totalRequests: concurrentRequests,
      successful,
      failed,
      totalTime,
      avgTimePerRequest: totalTime / concurrentRequests
    };
  }
}

// Notification functions
async function sendSlackNotification(results) {
  if (!config.slackWebhook) return;
  
  const color = results.failed > 0 ? 'danger' : results.warnings > 0 ? 'warning' : 'good';
  const status = results.failed > 0 ? '🔴 FAILED' : results.warnings > 0 ? '🟡 WARNING' : '🟢 PASSED';
  
  const payload = {
    attachments: [{
      color,
      title: `HighLevel OAuth Integration - Monthly Resilience Test ${status}`,
      fields: [
        { title: 'Passed', value: results.passed.toString(), short: true },
        { title: 'Failed', value: results.failed.toString(), short: true },
        { title: 'Warnings', value: results.warnings.toString(), short: true },
        { title: 'Duration', value: `${results.metrics.totalDuration.toFixed(2)}ms`, short: true }
      ],
      footer: 'HighLevel OAuth Resilience Test',
      ts: Math.floor(Date.now() / 1000)
    }]
  };
  
  try {
    await makeRequest(config.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    log('info', 'Slack notification sent');
  } catch (error) {
    log('error', 'Failed to send Slack notification', { error: error.message });
  }
}

// Main test runner
async function runResilienceTests() {
  const overallStartTime = performance.now();
  
  log('info', 'Starting HighLevel OAuth Integration Resilience Tests');
  log('info', 'Configuration', {
    oauthUrl: config.oauthUrl,
    apiUrl: config.apiUrl,
    testLocationId: config.testLocationId
  });
  
  try {
    // Health Tests
    await runTest('OAuth Server Health Check', HealthTests.oauthHealthCheck, 'health');
    await runTest('API Server Health Check', HealthTests.apiHealthCheck, 'health');
    await runTest('OAuth Metrics Endpoint', HealthTests.oauthMetrics, 'health');
    
    // Security Tests
    await runTest('Unauthorized Access Protection', SecurityTests.unauthorizedAccess, 'security');
    await runTest('Invalid Token Protection', SecurityTests.invalidTokenAccess, 'security');
    await runTest('Expired Token Protection', SecurityTests.expiredTokenAccess, 'security');
    await runTest('Rate Limiting Test', SecurityTests.rateLimitTest, 'security');
    
    // Functional Tests
    await runTest('Proxy Endpoint Functionality', FunctionalTests.proxyEndpoint, 'functional');
    await runTest('Installations Endpoint', FunctionalTests.installationsEndpoint, 'functional');
    await runTest('Database Connectivity', FunctionalTests.databaseConnectivity, 'functional');
    
    // Performance Tests
    await runTest('Response Time Test', PerformanceTests.responseTimeTest, 'performance');
    await runTest('Concurrency Test', PerformanceTests.concurrencyTest, 'performance');
    
  } catch (error) {
    log('error', 'Test execution failed', { error: error.message });
  }
  
  // Calculate final metrics
  testResults.metrics.totalDuration = performance.now() - overallStartTime;
  
  const responseTimes = testResults.tests
    .filter(t => t.result && t.result.responseTime)
    .map(t => t.result.responseTime);
  
  if (responseTimes.length > 0) {
    testResults.metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    testResults.metrics.slowestEndpoint = Math.max(...responseTimes);
    testResults.metrics.fastestEndpoint = Math.min(...responseTimes);
  }
  
  // Generate report
  log('info', '\n=== RESILIENCE TEST RESULTS ===');
  log('info', `Total Tests: ${testResults.passed + testResults.failed}`);
  log('info', `Passed: ${testResults.passed}`);
  log('info', `Failed: ${testResults.failed}`);
  log('info', `Warnings: ${testResults.warnings}`);
  log('info', `Total Duration: ${testResults.metrics.totalDuration.toFixed(2)}ms`);
  
  if (testResults.failed > 0) {
    log('error', '\nFAILED TESTS:');
    testResults.tests
      .filter(t => t.status === 'failed')
      .forEach(t => log('error', `- ${t.name}: ${t.error}`));
  }
  
  // Save detailed results
  const fs = require('fs');
  const reportPath = `resilience_test_${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
  log('info', `Detailed results saved to: ${reportPath}`);
  
  // Send notification
  await sendSlackNotification(testResults);
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Validate configuration
if (!config.oauthUrl || !config.apiUrl) {
  console.error('Error: OAuth and API URLs must be provided');
  console.error('Usage: node resilience_test.js --oauth-url=https://oauth.railway.app --api-url=https://api.railway.app');
  process.exit(1);
}

if (!config.s2sSecret) {
  console.error('Error: S2S_SHARED_SECRET environment variable is required');
  process.exit(1);
}

// Run tests
runResilienceTests().catch(error => {
  log('error', 'Resilience test runner failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

// ============================================================
// Usage Examples:
// ============================================================

// Basic usage:
// node resilience_test.js --oauth-url=https://oauth.railway.app --api-url=https://api.railway.app

// With environment variables:
// S2S_SHARED_SECRET=your-secret node resilience_test.js --oauth-url=https://oauth.railway.app --api-url=https://api.railway.app

// With Slack notifications:
// SLACK_WEBHOOK_URL=https://hooks.slack.com/... node resilience_test.js --oauth-url=https://oauth.railway.app --api-url=https://api.railway.app

// In CI/CD pipeline:
// npm install jsonwebtoken
// node resilience_test.js --oauth-url=$OAUTH_URL --api-url=$API_URL

// ============================================================