import 'dotenv/config';
import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const migrations = [
  {
    name: '001_initial_schema',
    sql: `
      -- Guilds table (player data)
      CREATE TABLE IF NOT EXISTS guilds (
        id SERIAL PRIMARY KEY,
        discord_id VARCHAR(32) UNIQUE NOT NULL,
        name VARCHAR(64) NOT NULL,
        level INTEGER DEFAULT 1,
        xp BIGINT DEFAULT 0,
        gold BIGINT DEFAULT 0,
        adventurer_count INTEGER DEFAULT 5,
        adventurer_capacity INTEGER DEFAULT 10,
        last_collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Index for faster Discord ID lookups
      CREATE INDEX IF NOT EXISTS idx_guilds_discord_id ON guilds(discord_id);
      
      -- Indexes for leaderboards
      CREATE INDEX IF NOT EXISTS idx_guilds_gold ON guilds(gold DESC);
      CREATE INDEX IF NOT EXISTS idx_guilds_level ON guilds(level DESC);

      -- Upgrades table (definitions)
      CREATE TABLE IF NOT EXISTS upgrades (
        id SERIAL PRIMARY KEY,
        name VARCHAR(64) UNIQUE NOT NULL,
        description TEXT,
        category VARCHAR(32) NOT NULL,
        base_cost BIGINT NOT NULL,
        cost_multiplier DECIMAL(10,4) DEFAULT 1.15,
        effect_type VARCHAR(32) NOT NULL,
        effect_value DECIMAL(10,4) NOT NULL,
        max_level INTEGER,
        required_guild_level INTEGER DEFAULT 1,
        required_adventurer_count INTEGER DEFAULT 0,
        required_upgrade_id INTEGER REFERENCES upgrades(id)
      );

      -- Guild upgrades (what each guild owns)
      CREATE TABLE IF NOT EXISTS guild_upgrades (
        guild_id INTEGER REFERENCES guilds(id) ON DELETE CASCADE,
        upgrade_id INTEGER REFERENCES upgrades(id) ON DELETE CASCADE,
        level INTEGER DEFAULT 1,
        purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (guild_id, upgrade_id)
      );

      -- Migrations tracking table
      CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `,
  },
  {
    name: '002_notification_settings',
    sql: `
      -- Notification settings for DM reminders
      CREATE TABLE IF NOT EXISTS notification_settings (
        guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
        dm_reminders_enabled BOOLEAN DEFAULT FALSE,
        last_reminder_at TIMESTAMP WITH TIME ZONE,
        dm_failures INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `,
  },
  {
    name: '003_lifetime_stats',
    sql: `
      -- Lifetime statistics for nerds
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_gold_earned BIGINT DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_xp_earned BIGINT DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_gold_spent BIGINT DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_upgrades_purchased INTEGER DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_grind_clicks INTEGER DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_grind_sessions INTEGER DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_grind_gold BIGINT DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS lifetime_adventurers_recruited INTEGER DEFAULT 0;
      ALTER TABLE guilds ADD COLUMN IF NOT EXISTS peak_gold_balance BIGINT DEFAULT 0;
    `,
  },
];

async function migrate() {
  console.log('Starting database migration...\n');

  try {
    // Ensure migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Get already applied migrations
    const { rows: applied } = await pool.query('SELECT name FROM migrations');
    const appliedNames = new Set(applied.map((r) => r.name));

    // Run pending migrations
    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) {
        console.log(`✓ ${migration.name} (already applied)`);
        continue;
      }

      console.log(`→ Running ${migration.name}...`);
      await pool.query(migration.sql);
      await pool.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
      console.log(`✓ ${migration.name} applied successfully`);
    }

    console.log('\nMigration complete!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
