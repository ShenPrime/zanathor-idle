import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getGuildWithData, collectResourcesFull } from '../database/guilds.js';
import { createCollectEmbed, createErrorEmbed } from '../utils/embeds.js';
import { calculateIdleEarningsWithData, calculateUpgradeBonuses, getEffectiveCapacity } from '../game/idle.js';
import { checkAndApplyLevelUp } from '../game/leveling.js';
import { flushSession } from './grind.js';

export const data = new SlashCommandBuilder()
  .setName('collect')
  .setDescription('Collect gold and XP earned by your adventurers');

export async function execute(interaction) {
  // Flush any active grind session first to keep data consistent
  await flushSession(interaction.user.id, false);
  
  // Single combined query instead of 3 separate queries
  const { guild, upgrades, prestigeUpgrades } = await getGuildWithData(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate idle earnings using pre-loaded data (no extra queries)
  const earnings = calculateIdleEarningsWithData(guild, upgrades, prestigeUpgrades);
  
  // Check minimum time (at least 1 minute)
  if (earnings.hoursElapsed < 1/60) {
    return interaction.reply({
      embeds: [createErrorEmbed('Your adventurers just returned! Wait a bit before collecting again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate adventurer growth using pre-loaded bonuses
  let adventurersRecruited = 0;
  let newAdventurerCount = guild.adventurer_count;
  
  if (earnings.adventurersGained > 0) {
    const bonuses = calculateUpgradeBonuses(upgrades);
    const effectiveCapacity = getEffectiveCapacity(guild, bonuses);
    
    newAdventurerCount = Math.min(
      guild.adventurer_count + earnings.adventurersGained,
      effectiveCapacity
    );
    
    if (newAdventurerCount > guild.adventurer_count) {
      adventurersRecruited = newAdventurerCount - guild.adventurer_count;
    }
  }
  
  // Single consolidated update query instead of 4 separate queries
  const updatedGuild = await collectResourcesFull(
    guild.id,
    earnings.goldEarned,
    earnings.xpEarned,
    newAdventurerCount,
    adventurersRecruited
  );
  
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
      text: `Maximum idle time reached (${earnings.maxIdleHours}h). Collect more often to maximize earnings!` 
    });
  }
  
  // Add double gold notification
  if (earnings.doubledGold) {
    embed.addFields({
      name: 'LUCKY COIN!',
      value: `Your Lucky Coin activated - **DOUBLE GOLD** this collection!`,
      inline: false,
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
