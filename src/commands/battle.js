import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getNotificationSettings } from '../database/notifications.js';
import {
  calculatePower,
  calculateWinChance,
  rollBattle,
  calculateLosses,
  checkBattleCooldowns,
  checkTargetCooldown,
  getRandomTarget,
  recordBattle,
  applyBattleResults,
  getRemainingBattlesToday,
  getMinimumBet,
  getDailyBattleLimit,
} from '../database/battles.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('battle')
  .setDescription('Battle another guild and bet gold on the outcome!')
  .addIntegerOption(option =>
    option
      .setName('bet')
      .setDescription('Amount of gold to bet')
      .setRequired(true)
      .setMinValue(0) // DEV: Set to 0 for testing, change to MINIMUM_BET for production
  )
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('The player to battle (leave empty and set random to true for a random opponent)')
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('random')
      .setDescription('Battle a random player')
      .setRequired(false)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const randomBattle = interaction.options.getBoolean('random');
  const betAmount = interaction.options.getInteger('bet');
  
  // Must specify either user or random
  if (!targetUser && !randomBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed('You must specify a user to battle OR set random to true.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get attacker's guild
  const attackerGuild = await getGuildByDiscordId(interaction.user.id);
  if (!attackerGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check minimum bet
  const minBet = getMinimumBet();
  if (betAmount < minBet) {
    return interaction.reply({
      embeds: [createErrorEmbed(`Minimum bet is **${formatNumber(minBet)}** gold.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check if attacker has enough gold
  if (Number(attackerGuild.gold) < betAmount) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You don't have enough gold! You have **${formatNumber(attackerGuild.gold)}** gold.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check cooldowns
  const cooldownCheck = checkBattleCooldowns(attackerGuild);
  if (!cooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(cooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get defender guild
  let defenderGuild;
  let defenderDiscordId;
  
  if (randomBattle) {
    defenderGuild = await getRandomTarget(attackerGuild.id);
    if (!defenderGuild) {
      return interaction.reply({
        embeds: [createErrorEmbed('No other guilds to battle! Invite some friends to play.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    defenderDiscordId = defenderGuild.discord_id;
  } else {
    // Can't battle yourself
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        embeds: [createErrorEmbed('You can\'t battle yourself!')],
        flags: MessageFlags.Ephemeral,
      });
    }
    
    defenderGuild = await getGuildByDiscordId(targetUser.id);
    if (!defenderGuild) {
      return interaction.reply({
        embeds: [createErrorEmbed(`**${targetUser.username}** doesn't have a guild yet!`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    defenderDiscordId = targetUser.id;
  }
  
  // Check per-target cooldown
  const targetCooldownCheck = await checkTargetCooldown(attackerGuild.id, defenderGuild.id);
  if (!targetCooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(targetCooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate power and win chance
  const attackerPower = calculatePower(attackerGuild);
  const defenderPower = calculatePower(defenderGuild);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // Roll for victory!
  const attackerWon = rollBattle(winChance);
  
  // Determine winner and loser
  const winnerId = attackerWon ? attackerGuild.id : defenderGuild.id;
  const loserId = attackerWon ? defenderGuild.id : attackerGuild.id;
  const winnerGuild = attackerWon ? attackerGuild : defenderGuild;
  const loserGuild = attackerWon ? defenderGuild : attackerGuild;
  
  // Calculate loser's losses
  const { goldLoss, xpLoss } = calculateLosses(loserGuild);
  
  // Apply battle results
  await applyBattleResults(winnerId, loserId, betAmount, goldLoss, xpLoss, attackerWon, attackerGuild.id);
  
  // Record the battle
  await recordBattle({
    attackerGuild,
    defenderGuild,
    betAmount,
    winnerId,
    goldTransferred: goldLoss,
    xpTransferred: xpLoss,
    attackerPower,
    defenderPower,
    winChance,
  });
  
  // Calculate total gold won by winner
  const winnerGoldGain = attackerWon ? goldLoss : betAmount + goldLoss;
  const loserGoldLoss = attackerWon ? goldLoss : betAmount + goldLoss;
  
  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle('BATTLE RESULTS')
    .setDescription(`<@${interaction.user.id}> vs <@${defenderDiscordId}>`)
    .setTimestamp();
  
  if (attackerWon) {
    embed.setColor(COLORS.SUCCESS);
    embed.addFields({
      name: 'Winner',
      value: `<@${interaction.user.id}> (Attacker)`,
      inline: false,
    });
  } else {
    embed.setColor(COLORS.ERROR);
    embed.addFields({
      name: 'Winner',
      value: `<@${defenderDiscordId}> (Defender)`,
      inline: false,
    });
  }
  
  embed.addFields(
    {
      name: 'Battle Stats',
      value: [
        `Attacker Power: **${attackerPower.toFixed(1)}**`,
        `Defender Power: **${defenderPower.toFixed(1)}**`,
        `Win Chance: **${winChance.toFixed(1)}%**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Spoils of War',
      value: [
        `Bet: **${formatNumber(betAmount)}** gold`,
        `Gold Looted: **${formatNumber(goldLoss)}**`,
        `XP Looted: **${formatNumber(xpLoss)}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: attackerWon ? 'Attacker Gains' : 'Defender Gains',
      value: `**+${formatNumber(winnerGoldGain)}** gold, **+${formatNumber(xpLoss)}** XP`,
      inline: false,
    },
    {
      name: attackerWon ? 'Defender Loses' : 'Attacker Loses',
      value: `**-${formatNumber(loserGoldLoss)}** gold, **-${formatNumber(xpLoss)}** XP`,
      inline: false,
    }
  );
  
  // Refresh attacker's guild to get updated battles_today
  const updatedAttackerGuild = await getGuildByDiscordId(interaction.user.id);
  const remaining = getRemainingBattlesToday(updatedAttackerGuild);
  embed.setFooter({ text: `Battles remaining today: ${remaining}/${getDailyBattleLimit()}` });
  
  // Create counter-attack button for defender
  const counterAttackButton = new ButtonBuilder()
    .setCustomId(`battle_counter:${interaction.user.id}:${betAmount}`)
    .setLabel('Counter-Attack!')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⚔️');
  
  const row = new ActionRowBuilder().addComponents(counterAttackButton);
  
  // Send public battle result
  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
  
  // Notify defender if they have notifications enabled
  try {
    const defenderSettings = await getNotificationSettings(defenderGuild.id);
    
    if (defenderSettings?.dm_reminders_enabled) {
      // Send DM to defender
      const defenderUser = await interaction.client.users.fetch(defenderDiscordId);
      const dmEmbed = new EmbedBuilder()
        .setColor(attackerWon ? COLORS.ERROR : COLORS.SUCCESS)
        .setTitle(attackerWon ? 'Your Guild Was Attacked!' : 'Your Guild Defended Successfully!')
        .setDescription(
          attackerWon
            ? `**${attackerGuild.name}** attacked your guild and won!\n\nYou lost **${formatNumber(goldLoss)}** gold and **${formatNumber(xpLoss)}** XP.`
            : `**${attackerGuild.name}** attacked your guild but you defended successfully!\n\nYou gained **${formatNumber(winnerGoldGain)}** gold and **${formatNumber(xpLoss)}** XP from their bet!`
        )
        .setTimestamp();
      
      await defenderUser.send({ embeds: [dmEmbed] });
    }
    // If no DM notifications, they'll see the @mention in the channel from the battle result
  } catch (error) {
    // DM failed, that's okay - they were already @mentioned in the channel
    console.log(`Could not DM battle notification to ${defenderDiscordId}:`, error.message);
  }
}

/**
 * Handle counter-attack button
 */
export async function handleCounterAttack(interaction) {
  const [, originalAttackerId, originalBetStr] = interaction.customId.split(':');
  const suggestedBet = parseInt(originalBetStr, 10);
  
  // Only the defender can use this button
  if (interaction.user.id === originalAttackerId) {
    return interaction.reply({
      embeds: [createErrorEmbed('You can\'t counter-attack yourself! This button is for the defender.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get defender's guild
  const defenderGuild = await getGuildByDiscordId(interaction.user.id);
  if (!defenderGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check cooldowns
  const cooldownCheck = checkBattleCooldowns(defenderGuild);
  if (!cooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(cooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get original attacker's guild (now the defender)
  const originalAttackerGuild = await getGuildByDiscordId(originalAttackerId);
  if (!originalAttackerGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('The original attacker no longer has a guild!')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check per-target cooldown
  const targetCooldownCheck = await checkTargetCooldown(defenderGuild.id, originalAttackerGuild.id);
  if (!targetCooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(targetCooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Determine bet amount (use same as original or max affordable)
  const betAmount = Math.min(suggestedBet, Number(defenderGuild.gold));
  const minBet = getMinimumBet();
  
  if (betAmount < minBet) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need at least **${formatNumber(minBet)}** gold to counter-attack!`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate power and win chance (now defender is attacking)
  const attackerPower = calculatePower(defenderGuild);
  const defenderPower = calculatePower(originalAttackerGuild);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // Roll for victory!
  const attackerWon = rollBattle(winChance);
  
  // Determine winner and loser
  const winnerId = attackerWon ? defenderGuild.id : originalAttackerGuild.id;
  const loserId = attackerWon ? originalAttackerGuild.id : defenderGuild.id;
  const loserGuild = attackerWon ? originalAttackerGuild : defenderGuild;
  
  // Calculate loser's losses
  const { goldLoss, xpLoss } = calculateLosses(loserGuild);
  
  // Apply battle results
  await applyBattleResults(winnerId, loserId, betAmount, goldLoss, xpLoss, attackerWon, defenderGuild.id);
  
  // Record the battle
  await recordBattle({
    attackerGuild: defenderGuild,
    defenderGuild: originalAttackerGuild,
    betAmount,
    winnerId,
    goldTransferred: goldLoss,
    xpTransferred: xpLoss,
    attackerPower,
    defenderPower,
    winChance,
  });
  
  // Calculate total gold won by winner
  const winnerGoldGain = attackerWon ? goldLoss : betAmount + goldLoss;
  const loserGoldLoss = attackerWon ? goldLoss : betAmount + goldLoss;
  
  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle('COUNTER-ATTACK RESULTS')
    .setDescription(`<@${interaction.user.id}> counter-attacks <@${originalAttackerId}>!`)
    .setTimestamp();
  
  if (attackerWon) {
    embed.setColor(COLORS.SUCCESS);
    embed.addFields({
      name: 'Winner',
      value: `<@${interaction.user.id}> (Counter-Attacker)`,
      inline: false,
    });
  } else {
    embed.setColor(COLORS.ERROR);
    embed.addFields({
      name: 'Winner',
      value: `<@${originalAttackerId}> (Defender)`,
      inline: false,
    });
  }
  
  embed.addFields(
    {
      name: 'Battle Stats',
      value: [
        `Attacker Power: **${attackerPower.toFixed(1)}**`,
        `Defender Power: **${defenderPower.toFixed(1)}**`,
        `Win Chance: **${winChance.toFixed(1)}%**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Spoils of War',
      value: [
        `Bet: **${formatNumber(betAmount)}** gold`,
        `Gold Looted: **${formatNumber(goldLoss)}**`,
        `XP Looted: **${formatNumber(xpLoss)}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: attackerWon ? 'Counter-Attacker Gains' : 'Defender Gains',
      value: `**+${formatNumber(winnerGoldGain)}** gold, **+${formatNumber(xpLoss)}** XP`,
      inline: false,
    },
    {
      name: attackerWon ? 'Defender Loses' : 'Counter-Attacker Loses',
      value: `**-${formatNumber(loserGoldLoss)}** gold, **-${formatNumber(xpLoss)}** XP`,
      inline: false,
    }
  );
  
  // Refresh counter-attacker's guild to get updated battles_today
  const updatedGuild = await getGuildByDiscordId(interaction.user.id);
  const remaining = getRemainingBattlesToday(updatedGuild);
  embed.setFooter({ text: `Battles remaining today: ${remaining}/${getDailyBattleLimit()}` });
  
  // Create new counter-attack button for the original attacker
  const counterAttackButton = new ButtonBuilder()
    .setCustomId(`battle_counter:${interaction.user.id}:${betAmount}`)
    .setLabel('Counter-Attack!')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⚔️');
  
  const row = new ActionRowBuilder().addComponents(counterAttackButton);
  
  // Send public counter-attack result
  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}
