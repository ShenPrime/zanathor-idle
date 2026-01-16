import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import {
  getUpgradeByName,
  getGuildUpgradeLevel,
  calculateUpgradeCost,
  calculateBulkPurchaseCost,
  calculateMaxAffordable,
  purchaseUpgradeMultiple,
  getAvailableUpgrades,
} from '../database/upgrades.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

const CATEGORIES = [
  { id: 'all', label: 'All', emoji: null },
  { id: 'recruitment', label: 'Recruitment', emoji: null },
  { id: 'equipment', label: 'Equipment', emoji: null },
  { id: 'facilities', label: 'Facilities', emoji: null },
  { id: 'missions', label: 'Missions', emoji: null },
];

export const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Purchase upgrades for your guild')
  .addStringOption(option =>
    option
      .setName('category')
      .setDescription('Filter by upgrade category')
      .setRequired(false)
      .addChoices(
        { name: 'All Categories', value: 'all' },
        { name: 'Recruitment - Adventurer capacity', value: 'recruitment' },
        { name: 'Equipment - Gold generation', value: 'equipment' },
        { name: 'Facilities - XP and bonuses', value: 'facilities' },
        { name: 'Missions - Passive income', value: 'missions' }
      )
  );

/**
 * Build the buy menu embed and components
 */
async function buildBuyMenu(guild, category = 'all') {
  // Get available upgrades
  let upgrades = await getAvailableUpgrades(
    guild.id,
    guild.level,
    guild.adventurer_count
  );
  
  // Filter by category if not 'all'
  if (category !== 'all') {
    upgrades = upgrades.filter(u => u.category === category);
  }
  
  // Build embed
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('Purchase Upgrades')
    .setDescription(
      `**Gold Available:** ${formatNumber(guild.gold)}\n\n` +
      `Select up to **5 upgrades** to purchase, then enter quantities.\n` +
      `Use category buttons to filter, or select upgrades below.`
    );
  
  if (upgrades.length === 0) {
    embed.addFields({
      name: 'No Upgrades Available',
      value: category === 'all' 
        ? 'You\'ve maxed out all available upgrades or need to level up to unlock more!'
        : `No upgrades available in this category. Try a different category or level up!`,
    });
  }
  
  // Build category buttons
  const categoryRow = new ActionRowBuilder().addComponents(
    CATEGORIES.map(cat => 
      new ButtonBuilder()
        .setCustomId(`buy_category:${cat.id}`)
        .setLabel(cat.label)
        .setStyle(cat.id === category ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
  
  const components = [categoryRow];
  
  // Build select menu if there are upgrades
  if (upgrades.length > 0) {
    const selectOptions = upgrades.slice(0, 25).map(u => {
      const cost = calculateUpgradeCost(u, u.current_level || 0);
      const levelText = u.max_level
        ? `[${u.current_level || 0}/${u.max_level}]`
        : `[Lv ${u.current_level || 0}]`;
      
      return {
        label: `${u.name} ${levelText}`,
        description: `${formatNumber(cost)} gold - ${u.description.slice(0, 50)}${u.description.length > 50 ? '...' : ''}`,
        value: u.name,
      };
    });
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`buy_select:${category}`)
      .setPlaceholder('Select upgrades to purchase...')
      .setMinValues(1)
      .setMaxValues(Math.min(5, selectOptions.length))
      .addOptions(selectOptions);
    
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }
  
  return { embed, components };
}

/**
 * Main command execution - shows the buy menu
 */
export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const category = interaction.options.getString('category') || 'all';
  const { embed, components } = await buildBuyMenu(guild, category);
  
  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

/**
 * Handle category button clicks - updates the menu in place
 */
export async function handleCategoryButton(interaction) {
  const category = interaction.customId.split(':')[1];
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.update({
      embeds: [createErrorEmbed('Your guild was not found. Please try again.')],
      components: [],
    });
  }
  
  const { embed, components } = await buildBuyMenu(guild, category);
  
  await interaction.update({
    embeds: [embed],
    components,
  });
}

/**
 * Handle upgrade selection - shows quantity modal
 */
export async function handleSelectMenu(interaction) {
  const selectedUpgrades = interaction.values;
  
  if (selectedUpgrades.length === 0) {
    return interaction.update({
      content: 'No upgrades selected.',
    });
  }
  
  // Build modal with text inputs for each selected upgrade
  const modal = new ModalBuilder()
    .setCustomId(`buy_modal:${selectedUpgrades.join(',')}`)
    .setTitle('Purchase Quantities');
  
  // Get guild to show costs
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  for (let i = 0; i < selectedUpgrades.length && i < 5; i++) {
    const upgradeName = selectedUpgrades[i];
    const upgrade = await getUpgradeByName(upgradeName);
    const currentLevel = await getGuildUpgradeLevel(guild.id, upgrade.id);
    const cost = calculateUpgradeCost(upgrade, currentLevel);
    
    const textInput = new TextInputBuilder()
      .setCustomId(`qty_${i}`)
      .setLabel(`${upgradeName} (${formatNumber(cost)}g each)`)
      .setPlaceholder('Enter: 1, 10, 50, or max')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(10);
    
    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  }
  
  await interaction.showModal(modal);
}

/**
 * Handle modal submission - process purchases
 */
export async function handleModal(interaction) {
  const upgradeNames = interaction.customId.split(':')[1].split(',');
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('Your guild was not found. Please try again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  let remainingGold = guild.gold;
  const results = [];
  const skipped = [];
  
  for (let i = 0; i < upgradeNames.length; i++) {
    const upgradeName = upgradeNames[i];
    const quantityInput = interaction.fields.getTextInputValue(`qty_${i}`)?.trim().toLowerCase();
    
    // Skip if no input or empty
    if (!quantityInput) {
      continue;
    }
    
    const upgrade = await getUpgradeByName(upgradeName);
    if (!upgrade) {
      skipped.push({ name: upgradeName, reason: 'Upgrade not found' });
      continue;
    }
    
    const currentLevel = await getGuildUpgradeLevel(guild.id, upgrade.id);
    
    // Check if already maxed
    if (upgrade.max_level && currentLevel >= upgrade.max_level) {
      skipped.push({ name: upgradeName, reason: 'Already at max level' });
      continue;
    }
    
    // Parse quantity
    let purchaseInfo;
    if (quantityInput === 'max') {
      purchaseInfo = calculateMaxAffordable(upgrade, currentLevel, remainingGold);
    } else {
      const quantity = parseInt(quantityInput, 10);
      if (isNaN(quantity) || quantity <= 0) {
        skipped.push({ name: upgradeName, reason: `Invalid quantity: "${quantityInput}"` });
        continue;
      }
      
      // Calculate cost for requested quantity
      purchaseInfo = calculateBulkPurchaseCost(upgrade, currentLevel, quantity);
      
      // If can't afford requested amount, buy as many as possible
      if (purchaseInfo.totalCost > remainingGold) {
        purchaseInfo = calculateMaxAffordable(upgrade, currentLevel, remainingGold);
      }
    }
    
    // Skip if can't buy any
    if (purchaseInfo.levelsBought === 0) {
      skipped.push({ name: upgradeName, reason: 'Cannot afford' });
      continue;
    }
    
    // Execute purchase
    try {
      const result = await purchaseUpgradeMultiple(
        guild.id,
        upgrade.id,
        purchaseInfo.levelsBought,
        purchaseInfo.totalCost
      );
      
      remainingGold = result.remainingGold;
      
      results.push({
        name: upgradeName,
        levelsBought: purchaseInfo.levelsBought,
        oldLevel: currentLevel,
        newLevel: purchaseInfo.finalLevel,
        cost: purchaseInfo.totalCost,
        effect: getEffectDescription(upgrade, purchaseInfo.finalLevel),
      });
    } catch (error) {
      if (error.message === 'Insufficient gold') {
        skipped.push({ name: upgradeName, reason: 'Insufficient gold' });
      } else {
        console.error('Purchase error:', error);
        skipped.push({ name: upgradeName, reason: 'Purchase failed' });
      }
    }
  }
  
  // Build result embed
  const embed = new EmbedBuilder()
    .setColor(results.length > 0 ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle(results.length > 0 ? 'Purchases Complete!' : 'No Purchases Made');
  
  if (results.length > 0) {
    const purchaseLines = results.map(r => 
      `**${r.name}**: Bought ${r.levelsBought} level${r.levelsBought > 1 ? 's' : ''} ` +
      `(${r.oldLevel} -> ${r.newLevel})\n` +
      `Cost: ${formatNumber(r.cost)}g | ${r.effect}`
    );
    
    embed.setDescription(purchaseLines.join('\n\n'));
    
    const totalSpent = results.reduce((sum, r) => sum + r.cost, 0);
    embed.addFields({
      name: 'Summary',
      value: `**Total Spent:** ${formatNumber(totalSpent)} gold\n**Remaining:** ${formatNumber(remainingGold)} gold`,
    });
  }
  
  if (skipped.length > 0) {
    const skippedLines = skipped.map(s => `${s.name}: ${s.reason}`);
    embed.addFields({
      name: 'Skipped',
      value: skippedLines.join('\n'),
    });
  }
  
  // Add buy again button
  const buyAgainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('buy_again')
      .setLabel('Buy More')
      .setStyle(ButtonStyle.Primary)
  );
  
  await interaction.reply({
    embeds: [embed],
    components: [buyAgainRow],
    ephemeral: true,
  });
}

/**
 * Handle "Buy Again" button - restarts the buy flow
 */
export async function handleBuyAgain(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.update({
      embeds: [createErrorEmbed('Your guild was not found. Please try again.')],
      components: [],
    });
  }
  
  const { embed, components } = await buildBuyMenu(guild, 'all');
  
  await interaction.update({
    embeds: [embed],
    components,
  });
}

/**
 * Generate a human-readable effect description
 */
function getEffectDescription(upgrade, level) {
  const value = parseFloat(upgrade.effect_value) * level;
  
  switch (upgrade.effect_type) {
    case 'gold_multiplier':
      return `+${(value * 100).toFixed(0)}% gold`;
    case 'xp_multiplier':
      return `+${(value * 100).toFixed(0)}% XP`;
    case 'all_multiplier':
      return `+${(value * 100).toFixed(0)}% gold & XP`;
    case 'adventurer_capacity':
      return `+${value} capacity`;
    case 'adventurer_per_hour':
      return `+${value} adventurers/hr`;
    case 'base_gold_per_hour':
      return `+${value} gold/hr`;
    case 'base_gold_and_xp':
      return `+${value} gold, +${Math.floor(value * 0.5)} XP/hr`;
    case 'capacity_and_gold':
      return `+${value} capacity, +${level * 8}% gold`;
    default:
      return upgrade.description;
  }
}
