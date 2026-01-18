import 'dotenv/config';
import { SQL } from 'bun';

const db = new SQL(process.env.DATABASE_URL);

async function reset() {
  console.log('=================================');
  console.log('    DATABASE RESET (DEV ONLY)');
  console.log('=================================\n');

  console.log('WARNING: This will delete ALL data!\n');

  try {
    // Drop all tables in correct order (respecting foreign keys)
    console.log('Dropping tables...');
    
    await db.unsafe('DROP TABLE IF EXISTS guild_upgrades CASCADE');
    console.log('  - Dropped guild_upgrades');
    
    await db.unsafe('DROP TABLE IF EXISTS guilds CASCADE');
    console.log('  - Dropped guilds');
    
    await db.unsafe('DROP TABLE IF EXISTS upgrades CASCADE');
    console.log('  - Dropped upgrades');
    
    await db.unsafe('DROP TABLE IF EXISTS migrations CASCADE');
    console.log('  - Dropped migrations');

    console.log('\nAll tables dropped successfully!\n');
    console.log('Now run the following commands to rebuild:');
    console.log('  bun run migrate');
    console.log('  bun run seed\n');
    
  } catch (error) {
    console.error('Reset failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

reset();
