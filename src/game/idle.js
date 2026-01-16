import { GAME, getRankForLevel } from '../config.js';
import { getGuildUpgrades } from '../database/upgrades.js';

/**
 * Calculate the bonuses from all upgrades a guild owns
 * @param {Array} upgrades - Guild's purchased upgrades
 * @returns {Object} Bonus multipliers and flat bonuses
 */
export function calculateUpgradeBonuses(upgrades) {
  const bonuses = {
    goldMultiplier: 1.0,
    xpMultiplier: 1.0,
    adventurerCapacityBonus: 0,
    adventurerPerHour: 0,
    baseGoldPerHour: 0,
    baseXpPerHour: 0,
  };

  for (const upgrade of upgrades) {
    const level = upgrade.level || 1;
    const value = parseFloat(upgrade.effect_value) * level;

    switch (upgrade.effect_type) {
      case 'gold_multiplier':
        bonuses.goldMultiplier += value;
        break;
      case 'xp_multiplier':
        bonuses.xpMultiplier += value;
        break;
      case 'all_multiplier':
        bonuses.goldMultiplier += value;
        bonuses.xpMultiplier += value;
        break;
      case 'adventurer_capacity':
        bonuses.adventurerCapacityBonus += value;
        break;
      case 'adventurer_per_hour':
        bonuses.adventurerPerHour += value;
        break;
      case 'base_gold_per_hour':
        bonuses.baseGoldPerHour += value;
        break;
      case 'base_gold_and_xp':
        bonuses.baseGoldPerHour += value;
        bonuses.baseXpPerHour += value * 0.5; // XP is 50% of gold bonus
        break;
      case 'capacity_and_gold':
        bonuses.adventurerCapacityBonus += value;
        bonuses.goldMultiplier += 0.08 * level; // 8% gold per level
        break;
    }
  }

  return bonuses;
}

/**
 * Calculate gold and XP generation rates for a guild
 * @param {Object} guild - Guild data
 * @param {Object} bonuses - Calculated upgrade bonuses
 * @returns {Object} Gold and XP per hour
 */
export function calculateRates(guild, bonuses) {
  const rank = getRankForLevel(guild.level);

  // Base gold = (adventurers * base rate * rank multiplier) + flat bonuses
  const baseGoldPerHour =
    guild.adventurer_count * GAME.BASE_GOLD_PER_HOUR * rank.multiplier +
    bonuses.baseGoldPerHour;

  // Apply gold multiplier from upgrades
  const goldPerHour = Math.floor(baseGoldPerHour * bonuses.goldMultiplier);

  // Base XP = (adventurers * base rate) + flat bonuses
  const baseXpPerHour =
    guild.adventurer_count * GAME.BASE_XP_PER_HOUR + bonuses.baseXpPerHour;

  // Apply XP multiplier from upgrades
  const xpPerHour = Math.floor(baseXpPerHour * bonuses.xpMultiplier);

  return { goldPerHour, xpPerHour };
}

/**
 * Calculate idle earnings since last collection
 * @param {Object} guild - Guild data from database
 * @returns {Promise<Object>} Earnings and time elapsed
 */
export async function calculateIdleEarnings(guild) {
  // Get guild's upgrades
  const upgrades = await getGuildUpgrades(guild.id);
  const bonuses = calculateUpgradeBonuses(upgrades);
  const rates = calculateRates(guild, bonuses);

  // Calculate time since last collection
  const lastCollected = new Date(guild.last_collected_at);
  const now = new Date();
  const hoursElapsed = (now - lastCollected) / (1000 * 60 * 60);

  // Cap at maximum idle hours
  const cappedHours = Math.min(hoursElapsed, GAME.MAX_IDLE_HOURS);

  // Calculate earnings
  const goldEarned = Math.floor(rates.goldPerHour * cappedHours);
  const xpEarned = Math.floor(rates.xpPerHour * cappedHours);

  // Calculate adventurer growth (if they have the upgrade)
  const adventurersGained = Math.floor(bonuses.adventurerPerHour * cappedHours);

  return {
    goldEarned,
    xpEarned,
    adventurersGained,
    hoursElapsed: cappedHours,
    rates,
    bonuses,
    wasCapped: hoursElapsed > GAME.MAX_IDLE_HOURS,
  };
}

/**
 * Get the effective adventurer capacity for a guild
 * @param {Object} guild - Guild data
 * @param {Object} bonuses - Upgrade bonuses
 * @returns {number} Total adventurer capacity
 */
export function getEffectiveCapacity(guild, bonuses) {
  return guild.adventurer_capacity + bonuses.adventurerCapacityBonus;
}
