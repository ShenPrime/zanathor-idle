import { SlashCommandBuilder } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getGuildUpgrades } from '../database/upgrades.js';
import { createGuildEmbed, createErrorEmbed } from '../utils/embeds.js';
import { calculateRates, calculateUpgradeBonuses, getEffectiveCapacity, calculateIdleEarnings } from '../game/idle.js';

export const data = new SlashCommandBuilder()
  .setName('guild')
  .setDescription('View your guild\'s stats and information');

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      ephemeral: true,
    });
  }
  
  // Get upgrades and calculate bonuses
  const upgrades = await getGuildUpgrades(guild.id);
  const bonuses = calculateUpgradeBonuses(upgrades);
  const rates = calculateRates(guild, bonuses);
  
  // Calculate pending earnings
  const pendingEarnings = await calculateIdleEarnings(guild);
  
  // Update capacity display with bonus
  const effectiveCapacity = getEffectiveCapacity(guild, bonuses);
  const displayGuild = {
    ...guild,
    adventurer_capacity: effectiveCapacity,
  };
  
  await interaction.reply({
    embeds: [createGuildEmbed(displayGuild, rates, pendingEarnings)],
  });
}
