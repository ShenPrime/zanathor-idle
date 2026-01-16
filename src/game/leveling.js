import { getTotalXpForLevel, getRankForLevel } from '../config.js';
import { updateLevel } from '../database/guilds.js';

/**
 * Check if a guild should level up and apply levels
 * @param {Object} guild - Guild data with current XP
 * @returns {Promise<Object>} Updated guild and level-up info
 */
export async function checkAndApplyLevelUp(guild) {
  let currentLevel = guild.level;
  let levelsGained = 0;
  let oldRank = getRankForLevel(currentLevel);
  
  // Check for multiple level-ups
  while (guild.xp >= getTotalXpForLevel(currentLevel + 1)) {
    currentLevel++;
    levelsGained++;
  }
  
  // If levels were gained, update the database
  if (levelsGained > 0) {
    const updatedGuild = await updateLevel(guild.id, currentLevel);
    const newRank = getRankForLevel(currentLevel);
    
    return {
      guild: updatedGuild,
      leveledUp: true,
      levelsGained,
      newLevel: currentLevel,
      rankChanged: oldRank.name !== newRank.name,
      oldRank,
      newRank,
    };
  }
  
  return {
    guild,
    leveledUp: false,
    levelsGained: 0,
    newLevel: currentLevel,
    rankChanged: false,
  };
}

/**
 * Get XP progress info for display
 * @param {Object} guild - Guild data
 * @returns {Object} XP progress information
 */
export function getXpProgress(guild) {
  const currentLevelTotalXp = getTotalXpForLevel(guild.level);
  const nextLevelTotalXp = getTotalXpForLevel(guild.level + 1);
  const xpIntoCurrentLevel = guild.xp - currentLevelTotalXp;
  const xpNeededForNextLevel = nextLevelTotalXp - currentLevelTotalXp;
  const progressPercent = (xpIntoCurrentLevel / xpNeededForNextLevel) * 100;
  
  return {
    currentXp: guild.xp,
    xpIntoLevel: xpIntoCurrentLevel,
    xpNeeded: xpNeededForNextLevel,
    progressPercent: Math.min(progressPercent, 100),
    totalForNextLevel: nextLevelTotalXp,
  };
}
