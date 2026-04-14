export type GameSpeed = "fast" | "medium" | "slow";

export interface MeshState {
    /** Twitch login (lowercase). Null if mesh has never been bought. */
    owner: string | null;
    /** The price the current owner paid — used as the decay starting point. */
    buyPrice: number;
    /** Epoch ms of the last purchase. */
    boughtAtMs: number;
}

export interface WalletState {
    schemaVersion: 1;
    /** Twitch login -> MeshBucks balance. */
    balances: Record<string, number>;
    /** VTS artMeshID -> state. Absent entry = unowned & never bought. */
    meshes: Record<string, MeshState>;
}
