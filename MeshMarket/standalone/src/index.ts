import type { TwitchChatManager, VTSClient } from "@sarxina/sarxina-tools";
import { Wallet } from "./Wallet.js";
import { AuctionManager, type AuctionResult } from "./Auction.js";
import { TagRenderer } from "./TagRenderer.js";
import { VTSIntegration } from "./VTSIntegration.js";
import { ChannelPointsManager } from "./ChannelPointsManager.js";
import { CommandRouter } from "./CommandRouter.js";
import { currentPrice } from "./PriceCalculator.js";
import type { GameSpeed } from "./types.js";

export interface MeshMarketContext {
    chat: TwitchChatManager;
    vts: VTSClient;
    /** Data directory for the wallet JSON file. The launcher supplies its
     *  own userData path so state persists across sessions. */
    dataDir: string;
    /** Broadcaster's Twitch login (lowercase). Used for broadcaster-only commands. */
    broadcasterLogin: string;
    config?: MeshMarketConfig;
}

export interface MeshMarketConfig {
    speed?: GameSpeed;
    /** Start with price tags visible on the model. Default false. */
    tagsVisibleOnStart?: boolean;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

export function startToy(ctx: MeshMarketContext): ToyHandle {
    const config = ctx.config ?? {};
    const speed: GameSpeed = config.speed ?? "medium";

    const walletPath = `${ctx.dataDir.replace(/\\/g, "/").replace(/\/$/, "")}/mesh-market.json`;
    const wallet = new Wallet(walletPath);
    const auction = new AuctionManager();
    const renderer = new TagRenderer();
    const vtsIntegration = new VTSIntegration(ctx.vts, renderer);
    const channelPoints = new ChannelPointsManager(ctx.chat, wallet, ctx.chat.say.bind(ctx.chat));
    void channelPoints.init();

    // --- Cached mesh list ---
    let meshList: string[] = [];
    const refreshMeshes = async (): Promise<void> => {
        try {
            meshList = await vtsIntegration.listMeshes();
        } catch (err) {
            console.error("  MeshMarket: failed to list meshes:", err);
        }
    };
    void refreshMeshes();

    // --- Tag visibility ---
    let tagsVisible = config.tagsVisibleOnStart ?? false;
    const renderAllTags = async (): Promise<void> => {
        const now = Date.now();
        for (const meshID of meshList) {
            const state = wallet.getMesh(meshID);
            const price = currentPrice(state, now, speed);
            try {
                await vtsIntegration.pinTag(meshID, state?.owner ?? null, price);
            } catch (err) {
                console.error(`  MeshMarket: pin failed for ${meshID}:`, err);
            }
        }
    };
    const toggleTags = async (on: boolean): Promise<void> => {
        tagsVisible = on;
        if (on) {
            await refreshMeshes();
            await renderAllTags();
        } else {
            await vtsIntegration.unpinAll();
        }
    };
    if (tagsVisible) void (async () => { await refreshMeshes(); await renderAllTags(); })();

    // --- Auction resolution: settle funds + update mesh + refresh that tag ---
    auction.onResolve((result: AuctionResult) => {
        void settleAuction(result);
    });

    const settleAuction = async (result: AuctionResult): Promise<void> => {
        const { meshID, winner, losers } = result;
        const now = Date.now();

        // Refund losers (each was debited reservedAmount when they bid)
        for (const loser of losers) {
            wallet.credit(loser.bidder, loser.reservedAmount);
        }

        const previousState = wallet.getMesh(meshID);
        const previousOwner = previousState?.owner ?? null;

        // Winning bid payout
        if (previousOwner && previousOwner !== winner.bidder) {
            // Full bid to previous owner
            wallet.credit(previousOwner, winner.amount);
        }
        // else: no previous owner (first buy) OR owner retained (self-upgrade).
        // In both cases the winner's reservedAmount goes to the sink — we simply
        // don't credit it back anywhere. Drain works as designed.

        // Winner becomes owner at their bid price (fresh clock)
        wallet.setOwner(meshID, winner.bidder, winner.amount, now);

        // Announce
        const sayFn = ctx.chat.say.bind(ctx.chat);
        if (previousOwner && previousOwner !== winner.bidder) {
            void sayFn(
                `AUCTION: @${winner.bidder} won ${meshID} for ${winner.amount} MB! @${previousOwner} receives ${winner.amount} MB.`
            );
        } else if (previousOwner === winner.bidder) {
            void sayFn(
                `AUCTION: @${winner.bidder} retained ${meshID} (now ${winner.amount} MB).`
            );
        } else {
            void sayFn(
                `AUCTION: @${winner.bidder} claimed ${meshID} for ${winner.amount} MB!`
            );
        }

        // Refresh the tag for this mesh if tags are visible
        if (tagsVisible) {
            const price = currentPrice(wallet.getMesh(meshID), now, speed);
            try {
                await vtsIntegration.pinTag(meshID, winner.bidder, price);
            } catch (err) {
                console.error(`  MeshMarket: tag refresh failed for ${meshID}:`, err);
            }
        }
    };

    // --- Command router ---
    new CommandRouter({
        chat: ctx.chat,
        wallet,
        auction,
        vts: vtsIntegration,
        broadcasterLogin: ctx.broadcasterLogin,
        speed,
        getMeshes: () => meshList,
        toggleTags,
        getTagsVisible: () => tagsVisible,
    });

    console.log(`  MeshMarket running (speed=${speed}, tags=${tagsVisible ? "on" : "off"})`);

    return {
        stop: async () => {
            // Close any active auctions: refund all bids (including winners — they haven't paid yet)
            const open = auction.closeAll();
            for (const result of open) {
                for (const bid of [...result.losers, result.winner]) {
                    wallet.credit(bid.bidder, bid.reservedAmount);
                }
            }
            await vtsIntegration.unpinAll();
            wallet.flush();
        },
    };
}
