import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getGuildWithData } from '../database/guilds.js';
import { createGuildEmbed, createErrorEmbed } from '../utils/embeds.js';
import { calculateRates, calculateUpgradeBonuses, calculatePrestigeBonuses, getEffectiveCapacity, calculateIdleEarningsWithData } from '../game/idle.js';

export const data = new SlashCommandBuilder()
  .setName('guild')
  .setDescription('View your guild\'s stats and information');

export async function execute(interaction) {
  // Single combined query instead of 3 separate queries
  const { guild, upgrades, prestigeUpgrades } = await getGuildWithData(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate bonuses using pre-loaded data
  const bonuses = calculateUpgradeBonuses(upgrades);
  const prestigeBonuses = calculatePrestigeBonuses(guild, prestigeUpgrades);
  const rates = calculateRates(guild, bonuses, prestigeBonuses);
  
  // Calculate pending earnings using pre-loaded data (no extra queries)
  const pendingEarnings = calculateIdleEarningsWithData(guild, upgrades, prestigeUpgrades);
  
  // Update capacity display with bonus
  const effectiveCapacity = getEffectiveCapacity(guild, bonuses);
  const displayGuild = {
    ...guild,
    adventurer_capacity: effectiveCapacity,
  };
  
  await interaction.reply({
    embeds: [createGuildEmbed(displayGuild, rates, pendingEarnings, prestigeBonuses)],
  });
}
