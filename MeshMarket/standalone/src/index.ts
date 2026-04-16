import type { TwitchChatManager, VTSClient } from "@sarxina/sarxina-tools";
import { Wallet } from "./Wallet.js";
import { AuctionManager, type AuctionResult } from "./Auction.js";
import { TagRenderer } from "./TagRenderer.js";
import { VTSIntegration } from "./VTSIntegration.js";
import { ChannelPointsManager } from "./ChannelPointsManager.js";
import { CommandRouter } from "./CommandRouter.js";
import { currentPrice } from "./PriceCalculator.js";
import { buildFallbackCatalog, loadCatalogFromModel, type MeshUnitCatalog } from "./MeshUnitCatalog.js";
import type { GameSpeed } from "./types.js";

export interface MeshMarketContext {
    chat: TwitchChatManager;
    vts: VTSClient;
    /** Data directory for the wallet JSON file. The launcher supplies its
     *  own userData path so state persists across sessions. */
    dataDir: string;
    /** Broadcaster's Twitch login (lowercase). Used for broadcaster-only commands. */
    broadcasterLogin: string;
    /**
     * Absolute path to the directory containing the active Live2D model files
     * (the directory holding the model's `.model3.json`). When supplied,
     * MeshMarket parses the model's part hierarchy and exposes coarse buyable
     * units instead of raw ArtMeshes. When omitted, falls back to one unit per
     * ArtMesh.
     */
    modelDirectory?: string;
    config?: MeshMarketConfig;
}

export interface MeshMarketConfig {
    speed?: GameSpeed;
    /** Start with price tags visible on the model. Default false. */
    tagsVisibleOnStart?: boolean;
    /**
     * Override the granularity level used to build buyable units. When unset,
     * the analyzer's recommended level (closest to 30 units) is used.
     */
    granularityLevel?: number;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

export async function startToy(ctx: MeshMarketContext): Promise<ToyHandle> {
    const config = ctx.config ?? {};
    const speed: GameSpeed = config.speed ?? "medium";

    const walletPath = `${ctx.dataDir.replace(/\\/g, "/").replace(/\/$/, "")}/mesh-market.json`;
    const wallet = new Wallet(walletPath);
    const auction = new AuctionManager();
    const renderer = new TagRenderer();
    const vtsIntegration = new VTSIntegration(ctx.vts, renderer);
    const channelPoints = new ChannelPointsManager(ctx.chat, wallet, ctx.chat.say.bind(ctx.chat));
    void channelPoints.init();

    // --- Build the unit catalog ---
    const catalog = await buildCatalog(ctx, vtsIntegration, config.granularityLevel);
    if (catalog.granularityLevel !== null) {
        console.log(
            `  MeshMarket: ${catalog.units.length} buyable units at granularity level ${catalog.granularityLevel} (covering ${catalog.meshCount} ArtMeshes).`,
        );
    } else {
        console.log(
            `  MeshMarket: no model directory available — falling back to ${catalog.units.length} individual ArtMeshes.`,
        );
    }

    // --- Tag visibility ---
    let tagsVisible = config.tagsVisibleOnStart ?? false;
    const renderAllTags = async (): Promise<void> => {
        const now = Date.now();
        for (const unit of catalog.units) {
            const state = wallet.getMesh(unit.id);
            const price = currentPrice(state, now, speed);
            const anchor = unit.meshIds[0];
            if (!anchor) continue;
            try {
                await vtsIntegration.pinTag(unit.id, anchor, state?.owner ?? null, price);
            } catch (err) {
                console.error(`  MeshMarket: pin failed for ${unit.id}:`, err);
            }
        }
    };
    const toggleTags = async (on: boolean): Promise<void> => {
        tagsVisible = on;
        if (on) await renderAllTags();
        else await vtsIntegration.unpinAll();
    };
    if (tagsVisible) void renderAllTags();

    // --- Auction resolution: settle funds + update unit + refresh that tag ---
    auction.onResolve((result: AuctionResult) => {
        void settleAuction(result);
    });

    const settleAuction = async (result: AuctionResult): Promise<void> => {
        const { meshID: unitID, winner, losers } = result;
        const now = Date.now();

        for (const loser of losers) {
            wallet.credit(loser.bidder, loser.reservedAmount);
        }

        const previousState = wallet.getMesh(unitID);
        const previousOwner = previousState?.owner ?? null;

        if (previousOwner && previousOwner !== winner.bidder) {
            wallet.credit(previousOwner, winner.amount);
        }

        wallet.setOwner(unitID, winner.bidder, winner.amount, now);

        const sayFn = ctx.chat.say.bind(ctx.chat);
        if (previousOwner && previousOwner !== winner.bidder) {
            void sayFn(
                `AUCTION: @${winner.bidder} won ${unitID} for ${winner.amount} MB! @${previousOwner} receives ${winner.amount} MB.`,
            );
        } else if (previousOwner === winner.bidder) {
            void sayFn(
                `AUCTION: @${winner.bidder} retained ${unitID} (now ${winner.amount} MB).`,
            );
        } else {
            void sayFn(
                `AUCTION: @${winner.bidder} claimed ${unitID} for ${winner.amount} MB!`,
            );
        }

        if (tagsVisible) {
            const unit = catalog.findUnit(unitID);
            const anchor = unit?.meshIds[0];
            if (anchor) {
                const price = currentPrice(wallet.getMesh(unitID), now, speed);
                try {
                    await vtsIntegration.pinTag(unitID, anchor, winner.bidder, price);
                } catch (err) {
                    console.error(`  MeshMarket: tag refresh failed for ${unitID}:`, err);
                }
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
        getUnits: () => catalog.units,
        toggleTags,
        getTagsVisible: () => tagsVisible,
    });

    console.log(`  MeshMarket running (speed=${speed}, tags=${tagsVisible ? "on" : "off"})`);

    return {
        stop: async () => {
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

async function buildCatalog(
    ctx: MeshMarketContext,
    vtsIntegration: VTSIntegration,
    granularityLevel: number | undefined,
): Promise<MeshUnitCatalog> {
    if (ctx.modelDirectory) {
        try {
            return await loadCatalogFromModel(ctx.modelDirectory, granularityLevel);
        } catch (err) {
            console.error(
                `  MeshMarket: failed to load mesh hierarchy from ${ctx.modelDirectory}:`,
                err,
            );
        }
    }
    let meshes: string[] = [];
    try {
        meshes = await vtsIntegration.listMeshes();
    } catch (err) {
        console.error("  MeshMarket: failed to list meshes from VTS:", err);
    }
    return buildFallbackCatalog(meshes);
}
