import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import {
  getNotificationSettings,
  enableReminders,
  disableReminders,
  enableBattleNotifications,
  disableBattleNotifications,
  updateAllNotificationSettings,
} from '../database/notifications.js';
import { createSuccessEmbed, createErrorEmbed, COLORS } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('notify')
  .setDescription('Manage notification settings')
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Which notification type to manage')
      .setRequired(true)
      .addChoices(
        { name: 'Collection Reminders', value: 'collection' },
        { name: 'Battle Notifications', value: 'battle' },
        { name: 'All Notifications', value: 'all' }
      )
  )
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('What action to take')
      .setRequired(true)
      .addChoices(
        { name: 'Enable', value: 'on' },
        { name: 'Disable', value: 'off' },
        { name: 'Check Status', value: 'status' }
      )
  );

export async function execute(interaction) {
  const guild = await getGuildByDiscordId(interaction.user.id);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const type = interaction.options.getString('type');
  const action = interaction.options.getString('action');
  
  // Handle status separately
  if (action === 'status') {
    return handleStatus(interaction, guild, type);
  }
  
  // Handle on/off
  const enable = action === 'on';
  
  switch (type) {
    case 'collection':
      return handleCollectionToggle(interaction, guild, enable);
    case 'battle':
      return handleBattleToggle(interaction, guild, enable);
    case 'all':
      return handleAllToggle(interaction, guild, enable);
  }
}

async function handleCollectionToggle(interaction, guild, enable) {
  if (enable) {
    await enableReminders(guild.id);
    
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('✅ Collection Reminders Enabled')
      .setDescription(
        'You will receive a DM reminder when your pending gold reaches **50%** of your current balance ' +
        '(once you have at least **2,000 gold**).\n\n' +
        'Reminders are sent at most once every **4 hours**.'
      )
      .setFooter({ text: 'Make sure your DMs are open to receive reminders!' });
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await disableReminders(guild.id);
    
    await interaction.reply({
      embeds: [createSuccessEmbed('Collection reminders have been **disabled**.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleBattleToggle(interaction, guild, enable) {
  if (enable) {
    await enableBattleNotifications(guild.id);
    
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('✅ Battle Notifications Enabled')
      .setDescription(
        'You will receive a DM when another player **attacks your guild**.\n\n' +
        'Stay informed about your wins and losses!'
      )
      .setFooter({ text: 'Make sure your DMs are open to receive notifications!' });
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await disableBattleNotifications(guild.id);
    
    await interaction.reply({
      embeds: [createSuccessEmbed('Battle notifications have been **disabled**.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleAllToggle(interaction, guild, enable) {
  await updateAllNotificationSettings(guild.id, enable, enable);
  
  if (enable) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('✅ All Notifications Enabled')
      .setDescription(
        '**Collection Reminders:** Enabled\n' +
        '**Battle Notifications:** Enabled\n\n' +
        'You will receive DMs for both collection reminders and battle results.'
      )
      .setFooter({ text: 'Make sure your DMs are open to receive notifications!' });
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      embeds: [createSuccessEmbed('All notifications have been **disabled**.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleStatus(interaction, guild, type) {
  const settings = await getNotificationSettings(guild.id);
  
  const collectionEnabled = settings?.dm_reminders_enabled || false;
  const battleEnabled = settings?.battle_notifications_enabled || false;
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('Notification Settings');
  
  if (type === 'all' || type === 'collection') {
    let collectionStatus = collectionEnabled ? '✅ **Enabled**' : '❌ **Disabled**';
    
    if (collectionEnabled) {
      collectionStatus += '\n• Trigger: 50% of balance (min 2,000 gold)';
      collectionStatus += '\n• Cooldown: 4 hours';
      
      if (settings?.last_reminder_at) {
        const lastReminder = new Date(settings.last_reminder_at);
        const hoursAgo = ((Date.now() - lastReminder.getTime()) / (1000 * 60 * 60)).toFixed(1);
        collectionStatus += `\n• Last reminder: ${hoursAgo} hours ago`;
      }
      
      if (settings?.dm_failures > 0) {
        collectionStatus += `\n• ⚠️ ${settings.dm_failures} failed DM attempt(s)`;
      }
    }
    
    embed.addFields({
      name: '📬 Collection Reminders',
      value: collectionStatus,
      inline: type === 'all',
    });
  }
  
  if (type === 'all' || type === 'battle') {
    let battleStatus = battleEnabled ? '✅ **Enabled**' : '❌ **Disabled**';
    
    if (battleEnabled) {
      battleStatus += '\n• DM when your guild is attacked';
    }
    
    embed.addFields({
      name: '⚔️ Battle Notifications',
      value: battleStatus,
      inline: type === 'all',
    });
  }
  
  // Add footer with toggle hints
  if (type === 'all') {
    embed.setFooter({ text: 'Use /notify type:<type> action:on/off to change settings' });
  } else if (type === 'collection') {
    embed.setFooter({ text: collectionEnabled 
      ? 'Use /notify type:collection action:off to disable' 
      : 'Use /notify type:collection action:on to enable' 
    });
  } else if (type === 'battle') {
    embed.setFooter({ text: battleEnabled 
      ? 'Use /notify type:battle action:off to disable' 
      : 'Use /notify type:battle action:on to enable' 
    });
  }
  
  // Warn if there have been DM failures
  if (settings?.dm_failures > 0 && collectionEnabled) {
    embed.setColor(COLORS.WARNING);
    embed.addFields({
      name: '⚠️ Warning',
      value: 'There have been failed DM attempts. Make sure your DMs are open. After 3 failures, collection reminders will be automatically disabled.',
      inline: false,
    });
  }
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
