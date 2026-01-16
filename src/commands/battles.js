import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getBattleHistory } from '../database/battles.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber, formatRelativeTime } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('battles')
  .setDescription('View your recent battle history');

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const battles = await getBattleHistory(guild.id, 10);
  
  if (battles.length === 0) {
    return interaction.reply({
      embeds: [createErrorEmbed('You haven\'t participated in any battles yet! Use `/battle` to start one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`Battle History for ${guild.name}`)
    .setTimestamp();
  
  // Build battle history list
  const historyLines = battles.map((battle, index) => {
    const wasAttacker = battle.attacker_id === guild.id;
    const won = battle.winner_id === guild.id;
    const opponent = wasAttacker ? battle.defender_name : battle.attacker_name;
    const opponentDiscordId = wasAttacker ? battle.defender_discord_id : battle.attacker_discord_id;
    
    const resultEmoji = won ? '🏆' : '💀';
    const roleText = wasAttacker ? 'ATK' : 'DEF';
    const timeAgo = formatRelativeTime(battle.created_at);
    
    // Calculate what the player gained/lost
    let goldChange, xpChange;
    if (won) {
      if (wasAttacker) {
        // Attacker won: get looted gold/xp
        goldChange = `+${formatNumber(battle.gold_transferred)}`;
        xpChange = `+${formatNumber(battle.xp_transferred)}`;
      } else {
        // Defender won: get bet + looted gold/xp
        goldChange = `+${formatNumber(Number(battle.bet_amount) + Number(battle.gold_transferred))}`;
        xpChange = `+${formatNumber(battle.xp_transferred)}`;
      }
    } else {
      if (wasAttacker) {
        // Attacker lost: lost bet + got looted
        goldChange = `-${formatNumber(Number(battle.bet_amount) + Number(battle.gold_transferred))}`;
        xpChange = `-${formatNumber(battle.xp_transferred)}`;
      } else {
        // Defender lost: got looted
        goldChange = `-${formatNumber(battle.gold_transferred)}`;
        xpChange = `-${formatNumber(battle.xp_transferred)}`;
      }
    }
    
    return `${resultEmoji} \`${roleText}\` vs **${opponent}** - ${goldChange} gold, ${xpChange} XP *(${timeAgo})*`;
  });
  
  embed.setDescription(historyLines.join('\n'));
  
  // Add summary stats
  const wins = battles.filter(b => b.winner_id === guild.id).length;
  const losses = battles.length - wins;
  const winRate = ((wins / battles.length) * 100).toFixed(1);
  
  embed.addFields({
    name: 'Recent Record',
    value: `**${wins}W** - **${losses}L** (${winRate}% win rate)`,
    inline: false,
  });
  
  embed.setFooter({ text: 'Showing last 10 battles | ATK = Attacker, DEF = Defender' });
  
  await interaction.reply({ embeds: [embed] });
}
