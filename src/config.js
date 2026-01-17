import 'dotenv/config';

// Bot configuration
export const BOT_TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
export const DEV_GUILD_ID = process.env.DEV_GUILD_ID; // For instant command updates during development

// Database configuration
export const DATABASE_URL = process.env.DATABASE_URL;

// Game Constants
export const GAME = {
  // Starting values for new guilds
  STARTING_GOLD: 25,              // Small starting bonus to get going
  STARTING_XP: 0,
  STARTING_ADVENTURERS: 5,        // More adventurers = faster start
  STARTING_ADVENTURER_CAPACITY: 10,

  // Base rates (per adventurer, per hour)
  BASE_GOLD_PER_HOUR: 60,         // 1 gold per minute per adventurer
  BASE_XP_PER_HOUR: 30,           // Half the gold rate

  // Maximum offline time counted (in hours)
  MAX_IDLE_HOURS: 24,

  // XP required per level (multiplied by current level)
  XP_PER_LEVEL_BASE: 50,          // Faster early leveling
  XP_LEVEL_MULTIPLIER: 1.35,      // Slower scaling
};

// Prestige System Constants
export const PRESTIGE = {
  MIN_LEVEL: 50,                  // First prestige at level 50
  LEVEL_INCREMENT: 10,            // Each prestige requires 10 more levels
  MAX_REQUIREMENT: 75,            // Cap requirement at level 75
  
  // Compounding bonuses per prestige level
  GOLD_BONUS_PER_LEVEL: 0.05,     // +5% gold per prestige (compounds)
  XP_BONUS_PER_LEVEL: 0.05,       // +5% XP per prestige (compounds)
  RECRUIT_BONUS_PER_LEVEL: 0.08,  // +8% recruitment rate per prestige (compounds)
};

// Adventurer Ranks - unlock at certain guild levels
export const RANKS = [
  { name: 'Bronze',   level: 1,   multiplier: 1.0,  emoji: '🥉' },
  { name: 'Iron',     level: 5,   multiplier: 1.5,  emoji: '⚙️' },
  { name: 'Steel',    level: 10,  multiplier: 2.0,  emoji: '🗡️' },
  { name: 'Silver',   level: 20,  multiplier: 3.0,  emoji: '🥈' },
  { name: 'Gold',     level: 35,  multiplier: 5.0,  emoji: '🥇' },
  { name: 'Platinum', level: 50,  multiplier: 8.0,  emoji: '💎' },
  { name: 'Diamond',  level: 75,  multiplier: 12.0, emoji: '💠' },
  { name: 'Mythril',  level: 100, multiplier: 20.0, emoji: '✨' },
];

// Get the rank for a given guild level
export function getRankForLevel(level) {
  let currentRank = RANKS[0];
  for (const rank of RANKS) {
    if (level >= rank.level) {
      currentRank = rank;
    } else {
      break;
    }
  }
  return currentRank;
}

// Get the next rank after the current level (or null if at max rank)
export function getNextRank(level) {
  for (const rank of RANKS) {
    if (rank.level > level) {
      return rank;
    }
  }
  return null; // Already at max rank
}

// Get XP required for a specific level
export function getXpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(
    GAME.XP_PER_LEVEL_BASE * Math.pow(GAME.XP_LEVEL_MULTIPLIER, level - 1)
  );
}

// Get total XP required to reach a level (cumulative)
export function getTotalXpForLevel(level) {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += getXpForLevel(i);
  }
  return total;
}
