import 'dotenv/config';
import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// ============================================================================
// UPGRADE DEFINITIONS (52 total)
// ============================================================================
// Level distribution: smooth progression from 1-75
// Early game (1-10): unlock every 1-2 levels
// Mid game (11-30): unlock every 2-3 levels
// Late game (31-50): unlock every 3-4 levels
// Endgame (51-75): unlock every 4-5 levels

const upgrades = [
  // ============================================================================
  // RECRUITMENT CATEGORY (9 upgrades)
  // ============================================================================
  {
    name: 'Job Board',
    description: '+3 adventurer capacity/lvl',
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
    description: '+1 adventurer/hr per lvl',
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
    description: '+2 adventurers/hr per lvl',
    category: 'recruitment',
    base_cost: 150,
    cost_multiplier: 1.4,
    effect_type: 'adventurer_per_hour',
    effect_value: 2,
    max_level: 10,
    required_guild_level: 3,
    required_adventurer_count: 8,
  },
  {
    name: 'Recruitment Posters',
    description: '+4 adventurer capacity/lvl',
    category: 'recruitment',
    base_cost: 300,
    cost_multiplier: 1.35,
    effect_type: 'adventurer_capacity',
    effect_value: 4,
    max_level: 8,
    required_guild_level: 6,
    required_adventurer_count: 12,
  },
  {
    name: 'Recruitment Office',
    description: '+8 adventurer capacity/lvl',
    category: 'recruitment',
    base_cost: 800,
    cost_multiplier: 1.5,
    effect_type: 'adventurer_capacity',
    effect_value: 8,
    max_level: 5,
    required_guild_level: 10,
    required_adventurer_count: 15,
  },
  {
    name: 'Talent Agency',
    description: '+3 adventurers/hr per lvl',
    category: 'recruitment',
    base_cost: 2500,
    cost_multiplier: 1.55,
    effect_type: 'adventurer_per_hour',
    effect_value: 3,
    max_level: 8,
    required_guild_level: 18,
    required_adventurer_count: 30,
  },
  {
    name: "Hero's Call",
    description: '+15 adventurer capacity/lvl',
    category: 'recruitment',
    base_cost: 8000,
    cost_multiplier: 1.6,
    effect_type: 'adventurer_capacity',
    effect_value: 15,
    max_level: 5,
    required_guild_level: 30,
    required_adventurer_count: 50,
  },
  {
    name: 'Famous Benefactor',
    description: '+25 adventurer capacity/lvl',
    category: 'recruitment',
    base_cost: 35000,
    cost_multiplier: 1.8,
    effect_type: 'adventurer_capacity',
    effect_value: 25,
    max_level: 5,
    required_guild_level: 45,
    required_adventurer_count: 80,
  },
  {
    name: 'Legendary Summoning',
    description: '+5 adventurers/hr per lvl',
    category: 'recruitment',
    base_cost: 150000,
    cost_multiplier: 2.0,
    effect_type: 'adventurer_per_hour',
    effect_value: 5,
    max_level: 3,
    required_guild_level: 65,
    required_adventurer_count: 120,
  },

  // ============================================================================
  // EQUIPMENT CATEGORY (9 upgrades)
  // ============================================================================
  {
    name: 'Basic Armory',
    description: '+15% gold/lvl',
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
    name: 'Leather Workshop',
    description: '+10% gold/lvl',
    category: 'equipment',
    base_cost: 200,
    cost_multiplier: 1.3,
    effect_type: 'gold_multiplier',
    effect_value: 0.10,
    max_level: 8,
    required_guild_level: 4,
    required_adventurer_count: 8,
  },
  {
    name: 'Iron Forge',
    description: '+20% gold/lvl',
    category: 'equipment',
    base_cost: 500,
    cost_multiplier: 1.35,
    effect_type: 'gold_multiplier',
    effect_value: 0.20,
    max_level: 10,
    required_guild_level: 8,
    required_adventurer_count: 15,
  },
  {
    name: 'Weaponsmith Guild',
    description: '+18% gold/lvl',
    category: 'equipment',
    base_cost: 1500,
    cost_multiplier: 1.4,
    effect_type: 'gold_multiplier',
    effect_value: 0.18,
    max_level: 8,
    required_guild_level: 14,
    required_adventurer_count: 25,
  },
  {
    name: 'Steel Works',
    description: '+25% gold/lvl',
    category: 'equipment',
    base_cost: 4000,
    cost_multiplier: 1.45,
    effect_type: 'gold_multiplier',
    effect_value: 0.25,
    max_level: 10,
    required_guild_level: 22,
    required_adventurer_count: 40,
  },
  {
    name: 'Runesmith',
    description: '+30% gold/lvl',
    category: 'equipment',
    base_cost: 12000,
    cost_multiplier: 1.5,
    effect_type: 'gold_multiplier',
    effect_value: 0.30,
    max_level: 6,
    required_guild_level: 32,
    required_adventurer_count: 60,
  },
  {
    name: 'Enchanted Arsenal',
    description: '+35% gold/lvl',
    category: 'equipment',
    base_cost: 40000,
    cost_multiplier: 1.6,
    effect_type: 'gold_multiplier',
    effect_value: 0.35,
    max_level: 5,
    required_guild_level: 44,
    required_adventurer_count: 85,
  },
  {
    name: 'Mythic Forge',
    description: '+45% gold/lvl',
    category: 'equipment',
    base_cost: 120000,
    cost_multiplier: 1.7,
    effect_type: 'gold_multiplier',
    effect_value: 0.45,
    max_level: 4,
    required_guild_level: 58,
    required_adventurer_count: 110,
  },
  {
    name: 'Divine Armaments',
    description: '+60% gold/lvl',
    category: 'equipment',
    base_cost: 400000,
    cost_multiplier: 1.8,
    effect_type: 'gold_multiplier',
    effect_value: 0.60,
    max_level: 3,
    required_guild_level: 72,
    required_adventurer_count: 150,
  },

  // ============================================================================
  // FACILITIES CATEGORY (9 upgrades)
  // ============================================================================
  {
    name: 'Training Grounds',
    description: '+25% XP/lvl',
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
    description: '+12% gold & XP/lvl',
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
    name: 'Bathhouse',
    description: '+20% XP/lvl',
    category: 'facilities',
    base_cost: 450,
    cost_multiplier: 1.35,
    effect_type: 'xp_multiplier',
    effect_value: 0.20,
    max_level: 6,
    required_guild_level: 7,
    required_adventurer_count: 14,
  },
  {
    name: 'Barracks',
    description: '+12 capacity, +8% gold/lvl',
    category: 'facilities',
    base_cost: 1200,
    cost_multiplier: 1.5,
    effect_type: 'capacity_and_gold',
    effect_value: 12,
    max_level: 5,
    required_guild_level: 12,
    required_adventurer_count: 22,
  },
  {
    name: 'Library',
    description: '+40% XP/lvl',
    category: 'facilities',
    base_cost: 3500,
    cost_multiplier: 1.55,
    effect_type: 'xp_multiplier',
    effect_value: 0.40,
    max_level: 5,
    required_guild_level: 20,
    required_adventurer_count: 35,
  },
  {
    name: 'War Room',
    description: '+15% gold & XP/lvl',
    category: 'facilities',
    base_cost: 10000,
    cost_multiplier: 1.5,
    effect_type: 'all_multiplier',
    effect_value: 0.15,
    max_level: 5,
    required_guild_level: 28,
    required_adventurer_count: 50,
  },
  {
    name: 'Academy',
    description: '+50% XP/lvl',
    category: 'facilities',
    base_cost: 30000,
    cost_multiplier: 1.6,
    effect_type: 'xp_multiplier',
    effect_value: 0.50,
    max_level: 4,
    required_guild_level: 40,
    required_adventurer_count: 75,
  },
  {
    name: 'Grand Hall',
    description: '+30% gold & XP/lvl',
    category: 'facilities',
    base_cost: 100000,
    cost_multiplier: 1.7,
    effect_type: 'all_multiplier',
    effect_value: 0.30,
    max_level: 3,
    required_guild_level: 55,
    required_adventurer_count: 100,
  },
  {
    name: 'Palace',
    description: '+40% gold & XP/lvl',
    category: 'facilities',
    base_cost: 350000,
    cost_multiplier: 1.8,
    effect_type: 'all_multiplier',
    effect_value: 0.40,
    max_level: 3,
    required_guild_level: 70,
    required_adventurer_count: 140,
  },

  // ============================================================================
  // MISSIONS CATEGORY (9 upgrades)
  // ============================================================================
  {
    name: 'Escort Contracts',
    description: '+30 gold/hr per lvl',
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
    name: 'Herb Gathering',
    description: '+20 gold, +15 XP/hr per lvl',
    category: 'missions',
    base_cost: 350,
    cost_multiplier: 1.35,
    effect_type: 'base_gold_and_xp',
    effect_value: 20,
    max_level: 8,
    required_guild_level: 5,
    required_adventurer_count: 10,
  },
  {
    name: 'Monster Bounties',
    description: '+60 gold/hr per lvl',
    category: 'missions',
    base_cost: 800,
    cost_multiplier: 1.4,
    effect_type: 'base_gold_per_hour',
    effect_value: 60,
    max_level: 10,
    required_guild_level: 9,
    required_adventurer_count: 18,
  },
  {
    name: 'Treasure Maps',
    description: '+80 gold/hr per lvl',
    category: 'missions',
    base_cost: 2000,
    cost_multiplier: 1.45,
    effect_type: 'base_gold_per_hour',
    effect_value: 80,
    max_level: 8,
    required_guild_level: 16,
    required_adventurer_count: 28,
  },
  {
    name: 'Dungeon Expeditions',
    description: '+150 gold, +75 XP/hr per lvl',
    category: 'missions',
    base_cost: 6000,
    cost_multiplier: 1.5,
    effect_type: 'base_gold_and_xp',
    effect_value: 150,
    max_level: 5,
    required_guild_level: 24,
    required_adventurer_count: 45,
  },
  {
    name: 'Dragon Hunts',
    description: '+200 gold, +100 XP/hr per lvl',
    category: 'missions',
    base_cost: 18000,
    cost_multiplier: 1.55,
    effect_type: 'base_gold_and_xp',
    effect_value: 200,
    max_level: 5,
    required_guild_level: 35,
    required_adventurer_count: 65,
  },
  {
    name: 'Planar Raids',
    description: '+300 gold, +150 XP/hr per lvl',
    category: 'missions',
    base_cost: 55000,
    cost_multiplier: 1.6,
    effect_type: 'base_gold_and_xp',
    effect_value: 300,
    max_level: 4,
    required_guild_level: 48,
    required_adventurer_count: 90,
  },
  {
    name: 'Royal Commissions',
    description: '+450 gold, +225 XP/hr per lvl',
    category: 'missions',
    base_cost: 180000,
    cost_multiplier: 1.7,
    effect_type: 'base_gold_and_xp',
    effect_value: 450,
    max_level: 3,
    required_guild_level: 62,
    required_adventurer_count: 115,
  },
  {
    name: 'Divine Quests',
    description: '+600 gold, +300 XP/hr per lvl',
    category: 'missions',
    base_cost: 500000,
    cost_multiplier: 1.8,
    effect_type: 'base_gold_and_xp',
    effect_value: 600,
    max_level: 3,
    required_guild_level: 75,
    required_adventurer_count: 160,
  },

  // ============================================================================
  // MAGIC CATEGORY (8 upgrades) - NEW
  // ============================================================================
  {
    name: 'Meditation Circle',
    description: '+20% XP/lvl',
    category: 'magic',
    base_cost: 400,
    cost_multiplier: 1.35,
    effect_type: 'xp_multiplier',
    effect_value: 0.20,
    max_level: 10,
    required_guild_level: 5,
    required_adventurer_count: 10,
  },
  {
    name: 'Arcane Studies',
    description: '+30% XP/lvl',
    category: 'magic',
    base_cost: 1000,
    cost_multiplier: 1.4,
    effect_type: 'xp_multiplier',
    effect_value: 0.30,
    max_level: 8,
    required_guild_level: 11,
    required_adventurer_count: 20,
  },
  {
    name: 'Mana Well',
    description: '+10% gold & XP/lvl',
    category: 'magic',
    base_cost: 3000,
    cost_multiplier: 1.45,
    effect_type: 'all_multiplier',
    effect_value: 0.10,
    max_level: 6,
    required_guild_level: 19,
    required_adventurer_count: 35,
  },
  {
    name: 'Enchantment Lab',
    description: '+35% XP/lvl',
    category: 'magic',
    base_cost: 8000,
    cost_multiplier: 1.5,
    effect_type: 'xp_multiplier',
    effect_value: 0.35,
    max_level: 6,
    required_guild_level: 26,
    required_adventurer_count: 48,
  },
  {
    name: 'Ley Line Tap',
    description: '+15% gold & XP/lvl',
    category: 'magic',
    base_cost: 25000,
    cost_multiplier: 1.55,
    effect_type: 'all_multiplier',
    effect_value: 0.15,
    max_level: 5,
    required_guild_level: 38,
    required_adventurer_count: 70,
  },
  {
    name: 'Astral Observatory',
    description: '+50% XP/lvl',
    category: 'magic',
    base_cost: 75000,
    cost_multiplier: 1.6,
    effect_type: 'xp_multiplier',
    effect_value: 0.50,
    max_level: 4,
    required_guild_level: 52,
    required_adventurer_count: 95,
  },
  {
    name: 'Archmage Tower',
    description: '+25% gold & XP/lvl',
    category: 'magic',
    base_cost: 220000,
    cost_multiplier: 1.7,
    effect_type: 'all_multiplier',
    effect_value: 0.25,
    max_level: 3,
    required_guild_level: 66,
    required_adventurer_count: 130,
  },
  {
    name: 'Planar Nexus',
    description: '+35% gold & XP/lvl',
    category: 'magic',
    base_cost: 600000,
    cost_multiplier: 1.8,
    effect_type: 'all_multiplier',
    effect_value: 0.35,
    max_level: 3,
    required_guild_level: 75,
    required_adventurer_count: 155,
  },

  // ============================================================================
  // TRADE CATEGORY (8 upgrades) - NEW
  // ============================================================================
  {
    name: 'Market Stall',
    description: '+25 gold/hr per lvl',
    category: 'trade',
    base_cost: 180,
    cost_multiplier: 1.3,
    effect_type: 'base_gold_per_hour',
    effect_value: 25,
    max_level: 10,
    required_guild_level: 4,
    required_adventurer_count: 8,
  },
  {
    name: 'Trade Route',
    description: '+50 gold/hr per lvl',
    category: 'trade',
    base_cost: 700,
    cost_multiplier: 1.4,
    effect_type: 'base_gold_per_hour',
    effect_value: 50,
    max_level: 8,
    required_guild_level: 10,
    required_adventurer_count: 18,
  },
  {
    name: 'Merchant Guild',
    description: '+15% gold/lvl',
    category: 'trade',
    base_cost: 2200,
    cost_multiplier: 1.45,
    effect_type: 'gold_multiplier',
    effect_value: 0.15,
    max_level: 8,
    required_guild_level: 17,
    required_adventurer_count: 30,
  },
  {
    name: 'Caravan Network',
    description: '+100 gold/hr per lvl',
    category: 'trade',
    base_cost: 7000,
    cost_multiplier: 1.5,
    effect_type: 'base_gold_per_hour',
    effect_value: 100,
    max_level: 6,
    required_guild_level: 25,
    required_adventurer_count: 45,
  },
  {
    name: 'Import License',
    description: '+20% gold/lvl',
    category: 'trade',
    base_cost: 22000,
    cost_multiplier: 1.55,
    effect_type: 'gold_multiplier',
    effect_value: 0.20,
    max_level: 5,
    required_guild_level: 36,
    required_adventurer_count: 65,
  },
  {
    name: 'Banking House',
    description: '+180 gold/hr per lvl',
    category: 'trade',
    base_cost: 65000,
    cost_multiplier: 1.6,
    effect_type: 'base_gold_per_hour',
    effect_value: 180,
    max_level: 4,
    required_guild_level: 50,
    required_adventurer_count: 90,
  },
  {
    name: 'Trade Empire',
    description: '+30% gold/lvl',
    category: 'trade',
    base_cost: 200000,
    cost_multiplier: 1.7,
    effect_type: 'gold_multiplier',
    effect_value: 0.30,
    max_level: 3,
    required_guild_level: 64,
    required_adventurer_count: 125,
  },
  {
    name: 'Monopoly',
    description: '+300 gold/hr per lvl',
    category: 'trade',
    base_cost: 550000,
    cost_multiplier: 1.8,
    effect_type: 'base_gold_per_hour',
    effect_value: 300,
    max_level: 3,
    required_guild_level: 74,
    required_adventurer_count: 150,
  },
];

// ============================================================================
// PRESTIGE UPGRADE DEFINITIONS (10 upgrades)
// ============================================================================
const prestigeUpgrades = [
  {
    name: 'Head Start',
    description: 'Start with bonus gold after prestige',
    effect_type: 'starting_gold',
    effect_value: 100, // Base value, multiplied by level
    max_level: 5,
    point_costs: [1, 1, 2, 2, 3], // 9 total
  },
  {
    name: 'Veteran Recruiters',
    description: 'Start with bonus adventurers after prestige',
    effect_type: 'starting_adventurers',
    effect_value: 2, // +2/4/7/11/16 adventurers (cumulative formula)
    max_level: 5,
    point_costs: [1, 2, 2, 3, 4], // 12 total
  },
  {
    name: 'Fast Learner',
    description: '+8% XP permanently (compounds)',
    effect_type: 'permanent_xp_multiplier',
    effect_value: 0.08,
    max_level: 5,
    point_costs: [2, 2, 3, 4, 5], // 16 total
  },
  {
    name: 'Gold Rush',
    description: '+8% gold permanently (compounds)',
    effect_type: 'permanent_gold_multiplier',
    effect_value: 0.08,
    max_level: 5,
    point_costs: [2, 2, 3, 4, 5], // 16 total
  },
  {
    name: 'Bigger Barracks',
    description: 'Start with bonus adventurer capacity',
    effect_type: 'starting_capacity',
    effect_value: 5, // +5/12/20/30/45 capacity (cumulative)
    max_level: 5,
    point_costs: [1, 2, 3, 4, 5], // 15 total
  },
  {
    name: 'Time Warp',
    description: 'Increase max idle hours',
    effect_type: 'max_idle_hours',
    effect_value: 2, // +2/4/8 hours
    max_level: 3,
    point_costs: [3, 5, 8], // 16 total
  },
  {
    name: 'Lucky Coin',
    description: '+2% chance for double gold on collect',
    effect_type: 'double_gold_chance',
    effect_value: 0.02,
    max_level: 3,
    point_costs: [4, 6, 10], // 20 total
  },
  {
    name: "Mentor's Blessing",
    description: '+2% XP per prestige level',
    effect_type: 'xp_per_prestige',
    effect_value: 0.02,
    max_level: 1,
    point_costs: [8], // 8 total
  },
  {
    name: "Tycoon's Secret",
    description: '+2% gold per prestige level',
    effect_type: 'gold_per_prestige',
    effect_value: 0.02,
    max_level: 1,
    point_costs: [8], // 8 total
  },
  {
    name: 'Quick Start',
    description: 'Keep 5% of gold on prestige',
    effect_type: 'gold_keep_percent',
    effect_value: 0.05,
    max_level: 1,
    point_costs: [10], // 10 total
  },
];

async function seed() {
  console.log('Seeding upgrade data...\n');

  try {
    // Seed regular upgrades
    console.log('=== Regular Upgrades ===');
    for (const upgrade of upgrades) {
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
      console.log(`  + ${upgrade.name} (${upgrade.category}, Lv${upgrade.required_guild_level})`);
    }
    console.log(`\nSeeded ${upgrades.length} regular upgrades successfully!\n`);

    // Seed prestige upgrades
    console.log('=== Prestige Upgrades ===');
    for (const upgrade of prestigeUpgrades) {
      await pool.query(
        `INSERT INTO prestige_upgrades (name, description, effect_type, effect_value, max_level, point_costs)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           effect_type = EXCLUDED.effect_type,
           effect_value = EXCLUDED.effect_value,
           max_level = EXCLUDED.max_level,
           point_costs = EXCLUDED.point_costs`,
        [
          upgrade.name,
          upgrade.description,
          upgrade.effect_type,
          upgrade.effect_value,
          upgrade.max_level,
          upgrade.point_costs,
        ]
      );
      const totalCost = upgrade.point_costs.reduce((a, b) => a + b, 0);
      console.log(`  + ${upgrade.name} (${upgrade.max_level} levels, ${totalCost} points total)`);
    }
    console.log(`\nSeeded ${prestigeUpgrades.length} prestige upgrades successfully!`);

  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
