import type { GameSpeed, MeshState } from "./types.js";
import { DECAY_PER_MINUTE, INITIAL_MESH_PRICE, PRICE_FLOOR } from "./config.js";

/**
 * Linear decay from buyPrice at rate D per minute, floored.
 *
 * For never-bought meshes we return INITIAL_MESH_PRICE with no decay — the
 * sticker price stays put until someone actually claims it.
 */
export function currentPrice(mesh: MeshState | null, nowMs: number, speed: GameSpeed): number {
    if (!mesh) return INITIAL_MESH_PRICE;
    const minutes = Math.max(0, (nowMs - mesh.boughtAtMs) / 60_000);
    const decayed = mesh.buyPrice - DECAY_PER_MINUTE[speed] * minutes;
    return Math.max(PRICE_FLOOR, Math.round(decayed));
}
