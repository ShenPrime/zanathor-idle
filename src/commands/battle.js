import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getNotificationSettings } from '../database/notifications.js';
import {
  calculatePower,
  calculatePowerRatio,
  getBattleType,
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
  getConsentTimeout,
  lockBetGold,
  unlockBetGold,
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
  
  // Calculate power and determine battle type
  const attackerPower = calculatePower(attackerGuild);
  const defenderPower = calculatePower(defenderGuild);
  const powerRatio = calculatePowerRatio(attackerPower, defenderPower);
  const battleType = getBattleType(powerRatio);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // If consent required (power ratio > 5), send challenge and wait for response
  if (battleType.type === 'consent') {
    // Lock the attacker's bet
    const locked = await lockBetGold(attackerGuild.id, betAmount);
    if (!locked) {
      return interaction.reply({
        embeds: [createErrorEmbed('Failed to lock your bet. Do you have enough gold?')],
        flags: MessageFlags.Ephemeral,
      });
    }
    
    const challengeEmbed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('Battle Challenge!')
      .setDescription(`<@${interaction.user.id}> challenges <@${defenderDiscordId}> to battle!`)
      .addFields(
        {
          name: 'Challenger',
          value: `**${attackerGuild.name}** (Power: ${attackerPower.toFixed(1)})`,
          inline: true,
        },
        {
          name: 'Defender',
          value: `**${defenderGuild.name}** (Power: ${defenderPower.toFixed(1)})`,
          inline: true,
        },
        {
          name: 'Power Disparity',
          value: `**${powerRatio.toFixed(1)}x** difference - Defender consent required`,
          inline: false,
        },
        {
          name: 'Stakes',
          value: `Bet: **${formatNumber(betAmount)}** gold\nMax loss if defeated: **${formatNumber(betAmount)}** gold (capped due to power difference)`,
          inline: false,
        }
      )
      .setFooter({ text: `Challenge expires in 30 seconds` })
      .setTimestamp();
    
    const acceptButton = new ButtonBuilder()
      .setCustomId(`battle_accept:${interaction.user.id}:${defenderDiscordId}:${betAmount}:${attackerGuild.id}:${defenderGuild.id}`)
      .setLabel('Accept Challenge')
      .setStyle(ButtonStyle.Success)
      .setEmoji('⚔️');
    
    const declineButton = new ButtonBuilder()
      .setCustomId(`battle_decline:${interaction.user.id}:${betAmount}:${attackerGuild.id}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);
    
    const reply = await interaction.reply({
      embeds: [challengeEmbed],
      components: [row],
      fetchReply: true,
    });
    
    // Set up timeout to return bet if no response
    const timeout = getConsentTimeout();
    setTimeout(async () => {
      try {
        // Check if the message still has buttons (hasn't been handled)
        const message = await reply.fetch();
        if (message.components.length > 0) {
          await handleChallengeTimeout(message, interaction.user.id, betAmount, attackerGuild.id);
        }
      } catch (error) {
        // Message may have been deleted or already handled
        console.log('Challenge timeout cleanup:', error.message);
      }
    }, timeout);
    
    return; // Wait for button interaction
  }
  
  // Auto-battle (power ratio < 5)
  await executeBattle(interaction, attackerGuild, defenderGuild, defenderDiscordId, betAmount, attackerPower, defenderPower, powerRatio, battleType, winChance, false);
}

/**
 * Execute the actual battle logic and send results
 */
async function executeBattle(interaction, attackerGuild, defenderGuild, defenderDiscordId, betAmount, attackerPower, defenderPower, powerRatio, battleType, winChance, isConsent) {
  // Roll for victory!
  const attackerWon = rollBattle(winChance);
  
  // Determine winner and loser
  const winnerId = attackerWon ? attackerGuild.id : defenderGuild.id;
  const loserId = attackerWon ? defenderGuild.id : attackerGuild.id;
  const loserGuild = attackerWon ? defenderGuild : attackerGuild;
  
  // Calculate loser's losses with cap
  const { goldLoss, xpLoss, wasCapped } = calculateLosses(loserGuild, betAmount, battleType.lossCap);
  
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
  
  // Build result embed with clearer display
  const embed = buildBattleResultEmbed(
    interaction.user.id,
    defenderDiscordId,
    attackerGuild,
    defenderGuild,
    attackerWon,
    betAmount,
    goldLoss,
    xpLoss,
    attackerPower,
    defenderPower,
    winChance,
    powerRatio,
    wasCapped
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
  if (isConsent) {
    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components: [row],
    });
  }
  
  // Notify defender
  await notifyDefender(interaction.client, defenderDiscordId, defenderGuild.id, attackerGuild.name, attackerWon, goldLoss, xpLoss, betAmount);
}

/**
 * Build a clear battle result embed
 */
function buildBattleResultEmbed(attackerId, defenderId, attackerGuild, defenderGuild, attackerWon, betAmount, goldLoss, xpLoss, attackerPower, defenderPower, winChance, powerRatio, wasCapped) {
  const embed = new EmbedBuilder()
    .setTitle('BATTLE RESULTS')
    .setDescription(`<@${attackerId}> vs <@${defenderId}>`)
    .setTimestamp();
  
  // Winner announcement
  if (attackerWon) {
    embed.setColor(COLORS.SUCCESS);
    embed.addFields({
      name: 'Winner',
      value: `<@${attackerId}> (${attackerGuild.name})`,
      inline: false,
    });
  } else {
    embed.setColor(COLORS.ERROR);
    embed.addFields({
      name: 'Winner',
      value: `<@${defenderId}> (${defenderGuild.name})`,
      inline: false,
    });
  }
  
  // Battle stats
  embed.addFields({
    name: 'Battle Stats',
    value: [
      `Attacker Power: **${attackerPower.toFixed(1)}**`,
      `Defender Power: **${defenderPower.toFixed(1)}**`,
      `Power Ratio: **${powerRatio.toFixed(1)}x**`,
      `Win Chance: **${winChance.toFixed(1)}%**`,
    ].join('\n'),
    inline: true,
  });
  
  // Calculate net changes for clarity
  let attackerGoldChange, attackerXpChange, defenderGoldChange, defenderXpChange;
  
  if (attackerWon) {
    // Attacker wins: gets loot, bet is returned (no change from bet)
    attackerGoldChange = goldLoss;
    attackerXpChange = xpLoss;
    defenderGoldChange = -goldLoss;
    defenderXpChange = -xpLoss;
  } else {
    // Defender wins: gets bet + loot
    attackerGoldChange = -(betAmount + goldLoss);
    attackerXpChange = -xpLoss;
    defenderGoldChange = betAmount + goldLoss;
    defenderXpChange = xpLoss;
  }
  
  // Spoils breakdown
  const spoilsLines = [`Bet: **${formatNumber(betAmount)}** gold ${attackerWon ? '(returned)' : '(lost!)'}`];
  spoilsLines.push(`Looted: **${formatNumber(goldLoss)}** gold, **${formatNumber(xpLoss)}** XP`);
  if (wasCapped) {
    spoilsLines.push(`*(Losses capped due to power difference)*`);
  }
  
  embed.addFields({
    name: 'Spoils of War',
    value: spoilsLines.join('\n'),
    inline: true,
  });
  
  // Net results - clearer display
  const formatChange = (val) => val >= 0 ? `+${formatNumber(val)}` : `-${formatNumber(Math.abs(val))}`;
  
  embed.addFields(
    {
      name: `${attackerGuild.name}'s Net Change`,
      value: `**${formatChange(attackerGoldChange)}** gold, **${formatChange(attackerXpChange)}** XP`,
      inline: true,
    },
    {
      name: `${defenderGuild.name}'s Net Change`,
      value: `**${formatChange(defenderGoldChange)}** gold, **${formatChange(defenderXpChange)}** XP`,
      inline: true,
    }
  );
  
  return embed;
}

/**
 * Notify defender of battle result
 */
async function notifyDefender(client, defenderDiscordId, defenderGuildId, attackerName, attackerWon, goldLoss, xpLoss, betAmount) {
  try {
    const defenderSettings = await getNotificationSettings(defenderGuildId);
    
    if (defenderSettings?.dm_reminders_enabled) {
      const defenderUser = await client.users.fetch(defenderDiscordId);
      
      let description;
      if (attackerWon) {
        description = `**${attackerName}** attacked your guild and won!\n\nYou lost **${formatNumber(goldLoss)}** gold and **${formatNumber(xpLoss)}** XP.`;
      } else {
        const totalGain = betAmount + goldLoss;
        description = `**${attackerName}** attacked your guild but you defended successfully!\n\nYou gained **${formatNumber(totalGain)}** gold and **${formatNumber(xpLoss)}** XP!`;
      }
      
      const dmEmbed = new EmbedBuilder()
        .setColor(attackerWon ? COLORS.ERROR : COLORS.SUCCESS)
        .setTitle(attackerWon ? 'Your Guild Was Attacked!' : 'Your Guild Defended Successfully!')
        .setDescription(description)
        .setTimestamp();
      
      await defenderUser.send({ embeds: [dmEmbed] });
    }
  } catch (error) {
    console.log(`Could not DM battle notification to ${defenderDiscordId}:`, error.message);
  }
}

/**
 * Handle battle challenge acceptance
 */
export async function handleBattleAccept(interaction) {
  const [, attackerDiscordId, defenderDiscordId, betStr, attackerGuildIdStr, defenderGuildIdStr] = interaction.customId.split(':');
  const betAmount = parseInt(betStr, 10);
  const attackerGuildId = parseInt(attackerGuildIdStr, 10);
  const defenderGuildId = parseInt(defenderGuildIdStr, 10);
  
  // Only the defender can accept
  if (interaction.user.id !== defenderDiscordId) {
    return interaction.reply({
      embeds: [createErrorEmbed('Only the challenged player can accept this battle!')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Fetch fresh guild data
  const attackerGuild = await getGuildByDiscordId(attackerDiscordId);
  const defenderGuild = await getGuildByDiscordId(defenderDiscordId);
  
  if (!attackerGuild || !defenderGuild) {
    // Return bet to attacker if guild is missing
    if (attackerGuild) {
      await unlockBetGold(attackerGuildId, betAmount);
    }
    return interaction.update({
      embeds: [createErrorEmbed('One of the guilds no longer exists!')],
      components: [],
    });
  }
  
  // Calculate power and battle type
  const attackerPower = calculatePower(attackerGuild);
  const defenderPower = calculatePower(defenderGuild);
  const powerRatio = calculatePowerRatio(attackerPower, defenderPower);
  const battleType = getBattleType(powerRatio);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // Create a fake interaction-like object with the attacker as user
  const fakeInteraction = {
    user: { id: attackerDiscordId },
    client: interaction.client,
    update: interaction.update.bind(interaction),
  };
  
  // Execute the battle (bet was already locked when challenge was sent)
  await executeBattle(fakeInteraction, attackerGuild, defenderGuild, defenderDiscordId, betAmount, attackerPower, defenderPower, powerRatio, battleType, winChance, true);
}

/**
 * Handle battle challenge decline
 */
export async function handleBattleDecline(interaction) {
  const [, attackerDiscordId, betStr, attackerGuildIdStr] = interaction.customId.split(':');
  const betAmount = parseInt(betStr, 10);
  const attackerGuildId = parseInt(attackerGuildIdStr, 10);
  
  // Return the locked bet to the attacker
  await unlockBetGold(attackerGuildId, betAmount);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('Challenge Declined')
    .setDescription(`<@${interaction.user.id}> declined the battle challenge.\n\n**${formatNumber(betAmount)}** gold has been returned to <@${attackerDiscordId}>.`)
    .setTimestamp();
  
  await interaction.update({
    embeds: [embed],
    components: [],
  });
}

/**
 * Handle challenge timeout (called when collector ends)
 */
export async function handleChallengeTimeout(message, attackerDiscordId, betAmount, attackerGuildId) {
  // Return the locked bet to the attacker
  await unlockBetGold(attackerGuildId, betAmount);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('Challenge Expired')
    .setDescription(`The battle challenge has expired.\n\n**${formatNumber(betAmount)}** gold has been returned to <@${attackerDiscordId}>.`)
    .setTimestamp();
  
  try {
    await message.edit({
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    console.log('Could not edit expired challenge message:', error.message);
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
  
  // Get counter-attacker's guild (was the defender)
  const counterAttackerGuild = await getGuildByDiscordId(interaction.user.id);
  if (!counterAttackerGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check cooldowns
  const cooldownCheck = checkBattleCooldowns(counterAttackerGuild);
  if (!cooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(cooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get original attacker's guild (now the defender)
  const defenderGuild = await getGuildByDiscordId(originalAttackerId);
  if (!defenderGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('The original attacker no longer has a guild!')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check per-target cooldown
  const targetCooldownCheck = await checkTargetCooldown(counterAttackerGuild.id, defenderGuild.id);
  if (!targetCooldownCheck.canBattle) {
    return interaction.reply({
      embeds: [createErrorEmbed(targetCooldownCheck.reason)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Determine bet amount (use same as original or max affordable)
  const betAmount = Math.min(suggestedBet, Number(counterAttackerGuild.gold));
  const minBet = getMinimumBet();
  
  if (betAmount < minBet) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need at least **${formatNumber(minBet)}** gold to counter-attack!`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate power and battle type
  const attackerPower = calculatePower(counterAttackerGuild);
  const defenderPower = calculatePower(defenderGuild);
  const powerRatio = calculatePowerRatio(attackerPower, defenderPower);
  const battleType = getBattleType(powerRatio);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // For counter-attacks, skip consent requirement (they chose to engage)
  // But still apply loss caps based on power ratio
  
  // Roll for victory!
  const attackerWon = rollBattle(winChance);
  
  // Determine winner and loser
  const winnerId = attackerWon ? counterAttackerGuild.id : defenderGuild.id;
  const loserId = attackerWon ? defenderGuild.id : counterAttackerGuild.id;
  const loserGuild = attackerWon ? defenderGuild : counterAttackerGuild;
  
  // Calculate loser's losses with cap
  const { goldLoss, xpLoss, wasCapped } = calculateLosses(loserGuild, betAmount, battleType.lossCap);
  
  // Apply battle results
  await applyBattleResults(winnerId, loserId, betAmount, goldLoss, xpLoss, attackerWon, counterAttackerGuild.id);
  
  // Record the battle
  await recordBattle({
    attackerGuild: counterAttackerGuild,
    defenderGuild,
    betAmount,
    winnerId,
    goldTransferred: goldLoss,
    xpTransferred: xpLoss,
    attackerPower,
    defenderPower,
    winChance,
  });
  
  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle('COUNTER-ATTACK RESULTS')
    .setDescription(`<@${interaction.user.id}> counter-attacks <@${originalAttackerId}>!`)
    .setTimestamp();
  
  // Calculate net changes
  let counterAttackerGoldChange, counterAttackerXpChange, defenderGoldChange, defenderXpChange;
  
  if (attackerWon) {
    counterAttackerGoldChange = goldLoss;
    counterAttackerXpChange = xpLoss;
    defenderGoldChange = -goldLoss;
    defenderXpChange = -xpLoss;
  } else {
    counterAttackerGoldChange = -(betAmount + goldLoss);
    counterAttackerXpChange = -xpLoss;
    defenderGoldChange = betAmount + goldLoss;
    defenderXpChange = xpLoss;
  }
  
  if (attackerWon) {
    embed.setColor(COLORS.SUCCESS);
    embed.addFields({
      name: 'Winner',
      value: `<@${interaction.user.id}> (${counterAttackerGuild.name})`,
      inline: false,
    });
  } else {
    embed.setColor(COLORS.ERROR);
    embed.addFields({
      name: 'Winner',
      value: `<@${originalAttackerId}> (${defenderGuild.name})`,
      inline: false,
    });
  }
  
  embed.addFields(
    {
      name: 'Battle Stats',
      value: [
        `Attacker Power: **${attackerPower.toFixed(1)}**`,
        `Defender Power: **${defenderPower.toFixed(1)}**`,
        `Power Ratio: **${powerRatio.toFixed(1)}x**`,
        `Win Chance: **${winChance.toFixed(1)}%**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Spoils of War',
      value: [
        `Bet: **${formatNumber(betAmount)}** gold ${attackerWon ? '(returned)' : '(lost!)'}`,
        `Looted: **${formatNumber(goldLoss)}** gold, **${formatNumber(xpLoss)}** XP`,
        wasCapped ? '*(Losses capped due to power difference)*' : '',
      ].filter(Boolean).join('\n'),
      inline: true,
    }
  );
  
  const formatChange = (val) => val >= 0 ? `+${formatNumber(val)}` : `-${formatNumber(Math.abs(val))}`;
  
  embed.addFields(
    {
      name: `${counterAttackerGuild.name}'s Net Change`,
      value: `**${formatChange(counterAttackerGoldChange)}** gold, **${formatChange(counterAttackerXpChange)}** XP`,
      inline: true,
    },
    {
      name: `${defenderGuild.name}'s Net Change`,
      value: `**${formatChange(defenderGoldChange)}** gold, **${formatChange(defenderXpChange)}** XP`,
      inline: true,
    }
  );
  
  // Refresh counter-attacker's guild to get updated battles_today
  const updatedGuild = await getGuildByDiscordId(interaction.user.id);
  const remaining = getRemainingBattlesToday(updatedGuild);
  embed.setFooter({ text: `Battles remaining today: ${remaining}/${getDailyBattleLimit()}` });
  
  // Create new counter-attack button
  const counterAttackButton = new ButtonBuilder()
    .setCustomId(`battle_counter:${interaction.user.id}:${betAmount}`)
    .setLabel('Counter-Attack!')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⚔️');
  
  const row = new ActionRowBuilder().addComponents(counterAttackButton);
  
  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
  
  // Notify the defender
  await notifyDefender(interaction.client, originalAttackerId, defenderGuild.id, counterAttackerGuild.name, attackerWon, goldLoss, xpLoss, betAmount);
}
