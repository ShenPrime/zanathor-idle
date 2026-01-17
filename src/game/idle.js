import { GAME, PRESTIGE, getRankForLevel } from '../config.js';
import { getGuildUpgrades } from '../database/upgrades.js';
import { getOwnedPrestigeUpgrades, getPrestigeUpgradeEffect } from '../database/prestige.js';

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
 * Calculate prestige bonuses from prestige level and prestige upgrades
 * @param {Object} guild - Guild data (needs prestige_level)
 * @param {Array} prestigeUpgrades - Guild's prestige upgrades
 * @returns {Object} Prestige bonus multipliers
 */
export function calculatePrestigeBonuses(guild, prestigeUpgrades = []) {
  const bonuses = {
    goldMultiplier: 1.0,
    xpMultiplier: 1.0,
    recruitmentMultiplier: 1.0,
    maxIdleHoursBonus: 0,
    doubleGoldChance: 0,
  };

  const prestigeLevel = guild.prestige_level || 0;

  // Base prestige bonuses (compound)
  if (prestigeLevel > 0) {
    bonuses.goldMultiplier = Math.pow(1 + PRESTIGE.GOLD_BONUS_PER_LEVEL, prestigeLevel);
    bonuses.xpMultiplier = Math.pow(1 + PRESTIGE.XP_BONUS_PER_LEVEL, prestigeLevel);
    bonuses.recruitmentMultiplier = Math.pow(1 + PRESTIGE.RECRUIT_BONUS_PER_LEVEL, prestigeLevel);
  }

  // Apply prestige upgrade effects
  for (const upgrade of prestigeUpgrades) {
    const level = upgrade.level || 0;
    if (level === 0) continue;

    const value = parseFloat(upgrade.effect_value);

    switch (upgrade.effect_type) {
      case 'permanent_gold_multiplier':
        // Compounds: (1.08)^level
        bonuses.goldMultiplier *= Math.pow(1 + value, level);
        break;

      case 'permanent_xp_multiplier':
        // Compounds: (1.08)^level
        bonuses.xpMultiplier *= Math.pow(1 + value, level);
        break;

      case 'max_idle_hours':
        // +2/4/8 hours (cumulative based on level)
        const hourBonuses = [2, 2, 4]; // Level 1: +2, Level 2: +4, Level 3: +8 total
        for (let i = 0; i < level; i++) {
          bonuses.maxIdleHoursBonus += hourBonuses[i] || 0;
        }
        break;

      case 'double_gold_chance':
        // +2% per level
        bonuses.doubleGoldChance += value * level;
        break;

      case 'xp_per_prestige':
        // +2% XP per prestige level
        bonuses.xpMultiplier *= 1 + (value * prestigeLevel);
        break;

      case 'gold_per_prestige':
        // +2% gold per prestige level
        bonuses.goldMultiplier *= 1 + (value * prestigeLevel);
        break;
    }
  }

  return bonuses;
}

/**
 * Calculate gold and XP generation rates for a guild
 * @param {Object} guild - Guild data
 * @param {Object} bonuses - Calculated upgrade bonuses
 * @param {Object} prestigeBonuses - Calculated prestige bonuses (optional)
 * @returns {Object} Gold and XP per hour
 */
export function calculateRates(guild, bonuses, prestigeBonuses = null) {
  const rank = getRankForLevel(guild.level);

  // Base gold = (adventurers * base rate * rank multiplier) + flat bonuses
  const baseGoldPerHour =
    guild.adventurer_count * GAME.BASE_GOLD_PER_HOUR * rank.multiplier +
    bonuses.baseGoldPerHour;

  // Apply gold multiplier from upgrades
  let goldPerHour = baseGoldPerHour * bonuses.goldMultiplier;

  // Apply prestige gold multiplier
  if (prestigeBonuses) {
    goldPerHour *= prestigeBonuses.goldMultiplier;
  }

  // Base XP = (adventurers * base rate) + flat bonuses
  const baseXpPerHour =
    guild.adventurer_count * GAME.BASE_XP_PER_HOUR + bonuses.baseXpPerHour;

  // Apply XP multiplier from upgrades
  let xpPerHour = baseXpPerHour * bonuses.xpMultiplier;

  // Apply prestige XP multiplier
  if (prestigeBonuses) {
    xpPerHour *= prestigeBonuses.xpMultiplier;
  }

  return {
    goldPerHour: Math.floor(goldPerHour),
    xpPerHour: Math.floor(xpPerHour),
  };
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

  // Get prestige upgrades and calculate prestige bonuses
  const prestigeUpgrades = await getOwnedPrestigeUpgrades(guild.id);
  const prestigeBonuses = calculatePrestigeBonuses(guild, prestigeUpgrades);

  const rates = calculateRates(guild, bonuses, prestigeBonuses);

  // Calculate time since last collection
  const lastCollected = new Date(guild.last_collected_at);
  const now = new Date();
  const hoursElapsed = (now - lastCollected) / (1000 * 60 * 60);

  // Calculate max idle hours (base + prestige bonus)
  const maxIdleHours = GAME.MAX_IDLE_HOURS + prestigeBonuses.maxIdleHoursBonus;

  // Cap at maximum idle hours
  const cappedHours = Math.min(hoursElapsed, maxIdleHours);

  // Calculate earnings
  let goldEarned = Math.floor(rates.goldPerHour * cappedHours);
  const xpEarned = Math.floor(rates.xpPerHour * cappedHours);

  // Check for double gold (Lucky Coin)
  let doubledGold = false;
  if (prestigeBonuses.doubleGoldChance > 0 && Math.random() < prestigeBonuses.doubleGoldChance) {
    goldEarned *= 2;
    doubledGold = true;
  }

  // Calculate adventurer growth (if they have the upgrade)
  // Apply prestige recruitment multiplier
  let adventurersGained = Math.floor(
    bonuses.adventurerPerHour * cappedHours * prestigeBonuses.recruitmentMultiplier
  );

  return {
    goldEarned,
    xpEarned,
    adventurersGained,
    hoursElapsed: cappedHours,
    rates,
    bonuses,
    prestigeBonuses,
    wasCapped: hoursElapsed > maxIdleHours,
    maxIdleHours,
    doubledGold,
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

/**
 * Format prestige bonuses as a percentage string
 * @param {number} multiplier - The multiplier (e.g., 1.276)
 * @returns {string} Formatted percentage (e.g., "+27.6%")
 */
export function formatPrestigeBonus(multiplier) {
  const percentage = (multiplier - 1) * 100;
  if (percentage === 0) return '+0%';
  return `+${percentage.toFixed(1)}%`;
}
