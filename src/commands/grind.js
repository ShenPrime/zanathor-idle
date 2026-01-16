import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { getGuildByDiscordId, addResources, incrementStats, updatePeakGold } from '../database/guilds.js';
import { getGuildUpgrades } from '../database/upgrades.js';
import { calculateUpgradeBonuses } from '../game/idle.js';
import { checkAndApplyLevelUp } from '../game/leveling.js';
import { GAME, getRankForLevel } from '../config.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

// In-memory cache for grind sessions
// Map<odId, GrindSession>
const grindSessions = new Map();

// Flush timeout duration in milliseconds
const FLUSH_DELAY_MS = 3000;

/**
 * @typedef {Object} GrindSession
 * @property {string} odId - Discord user ID
 * @property {number} guildId - Database guild ID
 * @property {number} goldPerClick - Gold earned per click
 * @property {number} xpPerClick - XP earned per click
 * @property {number} baseGold - Gold when session started
 * @property {number} baseXp - XP when session started
 * @property {number} baseLevel - Level when session started
 * @property {number} sessionGold - Total gold earned this session
 * @property {number} sessionXp - Total XP earned this session
 * @property {number} totalClicks - Total clicks this session
 * @property {number} flushedGold - Gold already written to DB
 * @property {number} flushedXp - XP already written to DB
 * @property {number} lastClickTime - Timestamp of last click
 * @property {NodeJS.Timeout|null} flushTimeout - Pending flush timeout
 * @property {Function|null} updateEmbed - Function to update the embed
 */

export const data = new SlashCommandBuilder()
  .setName('grind')
  .setDescription('Put in manual labor to earn extra gold. Click to earn!');

export async function execute(interaction) {
  const odId = interaction.user.id;
  
  // Check if player has a guild
  const guild = await getGuildByDiscordId(odId);
  
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Flush any existing session for this user
  await flushSession(odId, true);
  
  // Calculate click rates
  const upgrades = await getGuildUpgrades(guild.id);
  const bonuses = calculateUpgradeBonuses(upgrades);
  const rank = getRankForLevel(guild.level);
  
  // Gold per click = 40 seconds of idle income
  const goldPerClick = Math.max(1, Math.floor(
    (GAME.BASE_GOLD_PER_HOUR / 90) * guild.adventurer_count * rank.multiplier * bonuses.goldMultiplier
  ));
  
  const xpPerClick = Math.max(1, Math.floor(
    (GAME.BASE_XP_PER_HOUR / 90) * guild.adventurer_count * bonuses.xpMultiplier
  ));
  
  // Create new session
  const session = {
    odId,
    guildId: guild.id,
    goldPerClick,
    xpPerClick,
    baseGold: Number(guild.gold),
    baseXp: Number(guild.xp),
    baseLevel: guild.level,
    sessionGold: 0,
    sessionXp: 0,
    totalClicks: 0,
    flushedGold: 0,
    flushedXp: 0,
    flushedClicks: 0, // Track clicks that have been flushed to DB
    lastClickTime: Date.now(),
    flushTimeout: null,
    updateEmbed: null,
  };
  
  grindSessions.set(odId, session);
  
  // Track that a new grind session was started
  await incrementStats(guild.id, { lifetime_grind_sessions: 1 });
  
  // Create the embed and button
  const embed = createGrindEmbed(session);
  const row = createGrindButton();
  
  // Send ephemeral message
  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
  
  // Set up button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 15 * 60 * 1000, // 15 minutes max
  });
  
  // Store the update function in the session
  session.updateEmbed = async (newEmbed, disableButton = false) => {
    try {
      const components = disableButton ? [createGrindButton(true)] : [row];
      await interaction.editReply({
        embeds: [newEmbed],
        components,
      });
    } catch (error) {
      // Interaction may have expired
      console.error('Failed to update grind embed:', error.message);
    }
  };
  
  collector.on('collect', async (buttonInteraction) => {
    await handleGrindClick(buttonInteraction, odId);
  });
  
  collector.on('end', async () => {
    // Flush any remaining resources when collector ends
    await flushSession(odId, true);
    
    // Update embed to show session ended
    const finalSession = grindSessions.get(odId);
    if (finalSession && finalSession.updateEmbed) {
      const finalEmbed = createGrindEmbed(finalSession, true);
      await finalSession.updateEmbed(finalEmbed, true);
    }
    
    // Clean up session
    grindSessions.delete(odId);
  });
}

/**
 * Handle a grind button click
 * @param {ButtonInteraction} interaction 
 * @param {string} odId 
 */
async function handleGrindClick(interaction, odId) {
  const session = grindSessions.get(odId);
  
  if (!session) {
    // Session expired or doesn't exist
    await interaction.update({
      embeds: [createErrorEmbed('Session expired. Use `/grind` to start a new session.')],
      components: [createGrindButton(true)],
    });
    return;
  }
  
  // Increment session counters
  session.sessionGold += session.goldPerClick;
  session.sessionXp += session.xpPerClick;
  session.totalClicks += 1;
  session.lastClickTime = Date.now();
  
  // Clear existing flush timeout and set a new one
  if (session.flushTimeout) {
    clearTimeout(session.flushTimeout);
  }
  
  session.flushTimeout = setTimeout(() => {
    flushSession(odId, false);
  }, FLUSH_DELAY_MS);
  
  // Update the embed in place
  const embed = createGrindEmbed(session);
  
  try {
    await interaction.update({
      embeds: [embed],
      components: [createGrindButton()],
    });
  } catch (error) {
    console.error('Failed to update grind interaction:', error.message);
  }
}

/**
 * Flush pending resources to the database
 * @param {string} odId - Discord user ID
 * @param {boolean} final - Whether this is the final flush (session ending)
 * @returns {Promise<{leveledUp: boolean, newLevel: number|null}>}
 */
export async function flushSession(odId, final = false) {
  const session = grindSessions.get(odId);
  
  if (!session) {
    return { leveledUp: false, newLevel: null };
  }
  
  // Clear any pending flush timeout
  if (session.flushTimeout) {
    clearTimeout(session.flushTimeout);
    session.flushTimeout = null;
  }
  
  // Calculate how much to flush
  const goldToFlush = session.sessionGold - session.flushedGold;
  const xpToFlush = session.sessionXp - session.flushedXp;
  const clicksToFlush = session.totalClicks - session.flushedClicks;
  
  // Nothing to flush
  if (goldToFlush <= 0 && xpToFlush <= 0) {
    return { leveledUp: false, newLevel: null };
  }
  
  try {
    // Write to database
    const updatedGuild = await addResources(session.guildId, goldToFlush, xpToFlush);
    
    // Track grind stats
    await incrementStats(session.guildId, {
      lifetime_grind_gold: goldToFlush,
      lifetime_grind_clicks: clicksToFlush,
    });
    
    // Update peak gold
    await updatePeakGold(session.guildId, updatedGuild.gold);
    
    // Update flushed tracking
    session.flushedGold = session.sessionGold;
    session.flushedXp = session.sessionXp;
    session.flushedClicks = session.totalClicks;
    
    // Check for level-up
    const levelResult = await checkAndApplyLevelUp(updatedGuild);
    
    if (levelResult.leveledUp) {
      session.baseLevel = levelResult.newLevel;
      
      // Update the embed to show level-up
      if (session.updateEmbed) {
        const embed = createGrindEmbed(session, final, levelResult);
        await session.updateEmbed(embed, final);
      }
    } else if (!final && session.updateEmbed) {
      // Just update to remove any "pending" indication if we had one
      const embed = createGrindEmbed(session);
      await session.updateEmbed(embed);
    }
    
    return {
      leveledUp: levelResult.leveledUp,
      newLevel: levelResult.newLevel,
    };
  } catch (error) {
    console.error('Failed to flush grind session:', error);
    return { leveledUp: false, newLevel: null };
  }
}

/**
 * Flush all active sessions (for graceful shutdown)
 */
export async function flushAllSessions() {
  const promises = [];
  for (const odId of grindSessions.keys()) {
    promises.push(flushSession(odId, true));
  }
  await Promise.all(promises);
  grindSessions.clear();
}

/**
 * Check if a user has an active grind session
 * @param {string} odId 
 * @returns {boolean}
 */
export function hasActiveSession(odId) {
  return grindSessions.has(odId);
}

/**
 * Create the grind embed
 * @param {GrindSession} session 
 * @param {boolean} ended - Whether the session has ended
 * @param {Object} levelResult - Level-up result if applicable
 * @returns {EmbedBuilder}
 */
function createGrindEmbed(session, ended = false, levelResult = null) {
  const totalGold = session.baseGold + session.sessionGold;
  const totalXp = session.baseXp + session.sessionXp;
  
  const embed = new EmbedBuilder()
    .setColor(ended ? COLORS.WARNING : COLORS.SUCCESS)
    .setTitle(ended ? 'Grind Session Ended' : 'Grind Session')
    .setDescription(
      ended 
        ? '*You take a well-deserved break from the manual labor.*'
        : '*Roll up your sleeves and get to work!*'
    )
    .addFields(
      {
        name: 'Per Click',
        value: `+${session.goldPerClick} gold, +${session.xpPerClick} XP`,
        inline: true,
      },
      {
        name: 'Clicks',
        value: `${session.totalClicks}`,
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true,
      },
      {
        name: 'Session Earnings',
        value: `${formatNumber(session.sessionGold)} gold, ${formatNumber(session.sessionXp)} XP`,
        inline: true,
      },
      {
        name: 'Total Gold',
        value: formatNumber(totalGold),
        inline: true,
      },
      {
        name: 'Total XP',
        value: formatNumber(totalXp),
        inline: true,
      }
    );
  
  // Add level-up notification if applicable
  if (levelResult && levelResult.leveledUp) {
    const newRank = getRankForLevel(levelResult.newLevel);
    embed.addFields({
      name: 'LEVEL UP!',
      value: `${newRank.emoji} Your guild reached **Level ${levelResult.newLevel}**!`,
      inline: false,
    });
    embed.setColor(COLORS.GOLD);
  }
  
  if (ended) {
    embed.setFooter({ text: 'Use /grind to start a new session' });
  }
  
  return embed;
}

/**
 * Create the grind button
 * @param {boolean} disabled 
 * @returns {ActionRowBuilder}
 */
function createGrindButton(disabled = false) {
  const button = new ButtonBuilder()
    .setCustomId('grind_button')
    .setLabel('Grind!')
    .setStyle(ButtonStyle.Success)
    .setEmoji('⚒️')
    .setDisabled(disabled);
  
  return new ActionRowBuilder().addComponents(button);
}
