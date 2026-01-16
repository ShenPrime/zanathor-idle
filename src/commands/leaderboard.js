import { SlashCommandBuilder } from 'discord.js';
import { getGuildByDiscordId, getLeaderboard, getPlayerRank } from '../database/guilds.js';
import { createLeaderboardEmbed, createErrorEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the top guilds')
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('What to rank by')
      .setRequired(false)
      .addChoices(
        { name: 'Gold - Wealthiest guilds', value: 'gold' },
        { name: 'Level - Highest level guilds', value: 'level' },
        { name: 'Adventurers - Largest guilds', value: 'adventurer_count' }
      )
  );

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  const type = interaction.options.getString('type') || 'gold';
  
  // Get leaderboard data
  const topGuilds = await getLeaderboard(type, 10);
  
  // Get player's rank if they have a guild
  let playerRank = null;
  if (guild) {
    playerRank = await getPlayerRank(interaction.user.id, type);
  }
  
  const embed = createLeaderboardEmbed(topGuilds, type, playerRank || '?');
  
  if (!guild) {
    embed.setFooter({ text: 'Use /start to create your guild and join the rankings!' });
  }
  
  await interaction.reply({ embeds: [embed] });
}
