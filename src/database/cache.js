import { sql } from './connection.js';

/**
 * In-memory cache for static game data (upgrades, prestige upgrades)
 * This data rarely changes and can be cached at startup to reduce DB queries
 */

// Cache storage
let upgradesCache = null;
let upgradesByIdCache = null;
let upgradesByNameCache = null;
let prestigeUpgradesCache = null;
let prestigeUpgradesByIdCache = null;

/**
 * Initialize all caches - call this once at startup
 */
export async function initializeCache() {
  console.log('Loading static game data into cache...');
  
  await Promise.all([
    loadUpgradesCache(),
    loadPrestigeUpgradesCache(),
  ]);
  
  console.log(`Cached ${upgradesCache.length} upgrades and ${prestigeUpgradesCache.length} prestige upgrades`);
}

/**
 * Load upgrades into cache
 */
async function loadUpgradesCache() {
  const upgrades = await sql`SELECT * FROM upgrades ORDER BY category, required_guild_level, base_cost`;
  
  upgradesCache = upgrades;
  upgradesByIdCache = new Map();
  upgradesByNameCache = new Map();
  
  for (const upgrade of upgrades) {
    upgradesByIdCache.set(upgrade.id, upgrade);
    upgradesByNameCache.set(upgrade.name.toLowerCase(), upgrade);
  }
}

/**
 * Load prestige upgrades into cache
 */
async function loadPrestigeUpgradesCache() {
  const upgrades = await sql`SELECT * FROM prestige_upgrades ORDER BY id`;
  
  prestigeUpgradesCache = upgrades;
  prestigeUpgradesByIdCache = new Map();
  
  for (const upgrade of upgrades) {
    prestigeUpgradesByIdCache.set(upgrade.id, upgrade);
  }
}

/**
 * Get all upgrades (cached)
 * @returns {Array} All upgrades
 */
export function getCachedUpgrades() {
  if (!upgradesCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  return upgradesCache;
}

/**
 * Get upgrade by ID (cached)
 * @param {number} id - Upgrade ID
 * @returns {Object|null} The upgrade or null
 */
export function getCachedUpgradeById(id) {
  if (!upgradesByIdCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  return upgradesByIdCache.get(id) || null;
}

/**
 * Get upgrade by name (cached, case-insensitive)
 * @param {string} name - Upgrade name
 * @returns {Object|null} The upgrade or null
 */
export function getCachedUpgradeByName(name) {
  if (!upgradesByNameCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  return upgradesByNameCache.get(name.toLowerCase()) || null;
}

/**
 * Get multiple upgrades by names (cached)
 * @param {string[]} names - Array of upgrade names
 * @returns {Map<string, Object>} Map of lowercase name -> upgrade
 */
export function getCachedUpgradesByNames(names) {
  if (!upgradesByNameCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  
  const nameArray = Array.isArray(names) ? names : [names];
  const result = new Map();
  
  for (const name of nameArray) {
    const upgrade = upgradesByNameCache.get(name.toLowerCase());
    if (upgrade) {
      result.set(name.toLowerCase(), upgrade);
    }
  }
  
  return result;
}

/**
 * Get all prestige upgrades (cached)
 * @returns {Array} All prestige upgrades
 */
export function getCachedPrestigeUpgrades() {
  if (!prestigeUpgradesCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  return prestigeUpgradesCache;
}

/**
 * Get prestige upgrade by ID (cached)
 * @param {number} id - Prestige upgrade ID
 * @returns {Object|null} The upgrade or null
 */
export function getCachedPrestigeUpgradeById(id) {
  if (!prestigeUpgradesByIdCache) {
    throw new Error('Cache not initialized - call initializeCache() first');
  }
  return prestigeUpgradesByIdCache.get(id) || null;
}
