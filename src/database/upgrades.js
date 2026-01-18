import { sql } from './connection.js';

/**
 * Get all available upgrades
 * @returns {Promise<Array>} All upgrades
 */
export async function getAllUpgrades() {
  const result = await sql`SELECT * FROM upgrades ORDER BY category, required_guild_level, base_cost`;
  return result;
}

/**
 * Get upgrades by category
 * @param {string} category - Upgrade category
 * @returns {Promise<Array>} Upgrades in category
 */
export async function getUpgradesByCategory(category) {
  const result = await sql`
    SELECT * FROM upgrades 
    WHERE category = ${category} 
    ORDER BY required_guild_level, base_cost
  `;
  return result;
}

/**
 * Get a specific upgrade by ID
 * @param {number} upgradeId - Upgrade ID
 * @returns {Promise<Object|null>} The upgrade or null
 */
export async function getUpgradeById(upgradeId) {
  const [upgrade] = await sql`SELECT * FROM upgrades WHERE id = ${upgradeId}`;
  return upgrade || null;
}

/**
 * Get a specific upgrade by name
 * @param {string} name - Upgrade name
 * @returns {Promise<Object|null>} The upgrade or null
 */
export async function getUpgradeByName(name) {
  const [upgrade] = await sql`SELECT * FROM upgrades WHERE LOWER(name) = LOWER(${name})`;
  return upgrade || null;
}

/**
 * Get multiple upgrades by names (batch fetch)
 * @param {string[]} names - Array of upgrade names
 * @returns {Promise<Map<string, Object>>} Map of lowercase name -> upgrade
 */
export async function getUpgradesByNames(names) {
  // Normalize input to always be an array
  const nameArray = Array.isArray(names) ? names : [names];
  if (nameArray.length === 0) return new Map();
  
  // Normalize names to lowercase for comparison
  // Validate that all items are strings
  const lowerNames = nameArray
    .filter(n => typeof n === 'string')
    .map(n => n.toLowerCase());
  if (lowerNames.length !== nameArray.length) {
    console.error('Invalid names detected in getUpgradesByNames:', nameArray);
  }
  if (lowerNames.length === 0) return new Map();
  
  const upgrades = await sql`
    SELECT * FROM upgrades 
    WHERE LOWER(name) IN ${sql(lowerNames)}
  `;
  
  // Create a map keyed by lowercase name for easy lookup
  const upgradeMap = new Map();
  for (const upgrade of upgrades) {
    upgradeMap.set(upgrade.name.toLowerCase(), upgrade);
  }
  
  return upgradeMap;
}

/**
 * Get guild upgrade levels for multiple upgrades at once (batch fetch)
 * @param {number} guildId - Guild ID
 * @param {number[]} upgradeIds - Array of upgrade IDs
 * @returns {Promise<Map<number, number>>} Map of upgradeId -> level
 */
export async function getGuildUpgradeLevelsBatch(guildId, upgradeIds) {
  if (!upgradeIds || upgradeIds.length === 0) return new Map();
  
  // Validate array structure - ensure flat array of numbers
  const validIds = upgradeIds.filter(id => typeof id === 'number' && Number.isFinite(id));
  if (validIds.length !== upgradeIds.length) {
    console.error('Invalid upgradeIds detected:', upgradeIds);
  }
  if (validIds.length === 0) return new Map();
  
  const results = await sql`
    SELECT upgrade_id, level FROM guild_upgrades 
    WHERE guild_id = ${guildId} AND upgrade_id IN ${sql(validIds)}
  `;
  
  // Create a map keyed by upgrade_id
  const levelMap = new Map();
  for (const row of results) {
    levelMap.set(row.upgrade_id, row.level);
  }
  
  return levelMap;
}

/**
 * Get all upgrades a guild has purchased
 * @param {number} guildId - Guild ID
 * @returns {Promise<Array>} Guild's upgrades with upgrade details
 */
export async function getGuildUpgrades(guildId) {
  const result = await sql`
    SELECT gu.*, u.name, u.description, u.category, u.effect_type, u.effect_value, u.max_level
    FROM guild_upgrades gu
    JOIN upgrades u ON gu.upgrade_id = u.id
    WHERE gu.guild_id = ${guildId}
  `;
  return result;
}

/**
 * Get a guild's level for a specific upgrade
 * @param {number} guildId - Guild ID
 * @param {number} upgradeId - Upgrade ID
 * @returns {Promise<number>} Current level (0 if not purchased)
 */
export async function getGuildUpgradeLevel(guildId, upgradeId) {
  const [result] = await sql`
    SELECT level FROM guild_upgrades 
    WHERE guild_id = ${guildId} AND upgrade_id = ${upgradeId}
  `;
  return result?.level || 0;
}

/**
 * Purchase or upgrade an upgrade for a guild
 * @param {number} guildId - Guild ID
 * @param {number} upgradeId - Upgrade ID
 * @param {number} cost - Gold cost
 * @returns {Promise<Object>} The guild_upgrade record
 */
export async function purchaseUpgrade(guildId, upgradeId, cost) {
  return await sql.begin(async (tx) => {
    // Deduct gold
    const [goldResult] = await tx`
      UPDATE guilds SET gold = gold - ${cost} 
      WHERE id = ${guildId} AND gold >= ${cost} 
      RETURNING *
    `;
    
    if (!goldResult) {
      throw new Error('Insufficient gold');
    }
    
    // Insert or update the upgrade
    const [upgradeResult] = await tx`
      INSERT INTO guild_upgrades (guild_id, upgrade_id, level)
      VALUES (${guildId}, ${upgradeId}, 1)
      ON CONFLICT (guild_id, upgrade_id) 
      DO UPDATE SET level = guild_upgrades.level + 1, purchased_at = NOW()
      RETURNING *
    `;
    
    return upgradeResult;
  });
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
  return await sql.begin(async (tx) => {
    // Deduct gold and track spending stats
    const [goldResult] = await tx`
      UPDATE guilds 
      SET gold = gold - ${totalCost},
          lifetime_gold_spent = lifetime_gold_spent + ${totalCost},
          lifetime_upgrades_purchased = lifetime_upgrades_purchased + ${levelsToBuy},
          peak_gold_balance = GREATEST(peak_gold_balance, gold - ${totalCost})
      WHERE id = ${guildId} AND gold >= ${totalCost} 
      RETURNING *
    `;
    
    if (!goldResult) {
      throw new Error('Insufficient gold');
    }
    
    // Get current level
    const [currentResult] = await tx`
      SELECT level FROM guild_upgrades 
      WHERE guild_id = ${guildId} AND upgrade_id = ${upgradeId}
    `;
    const currentLevel = currentResult?.level || 0;
    const newLevel = currentLevel + levelsToBuy;
    
    // Insert or update the upgrade
    const [upgradeResult] = await tx`
      INSERT INTO guild_upgrades (guild_id, upgrade_id, level)
      VALUES (${guildId}, ${upgradeId}, ${newLevel})
      ON CONFLICT (guild_id, upgrade_id) 
      DO UPDATE SET level = ${newLevel}, purchased_at = NOW()
      RETURNING *
    `;
    
    return { 
      ...upgradeResult, 
      remainingGold: goldResult.gold 
    };
  });
}

/**
 * Get available upgrades for a guild (that they can see/purchase)
 * @param {number} guildId - Guild ID
 * @param {number} guildLevel - Guild's current level
 * @param {number} adventurerCount - Guild's adventurer count
 * @returns {Promise<Array>} Available upgrades with current levels
 */
export async function getAvailableUpgrades(guildId, guildLevel, adventurerCount) {
  const result = await sql`
    SELECT u.*, COALESCE(gu.level, 0) as current_level
    FROM upgrades u
    LEFT JOIN guild_upgrades gu ON u.id = gu.upgrade_id AND gu.guild_id = ${guildId}
    WHERE u.required_guild_level <= ${guildLevel}
      AND u.required_adventurer_count <= ${adventurerCount}
      AND (u.required_upgrade_id IS NULL 
           OR EXISTS (SELECT 1 FROM guild_upgrades WHERE guild_id = ${guildId} AND upgrade_id = u.required_upgrade_id))
      AND (u.max_level IS NULL OR COALESCE(gu.level, 0) < u.max_level)
    ORDER BY u.category, u.required_guild_level, u.base_cost
  `;
  return result;
}
