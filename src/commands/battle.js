import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { getNotificationSettings } from '../database/notifications.js';
import {
  calculatePower,
  calculatePowerRatio,
  getBattleType,
  calculateWinChance,
  rollBattle,
  calculateBattleRewards,
  calculateFreeRevengeRewards,
  checkBattleCooldowns,
  checkTargetCooldown,
  getRandomTarget,
  recordBattle,
  applyBattleResults,
  applyFreeRevengeResults,
  getRemainingBattlesToday,
  getMinimumBet,
  getDailyBattleLimit,
  getConsentTimeout,
  getFreeRevengeTimeout,
  isFreeRevengeValid,
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
  const attackerPower = await calculatePower(attackerGuild);
  const defenderPower = await calculatePower(defenderGuild);
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
  
  // Determine if stronger player won (for cap logic)
  const attackerIsStronger = attackerPower > defenderPower;
  const strongerWon = (attackerIsStronger && attackerWon) || (!attackerIsStronger && !attackerWon);
  
  // Calculate rewards with new system
  // attackerLost = true means the attacker lost (defender won) - attacker always loses full bet
  const attackerLost = !attackerWon;
  const { goldTransfer, xpBonus, wasCapped } = calculateBattleRewards({
    betAmount,
    loserGuild,
    strongerWon,
    isCapped: battleType.isCapped,
    attackerLost,
  });
  
  // Apply battle results
  await applyBattleResults(winnerId, loserId, goldTransfer, xpBonus);
  
  // Record the battle
  await recordBattle({
    attackerGuild,
    defenderGuild,
    betAmount,
    winnerId,
    goldTransferred: goldTransfer,
    xpTransferred: xpBonus,
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
    goldTransfer,
    xpBonus,
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
  
  // Create counter-attack buttons for defender
  // Include free revenge if power ratio >= 5 and attacker was stronger
  const timestamp = Date.now();
  const row = createCounterAttackButtons(interaction.user.id, defenderDiscordId, betAmount, powerRatio, attackerIsStronger, timestamp);
  
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
  await notifyDefender(interaction.client, defenderDiscordId, defenderGuild.id, attackerGuild.name, attackerWon, goldTransfer, xpBonus, betAmount);
}

/**
 * Build a clear battle result embed
 */
function buildBattleResultEmbed(attackerId, defenderId, attackerGuild, defenderGuild, attackerWon, betAmount, goldTransfer, xpBonus, attackerPower, defenderPower, winChance, powerRatio, wasCapped) {
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
  
  // Calculate net changes for clarity (new system: winner takes gold from loser)
  let attackerGoldChange, attackerXpChange, defenderGoldChange, defenderXpChange;
  
  if (attackerWon) {
    // Attacker wins: takes gold from defender, gains XP bonus
    attackerGoldChange = goldTransfer;
    attackerXpChange = xpBonus;
    defenderGoldChange = -goldTransfer;
    defenderXpChange = 0;
  } else {
    // Defender wins: takes gold from attacker, gains XP bonus
    attackerGoldChange = -goldTransfer;
    attackerXpChange = 0;
    defenderGoldChange = goldTransfer;
    defenderXpChange = xpBonus;
  }
  
  // Spoils breakdown
  const spoilsLines = [`Bet: **${formatNumber(betAmount)}** gold`];
  spoilsLines.push(`Gold won: **${formatNumber(goldTransfer)}** gold${wasCapped ? ' (capped)' : ''}`);
  spoilsLines.push(`XP bonus: **${formatNumber(xpBonus)}** XP`);
  if (wasCapped) {
    spoilsLines.push(`*(Winnings capped due to power difference)*`);
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
async function notifyDefender(client, defenderDiscordId, defenderGuildId, attackerName, attackerWon, goldTransfer, xpBonus, betAmount) {
  try {
    const defenderSettings = await getNotificationSettings(defenderGuildId);
    
    if (defenderSettings?.battle_notifications_enabled) {
      const defenderUser = await client.users.fetch(defenderDiscordId);
      
      let description;
      if (attackerWon) {
        description = `**${attackerName}** attacked your guild and won!\n\nYou lost **${formatNumber(goldTransfer)}** gold.`;
      } else {
        description = `**${attackerName}** attacked your guild but you defended successfully!\n\nYou gained **${formatNumber(goldTransfer)}** gold and **${formatNumber(xpBonus)}** XP!`;
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
  const attackerPower = await calculatePower(attackerGuild);
  const defenderPower = await calculatePower(defenderGuild);
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
 * Create counter-attack buttons for battle results
 * @param {string} attackerId - Original attacker's Discord ID
 * @param {string} defenderId - Original defender's Discord ID
 * @param {number} betAmount - Original bet amount
 * @param {number} powerRatio - Power ratio from the battle
 * @param {boolean} attackerWasStronger - Whether attacker was the stronger player
 * @param {number} timestamp - Battle timestamp for free revenge expiry
 */
function createCounterAttackButtons(attackerId, defenderId, betAmount, powerRatio, attackerWasStronger, timestamp) {
  const buttons = [];
  
  // Add Free Revenge button if power ratio >= 5 and attacker was stronger
  if (powerRatio >= 5 && attackerWasStronger) {
    const freeRevengeButton = new ButtonBuilder()
      .setCustomId(`battle_free_revenge:${attackerId}:${defenderId}:${timestamp}`)
      .setLabel('Free Revenge!')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🆓');
    buttons.push(freeRevengeButton);
  }
  
  const counterAttackButton = new ButtonBuilder()
    .setCustomId(`battle_counter:${attackerId}:${betAmount}`)
    .setLabel('Counter-Attack!')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⚔️');
  buttons.push(counterAttackButton);
  
  const matchBetButton = new ButtonBuilder()
    .setCustomId(`battle_match:${attackerId}:${betAmount}`)
    .setLabel('Match Bet!')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('💰');
  buttons.push(matchBetButton);
  
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Handle counter-attack button - shows modal for bet input
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
  
  // Check cooldowns before showing modal
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
  
  // Check minimum bet requirement
  const minBet = getMinimumBet();
  if (Number(counterAttackerGuild.gold) < minBet) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need at least **${formatNumber(minBet)}** gold to counter-attack!`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Show modal for bet input
  const modal = new ModalBuilder()
    .setCustomId(`battle_counter_modal:${originalAttackerId}`)
    .setTitle('Counter-Attack!');
  
  const betInput = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel('How much gold do you want to bet?')
    .setPlaceholder(`e.g., ${formatNumber(suggestedBet)} (original bet) or "max"`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);
  
  modal.addComponents(new ActionRowBuilder().addComponents(betInput));
  
  await interaction.showModal(modal);
}

/**
 * Handle match bet button - instantly counter with same bet amount
 */
export async function handleMatchBet(interaction) {
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
  
  // Determine bet amount (use same as original or max affordable)
  const betAmount = Math.min(suggestedBet, Number(counterAttackerGuild.gold));
  
  await executeCounterAttack(interaction, betAmount, originalAttackerId, counterAttackerGuild);
}

/**
 * Handle counter-attack modal submission
 */
export async function handleCounterAttackModal(interaction) {
  const [, originalAttackerId] = interaction.customId.split(':');
  const betInput = interaction.fields.getTextInputValue('bet_amount').trim().toLowerCase();
  
  // Get counter-attacker's guild
  const counterAttackerGuild = await getGuildByDiscordId(interaction.user.id);
  if (!counterAttackerGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed('Your guild was not found. Please try again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Parse bet amount
  let betAmount;
  if (betInput === 'max') {
    betAmount = Number(counterAttackerGuild.gold);
  } else {
    betAmount = parseInt(betInput.replace(/,/g, ''), 10);
    if (isNaN(betAmount) || betAmount <= 0) {
      return interaction.reply({
        embeds: [createErrorEmbed(`Invalid bet amount: "${betInput}". Enter a number or "max".`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  
  // Cap to available gold
  betAmount = Math.min(betAmount, Number(counterAttackerGuild.gold));
  
  await executeCounterAttack(interaction, betAmount, originalAttackerId, counterAttackerGuild);
}

/**
 * Execute the counter-attack battle (shared logic)
 */
async function executeCounterAttack(interaction, betAmount, originalAttackerId, counterAttackerGuild) {
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
  
  // Validate bet amount
  const minBet = getMinimumBet();
  if (betAmount < minBet) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need to bet at least **${formatNumber(minBet)}** gold to counter-attack!`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate power and battle type
  const attackerPower = await calculatePower(counterAttackerGuild);
  const defenderPower = await calculatePower(defenderGuild);
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
  
  // Determine if stronger player won (for cap logic)
  const attackerIsStronger = attackerPower > defenderPower;
  const strongerWon = (attackerIsStronger && attackerWon) || (!attackerIsStronger && !attackerWon);
  
  // Calculate rewards with new system
  // attackerLost = true means the counter-attacker lost - they always lose full bet
  const attackerLost = !attackerWon;
  const { goldTransfer, xpBonus, wasCapped } = calculateBattleRewards({
    betAmount,
    loserGuild,
    strongerWon,
    isCapped: battleType.isCapped,
    attackerLost,
  });
  
  // Apply battle results
  await applyBattleResults(winnerId, loserId, goldTransfer, xpBonus);
  
  // Record the battle
  await recordBattle({
    attackerGuild: counterAttackerGuild,
    defenderGuild,
    betAmount,
    winnerId,
    goldTransferred: goldTransfer,
    xpTransferred: xpBonus,
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
    counterAttackerGoldChange = goldTransfer;
    counterAttackerXpChange = xpBonus;
    defenderGoldChange = -goldTransfer;
    defenderXpChange = 0;
  } else {
    counterAttackerGoldChange = -goldTransfer;
    counterAttackerXpChange = 0;
    defenderGoldChange = goldTransfer;
    defenderXpChange = xpBonus;
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
        `Bet: **${formatNumber(betAmount)}** gold`,
        `Gold won: **${formatNumber(goldTransfer)}** gold${wasCapped ? ' (capped)' : ''}`,
        `XP bonus: **${formatNumber(xpBonus)}** XP`,
        wasCapped ? '*(Winnings capped due to power difference)*' : '',
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
  
  // Create counter-attack buttons (counter-attacker is now the "attacker" for the next round)
  const timestamp = Date.now();
  const row = createCounterAttackButtons(interaction.user.id, originalAttackerId, betAmount, powerRatio, attackerIsStronger, timestamp);
  
  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
  
  // Notify the defender
  await notifyDefender(interaction.client, originalAttackerId, defenderGuild.id, counterAttackerGuild.name, attackerWon, goldTransfer, xpBonus, betAmount);
}

/**
 * Handle free revenge button - counter-attack with no bet required
 */
export async function handleFreeRevenge(interaction) {
  const [, originalAttackerId, originalDefenderId, timestampStr] = interaction.customId.split(':');
  const battleTimestamp = parseInt(timestampStr, 10);
  
  // Only the original defender can use this button
  if (interaction.user.id !== originalDefenderId) {
    return interaction.reply({
      embeds: [createErrorEmbed('Only the original defender can use Free Revenge!')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Check if free revenge has expired (5 minute window)
  if (!isFreeRevengeValid(battleTimestamp)) {
    return interaction.reply({
      embeds: [createErrorEmbed('Free Revenge has expired! Use Counter-Attack or Match Bet instead.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Get defender's guild (counter-attacker)
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
  
  // Calculate power and win chance
  const attackerPower = await calculatePower(counterAttackerGuild);
  const defenderPower = await calculatePower(defenderGuild);
  const powerRatio = calculatePowerRatio(attackerPower, defenderPower);
  const winChance = calculateWinChance(attackerPower, defenderPower);
  
  // Roll for victory!
  const defenderWon = rollBattle(winChance);
  
  // Calculate free revenge rewards (1-2% of original attacker's gold if defender wins)
  const { goldReward, xpBonus } = calculateFreeRevengeRewards(defenderGuild);
  
  // Apply results
  await applyFreeRevengeResults(counterAttackerGuild.id, defenderGuild.id, defenderWon, goldReward, xpBonus);
  
  // Record the battle (with 0 bet)
  await recordBattle({
    attackerGuild: counterAttackerGuild,
    defenderGuild,
    betAmount: 0,
    winnerId: defenderWon ? counterAttackerGuild.id : defenderGuild.id,
    goldTransferred: defenderWon ? goldReward : 0,
    xpTransferred: defenderWon ? xpBonus : 0,
    attackerPower,
    defenderPower,
    winChance,
  });
  
  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle('FREE REVENGE RESULTS')
    .setDescription(`<@${interaction.user.id}> takes free revenge on <@${originalAttackerId}>!`)
    .setTimestamp();
  
  if (defenderWon) {
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
      name: 'Free Revenge',
      value: defenderWon
        ? `Won **${formatNumber(goldReward)}** gold and **${formatNumber(xpBonus)}** XP!`
        : 'Lost, but no penalty (free revenge)',
      inline: true,
    }
  );
  
  const formatChange = (val) => val >= 0 ? `+${formatNumber(val)}` : `-${formatNumber(Math.abs(val))}`;
  
  if (defenderWon) {
    embed.addFields(
      {
        name: `${counterAttackerGuild.name}'s Net Change`,
        value: `**${formatChange(goldReward)}** gold, **${formatChange(xpBonus)}** XP`,
        inline: true,
      },
      {
        name: `${defenderGuild.name}'s Net Change`,
        value: `**${formatChange(-goldReward)}** gold`,
        inline: true,
      }
    );
  } else {
    embed.addFields(
      {
        name: `${counterAttackerGuild.name}'s Net Change`,
        value: 'No change (free revenge)',
        inline: true,
      },
      {
        name: `${defenderGuild.name}'s Net Change`,
        value: 'No change',
        inline: true,
      }
    );
  }
  
  // Refresh counter-attacker's guild to get updated battles_today
  const updatedGuild = await getGuildByDiscordId(interaction.user.id);
  const remaining = getRemainingBattlesToday(updatedGuild);
  embed.setFooter({ text: `Battles remaining today: ${remaining}/${getDailyBattleLimit()}` });
  
  // Create regular counter-attack buttons (no free revenge on the result of a free revenge)
  const timestamp = Date.now();
  const attackerIsStronger = attackerPower > defenderPower;
  const row = createCounterAttackButtons(interaction.user.id, originalAttackerId, 0, powerRatio, attackerIsStronger, timestamp);
  
  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
  
  // Notify the original attacker
  try {
    const attackerSettings = await getNotificationSettings(defenderGuild.id);
    
    if (attackerSettings?.battle_notifications_enabled) {
      const attackerUser = await interaction.client.users.fetch(originalAttackerId);
      
      let description;
      if (defenderWon) {
        description = `**${counterAttackerGuild.name}** used Free Revenge against your guild and won!\n\nYou lost **${formatNumber(goldReward)}** gold.`;
      } else {
        description = `**${counterAttackerGuild.name}** used Free Revenge against your guild but you defended successfully!`;
      }
      
      const dmEmbed = new EmbedBuilder()
        .setColor(defenderWon ? COLORS.ERROR : COLORS.SUCCESS)
        .setTitle(defenderWon ? 'Free Revenge Attack!' : 'Free Revenge Defended!')
        .setDescription(description)
        .setTimestamp();
      
      await attackerUser.send({ embeds: [dmEmbed] });
    }
  } catch (error) {
    console.log(`Could not DM free revenge notification to ${originalAttackerId}:`, error.message);
  }
}
