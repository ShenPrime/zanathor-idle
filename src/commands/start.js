import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getGuildByDiscordId, createGuild, updateGuildName } from '../database/guilds.js';
import { 
  getNotificationSettings, 
  updateAllNotificationSettings,
  createDefaultNotificationSettings,
} from '../database/notifications.js';
import { createGuildEmbed, createErrorEmbed, COLORS } from '../utils/embeds.js';
import { calculateRates, calculateUpgradeBonuses } from '../game/idle.js';

// Setup timeout duration (2 minutes)
const SETUP_TIMEOUT_MS = 2 * 60 * 1000;

// In-memory storage for setup sessions
const setupSessions = new Map();

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Found your adventurer\'s guild or reconfigure settings');

export async function execute(interaction) {
  const discordId = interaction.user.id;
  
  // Clear any existing session for this user
  clearSession(discordId);
  
  // Check if player already has a guild
  const existingGuild = await getGuildByDiscordId(discordId);
  
  if (existingGuild) {
    // Existing user - show current settings and ask if they want to reconfigure
    const settings = await getNotificationSettings(existingGuild.id);
    
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`Current Settings for ${existingGuild.name}`)
      .addFields(
        {
          name: 'Guild Name',
          value: existingGuild.name,
          inline: false,
        },
        {
          name: 'Collection Reminders',
          value: settings?.dm_reminders_enabled ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        },
        {
          name: 'Battle Notifications',
          value: settings?.battle_notifications_enabled ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        }
      )
      .setDescription('Would you like to update your settings?')
      .setFooter({ text: 'This will let you change your guild name and notification preferences.' });
    
    const yesButton = new ButtonBuilder()
      .setCustomId('start_reconfigure_yes')
      .setLabel('Yes, Update Settings')
      .setStyle(ButtonStyle.Primary);
    
    const noButton = new ButtonBuilder()
      .setCustomId('start_reconfigure_no')
      .setLabel('No, Keep Current')
      .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(yesButton, noButton);
    
    // Create session for existing user
    const session = {
      odId: discordId,
      isNewUser: false,
      guildId: existingGuild.id,
      guildName: existingGuild.name,
      collectionReminders: settings?.dm_reminders_enabled || false,
      battleNotifications: settings?.battle_notifications_enabled || false,
      currentStep: 0, // 0 = reconfigure prompt
      originalSettings: {
        guildName: existingGuild.name,
        collectionReminders: settings?.dm_reminders_enabled || false,
        battleNotifications: settings?.battle_notifications_enabled || false,
      },
      timeout: null,
    };
    
    setupSessions.set(discordId, session);
    startTimeout(discordId);
    
    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    // New user - go straight to name modal
    const session = {
      odId: discordId,
      isNewUser: true,
      guildId: null,
      guildName: null,
      collectionReminders: null,
      battleNotifications: null,
      currentStep: 1, // 1 = name modal
      originalSettings: null,
      timeout: null,
    };
    
    setupSessions.set(discordId, session);
    startTimeout(discordId);
    
    await showNameModal(interaction);
  }
}

/**
 * Show the guild name modal
 */
async function showNameModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('start_guild_modal')
    .setTitle('Name Your Guild');
  
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
 * Handle the modal submission for guild name
 */
export async function handleModal(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const guildName = interaction.fields.getTextInputValue('guild_name').trim();
  
  // Validate guild name
  if (guildName.length < 3) {
    return interaction.reply({
      embeds: [createErrorEmbed('Guild name must be at least 3 characters long.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Update session
  session.guildName = guildName;
  session.currentStep = 2;
  resetTimeout(discordId);
  
  // Show step 2: Collection Reminders
  await showStep2(interaction, session);
}

/**
 * Show Step 2: Collection Reminders
 */
async function showStep2(interaction, session) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📬 Collection Reminders')
    .setDescription(
      'Get a DM when your pending earnings reach **50%** of your current gold balance.\n\n' +
      'Helps you remember to collect your idle income!'
    )
    .addFields(
      {
        name: 'Details',
        value: '• 4-hour cooldown between reminders\n• Auto-disables after 3 failed DM attempts',
        inline: false,
      }
    )
    .setFooter({ text: 'Step 2 of 3 • Skip Setup = All notifications OFF' });
  
  const enableButton = new ButtonBuilder()
    .setCustomId('start_step2_enable')
    .setLabel('Enable')
    .setStyle(ButtonStyle.Success);
  
  const disableButton = new ButtonBuilder()
    .setCustomId('start_step2_disable')
    .setLabel('Disable')
    .setStyle(ButtonStyle.Secondary);
  
  const backButton = new ButtonBuilder()
    .setCustomId('start_step2_back')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);
  
  const skipButton = new ButtonBuilder()
    .setCustomId('start_skip')
    .setLabel('Skip Setup')
    .setStyle(ButtonStyle.Danger);
  
  const row = new ActionRowBuilder().addComponents(enableButton, disableButton, backButton, skipButton);
  
  // Use reply for modal submissions, update for button interactions
  if (interaction.isModalSubmit()) {
    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  }
}

/**
 * Show Step 3: Battle Notifications
 */
async function showStep3(interaction, session) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('⚔️ Battle Notifications')
    .setDescription(
      'Get a DM when another player **attacks your guild**.\n\n' +
      'Know immediately when you\'ve won or lost a battle!'
    )
    .setFooter({ text: 'Step 3 of 3 • Skip Setup = All notifications OFF' });
  
  const enableButton = new ButtonBuilder()
    .setCustomId('start_step3_enable')
    .setLabel('Enable')
    .setStyle(ButtonStyle.Success);
  
  const disableButton = new ButtonBuilder()
    .setCustomId('start_step3_disable')
    .setLabel('Disable')
    .setStyle(ButtonStyle.Secondary);
  
  const backButton = new ButtonBuilder()
    .setCustomId('start_step3_back')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);
  
  const skipButton = new ButtonBuilder()
    .setCustomId('start_skip')
    .setLabel('Skip Setup')
    .setStyle(ButtonStyle.Danger);
  
  const row = new ActionRowBuilder().addComponents(enableButton, disableButton, backButton, skipButton);
  
  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Show final summary and create/update guild
 */
async function showFinalSummary(interaction, session) {
  clearSession(session.odId);
  
  try {
    let guild;
    
    if (session.isNewUser) {
      // Create new guild
      guild = await createGuild(session.odId, session.guildName);
      session.guildId = guild.id;
    } else {
      // Update existing guild name if changed
      if (session.guildName !== session.originalSettings.guildName) {
        guild = await updateGuildName(session.guildId, session.guildName);
      } else {
        guild = await getGuildByDiscordId(session.odId);
      }
    }
    
    // Update notification settings
    await updateAllNotificationSettings(
      session.guildId || guild.id,
      session.collectionReminders || false,
      session.battleNotifications || false
    );
    
    // Build summary embed
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTimestamp();
    
    if (session.isNewUser) {
      embed.setTitle(`🏰 Welcome to ${session.guildName}!`);
      embed.setDescription('Your adventurer\'s guild has been founded!');
    } else {
      embed.setTitle(`⚙️ Settings Updated`);
      embed.setDescription(`Your preferences for **${session.guildName}** have been saved.`);
    }
    
    embed.addFields(
      {
        name: 'Notification Settings',
        value: [
          `Collection Reminders: ${session.collectionReminders ? '✅ Enabled' : '❌ Disabled'}`,
          `Battle Notifications: ${session.battleNotifications ? '✅ Enabled' : '❌ Disabled'}`,
        ].join('\n'),
        inline: false,
      }
    );
    
    if (session.isNewUser) {
      embed.addFields({
        name: 'Next Steps',
        value: 'Use `/help` to learn how to play!\nUse `/notify` to change notification settings later.',
        inline: false,
      });
    } else {
      embed.setFooter({ text: 'Use /notify to change these settings anytime.' });
    }
    
    await interaction.update({
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    console.error('Error in final summary:', error);
    await interaction.update({
      embeds: [createErrorEmbed('Failed to save settings. Please try again.')],
      components: [],
    });
  }
}

/**
 * Handle skip setup
 */
async function handleSkipSetup(interaction, session) {
  clearSession(session.odId);
  
  try {
    if (session.isNewUser) {
      // Create guild with default settings (all notifications OFF)
      const guild = await createGuild(session.odId, session.guildName);
      await createDefaultNotificationSettings(guild.id);
      
      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`🏰 Welcome to ${session.guildName}!`)
        .setDescription('Your adventurer\'s guild has been founded!')
        .addFields(
          {
            name: 'Notifications',
            value: 'All notifications are **OFF** by default.\nUse `/notify` to enable them later.',
            inline: false,
          },
          {
            name: 'Next Steps',
            value: 'Use `/help` to learn how to play!',
            inline: false,
          }
        )
        .setTimestamp();
      
      await interaction.update({
        embeds: [embed],
        components: [],
      });
    } else {
      // Existing user - keep current settings
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('👋 No Changes Made')
        .setDescription('Your settings remain unchanged.')
        .setTimestamp();
      
      await interaction.update({
        embeds: [embed],
        components: [],
      });
    }
  } catch (error) {
    console.error('Error in skip setup:', error);
    await interaction.update({
      embeds: [createErrorEmbed('An error occurred. Please try again.')],
      components: [],
    });
  }
}

/**
 * Handle reconfigure "Yes" button
 */
export async function handleReconfigureYes(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.currentStep = 1;
  
  // Show name modal
  await showNameModal(interaction);
}

/**
 * Handle reconfigure "No" button
 */
export async function handleReconfigureNo(interaction) {
  const discordId = interaction.user.id;
  clearSession(discordId);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('👋 No Changes Made')
    .setDescription('Your settings remain unchanged.')
    .setTimestamp();
  
  await interaction.update({
    embeds: [embed],
    components: [],
  });
}

/**
 * Handle Step 2 Enable button
 */
export async function handleStep2Enable(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.collectionReminders = true;
  session.currentStep = 3;
  
  await showStep3(interaction, session);
}

/**
 * Handle Step 2 Disable button
 */
export async function handleStep2Disable(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.collectionReminders = false;
  session.currentStep = 3;
  
  await showStep3(interaction, session);
}

/**
 * Handle Step 2 Back button
 */
export async function handleStep2Back(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.currentStep = 1;
  
  // Reopen name modal
  await showNameModal(interaction);
}

/**
 * Handle Step 3 Enable button
 */
export async function handleStep3Enable(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.battleNotifications = true;
  
  await showFinalSummary(interaction, session);
}

/**
 * Handle Step 3 Disable button
 */
export async function handleStep3Disable(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.battleNotifications = false;
  
  await showFinalSummary(interaction, session);
}

/**
 * Handle Step 3 Back button
 */
export async function handleStep3Back(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  resetTimeout(discordId);
  session.currentStep = 2;
  
  await showStep2(interaction, session);
}

/**
 * Handle Skip Setup button
 */
export async function handleSkip(interaction) {
  const discordId = interaction.user.id;
  const session = setupSessions.get(discordId);
  
  if (!session) {
    return interaction.reply({
      embeds: [createErrorEmbed('Setup session expired. Please run `/start` again.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  await handleSkipSetup(interaction, session);
}

/**
 * Start timeout for a session
 */
function startTimeout(discordId) {
  const session = setupSessions.get(discordId);
  if (!session) return;
  
  session.timeout = setTimeout(() => {
    handleTimeout(discordId);
  }, SETUP_TIMEOUT_MS);
}

/**
 * Reset timeout for a session
 */
function resetTimeout(discordId) {
  const session = setupSessions.get(discordId);
  if (!session) return;
  
  if (session.timeout) {
    clearTimeout(session.timeout);
  }
  
  session.timeout = setTimeout(() => {
    handleTimeout(discordId);
  }, SETUP_TIMEOUT_MS);
}

/**
 * Handle session timeout
 */
function handleTimeout(discordId) {
  const session = setupSessions.get(discordId);
  if (!session) return;
  
  // Clean up session
  clearSession(discordId);
  
  // Note: We can't update the message here since we don't have the interaction
  // The user will see "session expired" message when they try to continue
  console.log(`Setup session timed out for user ${discordId}`);
}

/**
 * Clear a session
 */
function clearSession(discordId) {
  const session = setupSessions.get(discordId);
  if (session) {
    if (session.timeout) {
      clearTimeout(session.timeout);
    }
    setupSessions.delete(discordId);
  }
}

/**
 * Check if a user has an active setup session
 */
export function hasActiveSetupSession(discordId) {
  return setupSessions.has(discordId);
}
