import { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} from 'discord.js';
import { getGuildByDiscordId, getLeaderboard, getPlayerRank, getTotalGuildCount } from '../database/guilds.js';
import { COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

// Category configurations
const CATEGORIES = {
  gold: {
    field: 'gold',
    emoji: '💰',
    title: 'Wealthiest Guilds',
    subtitle: 'Current gold holdings',
    formatValue: (guild) => formatNumber(guild.gold),
    unit: 'gold',
  },
  level: {
    field: 'level',
    emoji: '⭐',
    title: 'Highest Level',
    subtitle: 'Guild experience',
    formatValue: (guild) => `Lv ${guild.level}`,
    unit: '',
  },
  adventurer_count: {
    field: 'adventurer_count',
    emoji: '👥',
    title: 'Largest Guilds',
    subtitle: 'Adventurer count',
    formatValue: (guild) => `${guild.adventurer_count} adv`,
    unit: '',
  },
  lifetime_gold_earned: {
    field: 'lifetime_gold_earned',
    emoji: '🏆',
    title: 'Richest of All Time',
    subtitle: 'Total gold ever earned',
    formatValue: (guild) => formatNumber(guild.lifetime_gold_earned || 0),
    unit: 'earned',
  },
  lifetime_battles_won: {
    field: 'lifetime_battles_won',
    emoji: '⚔️',
    title: 'Greatest Conquerors',
    subtitle: 'Battles won',
    formatValue: (guild) => `${guild.lifetime_battles_won || 0} wins`,
    unit: '',
    emptyMessage: 'No battles fought yet!',
  },
  prestige_level: {
    field: 'prestige_level',
    emoji: '🌟',
    title: 'Most Prestigious',
    subtitle: 'Times reborn',
    formatValue: (guild) => {
      const level = guild.prestige_level || 0;
      if (level === 0) return 'Not Prestiged';
      const stars = '⭐'.repeat(Math.min(level, 5));
      return `${stars} P${level}`;
    },
    unit: '',
    emptyMessage: 'No one has prestiged yet!',
  },
};

const CATEGORY_ORDER = ['gold', 'level', 'adventurer_count', 'lifetime_gold_earned', 'lifetime_battles_won', 'prestige_level'];

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the top guilds across different categories');

export async function execute(interaction) {
  await showLeaderboard(interaction, 'gold', false);
}

/**
 * Show leaderboard for a specific category
 * @param {Interaction} interaction 
 * @param {string} categoryKey 
 * @param {boolean} isUpdate - Whether this is an update to an existing message
 */
async function showLeaderboard(interaction, categoryKey, isUpdate = false) {
  const category = CATEGORIES[categoryKey];
  const playerGuild = await getGuildByDiscordId(interaction.user.id);
  
  // Get leaderboard data
  const topGuilds = await getLeaderboard(category.field, 10);
  const totalGuilds = await getTotalGuildCount();
  
  // Get player's rank if they have a guild
  let playerRank = null;
  if (playerGuild) {
    playerRank = await getPlayerRank(interaction.user.id, category.field);
  }
  
  // Check if this category has any data (for conquest and prestige)
  const hasData = topGuilds.length > 0 && (
    (categoryKey !== 'lifetime_battles_won' && categoryKey !== 'prestige_level') || 
    (categoryKey === 'lifetime_battles_won' && topGuilds.some(g => (g.lifetime_battles_won || 0) > 0)) ||
    (categoryKey === 'prestige_level' && topGuilds.some(g => (g.prestige_level || 0) > 0))
  );
  
  // Build the embed
  const embed = buildLeaderboardEmbed(category, categoryKey, topGuilds, playerGuild, playerRank, totalGuilds, hasData);
  
  // Build the buttons
  const buttons = buildCategoryButtons(categoryKey);
  
  // Send or update the message
  if (isUpdate) {
    await interaction.update({
      embeds: [embed],
      components: buttons,
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components: buttons,
    });
  }
}

/**
 * Build the leaderboard embed
 */
function buildLeaderboardEmbed(category, categoryKey, topGuilds, playerGuild, playerRank, totalGuilds, hasData) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(`${category.emoji} LEADERBOARD`)
    .setTimestamp();
  
  // Subtitle with category name
  let description = `**${category.title}**\n*${category.subtitle}*\n\n`;
  
  // Player rank info
  if (playerGuild && playerRank) {
    description += `Your Rank: **#${playerRank}** of ${totalGuilds}\n\n`;
  } else {
    description += `*Use /start to join the rankings!*\n\n`;
  }
  
  // Check for empty conquest leaderboard
  if (!hasData && category.emptyMessage) {
    description += `\`\`\`\n${category.emptyMessage}\n\`\`\``;
    embed.setDescription(description);
    embed.setFooter({ text: 'Click a button to view other rankings' });
    return embed;
  }
  
  // Build rankings display
  const medals = ['🥇', '🥈', '🥉'];
  let rankings = '';
  
  topGuilds.forEach((guild, index) => {
    const rank = index + 1;
    const isPlayer = playerGuild && guild.discord_id === playerGuild.discord_id;
    
    // Format the rank indicator
    let rankIndicator;
    if (rank <= 3) {
      rankIndicator = medals[index];
    } else {
      rankIndicator = `${rank}.`.padStart(3, ' ');
    }
    
    // Format the guild name (max 18 chars for alignment)
    let guildName = guild.name;
    if (guildName.length > 18) {
      guildName = guildName.substring(0, 15) + '...';
    }
    
    // Format the value
    const value = category.formatValue(guild);
    
    // Build the line
    const pointer = isPlayer ? '➤ ' : '  ';
    const youIndicator = isPlayer ? ' (You)' : '';
    
    // Use fixed-width formatting for cleaner look
    if (rank <= 3) {
      rankings += `${pointer}${rankIndicator} **${guildName}**${youIndicator} — ${value}\n`;
    } else {
      rankings += `${pointer}\`${rankIndicator}\` **${guildName}**${youIndicator} — ${value}\n`;
    }
  });
  
  // If no guilds at all
  if (topGuilds.length === 0) {
    rankings = '*No guilds yet! Be the first to join!*';
  }
  
  description += rankings;
  embed.setDescription(description);
  embed.setFooter({ text: 'Click a button to view other rankings' });
  
  return embed;
}

/**
 * Build the category navigation buttons
 * Discord limits action rows to 5 buttons max, so we split into multiple rows
 */
function buildCategoryButtons(activeCategory) {
  const buttonLabels = {
    gold: 'Gold',
    level: 'Level',
    adventurer_count: 'Size',
    lifetime_gold_earned: 'Earnings',
    lifetime_battles_won: 'Conquest',
    prestige_level: 'Prestige',
  };
  
  const rows = [];
  let currentRow = new ActionRowBuilder();
  
  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const key = CATEGORY_ORDER[i];
    const category = CATEGORIES[key];
    const isActive = key === activeCategory;
    
    const button = new ButtonBuilder()
      .setCustomId(`leaderboard:${key}`)
      .setLabel(buttonLabels[key])
      .setEmoji(category.emoji)
      .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary);
    
    currentRow.addComponents(button);
    
    // Discord allows max 5 buttons per row
    if ((i + 1) % 5 === 0 && i < CATEGORY_ORDER.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }
  
  // Add the last row if it has any buttons
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }
  
  return rows;
}

/**
 * Handle leaderboard button click
 */
export async function handleLeaderboardButton(interaction) {
  const [, categoryKey] = interaction.customId.split(':');
  
  if (!CATEGORIES[categoryKey]) {
    return;
  }
  
  await showLeaderboard(interaction, categoryKey, true);
}
