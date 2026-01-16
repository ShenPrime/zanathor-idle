import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { getGuildByDiscordId, createGuild } from '../database/guilds.js';
import { createGuildEmbed, createErrorEmbed } from '../utils/embeds.js';
import { calculateRates, calculateUpgradeBonuses } from '../game/idle.js';

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Found your adventurer\'s guild and begin your journey!');

export async function execute(interaction) {
  // Check if player already has a guild
  const existingGuild = await getGuildByDiscordId(interaction.user.id);
  
  if (existingGuild) {
    return interaction.reply({
      embeds: [createErrorEmbed(`You already have a guild named **${existingGuild.name}**! Use \`/guild\` to view it.`)],
      ephemeral: true,
    });
  }
  
  // Show modal to get guild name
  const modal = new ModalBuilder()
    .setCustomId('start_guild_modal')
    .setTitle('Found Your Guild');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('guild_name')
    .setLabel('What will you name your guild?')
    .setPlaceholder('e.g., The Silver Swords')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(64)
    .setRequired(true);
  
  const actionRow = new ActionRowBuilder().addComponents(nameInput);
  modal.addComponents(actionRow);
  
  await interaction.showModal(modal);
}

/**
 * Handle the modal submission for creating a guild
 * @param {ModalSubmitInteraction} interaction 
 */
export async function handleModal(interaction) {
  const guildName = interaction.fields.getTextInputValue('guild_name').trim();
  
  // Validate guild name
  if (guildName.length < 3) {
    return interaction.reply({
      embeds: [createErrorEmbed('Guild name must be at least 3 characters long.')],
      ephemeral: true,
    });
  }
  
  try {
    // Create the guild
    const guild = await createGuild(interaction.user.id, guildName);
    
    // Calculate initial rates
    const bonuses = calculateUpgradeBonuses([]);
    const rates = calculateRates(guild, bonuses);
    
    // Send welcome message with guild embed
    await interaction.reply({
      content: `Welcome to **Zanathor**, Guild Master! Your adventure begins now.`,
      embeds: [createGuildEmbed(guild, rates)],
    });
  } catch (error) {
    console.error('Error creating guild:', error);
    await interaction.reply({
      embeds: [createErrorEmbed('Failed to create your guild. Please try again.')],
      ephemeral: true,
    });
  }
}
