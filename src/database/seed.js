import 'dotenv/config';
import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Upgrade definitions
// BALANCE: Early game should have upgrades every 5-15 minutes
// With 5 adventurers at 60 gold/hr = 300 gold/hr = 5 gold/min
// First upgrade at ~50 gold = 10 minutes (with 25 starting gold = ~5 min)
const upgrades = [
  // === RECRUITMENT CATEGORY ===
  // Increases adventurer capacity and passive gain
  {
    name: 'Job Board',
    description: 'Post job listings to attract more adventurers. +3 adventurer capacity per level.',
    category: 'recruitment',
    base_cost: 50,
    cost_multiplier: 1.25,
    effect_type: 'adventurer_capacity',
    effect_value: 3,
    max_level: null, // unlimited
    required_guild_level: 1,
    required_adventurer_count: 0,
  },
  {
    name: 'Guild Scouts',
    description: 'Send scouts to recruit new adventurers. +1 adventurer joins per hour.',
    category: 'recruitment',
    base_cost: 80,
    cost_multiplier: 1.3,
    effect_type: 'adventurer_per_hour',
    effect_value: 1,
    max_level: 5,
    required_guild_level: 1,
    required_adventurer_count: 0,
  },
  {
    name: 'Guild Reputation',
    description: 'Word spreads of your guild\'s success. +2 adventurers join passively per hour.',
    category: 'recruitment',
    base_cost: 150,
    cost_multiplier: 1.4,
    effect_type: 'adventurer_per_hour',
    effect_value: 2,
    max_level: 10,
    required_guild_level: 2,
    required_adventurer_count: 8,
  },
  {
    name: 'Recruitment Office',
    description: 'A dedicated office for handling new recruits. +8 adventurer capacity.',
    category: 'recruitment',
    base_cost: 400,
    cost_multiplier: 1.5,
    effect_type: 'adventurer_capacity',
    effect_value: 8,
    max_level: 5,
    required_guild_level: 4,
    required_adventurer_count: 15,
  },
  {
    name: 'Famous Benefactor',
    description: 'A noble sponsors your guild. +25 adventurer capacity.',
    category: 'recruitment',
    base_cost: 5000,
    cost_multiplier: 2.0,
    effect_type: 'adventurer_capacity',
    effect_value: 25,
    max_level: 5,
    required_guild_level: 10,
    required_adventurer_count: 40,
  },

  // === EQUIPMENT CATEGORY ===
  // Increases gold generation per adventurer
  {
    name: 'Basic Armory',
    description: 'Provide basic weapons and armor. +15% gold per adventurer.',
    category: 'equipment',
    base_cost: 75,
    cost_multiplier: 1.3,
    effect_type: 'gold_multiplier',
    effect_value: 0.15,
    max_level: 10,
    required_guild_level: 1,
    required_adventurer_count: 0,
  },
  {
    name: 'Iron Forge',
    description: 'Upgrade to iron equipment. +20% gold per adventurer.',
    category: 'equipment',
    base_cost: 350,
    cost_multiplier: 1.35,
    effect_type: 'gold_multiplier',
    effect_value: 0.20,
    max_level: 10,
    required_guild_level: 3,
    required_adventurer_count: 10,
  },
  {
    name: 'Steel Works',
    description: 'Master-crafted steel equipment. +25% gold per adventurer.',
    category: 'equipment',
    base_cost: 1500,
    cost_multiplier: 1.4,
    effect_type: 'gold_multiplier',
    effect_value: 0.25,
    max_level: 10,
    required_guild_level: 7,
    required_adventurer_count: 20,
  },
  {
    name: 'Enchanted Arsenal',
    description: 'Magical weapons and armor. +35% gold per adventurer.',
    category: 'equipment',
    base_cost: 8000,
    cost_multiplier: 1.6,
    effect_type: 'gold_multiplier',
    effect_value: 0.35,
    max_level: 5,
    required_guild_level: 15,
    required_adventurer_count: 50,
  },

  // === FACILITIES CATEGORY ===
  // Increases XP gain and unlocks features
  {
    name: 'Training Grounds',
    description: 'A place for adventurers to hone their skills. +25% XP gain.',
    category: 'facilities',
    base_cost: 100,
    cost_multiplier: 1.3,
    effect_type: 'xp_multiplier',
    effect_value: 0.25,
    max_level: 10,
    required_guild_level: 1,
    required_adventurer_count: 0,
  },
  {
    name: 'Tavern',
    description: 'A place to relax and share tales. +12% gold and XP.',
    category: 'facilities',
    base_cost: 250,
    cost_multiplier: 1.4,
    effect_type: 'all_multiplier',
    effect_value: 0.12,
    max_level: 5,
    required_guild_level: 3,
    required_adventurer_count: 8,
  },
  {
    name: 'Barracks',
    description: 'Housing for your adventurers. +12 adventurer capacity, +8% gold.',
    category: 'facilities',
    base_cost: 600,
    cost_multiplier: 1.5,
    effect_type: 'capacity_and_gold',
    effect_value: 12, // capacity bonus, gold bonus is 8% per level
    max_level: 5,
    required_guild_level: 5,
    required_adventurer_count: 15,
  },
  {
    name: 'Library',
    description: 'Knowledge is power. +50% XP gain.',
    category: 'facilities',
    base_cost: 2000,
    cost_multiplier: 1.6,
    effect_type: 'xp_multiplier',
    effect_value: 0.50,
    max_level: 3,
    required_guild_level: 8,
    required_adventurer_count: 25,
  },
  {
    name: 'Grand Hall',
    description: 'An impressive hall for guild meetings. +30% all gains.',
    category: 'facilities',
    base_cost: 12000,
    cost_multiplier: 2.0,
    effect_type: 'all_multiplier',
    effect_value: 0.30,
    max_level: 3,
    required_guild_level: 18,
    required_adventurer_count: 75,
  },

  // === MISSIONS CATEGORY ===
  // Unlocks higher tier passive missions (flat bonuses)
  {
    name: 'Escort Contracts',
    description: 'Take on merchant escort missions. +30 base gold per hour.',
    category: 'missions',
    base_cost: 120,
    cost_multiplier: 1.3,
    effect_type: 'base_gold_per_hour',
    effect_value: 30,
    max_level: 10,
    required_guild_level: 2,
    required_adventurer_count: 5,
  },
  {
    name: 'Monster Bounties',
    description: 'Hunt dangerous creatures for rewards. +60 base gold per hour.',
    category: 'missions',
    base_cost: 500,
    cost_multiplier: 1.4,
    effect_type: 'base_gold_per_hour',
    effect_value: 60,
    max_level: 10,
    required_guild_level: 5,
    required_adventurer_count: 12,
  },
  {
    name: 'Dungeon Expeditions',
    description: 'Explore dangerous dungeons. +150 base gold, +75 base XP per hour.',
    category: 'missions',
    base_cost: 2500,
    cost_multiplier: 1.6,
    effect_type: 'base_gold_and_xp',
    effect_value: 150, // gold, XP is 50% of gold
    max_level: 5,
    required_guild_level: 10,
    required_adventurer_count: 30,
  },
  {
    name: 'Royal Commissions',
    description: 'Prestigious missions from the crown. +300 base gold, +150 XP per hour.',
    category: 'missions',
    base_cost: 15000,
    cost_multiplier: 1.8,
    effect_type: 'base_gold_and_xp',
    effect_value: 300,
    max_level: 3,
    required_guild_level: 20,
    required_adventurer_count: 80,
  },
];

async function seed() {
  console.log('Seeding upgrade data...\n');

  try {
    for (const upgrade of upgrades) {
      // Use upsert to avoid duplicates
      await pool.query(
        `INSERT INTO upgrades (name, description, category, base_cost, cost_multiplier, effect_type, effect_value, max_level, required_guild_level, required_adventurer_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           base_cost = EXCLUDED.base_cost,
           cost_multiplier = EXCLUDED.cost_multiplier,
           effect_type = EXCLUDED.effect_type,
           effect_value = EXCLUDED.effect_value,
           max_level = EXCLUDED.max_level,
           required_guild_level = EXCLUDED.required_guild_level,
           required_adventurer_count = EXCLUDED.required_adventurer_count`,
        [
          upgrade.name,
          upgrade.description,
          upgrade.category,
          upgrade.base_cost,
          upgrade.cost_multiplier,
          upgrade.effect_type,
          upgrade.effect_value,
          upgrade.max_level,
          upgrade.required_guild_level,
          upgrade.required_adventurer_count,
        ]
      );
      console.log(`✓ ${upgrade.name}`);
    }

    console.log(`\nSeeded ${upgrades.length} upgrades successfully!`);
  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
