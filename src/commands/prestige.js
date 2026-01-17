import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import {
  getGuildPrestigeUpgrades,
  getOwnedPrestigeUpgrades,
  canPrestige,
  getPrestigeRequirement,
  calculatePrestigeRewards,
  executePrestige,
  purchasePrestigeUpgrade,
  toggleAutoPrestige,
} from '../database/prestige.js';
import { calculatePrestigeBonuses, formatPrestigeBonus } from '../game/idle.js';
import { COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('prestige')
  .setDescription('View prestige status and permanent upgrades')
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('View your prestige level and bonuses')
  )
  .addSubcommand((sub) =>
    sub.setName('shop').setDescription('Browse and purchase permanent prestige upgrades')
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setDescription("You don't have a guild yet! Use `/start` to found one."),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === 'shop') {
    await showPrestigeShop(interaction, guild);
  } else {
    await showPrestigeStatus(interaction, guild);
  }
}

/**
 * Show prestige status and info
 */
async function showPrestigeStatus(interaction, guild) {
  const prestigeUpgrades = await getOwnedPrestigeUpgrades(guild.id);
  const prestigeBonuses = calculatePrestigeBonuses(guild, prestigeUpgrades);
  const eligibility = canPrestige(guild);
  const rewards = calculatePrestigeRewards(guild);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('PRESTIGE STATUS')
    .setDescription(buildPrestigeDescription(guild, prestigeBonuses, eligibility, rewards));

  // Build buttons
  const row = new ActionRowBuilder();

  // Prestige button (if eligible)
  if (eligibility.eligible) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('prestige_now')
        .setLabel(`Prestige Now (+${rewards.totalPoints} pts)`)
        .setEmoji('✨')
        .setStyle(ButtonStyle.Success)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('prestige_disabled')
        .setLabel(`Need Level ${eligibility.requiredLevel}`)
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  // Auto-prestige toggle
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_auto_toggle')
      .setLabel(guild.auto_prestige_enabled ? 'Auto: ON' : 'Auto: OFF')
      .setEmoji(guild.auto_prestige_enabled ? '🔄' : '⏸️')
      .setStyle(guild.auto_prestige_enabled ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  // Shop button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_shop_view')
      .setLabel('View Shop')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Build the prestige status description
 */
function buildPrestigeDescription(guild, prestigeBonuses, eligibility, rewards) {
  const stars = '⭐'.repeat(Math.min(guild.prestige_level, 10));
  const prestigeDisplay = guild.prestige_level > 0
    ? `${stars} **Prestige ${guild.prestige_level}**`
    : '*Not yet prestiged*';

  let desc = `${prestigeDisplay}\n\n`;

  // Current bonuses
  desc += '**Current Bonuses**\n';
  if (guild.prestige_level > 0 || prestigeBonuses.goldMultiplier > 1) {
    desc += `Gold: **${formatPrestigeBonus(prestigeBonuses.goldMultiplier)}**\n`;
    desc += `XP: **${formatPrestigeBonus(prestigeBonuses.xpMultiplier)}**\n`;
    desc += `Recruitment: **${formatPrestigeBonus(prestigeBonuses.recruitmentMultiplier)}**\n`;
    if (prestigeBonuses.maxIdleHoursBonus > 0) {
      desc += `Max Idle: **+${prestigeBonuses.maxIdleHoursBonus}hr**\n`;
    }
    if (prestigeBonuses.doubleGoldChance > 0) {
      desc += `Double Gold: **${(prestigeBonuses.doubleGoldChance * 100).toFixed(0)}%**\n`;
    }
  } else {
    desc += '*None yet - prestige to gain bonuses!*\n';
  }

  desc += '\n';

  // Points
  desc += '**Prestige Points**\n';
  desc += `Available: **${guild.prestige_points || 0}** | `;
  desc += `Total Earned: **${guild.total_prestige_points_earned || 0}**\n\n`;

  // Next prestige info
  desc += '**Next Prestige**\n';
  if (eligibility.eligible) {
    desc += `You are **eligible** to prestige!\n`;
    desc += `Rewards: **+${rewards.totalPoints} points** `;
    if (rewards.bonusPoints > 0) {
      desc += `(${rewards.basePoints} base + ${rewards.bonusPoints} bonus)\n`;
    } else {
      desc += '\n';
    }
  } else {
    const levelsNeeded = eligibility.requiredLevel - guild.level;
    desc += `Requirement: Level **${eligibility.requiredLevel}** `;
    desc += `(${levelsNeeded} more levels)\n`;
  }

  desc += '\n';

  // Warning
  desc += '*Prestiging resets your level, gold, XP, adventurers, and upgrades.*\n';
  desc += '*You keep prestige bonuses and permanent shop upgrades.*';

  return desc;
}

/**
 * Show the prestige shop
 */
async function showPrestigeShop(interaction, guild, isUpdate = false) {
  const allUpgrades = await getGuildPrestigeUpgrades(guild.id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('PRESTIGE SHOP')
    .setDescription(
      `**Available Points:** ${guild.prestige_points || 0}\n\n` +
      'Purchase permanent upgrades that persist through prestiges.\n' +
      'Select an upgrade below to purchase.'
    );

  // Add fields for each upgrade
  for (const upgrade of allUpgrades) {
    const currentLevel = upgrade.current_level || 0;
    const maxed = currentLevel >= upgrade.max_level;
    const nextCost = maxed ? null : upgrade.point_costs[currentLevel];

    let value = upgrade.description;
    value += `\nLevel: **${currentLevel}/${upgrade.max_level}**`;

    if (!maxed) {
      const canAfford = (guild.prestige_points || 0) >= nextCost;
      value += ` | Next: **${nextCost} pts** ${canAfford ? '✓' : ''}`;
    } else {
      value += ' | **MAXED**';
    }

    embed.addFields({
      name: `${maxed ? '✅' : '🔹'} ${upgrade.name}`,
      value,
      inline: true,
    });
  }

  // Build select menu for purchasing
  const purchasableUpgrades = allUpgrades.filter(
    (u) => (u.current_level || 0) < u.max_level
  );

  const components = [];

  if (purchasableUpgrades.length > 0) {
    const selectOptions = purchasableUpgrades.map((u) => {
      const currentLevel = u.current_level || 0;
      const nextCost = u.point_costs[currentLevel];
      const canAfford = (guild.prestige_points || 0) >= nextCost;

      return {
        label: u.name,
        description: `${nextCost} pts → Level ${currentLevel + 1}/${u.max_level}`,
        value: `${u.id}`,
        emoji: canAfford ? '💰' : '🔒',
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('prestige_buy_select')
      .setPlaceholder('Select an upgrade to purchase...')
      .addOptions(selectOptions);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Back button
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_back_status')
      .setLabel('Back to Status')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(buttonRow);

  if (isUpdate) {
    await interaction.update({
      embeds: [embed],
      components,
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components,
    });
  }
}

/**
 * Handle prestige now button - show confirmation modal
 */
export async function handlePrestigeNow(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  const eligibility = canPrestige(guild);
  if (!eligibility.eligible) {
    return interaction.reply({
      content: `You need to be level ${eligibility.requiredLevel} to prestige.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Show confirmation modal
  const modal = new ModalBuilder()
    .setCustomId('prestige_confirm_modal')
    .setTitle('Confirm Prestige');

  const confirmInput = new TextInputBuilder()
    .setCustomId('confirm_name')
    .setLabel(`Type your guild name to confirm: "${guild.name}"`)
    .setPlaceholder(guild.name)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(confirmInput));

  await interaction.showModal(modal);
}

/**
 * Handle prestige confirmation modal submission
 */
export async function handlePrestigeConfirmModal(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  const confirmName = interaction.fields.getTextInputValue('confirm_name');

  if (confirmName.toLowerCase() !== guild.name.toLowerCase()) {
    return interaction.reply({
      content: `Guild name doesn't match. Prestige cancelled.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Get prestige upgrades for starting values calculation
  const prestigeUpgrades = await getOwnedPrestigeUpgrades(guild.id);

  // Execute prestige
  const result = await executePrestige(guild.id, prestigeUpgrades);

  if (!result.success) {
    return interaction.reply({
      content: `Prestige failed: ${result.error}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('✨ PRESTIGE SUCCESSFUL! ✨')
    .setDescription(
      `Your guild has been reborn!\n\n` +
      `**New Prestige Level:** ${'⭐'.repeat(Math.min(result.newPrestigeLevel, 10))} ${result.newPrestigeLevel}\n` +
      `**Points Earned:** +${result.pointsEarned}\n\n` +
      `**Starting Resources:**\n` +
      `Gold: **${formatNumber(result.startingGold)}**${result.goldKept > 0 ? ` (kept ${formatNumber(result.goldKept)})` : ''}\n` +
      `Adventurers: **${result.startingAdventurers}**\n` +
      `Capacity: **${result.startingCapacity}**\n\n` +
      `Your journey begins anew, stronger than before!`
    );

  await interaction.reply({ embeds: [embed] });
}

/**
 * Handle auto-prestige toggle
 */
export async function handleAutoPrestigeToggle(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  const newStatus = await toggleAutoPrestige(guild.id);

  // Update the button
  const row = ActionRowBuilder.from(interaction.message.components[0]);
  const autoButton = row.components.find((c) => c.data.custom_id === 'prestige_auto_toggle');

  if (autoButton) {
    autoButton.data.label = newStatus ? 'Auto: ON' : 'Auto: OFF';
    autoButton.data.emoji = { name: newStatus ? '🔄' : '⏸️' };
    autoButton.data.style = newStatus ? ButtonStyle.Primary : ButtonStyle.Secondary;
  }

  await interaction.update({
    components: interaction.message.components,
  });
}

/**
 * Handle shop view button
 */
export async function handleShopView(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  await showPrestigeShop(interaction, guild, true);
}

/**
 * Handle back to status button
 */
export async function handleBackToStatus(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  const prestigeUpgrades = await getOwnedPrestigeUpgrades(guild.id);
  const prestigeBonuses = calculatePrestigeBonuses(guild, prestigeUpgrades);
  const eligibility = canPrestige(guild);
  const rewards = calculatePrestigeRewards(guild);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('PRESTIGE STATUS')
    .setDescription(buildPrestigeDescription(guild, prestigeBonuses, eligibility, rewards));

  // Rebuild buttons
  const row = new ActionRowBuilder();

  if (eligibility.eligible) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('prestige_now')
        .setLabel(`Prestige Now (+${rewards.totalPoints} pts)`)
        .setEmoji('✨')
        .setStyle(ButtonStyle.Success)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('prestige_disabled')
        .setLabel(`Need Level ${eligibility.requiredLevel}`)
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_auto_toggle')
      .setLabel(guild.auto_prestige_enabled ? 'Auto: ON' : 'Auto: OFF')
      .setEmoji(guild.auto_prestige_enabled ? '🔄' : '⏸️')
      .setStyle(guild.auto_prestige_enabled ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_shop_view')
      .setLabel('View Shop')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Handle prestige upgrade purchase from select menu
 */
export async function handlePrestigeBuySelect(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  if (!guild) return;

  const upgradeId = parseInt(interaction.values[0]);

  const result = await purchasePrestigeUpgrade(guild.id, upgradeId);

  if (!result.success) {
    return interaction.reply({
      content: `Purchase failed: ${result.error}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Refresh the shop view
  const updatedGuild = await getGuildByDiscordId(interaction.user.id);

  // Send success message and refresh
  await interaction.reply({
    content: `Purchased **${result.upgradeName}** level ${result.newLevel} for ${result.pointsSpent} points!`,
    flags: MessageFlags.Ephemeral,
  });

  // Update the shop display
  await showPrestigeShopRefresh(interaction, updatedGuild);
}

/**
 * Refresh the shop display after a purchase (edit the original message)
 */
async function showPrestigeShopRefresh(interaction, guild) {
  const allUpgrades = await getGuildPrestigeUpgrades(guild.id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('PRESTIGE SHOP')
    .setDescription(
      `**Available Points:** ${guild.prestige_points || 0}\n\n` +
      'Purchase permanent upgrades that persist through prestiges.\n' +
      'Select an upgrade below to purchase.'
    );

  for (const upgrade of allUpgrades) {
    const currentLevel = upgrade.current_level || 0;
    const maxed = currentLevel >= upgrade.max_level;
    const nextCost = maxed ? null : upgrade.point_costs[currentLevel];

    let value = upgrade.description;
    value += `\nLevel: **${currentLevel}/${upgrade.max_level}**`;

    if (!maxed) {
      const canAfford = (guild.prestige_points || 0) >= nextCost;
      value += ` | Next: **${nextCost} pts** ${canAfford ? '✓' : ''}`;
    } else {
      value += ' | **MAXED**';
    }

    embed.addFields({
      name: `${maxed ? '✅' : '🔹'} ${upgrade.name}`,
      value,
      inline: true,
    });
  }

  const purchasableUpgrades = allUpgrades.filter(
    (u) => (u.current_level || 0) < u.max_level
  );

  const components = [];

  if (purchasableUpgrades.length > 0) {
    const selectOptions = purchasableUpgrades.map((u) => {
      const currentLevel = u.current_level || 0;
      const nextCost = u.point_costs[currentLevel];
      const canAfford = (guild.prestige_points || 0) >= nextCost;

      return {
        label: u.name,
        description: `${nextCost} pts → Level ${currentLevel + 1}/${u.max_level}`,
        value: `${u.id}`,
        emoji: canAfford ? '💰' : '🔒',
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('prestige_buy_select')
      .setPlaceholder('Select an upgrade to purchase...')
      .addOptions(selectOptions);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prestige_back_status')
      .setLabel('Back to Status')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(buttonRow);

  await interaction.message.edit({
    embeds: [embed],
    components,
  });
}
