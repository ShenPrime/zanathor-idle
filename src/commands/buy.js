import { SlashCommandBuilder } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import {
  getUpgradeByName,
  getGuildUpgradeLevel,
  purchaseUpgrade,
  calculateUpgradeCost,
  getAvailableUpgrades,
} from '../database/upgrades.js';
import { createSuccessEmbed, createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';
import { EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Purchase an upgrade for your guild')
  .addStringOption(option =>
    option
      .setName('upgrade')
      .setDescription('Name of the upgrade to purchase')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.respond([]);
  }
  
  // Get available upgrades for this guild
  const upgrades = await getAvailableUpgrades(
    guild.id,
    guild.level,
    guild.adventurer_count
  );
  
  // Filter by search term and format for autocomplete
  const filtered = upgrades
    .filter(u => u.name.toLowerCase().includes(focusedValue))
    .slice(0, 25)
    .map(u => {
      const cost = calculateUpgradeCost(u, u.current_level || 0);
      const levelText = u.max_level
        ? `[${u.current_level || 0}/${u.max_level}]`
        : `[Lv ${u.current_level || 0}]`;
      return {
        name: `${u.name} ${levelText} - ${formatNumber(cost)} gold`,
        value: u.name,
      };
    });
  
  await interaction.respond(filtered);
}

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      ephemeral: true,
    });
  }
  
  const upgradeName = interaction.options.getString('upgrade');
  
  // Find the upgrade
  const upgrade = await getUpgradeByName(upgradeName);
  
  if (!upgrade) {
    return interaction.reply({
      embeds: [createErrorEmbed(`Upgrade "${upgradeName}" not found. Use \`/upgrades\` to see available upgrades.`)],
      ephemeral: true,
    });
  }
  
  // Check requirements
  if (guild.level < upgrade.required_guild_level) {
    return interaction.reply({
      embeds: [createErrorEmbed(`Your guild must be level **${upgrade.required_guild_level}** to unlock this upgrade. (Currently level ${guild.level})`)],
      ephemeral: true,
    });
  }
  
  if (guild.adventurer_count < upgrade.required_adventurer_count) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need at least **${upgrade.required_adventurer_count}** adventurers to unlock this upgrade. (Currently have ${guild.adventurer_count})`)],
      ephemeral: true,
    });
  }
  
  // Check current level and max level
  const currentLevel = await getGuildUpgradeLevel(guild.id, upgrade.id);
  
  if (upgrade.max_level && currentLevel >= upgrade.max_level) {
    return interaction.reply({
      embeds: [createErrorEmbed(`**${upgrade.name}** is already at maximum level (${upgrade.max_level})!`)],
      ephemeral: true,
    });
  }
  
  // Calculate cost
  const cost = calculateUpgradeCost(upgrade, currentLevel);
  
  // Check if player can afford it
  if (guild.gold < cost) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You need **${formatNumber(cost)}** gold to purchase this upgrade. (You have ${formatNumber(guild.gold)})`)],
      ephemeral: true,
    });
  }
  
  // Purchase the upgrade
  try {
    await purchaseUpgrade(guild.id, upgrade.id, cost);
    
    const newLevel = currentLevel + 1;
    const effectDescription = getEffectDescription(upgrade, newLevel);
    
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('Upgrade Purchased!')
      .setDescription(`You purchased **${upgrade.name}**!`)
      .addFields(
        {
          name: 'Level',
          value: upgrade.max_level
            ? `${newLevel} / ${upgrade.max_level}`
            : `Level ${newLevel}`,
          inline: true,
        },
        {
          name: 'Cost',
          value: `${formatNumber(cost)} gold`,
          inline: true,
        },
        {
          name: 'Effect',
          value: effectDescription,
          inline: false,
        }
      )
      .setFooter({ text: `Remaining gold: ${formatNumber(guild.gold - cost)}` });
    
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    if (error.message === 'Insufficient gold') {
      return interaction.reply({
        embeds: [createErrorEmbed('You no longer have enough gold for this purchase.')],
        ephemeral: true,
      });
    }
    
    console.error('Error purchasing upgrade:', error);
    return interaction.reply({
      embeds: [createErrorEmbed('Failed to purchase upgrade. Please try again.')],
      ephemeral: true,
    });
  }
}

/**
 * Generate a human-readable effect description
 */
function getEffectDescription(upgrade, level) {
  const value = parseFloat(upgrade.effect_value) * level;
  
  switch (upgrade.effect_type) {
    case 'gold_multiplier':
      return `+${(value * 100).toFixed(0)}% gold per adventurer`;
    case 'xp_multiplier':
      return `+${(value * 100).toFixed(0)}% XP gain`;
    case 'all_multiplier':
      return `+${(value * 100).toFixed(0)}% gold and XP`;
    case 'adventurer_capacity':
      return `+${value} adventurer capacity`;
    case 'adventurer_per_hour':
      return `+${value} adventurers join per hour`;
    case 'base_gold_per_hour':
      return `+${value} base gold per hour`;
    case 'base_gold_and_xp':
      return `+${value} base gold, +${Math.floor(value * 0.5)} base XP per hour`;
    case 'capacity_and_gold':
      return `+${value} adventurer capacity, +${level * 8}% gold`;
    default:
      return upgrade.description;
  }
}
