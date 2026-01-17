import 'dotenv/config';
import { REST, Routes } from 'discord.js';

// Import all commands
import * as startCommand from '../src/commands/start.js';
import * as guildCommand from '../src/commands/guild.js';
import * as collectCommand from '../src/commands/collect.js';
import * as upgradesCommand from '../src/commands/upgrades.js';
import * as buyCommand from '../src/commands/buy.js';
import * as leaderboardCommand from '../src/commands/leaderboard.js';
import * as helpCommand from '../src/commands/help.js';
import * as grindCommand from '../src/commands/grind.js';
import * as notifyCommand from '../src/commands/notify.js';
import * as nerdstatsCommand from '../src/commands/nerdstats.js';
import * as battleCommand from '../src/commands/battle.js';
import * as battlesCommand from '../src/commands/battles.js';
import * as watchCommand from '../src/commands/watch.js';
import * as prestigeCommand from '../src/commands/prestige.js';

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID;

const commands = [
  startCommand,
  guildCommand,
  collectCommand,
  upgradesCommand,
  buyCommand,
  leaderboardCommand,
  helpCommand,
  grindCommand,
  notifyCommand,
  nerdstatsCommand,
  battleCommand,
  battlesCommand,
  watchCommand,
  prestigeCommand,
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function registerCommands() {
  try {
    const commandData = commands.map((cmd) => cmd.data.toJSON());
    
    console.log('Commands to register:');
    commandData.forEach((cmd, i) => {
      console.log(`  ${i + 1}. /${cmd.name} - ${cmd.description}`);
    });
    
    if (DEV_GUILD_ID) {
      console.log(`\nRegistering ${commands.length} guild commands to guild ${DEV_GUILD_ID}...`);
      const result = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID),
        { body: commandData }
      );
      console.log(`\nSuccessfully registered ${result.length} commands!`);
      console.log('Registered:', result.map(c => c.name).join(', '));
    } else {
      console.log('\nNo DEV_GUILD_ID set, registering global commands...');
      const result = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commandData }
      );
      console.log(`\nSuccessfully registered ${result.length} global commands!`);
    }
  } catch (error) {
    console.error('Error registering commands:', error);
    if (error.rawError) {
      console.error('Raw error:', JSON.stringify(error.rawError, null, 2));
    }
  }
}

registerCommands();
