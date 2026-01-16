import 'dotenv/config';
import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function reset() {
  console.log('=================================');
  console.log('    DATABASE RESET (DEV ONLY)');
  console.log('=================================\n');

  console.log('WARNING: This will delete ALL data!\n');

  try {
    // Drop all tables in correct order (respecting foreign keys)
    console.log('Dropping tables...');
    
    await pool.query('DROP TABLE IF EXISTS guild_upgrades CASCADE');
    console.log('  - Dropped guild_upgrades');
    
    await pool.query('DROP TABLE IF EXISTS guilds CASCADE');
    console.log('  - Dropped guilds');
    
    await pool.query('DROP TABLE IF EXISTS upgrades CASCADE');
    console.log('  - Dropped upgrades');
    
    await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
    console.log('  - Dropped migrations');

    console.log('\nAll tables dropped successfully!\n');
    console.log('Now run the following commands to rebuild:');
    console.log('  npm run migrate');
    console.log('  npm run seed\n');
    
  } catch (error) {
    console.error('Reset failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
