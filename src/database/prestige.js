import { query, getClient } from './connection.js';
import { PRESTIGE } from '../config.js';

/**
 * Get all prestige upgrade definitions
 * @returns {Promise<Array>} All prestige upgrades
 */
export async function getAllPrestigeUpgrades() {
  const { rows } = await query(
    'SELECT * FROM prestige_upgrades ORDER BY id'
  );
  return rows;
}

/**
 * Get a prestige upgrade by ID
 * @param {number} upgradeId - The upgrade ID
 * @returns {Promise<Object|null>} The upgrade or null
 */
export async function getPrestigeUpgradeById(upgradeId) {
  const { rows } = await query(
    'SELECT * FROM prestige_upgrades WHERE id = $1',
    [upgradeId]
  );
  return rows[0] || null;
}

/**
 * Get all prestige upgrades a guild has purchased
 * @param {number} guildId - The guild ID
 * @returns {Promise<Array>} Guild's prestige upgrades with details
 */
export async function getGuildPrestigeUpgrades(guildId) {
  const { rows } = await query(
    `SELECT pu.*, gpu.level as current_level
     FROM prestige_upgrades pu
     LEFT JOIN guild_prestige_upgrades gpu ON pu.id = gpu.prestige_upgrade_id AND gpu.guild_id = $1
     ORDER BY pu.id`,
    [guildId]
  );
  return rows;
}

/**
 * Get guild's owned prestige upgrades only (for bonus calculations)
 * @param {number} guildId - The guild ID
 * @returns {Promise<Array>} Owned prestige upgrades
 */
export async function getOwnedPrestigeUpgrades(guildId) {
  const { rows } = await query(
    `SELECT pu.*, gpu.level
     FROM guild_prestige_upgrades gpu
     JOIN prestige_upgrades pu ON gpu.prestige_upgrade_id = pu.id
     WHERE gpu.guild_id = $1`,
    [guildId]
  );
  return rows;
}

/**
 * Get the current level of a specific prestige upgrade for a guild
 * @param {number} guildId - The guild ID
 * @param {number} upgradeId - The prestige upgrade ID
 * @returns {Promise<number>} Current level (0 if not purchased)
 */
export async function getGuildPrestigeUpgradeLevel(guildId, upgradeId) {
  const { rows } = await query(
    'SELECT level FROM guild_prestige_upgrades WHERE guild_id = $1 AND prestige_upgrade_id = $2',
    [guildId, upgradeId]
  );
  return rows[0]?.level || 0;
}

/**
 * Purchase a prestige upgrade
 * @param {number} guildId - The guild ID
 * @param {number} upgradeId - The prestige upgrade ID
 * @returns {Promise<Object>} Result with success status and new level
 */
export async function purchasePrestigeUpgrade(guildId, upgradeId) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Get the upgrade details
    const { rows: [upgrade] } = await client.query(
      'SELECT * FROM prestige_upgrades WHERE id = $1',
      [upgradeId]
    );
    
    if (!upgrade) {
      throw new Error('Prestige upgrade not found');
    }
    
    // Get current level
    const { rows: [current] } = await client.query(
      'SELECT level FROM guild_prestige_upgrades WHERE guild_id = $1 AND prestige_upgrade_id = $2',
      [guildId, upgradeId]
    );
    
    const currentLevel = current?.level || 0;
    
    // Check if already maxed
    if (currentLevel >= upgrade.max_level) {
      throw new Error('Upgrade already at max level');
    }
    
    // Get cost for next level
    const cost = upgrade.point_costs[currentLevel];
    
    // Get guild's prestige points
    const { rows: [guild] } = await client.query(
      'SELECT prestige_points FROM guilds WHERE id = $1',
      [guildId]
    );
    
    if (guild.prestige_points < cost) {
      throw new Error(`Not enough prestige points (need ${cost}, have ${guild.prestige_points})`);
    }
    
    // Deduct points
    await client.query(
      'UPDATE guilds SET prestige_points = prestige_points - $1 WHERE id = $2',
      [cost, guildId]
    );
    
    // Add or update the upgrade
    if (currentLevel === 0) {
      await client.query(
        `INSERT INTO guild_prestige_upgrades (guild_id, prestige_upgrade_id, level)
         VALUES ($1, $2, 1)`,
        [guildId, upgradeId]
      );
    } else {
      await client.query(
        `UPDATE guild_prestige_upgrades 
         SET level = level + 1, purchased_at = NOW()
         WHERE guild_id = $1 AND prestige_upgrade_id = $2`,
        [guildId, upgradeId]
      );
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      newLevel: currentLevel + 1,
      pointsSpent: cost,
      upgradeName: upgrade.name,
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    return {
      success: false,
      error: error.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Check if a guild can prestige
 * @param {Object} guild - The guild object
 * @returns {Object} Eligibility status and requirements
 */
export function canPrestige(guild) {
  const requiredLevel = getPrestigeRequirement(guild.prestige_level);
  const eligible = guild.level >= requiredLevel;
  
  return {
    eligible,
    currentLevel: guild.level,
    requiredLevel,
    prestigeLevel: guild.prestige_level,
  };
}

/**
 * Get the level requirement for next prestige
 * @param {number} currentPrestigeLevel - Current prestige level
 * @returns {number} Required guild level
 */
export function getPrestigeRequirement(currentPrestigeLevel) {
  // First prestige at 50, then +10 each time, capped at 75
  const baseRequirement = PRESTIGE.MIN_LEVEL + (currentPrestigeLevel * PRESTIGE.LEVEL_INCREMENT);
  return Math.min(baseRequirement, PRESTIGE.MAX_REQUIREMENT);
}

/**
 * Calculate prestige rewards for a guild
 * @param {Object} guild - The guild object
 * @returns {Object} Points earned and bonuses gained
 */
export function calculatePrestigeRewards(guild) {
  // Base point: 1
  // Bonus points: 1 per 10 levels above 50 (capped at 3 bonus)
  const basePoints = 1;
  const bonusPoints = Math.min(3, Math.floor((guild.level - 50) / 10));
  const totalPoints = basePoints + bonusPoints;
  
  return {
    basePoints,
    bonusPoints,
    totalPoints,
    newPrestigeLevel: guild.prestige_level + 1,
  };
}

/**
 * Execute prestige for a guild
 * @param {number} guildId - The guild ID
 * @param {Array} prestigeUpgrades - Guild's prestige upgrades for calculating starting values
 * @returns {Promise<Object>} Result with new stats
 */
export async function executePrestige(guildId, prestigeUpgrades = []) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Get current guild data
    const { rows: [guild] } = await client.query(
      'SELECT * FROM guilds WHERE id = $1',
      [guildId]
    );
    
    if (!guild) {
      throw new Error('Guild not found');
    }
    
    // Check eligibility
    const eligibility = canPrestige(guild);
    if (!eligibility.eligible) {
      throw new Error(`Must be level ${eligibility.requiredLevel} to prestige`);
    }
    
    // Calculate rewards
    const rewards = calculatePrestigeRewards(guild);
    
    // Calculate starting values from prestige upgrades
    const startingValues = calculateStartingValues(prestigeUpgrades);
    
    // Calculate gold to keep (from Quick Start upgrade)
    const goldKeepPercent = getPrestigeUpgradeEffect(prestigeUpgrades, 'gold_keep_percent');
    const goldToKeep = Math.floor(guild.gold * goldKeepPercent);
    
    // Reset guild stats
    await client.query(
      `UPDATE guilds SET
        level = 1,
        xp = 0,
        gold = $2,
        adventurer_count = $3,
        adventurer_capacity = $4,
        last_collected_at = NOW(),
        prestige_level = prestige_level + 1,
        prestige_points = prestige_points + $5,
        total_prestige_points_earned = total_prestige_points_earned + $5,
        lifetime_prestiges = lifetime_prestiges + 1
       WHERE id = $1`,
      [
        guildId,
        startingValues.gold + goldToKeep,
        startingValues.adventurers,
        startingValues.capacity,
        rewards.totalPoints,
      ]
    );
    
    // Clear all regular upgrades
    await client.query(
      'DELETE FROM guild_upgrades WHERE guild_id = $1',
      [guildId]
    );
    
    // Get updated guild before committing (still in transaction)
    const { rows: [updatedGuild] } = await client.query(
      'SELECT * FROM guilds WHERE id = $1',
      [guildId]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      pointsEarned: rewards.totalPoints,
      newPrestigeLevel: rewards.newPrestigeLevel,
      startingGold: startingValues.gold + goldToKeep,
      startingAdventurers: startingValues.adventurers,
      startingCapacity: startingValues.capacity,
      goldKept: goldToKeep,
      guild: updatedGuild,
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    return {
      success: false,
      error: error.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Calculate starting values from prestige upgrades
 * @param {Array} prestigeUpgrades - Guild's prestige upgrades
 * @returns {Object} Starting gold, adventurers, capacity
 */
export function calculateStartingValues(prestigeUpgrades) {
  // Base starting values (from config)
  const base = {
    gold: 25,       // GAME.STARTING_GOLD
    adventurers: 5, // GAME.STARTING_ADVENTURERS
    capacity: 10,   // GAME.STARTING_ADVENTURER_CAPACITY
  };
  
  for (const upgrade of prestigeUpgrades) {
    const level = upgrade.level || 0;
    if (level === 0) continue;
    
    switch (upgrade.effect_type) {
      case 'starting_gold':
        // +100/250/500/1000/2500 gold (cumulative)
        const goldBonuses = [100, 250, 500, 1000, 2500];
        for (let i = 0; i < level; i++) {
          base.gold += goldBonuses[i] || 0;
        }
        break;
        
      case 'starting_adventurers':
        // +2/4/7/11/16 adventurers (cumulative)
        const advBonuses = [2, 2, 3, 4, 5];
        for (let i = 0; i < level; i++) {
          base.adventurers += advBonuses[i] || 0;
        }
        break;
        
      case 'starting_capacity':
        // +5/12/20/30/45 capacity (cumulative)
        const capBonuses = [5, 7, 8, 10, 15];
        for (let i = 0; i < level; i++) {
          base.capacity += capBonuses[i] || 0;
        }
        break;
    }
  }
  
  return base;
}

/**
 * Get the total effect value from a prestige upgrade type
 * @param {Array} prestigeUpgrades - Guild's prestige upgrades
 * @param {string} effectType - The effect type to sum
 * @returns {number} Total effect value
 */
export function getPrestigeUpgradeEffect(prestigeUpgrades, effectType) {
  let total = 0;
  
  for (const upgrade of prestigeUpgrades) {
    if (upgrade.effect_type === effectType && upgrade.level > 0) {
      total += parseFloat(upgrade.effect_value) * upgrade.level;
    }
  }
  
  return total;
}

/**
 * Toggle auto-prestige for a guild
 * @param {number} guildId - The guild ID
 * @returns {Promise<boolean>} New auto-prestige status
 */
export async function toggleAutoPrestige(guildId) {
  const { rows } = await query(
    `UPDATE guilds 
     SET auto_prestige_enabled = NOT auto_prestige_enabled 
     WHERE id = $1 
     RETURNING auto_prestige_enabled`,
    [guildId]
  );
  return rows[0]?.auto_prestige_enabled || false;
}

/**
 * Check and execute auto-prestige if enabled and eligible
 * @param {Object} guild - The guild object
 * @param {Array} prestigeUpgrades - Guild's prestige upgrades
 * @returns {Promise<Object|null>} Prestige result or null if not executed
 */
export async function checkAutoPrestige(guild, prestigeUpgrades) {
  if (!guild.auto_prestige_enabled) {
    return null;
  }
  
  const eligibility = canPrestige(guild);
  if (!eligibility.eligible) {
    return null;
  }
  
  return await executePrestige(guild.id, prestigeUpgrades);
}
