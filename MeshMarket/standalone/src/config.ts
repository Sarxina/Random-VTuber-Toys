import type { GameSpeed } from "./types.js";

// --- Currency ---

export const STARTING_BALANCE = 1000;
export const INITIAL_MESH_PRICE = 200;
export const PRICE_FLOOR = 10;

// --- Auction ---

export const BID_WINDOW_MS = 60_000;
/** `!meshmarket buy <mesh>` with no amount defaults to this much over the current ceiling. */
export const DEFAULT_BID_BUMP = 100;

// --- Decay ---
// Linear: price = max(PRICE_FLOOR, buyPrice - D * minutesSinceLastBuy)

export const DECAY_PER_MINUTE: Record<GameSpeed, number> = {
    fast: 6.33,     // 200 -> 10 in 30 min
    medium: 0.688,  // 1000 -> 10 in 24 hrs
    slow: 0.297,    // 3000 -> 10 in 7 days
};

// --- Channel point rewards ---
// Titles must match exactly what's registered in the Twitch dev console.
// The toy creates these via Helix on first run if they don't already exist.

export const REWARD_TITLES: Record<string, number> = {
    "500 MeshBucks": 500,
    "1000 MeshBucks": 1000,
    "3000 MeshBucks": 3000,
};
