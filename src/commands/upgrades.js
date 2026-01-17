import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getAvailableUpgrades } from '../database/upgrades.js';
import { createUpgradesEmbed, createErrorEmbed } from '../utils/embeds.js';

const CATEGORIES = ['recruitment', 'equipment', 'facilities', 'missions', 'magic', 'trade'];

export const data = new SlashCommandBuilder()
  .setName('upgrades')
  .setDescription('Browse available upgrades for your guild')
  .addStringOption(option =>
    option
      .setName('category')
      .setDescription('Filter by upgrade category')
      .setRequired(false)
      .addChoices(
        { name: 'Recruitment - Increase adventurer capacity', value: 'recruitment' },
        { name: 'Equipment - Boost gold generation', value: 'equipment' },
        { name: 'Facilities - Improve XP and unlock features', value: 'facilities' },
        { name: 'Missions - Higher tier passive income', value: 'missions' },
        { name: 'Magic - XP and special bonuses', value: 'magic' },
        { name: 'Trade - Gold income and multipliers', value: 'trade' }
      )
  );

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const category = interaction.options.getString('category');
  
  // Get available upgrades
  let upgrades = await getAvailableUpgrades(
    guild.id,
    guild.level,
    guild.adventurer_count
  );
  
  // Filter by category if specified
  if (category) {
    upgrades = upgrades.filter(u => u.category === category);
  }
  
  const displayCategory = category || 'all';
  const embed = createUpgradesEmbed(upgrades, displayCategory, guild.gold);
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
