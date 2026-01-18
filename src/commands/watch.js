import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getGuildByDiscordId, getGuildWithData } from '../database/guilds.js';
import { calculateIdleEarnings, calculateIdleEarningsWithData } from '../game/idle.js';
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
  .setName('earnings')
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
 * Format rate per second with decimals
 */
function formatRate(perHour) {
  const perSecond = perHour / 3600;
  if (perSecond >= 1) {
    return `${perSecond.toFixed(1)}/s`;
  } else {
    return `${perSecond.toFixed(2)}/s`;
  }
}

/**
 * Build the watch embed
 */
function buildWatchEmbed(guildName, bankedGold, bankedXp, uncollectedGold, uncollectedXp, deltaGold, deltaXp, goldPerHour, xpPerHour, adventurerCount, elapsedMs, collectionDetected) {
  const totalGold = bankedGold + uncollectedGold;
  const totalXp = bankedXp + uncollectedXp;
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`LIVE EARNINGS - ${guildName}`)
    .setDescription(collectionDetected ? '*Collection detected - tracking from new baseline*' : null)
    .addFields(
      {
        name: 'Gold',
        value: [
          `Banked: **${formatNumber(bankedGold)}**`,
          `Uncollected: **${formatNumber(uncollectedGold)}** (+${formatNumber(deltaGold)})`,
          `Total: **${formatNumber(totalGold)}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'XP',
        value: [
          `Banked: **${formatNumber(bankedXp)}**`,
          `Uncollected: **${formatNumber(uncollectedXp)}** (+${formatNumber(deltaXp)})`,
          `Total: **${formatNumber(totalXp)}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Rate',
        value: [
          `Gold: **${formatRate(goldPerHour)}**`,
          `XP: **${formatRate(xpPerHour)}**`,
          `Adventurers: **${formatNumber(adventurerCount)}**`,
        ].join('\n'),
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
  
  // Get guild data with upgrades (combined query)
  const { guild, upgrades, prestigeUpgrades } = await getGuildWithData(userId);
  if (!guild) {
    return interaction.reply({
      embeds: [createErrorEmbed('You don\'t have a guild yet! Use `/start` to found one.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  
  // Calculate initial idle earnings using pre-loaded data
  const initialEarnings = calculateIdleEarningsWithData(guild, upgrades, prestigeUpgrades);
  
  // Store baseline values
  const baseline = {
    uncollectedGold: initialEarnings.goldEarned,
    uncollectedXp: initialEarnings.xpEarned,
    bankedGold: Number(guild.gold),
    bankedXp: Number(guild.xp),
  };
  
  // Build initial embed
  const embed = buildWatchEmbed(
    guild.name,
    baseline.bankedGold,
    baseline.bankedXp,
    baseline.uncollectedGold,
    baseline.uncollectedXp,
    0, // delta gold
    0, // delta xp
    initialEarnings.rates.goldPerHour,
    initialEarnings.rates.xpPerHour,
    guild.adventurer_count,
    0, // elapsed time
    false // collection detected
  );
  
  const row = buildStopButton(userId);
  
  // Send initial reply
  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  const reply = await interaction.fetchReply();
  
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
        
        const finalEmbed = buildWatchEmbed(
          finalGuild.name,
          Number(finalGuild.gold),
          Number(finalGuild.xp),
          finalUncollectedGold,
          finalUncollectedXp,
          finalDeltaGold,
          finalDeltaXp,
          finalEarnings.rates.goldPerHour,
          finalEarnings.rates.xpPerHour,
          finalGuild.adventurer_count,
          elapsedMs,
          false
        );
        finalEmbed.setTitle(`WATCH ENDED - ${finalGuild.name}`);
        finalEmbed.setColor(COLORS.WARNING);
        
        // Get the watcher to access the interaction
        const watcher = activeWatchers.get(userId);
        if (watcher) {
          try {
            await watcher.interaction.editReply({
              embeds: [finalEmbed],
              components: [], // Remove button
            });
          } catch (e) {
            // Interaction might be expired, ignore
          }
        }
        return;
      }
      
      // Get current guild data with upgrades (combined query for better performance)
      const currentData = await getGuildWithData(userId);
      const currentGuild = currentData.guild;
      if (!currentGuild) {
        stopWatcher(userId);
        return;
      }
      
      const currentEarnings = calculateIdleEarningsWithData(currentGuild, currentData.upgrades, currentData.prestigeUpgrades);
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
      
      // Build updated embed
      const updatedEmbed = buildWatchEmbed(
        currentGuild.name,
        currentBankedGold,
        currentBankedXp,
        currentUncollectedGold,
        currentUncollectedXp,
        deltaGold,
        deltaXp,
        currentEarnings.rates.goldPerHour,
        currentEarnings.rates.xpPerHour,
        currentGuild.adventurer_count,
        elapsedMs,
        collectionDetected
      );
      
      // Clear collection detected flag after showing it once
      if (collectionDetected) {
        collectionDetected = false;
      }
      
      const updatedRow = buildStopButton(userId);
      
      // Get the watcher to access the interaction
      const watcher = activeWatchers.get(userId);
      if (!watcher) return;
      
      // Check if we need to refresh the message (14 minutes since last message)
      if (now - lastMessageTime >= MESSAGE_REFRESH_MS) {
        // Send new followUp (old message will just stay there, can't delete ephemeral)
        try {
          await watcher.interaction.followUp({
            embeds: [updatedEmbed],
            components: [updatedRow],
            flags: MessageFlags.Ephemeral,
          });
          
          lastMessageTime = now;
          watcher.lastMessageTime = now;
          watcher.useFollowUp = true; // Mark that we're now using followUp
        } catch (e) {
          console.log('Failed to send watch followUp:', e.message);
          stopWatcher(userId);
          return;
        }
      } else {
        // Edit the reply using interaction.editReply for ephemeral messages
        try {
          await watcher.interaction.editReply({
            embeds: [updatedEmbed],
            components: [updatedRow],
          });
        } catch (e) {
          // Interaction might have expired, try followUp instead
          if (!watcher.useFollowUp) {
            try {
              await watcher.interaction.followUp({
                embeds: [updatedEmbed],
                components: [updatedRow],
                flags: MessageFlags.Ephemeral,
              });
              watcher.useFollowUp = true;
              lastMessageTime = now;
              watcher.lastMessageTime = now;
            } catch (followUpError) {
              console.log('Failed to edit or followUp watch message:', followUpError.message);
              stopWatcher(userId);
              return;
            }
          } else {
            // Already using followUp and it failed, stop the watcher
            console.log('Watch interaction expired:', e.message);
            stopWatcher(userId);
            return;
          }
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
  
  // Get final guild data with upgrades (combined query)
  const { guild, upgrades, prestigeUpgrades } = await getGuildWithData(targetUserId);
  if (!guild) {
    return interaction.update({
      embeds: [createErrorEmbed('Guild not found.')],
      components: [],
    });
  }
  
  const finalEarnings = calculateIdleEarningsWithData(guild, upgrades, prestigeUpgrades);
  const elapsedMs = Date.now() - watcher.startTime;
  
  const finalUncollectedGold = finalEarnings.goldEarned;
  const finalUncollectedXp = finalEarnings.xpEarned;
  const deltaGold = Math.max(0, finalUncollectedGold - watcher.baseline.uncollectedGold);
  const deltaXp = Math.max(0, finalUncollectedXp - watcher.baseline.uncollectedXp);
  
  const finalEmbed = buildWatchEmbed(
    guild.name,
    Number(guild.gold),
    Number(guild.xp),
    finalUncollectedGold,
    finalUncollectedXp,
    deltaGold,
    deltaXp,
    finalEarnings.rates.goldPerHour,
    finalEarnings.rates.xpPerHour,
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
