# Zanathor - Adventurer's Guild

An idle game Discord bot where players manage an adventurer's guild. Recruit adventurers, collect gold and XP, purchase upgrades, battle other players, and grow your guild to legendary status!

## Features

### Core Gameplay
- **Idle Income** - Your adventurers automatically generate gold and XP over time
- **Upgrades** - Purchase upgrades across 4 categories to boost your guild
- **Leveling** - Gain XP to level up and unlock new ranks with gold multipliers
- **Grinding** - Manual clicking for active players who want extra gold

### PvP Battle System
- **Battle other players** - Bet gold on the outcome of battles
- **Power-based RNG** - Super gentle weighting based on adventurers, gold, and rank
- **Balanced matchmaking** - Loss caps and consent system for mismatched power levels
- **Counter-attacks** - Quick revenge button after being attacked
- **Battle history** - Track your wins, losses, and lifetime stats

### Notifications
- **Collection reminders** - DM when your earnings are ready to collect
- **Battle notifications** - DM when another player attacks your guild
- **Configurable** - Enable/disable each type independently

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Found your guild or reconfigure settings |
| `/guild` | View your guild's stats and progress |
| `/collect` | Claim gold and XP earned by your adventurers |
| `/grind` | Put in manual labor to earn extra gold |
| `/upgrades [category]` | Browse available upgrades |
| `/buy` | Purchase upgrades with gold |
| `/battle bet:<amount> [user:<@player>] [random:true]` | Battle another player |
| `/battles` | View your recent battle history |
| `/leaderboard [type]` | See the top guilds |
| `/notify type:<type> action:<action>` | Manage notification settings |
| `/nerdstats` | View detailed lifetime statistics |
| `/help` | Learn how to play |

## Adventurer Ranks

Your guild rank increases as you level up, providing gold multipliers:

| Rank | Level | Gold Multiplier |
|------|-------|-----------------|
| Bronze | 1 | 1.0x |
| Iron | 5 | 1.5x |
| Steel | 10 | 2.0x |
| Silver | 20 | 3.0x |
| Gold | 35 | 5.0x |
| Platinum | 50 | 8.0x |
| Diamond | 75 | 12.0x |
| Mythril | 100 | 20.0x |

## Upgrade Categories

### Recruitment
Increase adventurer capacity and passive adventurer generation.
- Job Board, Guild Scouts, Guild Reputation, Recruitment Office, Famous Benefactor

### Equipment
Boost gold generation per adventurer.
- Basic Armory, Iron Forge, Steel Works, Enchanted Arsenal

### Facilities
Improve XP gain and overall bonuses.
- Training Grounds, Tavern, Barracks, Library, Grand Hall

### Missions
Unlock higher-tier passive income.
- Escort Contracts, Monster Bounties, Dungeon Expeditions, Royal Commissions

## Battle System

### Power Calculation
```
power = adventurers + (gold / 1000) + (rankBonus * 10)
```

### Win Chance
Super gentle weighting: 50% base +/- up to 15% based on power difference (clamped to 35%-65%).

### Power Ratio Balancing
| Power Ratio | Battle Type | Loss Cap |
|-------------|-------------|----------|
| < 3x | Auto-battle | Full % losses (5-10% gold, 2-5% XP) |
| 3-5x | Auto-battle | Losses capped at 2x bet |
| > 5x | Consent required | Losses capped at 1x bet |

### Battle Rewards
- **Winner**: Gets their bet back (if attacker) + loser's gold/XP losses
- **Loser**: Loses 5-10% of gold and 2-5% of XP (subject to caps)

## Setup

### Prerequisites
- [Bun](https://bun.sh/) runtime
- PostgreSQL database
- Discord bot token

### Environment Variables

Create a `.env` file in the root directory:

```env
# Discord Bot
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/zanathor

# Development (optional - for instant command updates)
DEV_GUILD_ID=your_dev_server_id
```

### Installation

```bash
# Install dependencies
bun install

# Run database migrations
bun run migrate

# Seed upgrade data
bun run seed

# Start the bot
bun run start

# Or run in development mode (auto-restart on changes)
bun run dev
```

### Database Commands

```bash
# Run migrations
bun run migrate

# Seed/update upgrade data
bun run seed

# Full database reset (WARNING: deletes all data)
bun run db:reset
```

## Project Structure

```
zanathor-idle/
├── src/
│   ├── commands/           # Slash command handlers
│   │   ├── start.js        # Guild creation & onboarding
│   │   ├── guild.js        # View guild stats
│   │   ├── collect.js      # Collect idle earnings
│   │   ├── grind.js        # Manual grinding
│   │   ├── upgrades.js     # Browse upgrades
│   │   ├── buy.js          # Purchase upgrades
│   │   ├── battle.js       # PvP battles
│   │   ├── battles.js      # Battle history
│   │   ├── leaderboard.js  # Rankings
│   │   ├── notify.js       # Notification settings
│   │   ├── nerdstats.js    # Lifetime statistics
│   │   └── help.js         # Help command
│   ├── database/           # Database layer
│   │   ├── connection.js   # PostgreSQL connection
│   │   ├── migrate.js      # Schema migrations
│   │   ├── seed.js         # Upgrade definitions
│   │   ├── reset.js        # Database reset utility
│   │   ├── guilds.js       # Guild CRUD operations
│   │   ├── upgrades.js     # Upgrade queries
│   │   ├── battles.js      # Battle system queries
│   │   └── notifications.js # Notification settings
│   ├── game/               # Game logic
│   │   ├── idle.js         # Idle earnings calculation
│   │   └── leveling.js     # XP and leveling system
│   ├── jobs/               # Background jobs
│   │   └── reminderChecker.js # Collection reminders
│   ├── utils/              # Utilities
│   │   ├── embeds.js       # Discord embed builders
│   │   └── format.js       # Number/time formatting
│   ├── config.js           # Game constants and settings
│   └── index.js            # Bot entry point
├── .env                    # Environment variables (not in git)
├── package.json
└── README.md
```

## Game Constants

Configurable in `src/config.js`:

| Constant | Default | Description |
|----------|---------|-------------|
| `STARTING_GOLD` | 25 | Gold for new guilds |
| `STARTING_ADVENTURERS` | 5 | Starting adventurer count |
| `STARTING_ADVENTURER_CAPACITY` | 10 | Initial capacity |
| `BASE_GOLD_PER_HOUR` | 60 | Gold/hour per adventurer |
| `BASE_XP_PER_HOUR` | 30 | XP/hour per adventurer |
| `MAX_IDLE_HOURS` | 24 | Max offline earnings cap |
| `XP_PER_LEVEL_BASE` | 50 | Base XP for leveling |
| `XP_LEVEL_MULTIPLIER` | 1.35 | XP scaling per level |

## Development

### Adding New Commands

1. Create a new file in `src/commands/`
2. Export `data` (SlashCommandBuilder) and `execute` function
3. Import and add to the `commands` array in `src/index.js`

### Adding New Migrations

1. Add a new migration object to the `migrations` array in `src/database/migrate.js`
2. Run `bun run migrate`

### Testing Battle System

The battle system has cooldowns disabled for development. To re-enable for production, edit `src/database/battles.js`:

```javascript
// Change these from 0 to production values:
const GLOBAL_COOLDOWN_MS = 2 * 60 * 1000;      // 2 minutes
const TARGET_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAILY_BATTLE_LIMIT = 10;
const MINIMUM_BET = 200;
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Discord Library**: [discord.js](https://discord.js.org/) v14
- **Database**: PostgreSQL with [node-postgres](https://node-postgres.com/)
- **Environment**: [dotenv](https://github.com/motdotla/dotenv)

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

*Good luck, Guild Master!*
