import { sql } from './connection.js';

/**
 * Get notification settings for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object|null>} Notification settings or null
 */
export async function getNotificationSettings(guildId) {
  const [settings] = await sql`SELECT * FROM notification_settings WHERE guild_id = ${guildId}`;
  return settings || null;
}

/**
 * Enable DM reminders for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function enableReminders(guildId) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, dm_reminders_enabled, dm_failures)
    VALUES (${guildId}, TRUE, 0)
    ON CONFLICT (guild_id) 
    DO UPDATE SET dm_reminders_enabled = TRUE, dm_failures = 0
    RETURNING *
  `;
  return settings;
}

/**
 * Disable DM reminders for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function disableReminders(guildId) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, dm_reminders_enabled)
    VALUES (${guildId}, FALSE)
    ON CONFLICT (guild_id) 
    DO UPDATE SET dm_reminders_enabled = FALSE
    RETURNING *
  `;
  return settings;
}

/**
 * Update last reminder timestamp
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function updateLastReminderTime(guildId) {
  const [settings] = await sql`
    UPDATE notification_settings 
    SET last_reminder_at = NOW()
    WHERE guild_id = ${guildId}
    RETURNING *
  `;
  return settings;
}

/**
 * Increment DM failure count and disable if threshold reached
 * @param {number} guildId - Guild ID
 * @param {number} maxFailures - Max failures before auto-disable (default 3)
 * @returns {Promise<Object>} Updated settings with wasDisabled flag
 */
export async function recordDmFailure(guildId, maxFailures = 3) {
  // Increment failure count
  const [settings] = await sql`
    UPDATE notification_settings 
    SET dm_failures = dm_failures + 1
    WHERE guild_id = ${guildId}
    RETURNING *
  `;
  
  // Auto-disable if too many failures
  if (settings && settings.dm_failures >= maxFailures) {
    await sql`
      UPDATE notification_settings 
      SET dm_reminders_enabled = FALSE
      WHERE guild_id = ${guildId}
    `;
    return { ...settings, wasDisabled: true };
  }
  
  return { ...settings, wasDisabled: false };
}

/**
 * Get all guilds with reminders enabled that are eligible for a reminder
 * (last reminder was more than 4 hours ago or never sent)
 * Includes upgrade data via JSON aggregation to avoid N+1 queries
 * @returns {Promise<Array>} Guilds with their upgrades, prestige upgrades, and notification settings
 */
export async function getGuildsEligibleForReminder() {
  const result = await sql`
    SELECT 
      g.*, 
      ns.last_reminder_at, 
      ns.dm_failures,
      COALESCE(
        (SELECT json_agg(row_to_json(u))
         FROM (
           SELECT gu.*, up.name, up.description, up.category, up.effect_type, up.effect_value, up.max_level
           FROM guild_upgrades gu
           JOIN upgrades up ON gu.upgrade_id = up.id
           WHERE gu.guild_id = g.id
         ) u
        ), '[]'::json
      ) as upgrades,
      COALESCE(
        (SELECT json_agg(row_to_json(p))
         FROM (
           SELECT gpu.level, pu.id, pu.name, pu.effect_type, pu.effect_value, pu.max_level
           FROM guild_prestige_upgrades gpu
           JOIN prestige_upgrades pu ON gpu.prestige_upgrade_id = pu.id
           WHERE gpu.guild_id = g.id
         ) p
        ), '[]'::json
      ) as prestige_upgrades
    FROM guilds g
    JOIN notification_settings ns ON g.id = ns.guild_id
    WHERE ns.dm_reminders_enabled = TRUE
      AND (ns.last_reminder_at IS NULL 
           OR ns.last_reminder_at < NOW() - INTERVAL '4 hours')
  `;
  return result;
}

/**
 * Enable battle notifications for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function enableBattleNotifications(guildId) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, battle_notifications_enabled)
    VALUES (${guildId}, TRUE)
    ON CONFLICT (guild_id) 
    DO UPDATE SET battle_notifications_enabled = TRUE
    RETURNING *
  `;
  return settings;
}

/**
 * Disable battle notifications for a guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Updated settings
 */
export async function disableBattleNotifications(guildId) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, battle_notifications_enabled)
    VALUES (${guildId}, FALSE)
    ON CONFLICT (guild_id) 
    DO UPDATE SET battle_notifications_enabled = FALSE
    RETURNING *
  `;
  return settings;
}

/**
 * Update all notification settings at once (for onboarding flow)
 * @param {number} guildId - Guild ID
 * @param {boolean} collectionReminders - Enable collection reminders
 * @param {boolean} battleNotifications - Enable battle notifications
 * @returns {Promise<Object>} Updated settings
 */
export async function updateAllNotificationSettings(guildId, collectionReminders, battleNotifications) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, dm_reminders_enabled, battle_notifications_enabled, dm_failures)
    VALUES (${guildId}, ${collectionReminders}, ${battleNotifications}, 0)
    ON CONFLICT (guild_id) 
    DO UPDATE SET 
      dm_reminders_enabled = ${collectionReminders}, 
      battle_notifications_enabled = ${battleNotifications},
      dm_failures = 0
    RETURNING *
  `;
  return settings;
}

/**
 * Create default notification settings for a new guild (all off)
 * @param {number} guildId - Guild ID
 * @returns {Promise<Object>} Created settings
 */
export async function createDefaultNotificationSettings(guildId) {
  const [settings] = await sql`
    INSERT INTO notification_settings (guild_id, dm_reminders_enabled, battle_notifications_enabled, dm_failures)
    VALUES (${guildId}, FALSE, FALSE, 0)
    ON CONFLICT (guild_id) DO NOTHING
    RETURNING *
  `;
  return settings;
}
