import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { MeshState, WalletState } from "./types.js";
import { STARTING_BALANCE } from "./config.js";

/**
 * The Wallet owns all persistent state: per-user balances and per-mesh ownership.
 * Only class that touches disk. All writes are debounced 200ms so rapid-fire
 * auction events don't hammer the FS.
 */
export class Wallet {
    private state: WalletState;
    private writeTimer: NodeJS.Timeout | null = null;

    constructor(private filePath: string) {
        this.state = this.readFromDisk();
    }

    private readFromDisk(): WalletState {
        if (!existsSync(this.filePath)) {
            return { schemaVersion: 1, balances: {}, meshes: {} };
        }
        try {
            const raw = readFileSync(this.filePath, "utf-8");
            return JSON.parse(raw) as WalletState;
        } catch {
            return { schemaVersion: 1, balances: {}, meshes: {} };
        }
    }

    private scheduleSave(): void {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => this.flush(), 200);
    }

    /** Force an immediate synchronous save. Call this on shutdown. */
    flush(): void {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        const dir = path.dirname(this.filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    }

    // --- Balances ---

    /** Auto-enroll a user with STARTING_BALANCE if they're new. */
    enroll(login: string): { newEnrollment: boolean; balance: number } {
        const existing = this.state.balances[login];
        if (existing !== undefined) {
            return { newEnrollment: false, balance: existing };
        }
        this.state.balances[login] = STARTING_BALANCE;
        this.scheduleSave();
        return { newEnrollment: true, balance: STARTING_BALANCE };
    }

    hasAccount(login: string): boolean {
        return this.state.balances[login] !== undefined;
    }

    balanceOf(login: string): number {
        return this.state.balances[login] ?? 0;
    }

    /** Debit. Throws if insufficient. */
    debit(login: string, amount: number): void {
        const current = this.balanceOf(login);
        if (current < amount) {
            throw new Error(`Insufficient balance: has ${current}, needs ${amount}`);
        }
        this.state.balances[login] = current - amount;
        this.scheduleSave();
    }

    credit(login: string, amount: number): void {
        this.state.balances[login] = this.balanceOf(login) + amount;
        this.scheduleSave();
    }

    // --- Meshes ---

    getMesh(meshID: string): MeshState | null {
        return this.state.meshes[meshID] ?? null;
    }

    setOwner(meshID: string, owner: string, buyPrice: number, nowMs: number): void {
        this.state.meshes[meshID] = { owner, buyPrice, boughtAtMs: nowMs };
        this.scheduleSave();
    }

    meshesOwnedBy(login: string): Array<{ meshID: string; state: MeshState }> {
        return Object.entries(this.state.meshes)
            .filter(([, s]) => s.owner === login)
            .map(([meshID, state]) => ({ meshID, state }));
    }

    /** Iterate all known meshes (owned at some point in history). */
    allMeshes(): Array<{ meshID: string; state: MeshState }> {
        return Object.entries(this.state.meshes).map(([meshID, state]) => ({
            meshID,
            state,
        }));
    }
}
