import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

// Create a connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Test connection on startup
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  
  // Log slow queries (500ms+ threshold)
  if (duration > 500) {
    console.log('Slow query:', { text, duration, rows: result.rowCount });
  }
  
  return result;
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Test the database connection
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  try {
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
  }
}

/**
 * Close all connections (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
}

export default pool;
