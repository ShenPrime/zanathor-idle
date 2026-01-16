import { EmbedBuilder } from 'discord.js';
import { formatNumber, progressBar } from './format.js';
import { getRankForLevel, getNextRank, getXpForLevel, getTotalXpForLevel } from '../config.js';

// Color palette for embeds
export const COLORS = {
  PRIMARY: 0x5865F2,    // Discord Blurple
  SUCCESS: 0x57F287,    // Green
  WARNING: 0xFEE75C,    // Yellow
  ERROR: 0xED4245,      // Red
  GOLD: 0xFFD700,       // Gold
  INFO: 0x3498DB,       // Blue
};

import { GAME } from '../config.js';

/**
 * Generate rank bonus display text with next rank info
 */
function getRankBonusText(level, currentRank) {
  const nextRank = getNextRank(level);
  
  let text = `${currentRank.name} (x${currentRank.multiplier})`;
  
  if (nextRank) {
    text += `\nNext: ${nextRank.name} at Lv ${nextRank.level}`;
  } else {
    text += `\n*Max Rank!*`;
  }
  
  return text;
}

/**
 * Create a guild profile embed
 * @param {Object} guild - Guild data from database
 * @param {Object} stats - Calculated stats (goldPerHour, xpPerHour)
 * @param {Object} pendingEarnings - Pending earnings from calculateIdleEarnings()
 * @returns {EmbedBuilder}
 */
export function createGuildEmbed(guild, stats = {}, pendingEarnings = null) {
  const rank = getRankForLevel(guild.level);
  const nextLevelXp = getTotalXpForLevel(guild.level + 1);
  const currentLevelXp = getTotalXpForLevel(guild.level);
  const xpProgress = guild.xp - currentLevelXp;
  const xpNeeded = nextLevelXp - currentLevelXp;
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`${rank.emoji} ${guild.name}`)
    .setDescription(`*${rank.name} Rank Adventurer's Guild*`)
    .addFields(
      {
        name: 'Level',
        value: `**${guild.level}**\n${progressBar(xpProgress, xpNeeded)} ${formatNumber(xpProgress)}/${formatNumber(xpNeeded)} XP`,
        inline: false,
      },
      {
        name: 'Gold',
        value: `**${formatNumber(guild.gold)}**`,
        inline: true,
      },
      {
        name: 'Adventurers',
        value: `**${guild.adventurer_count}** / ${guild.adventurer_capacity}`,
        inline: true,
      },
      {
        name: 'Rank Bonus',
        value: getRankBonusText(guild.level, rank),
        inline: true,
      }
    );
  
  if (stats.goldPerHour !== undefined) {
    embed.addFields(
      {
        name: 'Gold/Hour',
        value: `**+${formatNumber(stats.goldPerHour)}**`,
        inline: true,
      },
      {
        name: 'XP/Hour',
        value: `**+${formatNumber(stats.xpPerHour)}**`,
        inline: true,
      }
    );
  }
  
  // Add pending earnings field
  if (pendingEarnings) {
    const hoursText = pendingEarnings.hoursElapsed < 1 
      ? `${Math.round(pendingEarnings.hoursElapsed * 60)} min`
      : `${pendingEarnings.hoursElapsed.toFixed(1)} hrs`;
    
    embed.addFields({
      name: 'Pending Collection',
      value: `**+${formatNumber(pendingEarnings.goldEarned)}** gold, **+${formatNumber(pendingEarnings.xpEarned)}** XP (${hoursText})`,
      inline: false,
    });
    
    // Check if approaching 24hr cap (warn at 20+ hours)
    const hoursRemaining = GAME.MAX_IDLE_HOURS - pendingEarnings.hoursElapsed;
    if (pendingEarnings.wasCapped) {
      embed.setFooter({ text: 'Your earnings have reached the 24hr cap! Collect now to avoid missing out.' });
      embed.setColor(COLORS.WARNING);
    } else if (hoursRemaining <= 4) {
      embed.setFooter({ text: `Warning: Earnings will cap in ${hoursRemaining.toFixed(1)} hours! Collect soon.` });
    } else {
      embed.setFooter({ text: 'Use /collect to claim your earnings!' });
    }
  } else {
    embed.setFooter({ text: 'Use /collect to claim your earnings!' });
  }
  
  embed.setTimestamp();
  
  return embed;
}

/**
 * Create an embed for collecting resources
 * @param {Object} guild - Guild data
 * @param {number} goldEarned - Gold collected
 * @param {number} xpEarned - XP collected
 * @param {number} hoursElapsed - Time since last collection
 * @param {boolean} leveledUp - Whether the guild leveled up
 * @param {number} newLevel - New level if leveled up
 * @returns {EmbedBuilder}
 */
export function createCollectEmbed(guild, goldEarned, xpEarned, hoursElapsed, leveledUp = false, newLevel = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('Resources Collected!')
    .setDescription(`Your adventurers have been busy for **${hoursElapsed.toFixed(1)} hours**!`)
    .addFields(
      {
        name: 'Gold Earned',
        value: `+${formatNumber(goldEarned)}`,
        inline: true,
      },
      {
        name: 'XP Earned',
        value: `+${formatNumber(xpEarned)}`,
        inline: true,
      },
      {
        name: 'Total Gold',
        value: formatNumber(guild.gold),
        inline: true,
      }
    );
  
  if (leveledUp) {
    const newRank = getRankForLevel(newLevel);
    embed.addFields({
      name: 'LEVEL UP!',
      value: `${newRank.emoji} Your guild is now **Level ${newLevel}**!`,
      inline: false,
    });
    embed.setColor(COLORS.SUCCESS);
  }
  
  embed.setTimestamp();
  
  return embed;
}

/**
 * Create an embed for the upgrade shop
 * @param {Array} upgrades - Available upgrades
 * @param {string} category - Category being viewed
 * @param {number} playerGold - Player's current gold
 * @returns {EmbedBuilder}
 */
export function createUpgradesEmbed(upgrades, category, playerGold) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`Upgrades - ${category.charAt(0).toUpperCase() + category.slice(1)}`)
    .setDescription(`Your gold: **${formatNumber(playerGold)}**\n\nUse \`/buy <upgrade name>\` to purchase.`);
  
  if (upgrades.length === 0) {
    embed.addFields({
      name: 'No Upgrades Available',
      value: 'Level up your guild or recruit more adventurers to unlock new upgrades!',
      inline: false,
    });
  } else {
    for (const upgrade of upgrades.slice(0, 10)) { // Limit to 10 to avoid embed limits
      const cost = Math.floor(
        upgrade.base_cost * Math.pow(upgrade.cost_multiplier, upgrade.current_level || 0)
      );
      const canAfford = playerGold >= cost;
      const levelText = upgrade.max_level 
        ? `[${upgrade.current_level || 0}/${upgrade.max_level}]`
        : `[Lv ${upgrade.current_level || 0}]`;
      
      embed.addFields({
        name: `${canAfford ? '✅' : '❌'} ${upgrade.name} ${levelText}`,
        value: `${upgrade.description}\n**Cost:** ${formatNumber(cost)} gold`,
        inline: false,
      });
    }
  }
  
  embed.setFooter({ text: 'Categories: recruitment, equipment, facilities, missions' });
  
  return embed;
}

/**
 * Create a leaderboard embed
 * @param {Array} guilds - Top guilds
 * @param {string} type - Leaderboard type (gold, level, adventurers)
 * @param {number} playerRank - Current player's rank
 * @returns {EmbedBuilder}
 */
export function createLeaderboardEmbed(guilds, type, playerRank) {
  const titles = {
    gold: 'Wealthiest Guilds',
    level: 'Highest Level Guilds',
    adventurer_count: 'Largest Guilds',
  };
  
  const valueLabels = {
    gold: 'gold',
    level: 'level',
    adventurer_count: 'adventurers',
  };
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(`Leaderboard - ${titles[type] || 'Top Guilds'}`)
    .setDescription(`Your rank: **#${playerRank}**`);
  
  const medals = ['🥇', '🥈', '🥉'];
  
  let description = '';
  guilds.forEach((guild, index) => {
    const medal = medals[index] || `**${index + 1}.**`;
    const value = type === 'level' ? guild[type] : formatNumber(guild[type]);
    description += `${medal} **${guild.name}** - ${value} ${valueLabels[type]}\n`;
  });
  
  embed.addFields({
    name: 'Rankings',
    value: description || 'No guilds yet!',
    inline: false,
  });
  
  embed.setTimestamp();
  
  return embed;
}

/**
 * Create a simple error embed
 * @param {string} message - Error message
 * @returns {EmbedBuilder}
 */
export function createErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setDescription(`❌ ${message}`);
}

/**
 * Create a simple success embed
 * @param {string} message - Success message
 * @returns {EmbedBuilder}
 */
export function createSuccessEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setDescription(`✅ ${message}`);
}
