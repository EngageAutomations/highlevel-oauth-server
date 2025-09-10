/**
 * OAuth State Persistence Kit - Postgres-backed Stores
 * Handles state persistence and code deduplication using PostgreSQL
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ttlMinutes = parseInt(process.env.STATE_TTL_MIN || '20', 10);

/**
 * Create a new state token and store it in the database
 * @param {string} clientId - HighLevel client ID
 * @param {string} redirectUri - OAuth redirect URI
 * @returns {Promise<string>} - Generated state token
 */
async function createState(clientId, redirectUri) {
  const state = crypto.randomBytes(16).toString('base64url'); // URL-safe
  await pool.query(
    `INSERT INTO oauth_state(state, client_id, redirect_uri, expires_at)
     VALUES ($1,$2,$3, NOW() + ($4 || ' minutes')::interval)`,
    [state, clientId, redirectUri, ttlMinutes]
  );
  return state;
}

/**
 * Consume a state token (delete and return its data)
 * @param {string} state - State token to consume
 * @returns {Promise<Object|null>} - State data or null if invalid/expired
 */
async function consumeState(state) {
  const { rows } = await pool.query(
    `DELETE FROM oauth_state
       WHERE state = $1 AND expires_at > NOW()
     RETURNING client_id, redirect_uri, expires_at`,
    [state]
  );
  return rows[0] || null; // null = invalid/expired
}

/**
 * Mark an authorization code as used to prevent reuse
 * @param {string} code - Authorization code
 * @param {number} ttlMin - TTL in minutes (default: 10)
 */
async function markCodeUsed(code, ttlMin = 10) {
  await pool.query(
    `INSERT INTO oauth_used_codes(code, expires_at)
     VALUES ($1, NOW() + ($2 || ' minutes')::interval)
     ON CONFLICT (code) DO NOTHING`,
    [code, ttlMin]
  );
}

/**
 * Check if an authorization code has been used
 * @param {string} code - Authorization code to check
 * @returns {Promise<boolean>} - True if code has been used
 */
async function isCodeUsed(code) {
  const { rows } = await pool.query(
    `SELECT 1 FROM oauth_used_codes
      WHERE code=$1 AND expires_at > NOW()`,
    [code]
  );
  return rows.length > 0;
}

/**
 * Clean up expired state tokens and used codes (maintenance function)
 */
async function cleanupExpired() {
  const stateResult = await pool.query(
    `DELETE FROM oauth_state WHERE expires_at <= NOW()`
  );
  const codesResult = await pool.query(
    `DELETE FROM oauth_used_codes WHERE expires_at <= NOW()`
  );
  
  console.log(`Cleaned up ${stateResult.rowCount} expired states, ${codesResult.rowCount} expired codes`);
}

module.exports = {
  createState,
  consumeState,
  markCodeUsed,
  isCodeUsed,
  cleanupExpired
};