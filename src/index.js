import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  Events,
  MessageFlags,
} from 'discord.js';
import { BOT_TOKEN, CLIENT_ID, DEV_GUILD_ID } from './config.js';
import { testConnection } from './database/connection.js';

// Import commands
import * as startCommand from './commands/start.js';
import * as guildCommand from './commands/guild.js';
import * as collectCommand from './commands/collect.js';
import * as upgradesCommand from './commands/upgrades.js';
import * as buyCommand from './commands/buy.js';
import * as leaderboardCommand from './commands/leaderboard.js';
import * as helpCommand from './commands/help.js';
import * as grindCommand from './commands/grind.js';
import * as notifyCommand from './commands/notify.js';
import * as nerdstatsCommand from './commands/nerdstats.js';

// Import jobs
import { startReminderChecker, stopReminderChecker } from './jobs/reminderChecker.js';

// Validate environment
if (!BOT_TOKEN) {
  console.error('ERROR: DISCORD_TOKEN is not set in .env file');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('ERROR: DISCORD_CLIENT_ID is not set in .env file');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Set up commands collection
client.commands = new Collection();

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
];

// Register commands in collection
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// Deploy slash commands to Discord
async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

  try {
    const commandData = commands.map((cmd) => cmd.data.toJSON());

    // Use guild commands for instant updates during development
    // Set DEV_GUILD_ID in .env for dev, leave it unset for production (global commands)
    if (DEV_GUILD_ID) {
      console.log(`Registering ${commands.length} guild commands (instant updates)...`);
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID),
        { body: commandData }
      );
      console.log(`Successfully registered ${commands.length} commands to dev guild!`);
    } else {
      console.log(`Registering ${commands.length} global commands (may take up to 1 hour)...`);
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commandData }
      );
      console.log(`Successfully registered ${commands.length} global commands!`);
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`Command not found: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}:`, error);

      const errorMessage = {
        content: 'There was an error executing this command!',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }

  // Handle autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);

    if (!command || !command.autocomplete) {
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Autocomplete error for ${interaction.commandName}:`, error);
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'start_guild_modal') {
      try {
        await startCommand.handleModal(interaction);
      } catch (error) {
        console.error('Error handling start modal:', error);
        
        if (!interaction.replied) {
          await interaction.reply({
            content: 'There was an error creating your guild. Please try again.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }
    
    // Handle buy modal submissions
    if (interaction.customId.startsWith('buy_modal:')) {
      try {
        await buyCommand.handleModal(interaction);
      } catch (error) {
        console.error('Error handling buy modal:', error);
        
        if (!interaction.replied) {
          await interaction.reply({
            content: 'There was an error processing your purchase. Please try again.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }
  }
  
  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('buy_select:')) {
      try {
        await buyCommand.handleSelectMenu(interaction);
      } catch (error) {
        console.error('Error handling buy select menu:', error);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'There was an error with your selection. Please try again.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }
  }
  
  // Handle button interactions
  if (interaction.isButton()) {
    // Buy category buttons
    if (interaction.customId.startsWith('buy_category:')) {
      try {
        await buyCommand.handleCategoryButton(interaction);
      } catch (error) {
        console.error('Error handling buy category button:', error);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.update({
            content: 'There was an error. Please try again.',
            components: [],
          });
        }
      }
    }
    
    // Buy again button
    if (interaction.customId === 'buy_again') {
      try {
        await buyCommand.handleBuyAgain(interaction);
      } catch (error) {
        console.error('Error handling buy again button:', error);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.update({
            content: 'There was an error. Please use /buy to try again.',
            components: [],
          });
        }
      }
    }
  }
});

// Bot ready event
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`\nLogged in as ${readyClient.user.tag}!`);
  console.log(`Bot is in ${readyClient.guilds.cache.size} server(s)`);
  
  // Start the reminder checker
  startReminderChecker(client);
  
  console.log('\nZanathor is ready for adventurers!\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  
  // Stop the reminder checker
  stopReminderChecker();
  
  // Flush all active grind sessions before shutting down
  console.log('Flushing active grind sessions...');
  await grindCommand.flushAllSessions();
  
  client.destroy();
  process.exit(0);
});

// Main startup
async function main() {
  console.log('=================================');
  console.log('    ZANATHOR - Adventurer\'s Guild');
  console.log('=================================\n');

  // Test database connection
  console.log('Connecting to database...');
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('Failed to connect to database. Please check your DATABASE_URL in .env');
    process.exit(1);
  }

  // Deploy commands
  await deployCommands();

  // Login to Discord
  console.log('\nConnecting to Discord...');
  await client.login(BOT_TOKEN);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
