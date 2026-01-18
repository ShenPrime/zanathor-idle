import { sql } from './connection.js';
import { GAME } from '../config.js';

/**
 * Create a new guild for a player
 * @param {string} discordId - Discord user ID
 * @param {string} name - Guild name
 * @returns {Promise<Object>} The created guild
 */
export async function createGuild(discordId, name) {
  const [guild] = await sql`
    INSERT INTO guilds (discord_id, name, level, xp, gold, adventurer_count, adventurer_capacity, last_collected_at)
    VALUES (${discordId}, ${name}, 1, ${GAME.STARTING_XP}, ${GAME.STARTING_GOLD}, ${GAME.STARTING_ADVENTURERS}, ${GAME.STARTING_ADVENTURER_CAPACITY}, NOW())
    RETURNING *
  `;
  return guild;
}

/**
 * Get a guild by Discord user ID
 * @param {string} discordId - Discord user ID
 * @returns {Promise<Object|null>} The guild or null
 */
export async function getGuildByDiscordId(discordId) {
  const [guild] = await sql`SELECT * FROM guilds WHERE discord_id = ${discordId}`;
  return guild || null;
}

/**
 * Get a guild by ID
 * @param {number} id - Guild ID
 * @returns {Promise<Object|null>} The guild or null
 */
export async function getGuildById(id) {
  const [guild] = await sql`SELECT * FROM guilds WHERE id = ${id}`;
  return guild || null;
}

/**
 * Update guild after collecting resources
 * @param {number} id - Guild ID
 * @param {number} goldToAdd - Gold to add
 * @param {number} xpToAdd - XP to add
 * @returns {Promise<Object>} Updated guild
 */
export async function collectResources(id, goldToAdd, xpToAdd) {
  const [guild] = await sql`
    UPDATE guilds 
    SET gold = gold + ${goldToAdd},
        xp = xp + ${xpToAdd},
        last_collected_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return guild;
}

/**
 * Update guild level
 * @param {number} id - Guild ID
 * @param {number} newLevel - New level
 * @returns {Promise<Object>} Updated guild
 */
export async function updateLevel(id, newLevel) {
  const [guild] = await sql`UPDATE guilds SET level = ${newLevel} WHERE id = ${id} RETURNING *`;
  return guild;
}

/**
 * Spend gold from a guild
 * @param {number} id - Guild ID
 * @param {number} amount - Amount to spend
 * @returns {Promise<Object|null>} Updated guild or null if insufficient funds
 */
export async function spendGold(id, amount) {
  const [guild] = await sql`
    UPDATE guilds 
    SET gold = gold - ${amount} 
    WHERE id = ${id} AND gold >= ${amount}
    RETURNING *
  `;
  return guild || null;
}

/**
 * Update adventurer count
 * @param {number} id - Guild ID
 * @param {number} count - New adventurer count
 * @returns {Promise<Object>} Updated guild
 */
export async function updateAdventurerCount(id, count) {
  const [guild] = await sql`UPDATE guilds SET adventurer_count = ${count} WHERE id = ${id} RETURNING *`;
  return guild;
}

/**
 * Update adventurer capacity
 * @param {number} id - Guild ID
 * @param {number} capacity - New capacity
 * @returns {Promise<Object>} Updated guild
 */
export async function updateAdventurerCapacity(id, capacity) {
  const [guild] = await sql`UPDATE guilds SET adventurer_capacity = ${capacity} WHERE id = ${id} RETURNING *`;
  return guild;
}

/**
 * Get leaderboard by a specific field
 * @param {string} field - Field to sort by (gold, level, adventurer_count, lifetime_gold_earned, lifetime_battles_won, prestige_level)
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} Top guilds
 */
export async function getLeaderboard(field = 'gold', limit = 10) {
  // Whitelist allowed fields to prevent SQL injection
  const allowedFields = ['gold', 'level', 'adventurer_count', 'xp', 'lifetime_gold_earned', 'lifetime_battles_won', 'prestige_level'];
  if (!allowedFields.includes(field)) {
    field = 'gold';
  }

  // Use sql() helper for safe dynamic identifier
  const result = await sql`
    SELECT id, discord_id, name, level, gold, adventurer_count, xp, 
           lifetime_gold_earned, lifetime_battles_won, prestige_level
    FROM guilds 
    ORDER BY ${sql(field)} DESC 
    LIMIT ${limit}
  `;
  return result;
}

/**
 * Get a player's rank on the leaderboard
 * @param {string} discordId - Discord user ID
 * @param {string} field - Field to rank by
 * @returns {Promise<number>} Rank (1-based)
 */
export async function getPlayerRank(discordId, field = 'gold') {
  const allowedFields = ['gold', 'level', 'adventurer_count', 'xp', 'lifetime_gold_earned', 'lifetime_battles_won', 'prestige_level'];
  if (!allowedFields.includes(field)) {
    field = 'gold';
  }

  // Use sql.unsafe for complex dynamic query with validated field
  const result = await sql.unsafe(
    `SELECT COUNT(*) + 1 as rank
     FROM guilds g1
     WHERE g1.${field} > (SELECT ${field} FROM guilds WHERE discord_id = $1)`,
    [discordId]
  );
  return parseInt(result[0]?.rank || 1);
}

/**
 * Get total count of guilds
 * @returns {Promise<number>} Total guild count
 */
export async function getTotalGuildCount() {
  const [result] = await sql`SELECT COUNT(*) as count FROM guilds`;
  return parseInt(result?.count || 0);
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
  const [guild] = await sql`
    UPDATE guilds 
    SET gold = gold + ${goldToAdd},
        xp = xp + ${xpToAdd}
    WHERE id = ${id}
    RETURNING *
  `;
  return guild;
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
    'lifetime_battles_won',
    'lifetime_battles_lost',
    'lifetime_battle_gold_won',
    'lifetime_battle_gold_lost',
    'lifetime_battle_xp_won',
    'lifetime_battle_xp_lost',
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
  
  // Use sql.unsafe for dynamic SET clause with validated fields
  const result = await sql.unsafe(
    `UPDATE guilds SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return result[0];
}

/**
 * Update peak gold balance if current gold is higher
 * @param {number} id - Guild ID
 * @param {number} currentGold - Current gold balance to compare
 * @returns {Promise<Object>} Updated guild
 */
export async function updatePeakGold(id, currentGold) {
  const [guild] = await sql`
    UPDATE guilds 
    SET peak_gold_balance = GREATEST(peak_gold_balance, ${currentGold})
    WHERE id = ${id}
    RETURNING *
  `;
  return guild;
}

/**
 * Update guild name
 * @param {number} id - Guild ID
 * @param {string} name - New guild name
 * @returns {Promise<Object>} Updated guild
 */
export async function updateGuildName(id, name) {
  const [guild] = await sql`UPDATE guilds SET name = ${name} WHERE id = ${id} RETURNING *`;
  return guild;
}

/**
 * Flush grind session data to database in a single operation
 * Combines addResources, incrementStats, and updatePeakGold into one query
 * @param {number} id - Guild ID
 * @param {number} goldToAdd - Gold to add
 * @param {number} xpToAdd - XP to add
 * @param {number} clicksToAdd - Clicks to add to lifetime stats
 * @returns {Promise<Object>} Updated guild
 */
export async function flushGrindData(id, goldToAdd, xpToAdd, clicksToAdd) {
  const [guild] = await sql`
    UPDATE guilds 
    SET gold = gold + ${goldToAdd},
        xp = xp + ${xpToAdd},
        lifetime_grind_gold = lifetime_grind_gold + ${goldToAdd},
        lifetime_grind_clicks = lifetime_grind_clicks + ${clicksToAdd},
        peak_gold_balance = GREATEST(peak_gold_balance, gold + ${goldToAdd})
    WHERE id = ${id}
    RETURNING *
  `;
  return guild;
}
