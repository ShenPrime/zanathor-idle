import { query, getClient } from './connection.js';

/**
 * Get all available upgrades
 * @returns {Promise<Array>} All upgrades
 */
export async function getAllUpgrades() {
  const result = await query(
    `SELECT * FROM upgrades ORDER BY category, required_guild_level, base_cost`
  );
  return result.rows;
}

/**
 * Get upgrades by category
 * @param {string} category - Upgrade category
 * @returns {Promise<Array>} Upgrades in category
 */
export async function getUpgradesByCategory(category) {
  const result = await query(
    `SELECT * FROM upgrades WHERE category = $1 ORDER BY required_guild_level, base_cost`,
    [category]
  );
  return result.rows;
}

/**
 * Get a specific upgrade by ID
 * @param {number} upgradeId - Upgrade ID
 * @returns {Promise<Object|null>} The upgrade or null
 */
export async function getUpgradeById(upgradeId) {
  const result = await query(
    'SELECT * FROM upgrades WHERE id = $1',
    [upgradeId]
  );
  return result.rows[0] || null;
}

/**
 * Get a specific upgrade by name
 * @param {string} name - Upgrade name
 * @returns {Promise<Object|null>} The upgrade or null
 */
export async function getUpgradeByName(name) {
  const result = await query(
    'SELECT * FROM upgrades WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  return result.rows[0] || null;
}

/**
 * Get all upgrades a guild has purchased
 * @param {number} guildId - Guild ID
 * @returns {Promise<Array>} Guild's upgrades with upgrade details
 */
export async function getGuildUpgrades(guildId) {
  const result = await query(
    `SELECT gu.*, u.name, u.description, u.category, u.effect_type, u.effect_value, u.max_level
     FROM guild_upgrades gu
     JOIN upgrades u ON gu.upgrade_id = u.id
     WHERE gu.guild_id = $1`,
    [guildId]
  );
  return result.rows;
}

/**
 * Get a guild's level for a specific upgrade
 * @param {number} guildId - Guild ID
 * @param {number} upgradeId - Upgrade ID
 * @returns {Promise<number>} Current level (0 if not purchased)
 */
export async function getGuildUpgradeLevel(guildId, upgradeId) {
  const result = await query(
    'SELECT level FROM guild_upgrades WHERE guild_id = $1 AND upgrade_id = $2',
    [guildId, upgradeId]
  );
  return result.rows[0]?.level || 0;
}

/**
 * Purchase or upgrade an upgrade for a guild
 * @param {number} guildId - Guild ID
 * @param {number} upgradeId - Upgrade ID
 * @param {number} cost - Gold cost
 * @returns {Promise<Object>} The guild_upgrade record
 */
export async function purchaseUpgrade(guildId, upgradeId, cost) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Deduct gold
    const goldResult = await client.query(
      'UPDATE guilds SET gold = gold - $2 WHERE id = $1 AND gold >= $2 RETURNING *',
      [guildId, cost]
    );
    
    if (!goldResult.rows[0]) {
      throw new Error('Insufficient gold');
    }
    
    // Insert or update the upgrade
    const upgradeResult = await client.query(
      `INSERT INTO guild_upgrades (guild_id, upgrade_id, level)
       VALUES ($1, $2, 1)
       ON CONFLICT (guild_id, upgrade_id) 
       DO UPDATE SET level = guild_upgrades.level + 1, purchased_at = NOW()
       RETURNING *`,
      [guildId, upgradeId]
    );
    
    await client.query('COMMIT');
    return upgradeResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Calculate the cost of the next level of an upgrade
 * @param {Object} upgrade - The upgrade object
 * @param {number} currentLevel - Current level owned
 * @returns {number} Cost for next level
 */
export function calculateUpgradeCost(upgrade, currentLevel) {
  return Math.floor(
    upgrade.base_cost * Math.pow(upgrade.cost_multiplier, currentLevel)
  );
}

/**
 * Calculate total cost for buying multiple levels of an upgrade
 * @param {Object} upgrade - The upgrade object
 * @param {number} currentLevel - Current level owned
 * @param {number} quantity - Number of levels to buy
 * @returns {{ totalCost: number, finalLevel: number, levelsBought: number }}
 */
export function calculateBulkPurchaseCost(upgrade, currentLevel, quantity) {
  let totalCost = 0;
  let level = currentLevel;
  const maxLevel = upgrade.max_level || Infinity;
  
  for (let i = 0; i < quantity && level < maxLevel; i++) {
    totalCost += Math.floor(upgrade.base_cost * Math.pow(upgrade.cost_multiplier, level));
    level++;
  }
  
  return { totalCost, finalLevel: level, levelsBought: level - currentLevel };
}

/**
 * Calculate maximum levels affordable with given gold
 * @param {Object} upgrade - The upgrade object
 * @param {number} currentLevel - Current level owned
 * @param {number} availableGold - Gold available to spend
 * @returns {{ totalCost: number, finalLevel: number, levelsBought: number }}
 */
export function calculateMaxAffordable(upgrade, currentLevel, availableGold) {
  let totalCost = 0;
  let level = currentLevel;
  const maxLevel = upgrade.max_level || Infinity;
  
  while (level < maxLevel) {
    const nextCost = Math.floor(upgrade.base_cost * Math.pow(upgrade.cost_multiplier, level));
    if (totalCost + nextCost > availableGold) break;
    totalCost += nextCost;
    level++;
  }
  
  return { totalCost, finalLevel: level, levelsBought: level - currentLevel };
}

/**
 * Purchase multiple levels of an upgrade
 * @param {number} guildId - Guild ID
 * @param {number} upgradeId - Upgrade ID
 * @param {number} levelsToBuy - Number of levels to purchase
 * @param {number} totalCost - Total gold cost
 * @returns {Promise<Object>} The guild_upgrade record
 */
export async function purchaseUpgradeMultiple(guildId, upgradeId, levelsToBuy, totalCost) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Deduct gold
    const goldResult = await client.query(
      'UPDATE guilds SET gold = gold - $2 WHERE id = $1 AND gold >= $2 RETURNING *',
      [guildId, totalCost]
    );
    
    if (!goldResult.rows[0]) {
      throw new Error('Insufficient gold');
    }
    
    // Get current level
    const currentResult = await client.query(
      'SELECT level FROM guild_upgrades WHERE guild_id = $1 AND upgrade_id = $2',
      [guildId, upgradeId]
    );
    const currentLevel = currentResult.rows[0]?.level || 0;
    const newLevel = currentLevel + levelsToBuy;
    
    // Insert or update the upgrade
    const upgradeResult = await client.query(
      `INSERT INTO guild_upgrades (guild_id, upgrade_id, level)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, upgrade_id) 
       DO UPDATE SET level = $3, purchased_at = NOW()
       RETURNING *`,
      [guildId, upgradeId, newLevel]
    );
    
    await client.query('COMMIT');
    return { 
      ...upgradeResult.rows[0], 
      remainingGold: goldResult.rows[0].gold 
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get available upgrades for a guild (that they can see/purchase)
 * @param {number} guildId - Guild ID
 * @param {number} guildLevel - Guild's current level
 * @param {number} adventurerCount - Guild's adventurer count
 * @returns {Promise<Array>} Available upgrades with current levels
 */
export async function getAvailableUpgrades(guildId, guildLevel, adventurerCount) {
  const result = await query(
    `SELECT u.*, COALESCE(gu.level, 0) as current_level
     FROM upgrades u
     LEFT JOIN guild_upgrades gu ON u.id = gu.upgrade_id AND gu.guild_id = $1
     WHERE u.required_guild_level <= $2
       AND u.required_adventurer_count <= $3
       AND (u.required_upgrade_id IS NULL 
            OR EXISTS (SELECT 1 FROM guild_upgrades WHERE guild_id = $1 AND upgrade_id = u.required_upgrade_id))
       AND (u.max_level IS NULL OR COALESCE(gu.level, 0) < u.max_level)
     ORDER BY u.category, u.required_guild_level, u.base_cost`,
    [guildId, guildLevel, adventurerCount]
  );
  return result.rows;
}
