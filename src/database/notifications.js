import { query } from './connection.js';

/**
 * Get notification settings for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object|null>} Notification settings or null
 */
export async function getNotificationSettings(guildId) {
  const result = await query(
    'SELECT * FROM notification_settings WHERE guild_id = $1',
    [guildId]
  );
  return result.rows[0] || null;
}

/**
 * Enable DM reminders for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function enableReminders(guildId) {
  const result = await query(
    `INSERT INTO notification_settings (guild_id, dm_reminders_enabled, dm_failures)
     VALUES ($1, TRUE, 0)
     ON CONFLICT (guild_id) 
     DO UPDATE SET dm_reminders_enabled = TRUE, dm_failures = 0
     RETURNING *`,
    [guildId]
  );
  return result.rows[0];
}

/**
 * Disable DM reminders for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function disableReminders(guildId) {
  const result = await query(
    `INSERT INTO notification_settings (guild_id, dm_reminders_enabled)
     VALUES ($1, FALSE)
     ON CONFLICT (guild_id) 
     DO UPDATE SET dm_reminders_enabled = FALSE
     RETURNING *`,
    [guildId]
  );
  return result.rows[0];
}

/**
 * Update last reminder timestamp
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function updateLastReminderTime(guildId) {
  const result = await query(
    `UPDATE notification_settings 
     SET last_reminder_at = NOW()
     WHERE guild_id = $1
     RETURNING *`,
    [guildId]
  );
  return result.rows[0];
}

/**
 * Increment DM failure count and disable if threshold reached
 * @param {number} guildId - Guild ID
 * @param {number} maxFailures - Max failures before auto-disable (default 3)
 * @returns {Promise<Object>} Updated settings with wasDisabled flag
 */
export async function recordDmFailure(guildId, maxFailures = 3) {
  // Increment failure count
  const result = await query(
    `UPDATE notification_settings 
     SET dm_failures = dm_failures + 1
     WHERE guild_id = $1
     RETURNING *`,
    [guildId]
  );
  
  const settings = result.rows[0];
  
  // Auto-disable if too many failures
  if (settings && settings.dm_failures >= maxFailures) {
    await query(
      `UPDATE notification_settings 
       SET dm_reminders_enabled = FALSE
       WHERE guild_id = $1`,
      [guildId]
    );
    return { ...settings, wasDisabled: true };
  }
  
  return { ...settings, wasDisabled: false };
}

/**
 * Get all guilds with reminders enabled that are eligible for a reminder
 * (last reminder was more than 4 hours ago or never sent)
 * @returns {Promise<Array>} Guilds with their discord_id and notification settings
 */
export async function getGuildsEligibleForReminder() {
  const result = await query(
    `SELECT g.*, ns.last_reminder_at, ns.dm_failures
     FROM guilds g
     JOIN notification_settings ns ON g.id = ns.guild_id
     WHERE ns.dm_reminders_enabled = TRUE
       AND (ns.last_reminder_at IS NULL 
            OR ns.last_reminder_at < NOW() - INTERVAL '4 hours')`
  );
  return result.rows;
}
