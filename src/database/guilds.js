import { query } from './connection.js';
import { GAME } from '../config.js';

/**
 * Create a new guild for a player
 * @param {string} discordId - Discord user ID
 * @param {string} name - Guild name
 * @returns {Promise<Object>} The created guild
 */
export async function createGuild(discordId, name) {
  const result = await query(
    `INSERT INTO guilds (discord_id, name, level, xp, gold, adventurer_count, adventurer_capacity, last_collected_at)
     VALUES ($1, $2, 1, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [
      discordId,
      name,
      GAME.STARTING_XP,
      GAME.STARTING_GOLD,
      GAME.STARTING_ADVENTURERS,
      GAME.STARTING_ADVENTURER_CAPACITY,
    ]
  );
  return result.rows[0];
}

/**
 * Get a guild by Discord user ID
 * @param {string} discordId - Discord user ID
 * @returns {Promise<Object|null>} The guild or null
 */
export async function getGuildByDiscordId(discordId) {
  const result = await query(
    'SELECT * FROM guilds WHERE discord_id = $1',
    [discordId]
  );
  return result.rows[0] || null;
}

/**
 * Get a guild by ID
 * @param {number} id - Guild ID
 * @returns {Promise<Object|null>} The guild or null
 */
export async function getGuildById(id) {
  const result = await query(
    'SELECT * FROM guilds WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Update guild after collecting resources
 * @param {number} id - Guild ID
 * @param {number} goldToAdd - Gold to add
 * @param {number} xpToAdd - XP to add
 * @returns {Promise<Object>} Updated guild
 */
export async function collectResources(id, goldToAdd, xpToAdd) {
  const result = await query(
    `UPDATE guilds 
     SET gold = gold + $2,
         xp = xp + $3,
         last_collected_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, goldToAdd, xpToAdd]
  );
  return result.rows[0];
}

/**
 * Update guild level
 * @param {number} id - Guild ID
 * @param {number} newLevel - New level
 * @returns {Promise<Object>} Updated guild
 */
export async function updateLevel(id, newLevel) {
  const result = await query(
    `UPDATE guilds SET level = $2 WHERE id = $1 RETURNING *`,
    [id, newLevel]
  );
  return result.rows[0];
}

/**
 * Spend gold from a guild
 * @param {number} id - Guild ID
 * @param {number} amount - Amount to spend
 * @returns {Promise<Object|null>} Updated guild or null if insufficient funds
 */
export async function spendGold(id, amount) {
  const result = await query(
    `UPDATE guilds 
     SET gold = gold - $2 
     WHERE id = $1 AND gold >= $2
     RETURNING *`,
    [id, amount]
  );
  return result.rows[0] || null;
}

/**
 * Update adventurer count
 * @param {number} id - Guild ID
 * @param {number} count - New adventurer count
 * @returns {Promise<Object>} Updated guild
 */
export async function updateAdventurerCount(id, count) {
  const result = await query(
    `UPDATE guilds SET adventurer_count = $2 WHERE id = $1 RETURNING *`,
    [id, count]
  );
  return result.rows[0];
}

/**
 * Update adventurer capacity
 * @param {number} id - Guild ID
 * @param {number} capacity - New capacity
 * @returns {Promise<Object>} Updated guild
 */
export async function updateAdventurerCapacity(id, capacity) {
  const result = await query(
    `UPDATE guilds SET adventurer_capacity = $2 WHERE id = $1 RETURNING *`,
    [id, capacity]
  );
  return result.rows[0];
}

/**
 * Get leaderboard by a specific field
 * @param {string} field - Field to sort by (gold, level, adventurer_count)
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} Top guilds
 */
export async function getLeaderboard(field = 'gold', limit = 10) {
  // Whitelist allowed fields to prevent SQL injection
  const allowedFields = ['gold', 'level', 'adventurer_count', 'xp'];
  if (!allowedFields.includes(field)) {
    field = 'gold';
  }

  const result = await query(
    `SELECT id, discord_id, name, level, gold, adventurer_count, xp
     FROM guilds 
     ORDER BY ${field} DESC 
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Get a player's rank on the leaderboard
 * @param {string} discordId - Discord user ID
 * @param {string} field - Field to rank by
 * @returns {Promise<number>} Rank (1-based)
 */
export async function getPlayerRank(discordId, field = 'gold') {
  const allowedFields = ['gold', 'level', 'adventurer_count', 'xp'];
  if (!allowedFields.includes(field)) {
    field = 'gold';
  }

  const result = await query(
    `SELECT COUNT(*) + 1 as rank
     FROM guilds g1
     WHERE g1.${field} > (SELECT ${field} FROM guilds WHERE discord_id = $1)`,
    [discordId]
  );
  return parseInt(result.rows[0]?.rank || 1);
}

/**
 * Add resources to a guild (for grind command batching)
 * Does NOT update last_collected_at (that's only for idle collection)
 * @param {number} id - Guild ID
 * @param {number} goldToAdd - Gold to add
 * @param {number} xpToAdd - XP to add
 * @returns {Promise<Object>} Updated guild
 */
export async function addResources(id, goldToAdd, xpToAdd) {
  const result = await query(
    `UPDATE guilds 
     SET gold = gold + $2,
         xp = xp + $3
     WHERE id = $1
     RETURNING *`,
    [id, goldToAdd, xpToAdd]
  );
  return result.rows[0];
}

/**
 * Increment lifetime stats for a guild
 * @param {number} id - Guild ID
 * @param {Object} stats - Stats to increment (e.g., { lifetime_gold_earned: 100, lifetime_xp_earned: 50 })
 * @returns {Promise<Object>} Updated guild
 */
export async function incrementStats(id, stats) {
  const validStats = [
    'lifetime_gold_earned',
    'lifetime_xp_earned',
    'lifetime_gold_spent',
    'lifetime_upgrades_purchased',
    'lifetime_grind_clicks',
    'lifetime_grind_sessions',
    'lifetime_grind_gold',
    'lifetime_adventurers_recruited',
  ];
  
  // Build SET clause dynamically
  const setClauses = [];
  const values = [id];
  let paramIndex = 2;
  
  for (const [key, value] of Object.entries(stats)) {
    if (validStats.includes(key) && typeof value === 'number') {
      setClauses.push(`${key} = ${key} + $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }
  
  if (setClauses.length === 0) {
    // No valid stats to update
    return getGuildById(id);
  }
  
  const result = await query(
    `UPDATE guilds SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Update peak gold balance if current gold is higher
 * @param {number} id - Guild ID
 * @param {number} currentGold - Current gold balance to compare
 * @returns {Promise<Object>} Updated guild
 */
export async function updatePeakGold(id, currentGold) {
  const result = await query(
    `UPDATE guilds 
     SET peak_gold_balance = GREATEST(peak_gold_balance, $2)
     WHERE id = $1
     RETURNING *`,
    [id, currentGold]
  );
  return result.rows[0];
}
