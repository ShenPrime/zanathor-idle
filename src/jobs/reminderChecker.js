import { EmbedBuilder } from 'discord.js';
import { getGuildsEligibleForReminder, updateLastReminderTime, recordDmFailure } from '../database/notifications.js';
import { calculateIdleEarnings } from '../game/idle.js';
import { formatNumber } from '../utils/format.js';
import { COLORS } from '../utils/embeds.js';

// Minimum gold balance required before reminders are sent
const MIN_GOLD_FOR_REMINDERS = 2000;

// Reminder triggers when pending gold >= this percentage of current gold
const REMINDER_THRESHOLD_PERCENT = 0.5;

// Check interval in milliseconds (30 minutes)
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

let intervalId = null;

/**
 * Build the reminder DM embed
 * @param {Object} guild - Guild data
 * @param {number} pendingGold - Pending gold to collect
 * @param {number} pendingXp - Pending XP to collect
 * @returns {EmbedBuilder}
 */
function buildReminderEmbed(guild, pendingGold, pendingXp) {
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('Collection Reminder')
    .setDescription(
      `Your guild **${guild.name}** has **${formatNumber(pendingGold)} gold** and ` +
      `**${formatNumber(pendingXp)} XP** ready to collect!\n\n` +
      `Use \`/collect\` in any server channel.`
    )
    .setFooter({ text: 'Use /notify off to disable these reminders' })
    .setTimestamp();
}

/**
 * Check a single guild and send reminder if needed
 * @param {Object} client - Discord client
 * @param {Object} guild - Guild data from database
 * @returns {Promise<boolean>} Whether a reminder was sent
 */
async function checkAndRemindGuild(client, guild) {
  try {
    // Skip if guild doesn't have enough gold for reminders
    if (guild.gold < MIN_GOLD_FOR_REMINDERS) {
      return false;
    }
    
    // Calculate pending earnings
    const earnings = await calculateIdleEarnings(guild);
    
    // Check if pending gold meets threshold (50% of current balance)
    const threshold = guild.gold * REMINDER_THRESHOLD_PERCENT;
    if (earnings.goldEarned < threshold) {
      return false;
    }
    
    // Try to send DM
    try {
      const user = await client.users.fetch(guild.discord_id);
      const embed = buildReminderEmbed(guild, earnings.goldEarned, earnings.xpEarned);
      
      await user.send({ embeds: [embed] });
      
      // Update last reminder time
      await updateLastReminderTime(guild.id);
      
      console.log(`Sent reminder to ${guild.name} (${guild.discord_id})`);
      return true;
      
    } catch (dmError) {
      // DM failed - user probably has DMs disabled
      if (dmError.code === 50007) { // Cannot send messages to this user
        const result = await recordDmFailure(guild.id);
        
        if (result.wasDisabled) {
          console.log(`Auto-disabled reminders for ${guild.name} after 3 DM failures`);
        } else {
          console.log(`DM failed for ${guild.name} (failure ${result.dm_failures}/3)`);
        }
      } else {
        console.error(`Unexpected DM error for ${guild.name}:`, dmError.message);
      }
      return false;
    }
    
  } catch (error) {
    console.error(`Error checking guild ${guild.id}:`, error.message);
    return false;
  }
}

/**
 * Run the reminder check for all eligible guilds
 * @param {Object} client - Discord client
 */
async function runReminderCheck(client) {
  try {
    const guilds = await getGuildsEligibleForReminder();
    
    if (guilds.length === 0) {
      return;
    }
    
    console.log(`Checking ${guilds.length} guild(s) for reminders...`);
    
    let remindersSent = 0;
    for (const guild of guilds) {
      const sent = await checkAndRemindGuild(client, guild);
      if (sent) remindersSent++;
    }
    
    if (remindersSent > 0) {
      console.log(`Sent ${remindersSent} reminder(s)`);
    }
    
  } catch (error) {
    console.error('Error running reminder check:', error.message);
  }
}

/**
 * Start the reminder checker interval
 * @param {Object} client - Discord client
 */
export function startReminderChecker(client) {
  if (intervalId) {
    console.warn('Reminder checker is already running');
    return;
  }
  
  console.log(`Starting reminder checker (every ${CHECK_INTERVAL_MS / 60000} minutes)`);
  
  // Run immediately on start, then every interval
  runReminderCheck(client);
  
  intervalId = setInterval(() => {
    runReminderCheck(client);
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the reminder checker interval
 */
export function stopReminderChecker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Reminder checker stopped');
  }
}
