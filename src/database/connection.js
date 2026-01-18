import { sql } from "bun";

// Re-export sql for direct use with tagged template literals
// Usage: await sql`SELECT * FROM guilds WHERE id = ${id}`
export { sql };

/**
 * Test the database connection
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  try {
    await sql`SELECT NOW()`;
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
  await sql.close();
}

export default sql;
