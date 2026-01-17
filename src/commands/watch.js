import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId } from '../database/guilds.js';
import { calculateIdleEarnings } from '../game/idle.js';
import { createErrorEmbed, COLORS } from '../utils/embeds.js';
import { formatNumber } from '../utils/format.js';

// Constants
const UPDATE_INTERVAL_MS = 5000;           // 5 seconds
const MESSAGE_REFRESH_MS = 14 * 60 * 1000; // 14 minutes (refresh before 15-min token expiry)
const DEFAULT_DURATION_MIN = 60;
const MAX_DURATION_MIN = 60;

// Active watchers storage: userId -> watcher state
const activeWatchers = new Map();

export const data = new SlashCommandBuilder()
  .setName('watch')
  .setDescription('Watch your gold and XP earnings update in real-time')
  .addIntegerOption(option =>
    option
      .setName('duration')
      .setDescription('How long to watch in minutes (default: 60, max: 60)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_DURATION_MIN)
  );

/**
 * Format elapsed time as "Xm Ys" or "Ys"
 */
function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Build the watch embed
 */
function buildWatchEmbed(guildName, uncollectedGold, uncollectedXp, deltaGold, deltaXp, totalGold, totalXp, goldPerMin, xpPerMin, adventurerCount, elapsedMs, collectionDetected) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`LIVE EARNINGS - ${guildName}`)
    .setDescription(collectionDetected ? '*Collection detected - tracking from new baseline*' : null)
    .addFields(
      {
        name: 'Gold',
        value: `${formatNumber(uncollectedGold)} (+${formatNumber(deltaGold)}) Total: ${formatNumber(totalGold)}`,
        inline: true,
      },
      {
        name: 'XP',
        value: `${formatNumber(uncollectedXp)} (+${formatNumber(deltaXp)}) Total: ${formatNumber(totalXp)}`,
        inline: true,
      },
      {
        name: '\u200b',
        value: '\u200b',
        inline: true,
      },
      {
        name: 'Rate',
        value: `~${formatNumber(goldPerMin)} gold/min | ~${formatNumber(xpPerMin)} XP/min`,
        inline: true,
      },
      {
        name: 'Adventurers',
        value: `${formatNumber(adventurerCount)} working`,
        inline: true,
      }
    )
    .setFooter({ text: `${formatElapsedTime(elapsedMs)} elapsed (updates every 5s)` })
    .setTimestamp();
  
  return embed;
}

/**
 * Build the stop button
 */
function buildStopButton(userId) {
  const stopButton = new ButtonBuilder()
    .setCustomId(`watch_stop:${userId}`)
    .setLabel('Stop Watching')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⏹️');
  
  return new ActionRowBuilder().addComponents(stopButton);
}

/**
 * Stop a watcher and clean up
 */
function stopWatcher(userId) {
  const watcher = activeWatchers.get(userId);
  if (watcher) {
    clearInterval(watcher.intervalId);
    activeWatchers.delete(userId);
  }
}

/**
 * Main execute function
 */
export async function execute(interaction) {
  const userId = interaction.user.id;
  const durationMin = interaction.options.getInteger('duration') || DEFAULT_DURATION_MIN;
  const durationMs = durationMin * 60 * 1000;
  
  // Stop existing watcher if any
  if (activeWatchers.has(userId)) {
    stopWatcher(userId);
  }
  
  // Get guild data
  const guild = await getGuildByDiscordId(userId);
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate initial idle earnings
  const initialEarnings = await calculateIdleEarnings(guild);
  
  // Store baseline values
  const baseline = {
    uncollectedGold: initialEarnings.goldEarned,
    uncollectedXp: initialEarnings.xpEarned,
    bankedGold: Number(guild.gold),
    bankedXp: Number(guild.xp),
  };
  
  // Calculate rates per minute
  const goldPerMin = Math.round(initialEarnings.rates.goldPerHour / 60);
  const xpPerMin = Math.round(initialEarnings.rates.xpPerHour / 60);
  
  // Build initial embed
  const totalGold = baseline.bankedGold + baseline.uncollectedGold;
  const totalXp = baseline.bankedXp + baseline.uncollectedXp;
  
  const embed = buildWatchEmbed(
    guild.name,
    baseline.uncollectedGold,
    baseline.uncollectedXp,
    0, // delta gold
    0, // delta xp
    totalGold,
    totalXp,
    goldPerMin,
    xpPerMin,
    guild.adventurer_count,
    0, // elapsed time
    false // collection detected
  );
  
  const row = buildStopButton(userId);
  
  // Send initial reply
  const reply = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });
  
  const startTime = Date.now();
  let lastMessageTime = startTime;
  let currentMessage = reply;
  let collectionDetected = false;
  
  // Create the update function
  const updateWatch = async () => {
    try {
      const now = Date.now();
      const elapsedMs = now - startTime;
      
      // Check if duration expired
      if (elapsedMs >= durationMs) {
        stopWatcher(userId);
        
        // Final update
        const finalGuild = await getGuildByDiscordId(userId);
        if (!finalGuild) return;
        
        const finalEarnings = await calculateIdleEarnings(finalGuild);
        const finalUncollectedGold = finalEarnings.goldEarned;
        const finalUncollectedXp = finalEarnings.xpEarned;
        const finalDeltaGold = Math.max(0, finalUncollectedGold - baseline.uncollectedGold);
        const finalDeltaXp = Math.max(0, finalUncollectedXp - baseline.uncollectedXp);
        const finalTotalGold = Number(finalGuild.gold) + finalUncollectedGold;
        const finalTotalXp = Number(finalGuild.xp) + finalUncollectedXp;
        
        const finalEmbed = buildWatchEmbed(
          finalGuild.name,
          finalUncollectedGold,
          finalUncollectedXp,
          finalDeltaGold,
          finalDeltaXp,
          finalTotalGold,
          finalTotalXp,
          goldPerMin,
          xpPerMin,
          finalGuild.adventurer_count,
          elapsedMs,
          false
        );
        finalEmbed.setTitle(`WATCH ENDED - ${finalGuild.name}`);
        finalEmbed.setColor(COLORS.WARNING);
        
        try {
          await currentMessage.edit({
            embeds: [finalEmbed],
            components: [], // Remove button
          });
        } catch (e) {
          // Message might be deleted, ignore
        }
        return;
      }
      
      // Get current guild data
      const currentGuild = await getGuildByDiscordId(userId);
      if (!currentGuild) {
        stopWatcher(userId);
        return;
      }
      
      const currentEarnings = await calculateIdleEarnings(currentGuild);
      const currentUncollectedGold = currentEarnings.goldEarned;
      const currentUncollectedXp = currentEarnings.xpEarned;
      const currentBankedGold = Number(currentGuild.gold);
      const currentBankedXp = Number(currentGuild.xp);
      
      // Check for collection (banked increased significantly AND uncollected dropped)
      const bankedGoldIncreased = currentBankedGold > baseline.bankedGold + 10;
      const uncollectedDropped = currentUncollectedGold < baseline.uncollectedGold * 0.5;
      
      if (bankedGoldIncreased && uncollectedDropped) {
        // Collection detected - reset baseline
        baseline.uncollectedGold = currentUncollectedGold;
        baseline.uncollectedXp = currentUncollectedXp;
        baseline.bankedGold = currentBankedGold;
        baseline.bankedXp = currentBankedXp;
        collectionDetected = true;
      }
      
      // Calculate deltas
      const deltaGold = Math.max(0, currentUncollectedGold - baseline.uncollectedGold);
      const deltaXp = Math.max(0, currentUncollectedXp - baseline.uncollectedXp);
      const totalGold = currentBankedGold + currentUncollectedGold;
      const totalXp = currentBankedXp + currentUncollectedXp;
      
      // Update rates (in case adventurer count changed)
      const currentGoldPerMin = Math.round(currentEarnings.rates.goldPerHour / 60);
      const currentXpPerMin = Math.round(currentEarnings.rates.xpPerHour / 60);
      
      // Build updated embed
      const updatedEmbed = buildWatchEmbed(
        currentGuild.name,
        currentUncollectedGold,
        currentUncollectedXp,
        deltaGold,
        deltaXp,
        totalGold,
        totalXp,
        currentGoldPerMin,
        currentXpPerMin,
        currentGuild.adventurer_count,
        elapsedMs,
        collectionDetected
      );
      
      // Clear collection detected flag after showing it once
      if (collectionDetected) {
        collectionDetected = false;
      }
      
      const updatedRow = buildStopButton(userId);
      
      // Check if we need to refresh the message (14 minutes since last message)
      if (now - lastMessageTime >= MESSAGE_REFRESH_MS) {
        // Delete old message
        try {
          await currentMessage.delete();
        } catch (e) {
          // Message might already be deleted, ignore
        }
        
        // Get the watcher to access the interaction
        const watcher = activeWatchers.get(userId);
        if (!watcher) return;
        
        // Send new followUp
        try {
          const newMessage = await watcher.interaction.followUp({
            embeds: [updatedEmbed],
            components: [updatedRow],
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
          });
          
          currentMessage = newMessage;
          watcher.currentMessage = newMessage;
          lastMessageTime = now;
          watcher.lastMessageTime = now;
        } catch (e) {
          console.log('Failed to send watch followUp:', e.message);
          stopWatcher(userId);
          return;
        }
      } else {
        // Just edit the current message
        try {
          await currentMessage.edit({
            embeds: [updatedEmbed],
            components: [updatedRow],
          });
        } catch (e) {
          // Message might be deleted or interaction expired
          console.log('Failed to edit watch message:', e.message);
          stopWatcher(userId);
          return;
        }
      }
    } catch (error) {
      console.error('Error in watch update loop:', error);
      stopWatcher(userId);
    }
  };
  
  // Start the interval
  const intervalId = setInterval(updateWatch, UPDATE_INTERVAL_MS);
  
  // Store watcher state
  activeWatchers.set(userId, {
    intervalId,
    startTime,
    lastMessageTime,
    currentMessage,
    interaction,
    durationMs,
    baseline,
  });
}

/**
 * Handle stop button click
 */
export async function handleStopButton(interaction) {
  const [, targetUserId] = interaction.customId.split(':');
  
  // Verify the user clicking is the watcher owner
  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      embeds: [createErrorEmbed('You can only stop your own watch!')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  const watcher = activeWatchers.get(targetUserId);
  
  if (!watcher) {
    // Watcher already stopped, just acknowledge
    return interaction.update({
      components: [], // Remove button
    });
  }
  
  // Stop the watcher
  stopWatcher(targetUserId);
  
  // Get final guild data
  const guild = await getGuildByDiscordId(targetUserId);
  if (!guild) {
    return interaction.update({
      embeds: [createErrorEmbed('Guild not found.')],
      components: [],
    });
  }
  
  const finalEarnings = await calculateIdleEarnings(guild);
  const elapsedMs = Date.now() - watcher.startTime;
  
  const finalUncollectedGold = finalEarnings.goldEarned;
  const finalUncollectedXp = finalEarnings.xpEarned;
  const deltaGold = Math.max(0, finalUncollectedGold - watcher.baseline.uncollectedGold);
  const deltaXp = Math.max(0, finalUncollectedXp - watcher.baseline.uncollectedXp);
  const totalGold = Number(guild.gold) + finalUncollectedGold;
  const totalXp = Number(guild.xp) + finalUncollectedXp;
  
  const goldPerMin = Math.round(finalEarnings.rates.goldPerHour / 60);
  const xpPerMin = Math.round(finalEarnings.rates.xpPerHour / 60);
  
  const finalEmbed = buildWatchEmbed(
    guild.name,
    finalUncollectedGold,
    finalUncollectedXp,
    deltaGold,
    deltaXp,
    totalGold,
    totalXp,
    goldPerMin,
    xpPerMin,
    guild.adventurer_count,
    elapsedMs,
    false
  );
  finalEmbed.setTitle(`WATCH STOPPED - ${guild.name}`);
  finalEmbed.setColor(COLORS.WARNING);
  
  await interaction.update({
    embeds: [finalEmbed],
    components: [], // Remove button
  });
}
