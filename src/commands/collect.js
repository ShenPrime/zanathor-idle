import { SlashCommandBuilder } from 'discord.js';
import { getGuildByDiscordId, collectResources, updateAdventurerCount } from '../database/guilds.js';
import { getGuildUpgrades } from '../database/upgrades.js';
import { createCollectEmbed, createErrorEmbed } from '../utils/embeds.js';
import { calculateIdleEarnings, calculateUpgradeBonuses, getEffectiveCapacity } from '../game/idle.js';
import { checkAndApplyLevelUp } from '../game/leveling.js';
import { flushSession } from './grind.js';

export const data = new SlashCommandBuilder()
  .setName('collect')
  .setDescription('Collect gold and XP earned by your adventurers');

export async function execute(interaction) {
  // Flush any active grind session first to keep data consistent
  await flushSession(interaction.user.id, false);
  
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      ephemeral: true,
    });
  }
  
  // Calculate idle earnings
  const earnings = await calculateIdleEarnings(guild);
  
  // Check minimum time (at least 1 minute)
  if (earnings.hoursElapsed < 1/60) {
    return interaction.reply({
      embeds: [createErrorEmbed('Your adventurers just returned! Wait a bit before collecting again.')],
      ephemeral: true,
    });
  }
  
  // Collect the resources
  let updatedGuild = await collectResources(guild.id, earnings.goldEarned, earnings.xpEarned);
  
  // Handle adventurer growth from upgrades
  if (earnings.adventurersGained > 0) {
    const upgrades = await getGuildUpgrades(guild.id);
    const bonuses = calculateUpgradeBonuses(upgrades);
    const effectiveCapacity = getEffectiveCapacity(guild, bonuses);
    
    const newCount = Math.min(
      guild.adventurer_count + earnings.adventurersGained,
      effectiveCapacity
    );
    
    if (newCount > guild.adventurer_count) {
      updatedGuild = await updateAdventurerCount(guild.id, newCount);
    }
  }
  
  // Check for level-ups
  const levelResult = await checkAndApplyLevelUp(updatedGuild);
  
  // Build response embed
  const embed = createCollectEmbed(
    levelResult.guild,
    earnings.goldEarned,
    earnings.xpEarned,
    earnings.hoursElapsed,
    levelResult.leveledUp,
    levelResult.newLevel
  );
  
  // Add warning if time was capped
  if (earnings.wasCapped) {
    embed.setFooter({ 
      text: `Maximum idle time reached (24h). Collect more often to maximize earnings!` 
    });
  }
  
  // Add rank-up notification
  if (levelResult.rankChanged) {
    embed.addFields({
      name: 'RANK UP!',
      value: `${levelResult.newRank.emoji} Your adventurers have achieved **${levelResult.newRank.name}** rank!`,
      inline: false,
    });
  }
  
  await interaction.reply({ embeds: [embed] });
}
