import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('nerdstats')
  .setDescription('View detailed lifetime statistics for your guild');

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate guild age
  const createdAt = new Date(guild.created_at);
  const now = new Date();
  const ageMs = now - createdAt;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const ageHours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  let ageText;
  if (ageDays > 0) {
    ageText = `${ageDays} day${ageDays !== 1 ? 's' : ''}, ${ageHours} hr${ageHours !== 1 ? 's' : ''}`;
  } else {
    ageText = `${ageHours} hour${ageHours !== 1 ? 's' : ''}`;
  }
  
  // Format created date
  const createdDateText = createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`Nerd Stats for ${guild.name}`)
    .addFields(
      {
        name: 'EARNINGS',
        value: [
          `Lifetime Gold Earned: **${formatNumber(guild.lifetime_gold_earned || 0)}**`,
          `Lifetime XP Earned: **${formatNumber(guild.lifetime_xp_earned || 0)}**`,
          `Peak Gold Balance: **${formatNumber(guild.peak_gold_balance || 0)}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'GRINDING',
        value: [
          `Total Grind Sessions: **${formatNumber(guild.lifetime_grind_sessions || 0)}**`,
          `Total Clicks: **${formatNumber(guild.lifetime_grind_clicks || 0)}**`,
          `Gold from Grinding: **${formatNumber(guild.lifetime_grind_gold || 0)}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'SPENDING',
        value: [
          `Total Gold Spent: **${formatNumber(guild.lifetime_gold_spent || 0)}**`,
          `Upgrades Purchased: **${formatNumber(guild.lifetime_upgrades_purchased || 0)}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'RECRUITMENT',
        value: `Adventurers Recruited: **${formatNumber(guild.lifetime_adventurers_recruited || 0)}**`,
        inline: false,
      },
      {
        name: 'TIME',
        value: [
          `Guild Founded: **${createdDateText}**`,
          `Guild Age: **${ageText}**`,
        ].join('\n'),
        inline: false,
      }
    )
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}
