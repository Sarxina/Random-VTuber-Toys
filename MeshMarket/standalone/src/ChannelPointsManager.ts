import { RedeemCommandManager, type TwitchChatManager } from "@sarxina/sarxina-tools";
import { REWARD_TITLES } from "./config.js";
import type { Wallet } from "./Wallet.js";

interface HelixReward {
    id: string;
    title: string;
    cost: number;
}

/**
 * On startup:
 *   1. Check which of our three rewards already exist on the channel (Helix API).
 *   2. Create any that are missing.
 *   3. Subscribe via RedeemCommandManager to credit the user on each redemption.
 *
 * Fails gracefully if the broadcaster isn't affiliate (no channel points) or
 * the required scope is missing — logs a warning and skips setup. The toy
 * still works for buying/selling; users just can't top up via channel points.
 */
export class ChannelPointsManager {
    constructor(
        private chat: TwitchChatManager,
        private wallet: Wallet,
        private say: (msg: string) => Promise<void>
    ) {}

    async init(): Promise<void> {
        const clientId = process.env["TWITCH_CLIENT_ID"];
        const accessToken = process.env["TWITCH_ACCESS_TOKEN"];
        const broadcasterId = process.env["TWITCH_BROADCASTER_ID"];

        if (!clientId || !accessToken || !broadcasterId) {
            console.log("  MeshMarket: Twitch env not set — channel point rewards disabled.");
        } else {
            try {
                await this.ensureRewards(clientId, accessToken, broadcasterId);
            } catch (err) {
                console.log(
                    `  MeshMarket: could not auto-create rewards (${err instanceof Error ? err.message : err}). Create them manually in the dashboard with exact titles: ${Object.keys(REWARD_TITLES).join(", ")}`
                );
            }
        }

        // Subscribe regardless — if the streamer created rewards manually we still handle them.
        for (const [title, bucks] of Object.entries(REWARD_TITLES)) {
            new RedeemCommandManager(
                title,
                (chatter) => this.onRedeem(chatter, bucks),
                this.chat
            );
        }
    }

    private onRedeem(chatter: string, bucks: number): void {
        const login = chatter.toLowerCase();
        this.wallet.enroll(login);
        this.wallet.credit(login, bucks);
        void this.say(`@${chatter} +${bucks} MeshBucks (balance: ${this.wallet.balanceOf(login)}).`);
    }

    private async ensureRewards(
        clientId: string,
        accessToken: string,
        broadcasterId: string
    ): Promise<void> {
        const existing = await this.listRewards(clientId, accessToken, broadcasterId);
        const existingTitles = new Set(existing.map((r) => r.title));

        for (const [title, cost] of Object.entries(REWARD_TITLES)) {
            if (existingTitles.has(title)) continue;
            await this.createReward(clientId, accessToken, broadcasterId, title, cost);
            console.log(`  MeshMarket: created channel point reward "${title}" (${cost} points)`);
        }
    }

    private async listRewards(
        clientId: string,
        accessToken: string,
        broadcasterId: string
    ): Promise<HelixReward[]> {
        const resp = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
            {
                headers: {
                    "Client-Id": clientId,
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );
        if (!resp.ok) {
            throw new Error(`list rewards failed: ${resp.status} ${await resp.text()}`);
        }
        const json = (await resp.json()) as { data: HelixReward[] };
        return json.data;
    }

    private async createReward(
        clientId: string,
        accessToken: string,
        broadcasterId: string,
        title: string,
        cost: number
    ): Promise<void> {
        const resp = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
            {
                method: "POST",
                headers: {
                    "Client-Id": clientId,
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ title, cost, is_enabled: true }),
            }
        );
        if (!resp.ok) {
            throw new Error(`create "${title}" failed: ${resp.status} ${await resp.text()}`);
        }
    }
}
