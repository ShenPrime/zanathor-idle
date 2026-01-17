import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID;

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function clearCommands() {
  try {
    console.log('Clearing all guild commands...');
    
    // Clear guild commands
    if (DEV_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID),
        { body: [] }
      );
      console.log('Guild commands cleared!');
    }
    
    // Also clear global commands just in case
    console.log('Clearing all global commands...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );
    console.log('Global commands cleared!');
    
    console.log('\nAll commands cleared. Restart the bot to re-register them.');
  } catch (error) {
    console.error('Error clearing commands:', error);
  }
}

clearCommands();
