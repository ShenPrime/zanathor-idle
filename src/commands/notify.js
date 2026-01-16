import { SlashCommandBuilder } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import {
  getNotificationSettings,
  enableReminders,
  disableReminders,
} from '../database/notifications.js';
import { createSuccessEmbed, createErrorEmbed, COLORS } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('notify')
  .setDescription('Manage DM reminder notifications')
  .addSubcommand(subcommand =>
    subcommand
      .setName('on')
      .setDescription('Enable DM reminders when you have gold to collect')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('off')
      .setDescription('Disable DM reminders')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Check your current notification settings')
  );

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      ephemeral: true,
    });
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  switch (subcommand) {
    case 'on':
      return handleOn(interaction, guild);
    case 'off':
      return handleOff(interaction, guild);
    case 'status':
      return handleStatus(interaction, guild);
  }
}

async function handleOn(interaction, guild) {
  await enableReminders(guild.id);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('DM Reminders Enabled')
    .setDescription(
      'You will receive a DM reminder when your pending gold reaches **50%** of your current balance ' +
      '(once you have at least **2,000 gold**).\n\n' +
      'Reminders are sent at most once every **4 hours**.'
    )
    .setFooter({ text: 'Make sure your DMs are open to receive reminders!' });
  
  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function handleOff(interaction, guild) {
  await disableReminders(guild.id);
  
  await interaction.reply({
    embeds: [createSuccessEmbed('DM reminders have been disabled. You will no longer receive collection reminders.')],
    ephemeral: true,
  });
}

async function handleStatus(interaction, guild) {
  const settings = await getNotificationSettings(guild.id);
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('Notification Settings');
  
  if (!settings || !settings.dm_reminders_enabled) {
    embed.setDescription('**DM Reminders:** Disabled')
      .addFields({
        name: 'Enable Reminders',
        value: 'Use `/notify on` to receive DM reminders when you have gold to collect.',
      });
  } else {
    let statusText = '**DM Reminders:** Enabled\n';
    statusText += '**Trigger:** When pending gold reaches 50% of your balance (min 2,000 gold)\n';
    statusText += '**Cooldown:** 4 hours between reminders\n';
    
    if (settings.last_reminder_at) {
      const lastReminder = new Date(settings.last_reminder_at);
      const hoursAgo = ((Date.now() - lastReminder.getTime()) / (1000 * 60 * 60)).toFixed(1);
      statusText += `**Last Reminder:** ${hoursAgo} hours ago`;
    } else {
      statusText += '**Last Reminder:** Never';
    }
    
    embed.setDescription(statusText);
    
    // Warn if there have been DM failures
    if (settings.dm_failures > 0) {
      embed.addFields({
        name: 'Warning',
        value: `There have been **${settings.dm_failures}** failed DM attempt(s). ` +
          'Make sure your DMs are open. After 3 failures, reminders will be automatically disabled.',
      });
      embed.setColor(COLORS.WARNING);
    }
  }
  
  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
