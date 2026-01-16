import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { COLORS } from '../utils/embeds.js';
import { RANKS, GAME } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Learn how to play Zanathor');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('Welcome to Zanathor!')
    .setDescription(
      `**Zanathor** is an idle game where you manage an adventurer's guild. ` +
      `Recruit adventurers, send them on missions, collect gold and XP, and grow your guild to legendary status!`
    )
    .addFields(
      {
        name: 'Getting Started',
        value:
          '`/start` - Found your guild and begin your adventure\n' +
          '`/guild` - View your guild\'s stats and progress\n' +
          '`/collect` - Claim gold and XP earned by your adventurers\n' +
          '`/grind` - Put in manual labor to earn extra gold',
        inline: false,
      },
      {
        name: 'Progression',
        value:
          '`/upgrades [category]` - Browse available upgrades\n' +
          '`/buy <upgrade>` - Purchase upgrades with gold\n' +
          '`/leaderboard [type]` - See the top guilds',
        inline: false,
      },
      {
        name: 'How It Works',
        value:
          'Your adventurers automatically generate **gold** and **XP** over time.\n\n' +
          `**Gold** is used to purchase upgrades that improve your guild.\n` +
          `**XP** increases your guild level, unlocking new upgrades and adventurer ranks.\n\n` +
          `Idle earnings cap at **${GAME.MAX_IDLE_HOURS} hours** - collect regularly for maximum gains!`,
        inline: false,
      },
      {
        name: 'Adventurer Ranks',
        value: RANKS.map(r => `${r.emoji} **${r.name}** (Lv ${r.level}+) - x${r.multiplier} gold`).join('\n'),
        inline: false,
      },
      {
        name: 'Upgrade Categories',
        value:
          '**Recruitment** - Increase adventurer capacity\n' +
          '**Equipment** - Boost gold generation per adventurer\n' +
          '**Facilities** - Improve XP gain and overall bonuses\n' +
          '**Missions** - Unlock higher-tier passive income',
        inline: false,
      }
    )
    .setFooter({ text: 'Good luck, Guild Master!' });

  await interaction.reply({ embeds: [embed] });
}
