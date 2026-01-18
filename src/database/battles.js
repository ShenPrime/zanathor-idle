import { query, getClient } from './connection.js';
import { getRankForLevel } from '../config.js';
import { getGuildUpgrades } from './upgrades.js';
import { getOwnedPrestigeUpgrades } from './prestige.js';
import { calculateUpgradeBonuses, calculateRates, calculatePrestigeBonuses } from '../game/idle.js';

// TODO: Re-enable for production
// const GLOBAL_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
// const TARGET_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
// const DAILY_BATTLE_LIMIT = 10;
// const MINIMUM_BET = 200;

// DEV: Disabled for testing
const GLOBAL_COOLDOWN_MS = 0;
const TARGET_COOLDOWN_MS = 0;
const DAILY_BATTLE_LIMIT = 999;
const MINIMUM_BET = 0;

// Power ratio thresholds for battle balancing
const POWER_RATIO_CAPPED = 3;        // >= 3x: stronger player's winnings capped to 1-5% of weaker's gold
const POWER_RATIO_CONSENT = 5;       // >= 5x: requires defender consent + free revenge option

// Consent timeout in milliseconds
const CONSENT_TIMEOUT_MS = 30 * 1000; // 30 seconds

// Free revenge timeout in milliseconds
const FREE_REVENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Calculate guild power for battle
 * Power = adventurers + (goldPerHour / 500) + (xp / 5000)
 * Uses actual production rates (with upgrades/prestige) instead of held gold
 * @param {Object} guild - Guild object
 * @returns {Promise<number>} Power value
 */
export async function calculatePower(guild) {
  // Get guild's upgrades and calculate bonuses
  const upgrades = await getGuildUpgrades(guild.id);
  const bonuses = calculateUpgradeBonuses(upgrades);
  
  // Get prestige upgrades and calculate prestige bonuses
  const prestigeUpgrades = await getOwnedPrestigeUpgrades(guild.id);
  const prestigeBonuses = calculatePrestigeBonuses(guild, prestigeUpgrades);
  
  // Calculate rates with all bonuses applied
  const rates = calculateRates(guild, bonuses, prestigeBonuses);
  
  const adventurerPower = guild.adventurer_count;
  const goldRatePower = rates.goldPerHour / 500;
  const xpPower = Number(guild.xp) / 5000;
  
  return adventurerPower + goldRatePower + xpPower;
}

/**
 * Calculate win chance with super gentle weighting
 * Base: 50% +/- up to 15% based on power difference
 * Clamped to 35%-65% range
 * @param {number} attackerPower - Attacker's power
 * @param {number} defenderPower - Defender's power
 * @returns {number} Win chance as percentage (0-100)
 */
export function calculateWinChance(attackerPower, defenderPower) {
  const totalPower = attackerPower + defenderPower;
  if (totalPower === 0) return 50;
  
  const powerDiff = attackerPower - defenderPower;
  const adjustment = (powerDiff / totalPower) * 15;
  const winChance = 50 + adjustment;
  
  // Clamp to 35%-65% range
  return Math.min(65, Math.max(35, winChance));
}

/**
 * Roll battle outcome
 * @param {number} winChance - Win chance percentage
 * @returns {boolean} True if attacker wins
 */
export function rollBattle(winChance) {
  const roll = Math.random() * 100;
  return roll < winChance;
}

/**
 * Calculate power ratio between two guilds
 * @param {number} power1 - First guild's power
 * @param {number} power2 - Second guild's power
 * @returns {number} Ratio of stronger/weaker (always >= 1)
 */
export function calculatePowerRatio(power1, power2) {
  const stronger = Math.max(power1, power2);
  const weaker = Math.min(power1, power2);
  if (weaker === 0) return Infinity;
  return stronger / weaker;
}

/**
 * Determine battle type based on power ratio
 * @param {number} powerRatio - Power ratio between guilds
 * @returns {{ type: 'normal' | 'capped' | 'consent', requiresConsent: boolean, isCapped: boolean, freeRevenge: boolean }}
 */
export function getBattleType(powerRatio) {
  if (powerRatio < POWER_RATIO_CAPPED) {
    return { type: 'normal', requiresConsent: false, isCapped: false, freeRevenge: false };
  } else if (powerRatio < POWER_RATIO_CONSENT) {
    return { type: 'capped', requiresConsent: false, isCapped: true, freeRevenge: false };
  } else {
    return { type: 'consent', requiresConsent: true, isCapped: true, freeRevenge: true };
  }
}

/**
 * Calculate battle rewards based on new system:
 * - Winner takes bet from loser (or capped amount if power disparity)
 * - Winner gets flat 1-5% XP bonus
 * - IMPORTANT: Attacker ALWAYS loses their full bet if they lose, no caps
 * 
 * @param {Object} params - Battle parameters
 * @param {number} params.betAmount - The bet amount
 * @param {Object} params.loserGuild - Loser's guild
 * @param {boolean} params.strongerWon - Whether the stronger player won
 * @param {boolean} params.isCapped - Whether power disparity cap applies
 * @param {boolean} params.attackerLost - Whether the attacker was the one who lost
 * @returns {{ goldTransfer: number, xpBonus: number, wasCapped: boolean }}
 */
export function calculateBattleRewards({ betAmount, loserGuild, strongerWon, isCapped, attackerLost }) {
  // XP bonus for winner: flat 1-5%
  const xpPercent = 1 + Math.random() * 4; // 1-5%
  const xpBonus = Math.floor(Number(loserGuild.xp) * (xpPercent / 100));
  
  // Gold transfer: normally the bet amount
  let goldTransfer = betAmount;
  let wasCapped = false;
  
  // Attacker ALWAYS loses their full bet if they lose - no caps apply
  // Caps only protect defenders (the weaker party being attacked)
  if (attackerLost) {
    // Attacker loses: full bet amount, no cap protection
    goldTransfer = betAmount;
  } else if (strongerWon && isCapped) {
    // Defender loses to stronger attacker: cap winnings to 1-5% of loser's gold
    const cappedPercent = 1 + Math.random() * 4; // 1-5%
    const cappedAmount = Math.floor(Number(loserGuild.gold) * (cappedPercent / 100));
    
    if (cappedAmount < betAmount) {
      goldTransfer = cappedAmount;
      wasCapped = true;
    }
  }
  
  // Can't take more than the loser has
  goldTransfer = Math.min(goldTransfer, Number(loserGuild.gold));
  
  return { goldTransfer, xpBonus, wasCapped };
}

/**
 * Calculate free revenge rewards (when defender counter-attacks for free)
 * Winner gets 1-2% of opponent's gold, loser loses nothing
 * 
 * @param {Object} attackerGuild - Original attacker's guild (now being counter-attacked)
 * @returns {{ goldReward: number, xpBonus: number }}
 */
export function calculateFreeRevengeRewards(attackerGuild) {
  const goldPercent = 1 + Math.random(); // 1-2%
  const goldReward = Math.floor(Number(attackerGuild.gold) * (goldPercent / 100));
  
  // Small XP bonus
  const xpPercent = 1 + Math.random(); // 1-2%
  const xpBonus = Math.floor(Number(attackerGuild.xp) * (xpPercent / 100));
  
  return { goldReward, xpBonus };
}

/**
 * Get the free revenge timeout in milliseconds
 * @returns {number} Timeout in ms
 */
export function getFreeRevengeTimeout() {
  return FREE_REVENGE_TIMEOUT_MS;
}

/**
 * Check if free revenge is still valid (within 5 minute window)
 * @param {number} battleTimestamp - Timestamp when original battle occurred
 * @returns {boolean} True if free revenge is still available
 */
export function isFreeRevengeValid(battleTimestamp) {
  const now = Date.now();
  return (now - battleTimestamp) < FREE_REVENGE_TIMEOUT_MS;
}

/**
 * Get the consent timeout in milliseconds
 * @returns {number} Timeout in ms
 */
export function getConsentTimeout() {
  return CONSENT_TIMEOUT_MS;
}

/**
 * Check if attacker can battle (cooldowns and daily limit)
 * @param {Object} attackerGuild - Attacker's guild
 * @returns {{ canBattle: boolean, reason?: string }}
 */
export function checkBattleCooldowns(attackerGuild) {
  const now = new Date();
  
  // Check daily limit (reset if new day)
  const today = now.toISOString().split('T')[0];
  const lastReset = attackerGuild.last_battle_reset;
  const battlesToday = lastReset === today ? (attackerGuild.battles_today || 0) : 0;
  
  if (battlesToday >= DAILY_BATTLE_LIMIT) {
    return { canBattle: false, reason: `You've reached your daily battle limit (${DAILY_BATTLE_LIMIT}). Try again tomorrow!` };
  }
  
  // Check global cooldown
  if (attackerGuild.last_battle_at && GLOBAL_COOLDOWN_MS > 0) {
    const lastBattle = new Date(attackerGuild.last_battle_at);
    const timeSince = now - lastBattle;
    if (timeSince < GLOBAL_COOLDOWN_MS) {
      const remaining = Math.ceil((GLOBAL_COOLDOWN_MS - timeSince) / 1000);
      return { canBattle: false, reason: `You must wait ${remaining} seconds before battling again.` };
    }
  }
  
  return { canBattle: true, battlesToday };
}

/**
 * Check if attacker can battle a specific target (per-target cooldown)
 * @param {number} attackerId - Attacker's guild ID
 * @param {number} defenderId - Defender's guild ID
 * @returns {Promise<{ canBattle: boolean, reason?: string }>}
 */
export async function checkTargetCooldown(attackerId, defenderId) {
  if (TARGET_COOLDOWN_MS === 0) return { canBattle: true };
  
  const result = await query(
    `SELECT created_at FROM battles 
     WHERE attacker_id = $1 AND defender_id = $2 
     ORDER BY created_at DESC LIMIT 1`,
    [attackerId, defenderId]
  );
  
  if (result.rows.length === 0) return { canBattle: true };
  
  const lastBattle = new Date(result.rows[0].created_at);
  const now = new Date();
  const timeSince = now - lastBattle;
  
  if (timeSince < TARGET_COOLDOWN_MS) {
    const remainingMs = TARGET_COOLDOWN_MS - timeSince;
    const remainingMins = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(remainingMins / 60);
    const mins = remainingMins % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    return { canBattle: false, reason: `You must wait ${timeStr} before battling this player again.` };
  }
  
  return { canBattle: true };
}

/**
 * Get a random guild to battle (excluding the attacker)
 * @param {number} attackerId - Attacker's guild ID
 * @returns {Promise<Object|null>} Random guild or null
 */
export async function getRandomTarget(attackerId) {
  const result = await query(
    `SELECT * FROM guilds WHERE id != $1 ORDER BY RANDOM() LIMIT 1`,
    [attackerId]
  );
  return result.rows[0] || null;
}

/**
 * Record a battle and apply results
 * @param {Object} params - Battle parameters
 * @returns {Promise<Object>} Battle record
 */
export async function recordBattle({
  attackerGuild,
  defenderGuild,
  betAmount,
  winnerId,
  goldTransferred,
  xpTransferred,
  attackerPower,
  defenderPower,
  winChance,
}) {
  const today = new Date().toISOString().split('T')[0];
  
  // Determine current battles_today, resetting if needed
  const lastReset = attackerGuild.last_battle_reset;
  const currentBattles = lastReset === today ? (attackerGuild.battles_today || 0) : 0;
  
  // Record the battle
  const battleResult = await query(
    `INSERT INTO battles (attacker_id, defender_id, bet_amount, winner_id, gold_transferred, xp_transferred, attacker_power, defender_power, win_chance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [attackerGuild.id, defenderGuild.id, betAmount, winnerId, goldTransferred, xpTransferred, attackerPower, defenderPower, winChance]
  );
  
  // Update attacker's cooldown tracking
  await query(
    `UPDATE guilds SET last_battle_at = NOW(), battles_today = $2, last_battle_reset = $3 WHERE id = $1`,
    [attackerGuild.id, currentBattles + 1, today]
  );
  
  return battleResult.rows[0];
}

/**
 * Apply battle results to guilds (new system: winner takes bet from loser)
 * Uses a transaction to ensure atomic updates - either all succeed or all fail
 * @param {number} winnerId - Winner's guild ID
 * @param {number} loserId - Loser's guild ID
 * @param {number} goldTransfer - Gold transferred from loser to winner
 * @param {number} xpBonus - XP bonus for winner (not taken from loser)
 */
export async function applyBattleResults(winnerId, loserId, goldTransfer, xpBonus) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Winner gains gold and XP bonus
    await client.query(
      `UPDATE guilds SET gold = gold + $2, xp = xp + $3 WHERE id = $1`,
      [winnerId, goldTransfer, xpBonus]
    );
    
    // Loser loses gold (no XP loss in new system)
    await client.query(
      `UPDATE guilds SET gold = GREATEST(0, gold - $2) WHERE id = $1`,
      [loserId, goldTransfer]
    );
    
    // Update lifetime stats for winner
    await client.query(
      `UPDATE guilds SET 
         lifetime_battles_won = lifetime_battles_won + 1,
         lifetime_battle_gold_won = lifetime_battle_gold_won + $2,
         lifetime_battle_xp_won = lifetime_battle_xp_won + $3
       WHERE id = $1`,
      [winnerId, goldTransfer, xpBonus]
    );
    
    // Update lifetime stats for loser
    await client.query(
      `UPDATE guilds SET 
         lifetime_battles_lost = lifetime_battles_lost + 1,
         lifetime_battle_gold_lost = lifetime_battle_gold_lost + $2
       WHERE id = $1`,
      [loserId, goldTransfer]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to apply battle results, rolling back:', error);
    throw error; // Re-throw so caller knows the battle failed
  } finally {
    client.release();
  }
}

/**
 * Apply free revenge battle results
 * If defender wins: gets gold from attacker, attacker loses gold
 * If defender loses: nothing happens (free revenge has no cost)
 * Uses a transaction to ensure atomic updates
 * @param {number} defenderId - Original defender's guild ID (counter-attacker)
 * @param {number} attackerId - Original attacker's guild ID (being counter-attacked)
 * @param {boolean} defenderWon - Whether the defender won the free revenge
 * @param {number} goldReward - Gold reward if defender wins
 * @param {number} xpBonus - XP bonus if defender wins
 */
export async function applyFreeRevengeResults(defenderId, attackerId, defenderWon, goldReward, xpBonus) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    if (defenderWon) {
      // Defender wins: gets gold and XP from attacker
      await client.query(
        `UPDATE guilds SET gold = gold + $2, xp = xp + $3 WHERE id = $1`,
        [defenderId, goldReward, xpBonus]
      );
      
      await client.query(
        `UPDATE guilds SET gold = GREATEST(0, gold - $2) WHERE id = $1`,
        [attackerId, goldReward]
      );
      
      // Update lifetime stats
      await client.query(
        `UPDATE guilds SET 
           lifetime_battles_won = lifetime_battles_won + 1,
           lifetime_battle_gold_won = lifetime_battle_gold_won + $2,
           lifetime_battle_xp_won = lifetime_battle_xp_won + $3
         WHERE id = $1`,
        [defenderId, goldReward, xpBonus]
      );
      
      await client.query(
        `UPDATE guilds SET 
           lifetime_battles_lost = lifetime_battles_lost + 1,
           lifetime_battle_gold_lost = lifetime_battle_gold_lost + $2
         WHERE id = $1`,
        [attackerId, goldReward]
      );
    } else {
      // Defender loses: nothing happens (free revenge), but still count as a loss
      await client.query(
        `UPDATE guilds SET lifetime_battles_lost = lifetime_battles_lost + 1 WHERE id = $1`,
        [defenderId]
      );
      
      await client.query(
        `UPDATE guilds SET lifetime_battles_won = lifetime_battles_won + 1 WHERE id = $1`,
        [attackerId]
      );
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to apply free revenge results, rolling back:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get battle history for a player
 * @param {number} guildId - Guild ID
 * @param {number} limit - Number of battles to retrieve
 * @returns {Promise<Array>} Recent battles with participant info
 */
export async function getBattleHistory(guildId, limit = 10) {
  const result = await query(
    `SELECT 
       b.*,
       att.name as attacker_name,
       att.discord_id as attacker_discord_id,
       def.name as defender_name,
       def.discord_id as defender_discord_id,
       win.name as winner_name,
       win.discord_id as winner_discord_id
     FROM battles b
     JOIN guilds att ON b.attacker_id = att.id
     JOIN guilds def ON b.defender_id = def.id
     JOIN guilds win ON b.winner_id = win.id
     WHERE b.attacker_id = $1 OR b.defender_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [guildId, limit]
  );
  return result.rows;
}

/**
 * Get remaining battles today for a guild
 * @param {Object} guild - Guild object
 * @returns {number} Remaining battles
 */
export function getRemainingBattlesToday(guild) {
  const today = new Date().toISOString().split('T')[0];
  const lastReset = guild.last_battle_reset;
  const battlesToday = lastReset === today ? (guild.battles_today || 0) : 0;
  return DAILY_BATTLE_LIMIT - battlesToday;
}

/**
 * Get the minimum bet amount
 * @returns {number} Minimum bet
 */
export function getMinimumBet() {
  return MINIMUM_BET;
}

/**
 * Get the daily battle limit
 * @returns {number} Daily limit
 */
export function getDailyBattleLimit() {
  return DAILY_BATTLE_LIMIT;
}

/**
 * Lock gold for a pending battle challenge (deduct from available gold)
 * @param {number} guildId - Guild ID
 * @param {number} amount - Amount to lock
 * @returns {Promise<boolean>} True if successful
 */
export async function lockBetGold(guildId, amount) {
  const result = await query(
    `UPDATE guilds SET gold = gold - $2 WHERE id = $1 AND gold >= $2 RETURNING *`,
    [guildId, amount]
  );
  return result.rows.length > 0;
}

/**
 * Unlock/return gold for a declined or expired challenge
 * @param {number} guildId - Guild ID
 * @param {number} amount - Amount to return
 * @returns {Promise<void>}
 */
export async function unlockBetGold(guildId, amount) {
  await query(
    `UPDATE guilds SET gold = gold + $2 WHERE id = $1`,
    [guildId, amount]
  );
}

/**
 * Get power ratio thresholds for display
 * @returns {{ capped: number, consent: number }}
 */
export function getPowerRatioThresholds() {
  return {
    capped: POWER_RATIO_CAPPED,
    consent: POWER_RATIO_CONSENT,
  };
}
