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
import type { ToyControl, ToyControlSchema } from "./controlSchema.js";

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
    /** Slider position 0..2 → slow/medium/fast. */
    speedLevel?: number;
    /** Start with price tags visible on the model. Default true. */
    tagsVisibleOnStart?: boolean;
    /**
     * Override the granularity level used to build buyable units. When unset,
     * the analyzer's recommended level (closest to 30 units) is used.
     */
    granularityLevel?: number;
}

const SPEED_BY_LEVEL: readonly GameSpeed[] = ["slow", "medium", "fast"];
function levelToSpeed(level: number | undefined): GameSpeed {
    if (typeof level !== "number") return "medium";
    return SPEED_BY_LEVEL[level] ?? "medium";
}

export interface ToyHandle {
    stop: () => Promise<void>;
    onConfigChange?: (config: Record<string, unknown>) => Promise<void>;
}

export async function startToy(ctx: MeshMarketContext): Promise<ToyHandle> {
    const config = ctx.config ?? {};
    let speed: GameSpeed = levelToSpeed(config.speedLevel);

    const walletPath = `${ctx.dataDir.replace(/\\/g, "/").replace(/\/$/, "")}/mesh-market.json`;
    const wallet = new Wallet(walletPath);
    const auction = new AuctionManager();
    const renderer = new TagRenderer();
    const vtsIntegration = new VTSIntegration(ctx.vts, renderer);
    const channelPoints = new ChannelPointsManager(ctx.chat, wallet, ctx.chat.say.bind(ctx.chat));
    void channelPoints.init();

    // Mutable state: catalog + speed both swap live via onConfigChange.
    let catalog: MeshUnitCatalog = await buildCatalog(
        ctx,
        vtsIntegration,
        (config as MeshMarketConfig).granularityLevel,
    );
    logCatalog(catalog);

    let tagsVisible = config.tagsVisibleOnStart ?? true;
    const renderAllTags = async (): Promise<void> => {
        const now = Date.now();
        for (const unit of catalog.units) {
            const state = wallet.getMesh(unit.id);
            // Only render tags for owned units. Unowned units = no tag.
            if (!state?.owner) {
                await vtsIntegration.unpinTag(unit.id);
                continue;
            }
            const price = currentPrice(state, now, speed);
            const anchor = unit.meshIds[0];
            if (!anchor) continue;
            try {
                await vtsIntegration.pinTag(unit.id, anchor, state.owner, price);
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

    new CommandRouter({
        chat: ctx.chat,
        wallet,
        auction,
        vts: vtsIntegration,
        broadcasterLogin: ctx.broadcasterLogin,
        getSpeed: () => speed,
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
        onConfigChange: async (next) => {
            const nextSpeed = levelToSpeed(next["speedLevel"] as number | undefined);
            if (nextSpeed !== speed) {
                speed = nextSpeed;
                console.log(`  MeshMarket: speed changed to ${speed}`);
                if (tagsVisible) await renderAllTags();
            }

            const nextLevel = next["granularityLevel"] as number | undefined;
            if (
                ctx.modelDirectory &&
                typeof nextLevel === "number" &&
                nextLevel !== catalog.granularityLevel
            ) {
                let newCatalog: MeshUnitCatalog;
                try {
                    newCatalog = await loadCatalogFromModel(ctx.modelDirectory, nextLevel);
                } catch (err) {
                    console.error("  MeshMarket: granularity reload failed:", err);
                    return;
                }
                if (tagsVisible) {
                    const newIds = new Set(newCatalog.units.map((u) => u.id));
                    for (const unit of catalog.units) {
                        if (!newIds.has(unit.id)) {
                            await vtsIntegration.unpinTag(unit.id);
                        }
                    }
                }
                catalog = newCatalog;
                logCatalog(catalog);
                if (tagsVisible) await renderAllTags();
            }
        },
    };
}

/**
 * Toy-control schema MeshMarket exposes to the launcher. The granularity
 * options are computed live from the active model so the streamer can see
 * how many buyable parts each level produces before picking one.
 */
export async function getControlSchema(ctx: MeshMarketContext): Promise<ToyControlSchema> {
    const controls: ToyControl[] = [
        {
            id: "speedLevel",
            type: "slider",
            label: "Game speed",
            description: "How quickly mesh prices decay between purchases.",
            min: 0,
            max: 2,
            step: 1,
            default: 1,
            valueLabels: { 0: "Slow", 1: "Medium", 2: "Fast" },
        },
        {
            id: "tagsVisibleOnStart",
            type: "toggle",
            label: "Show price tags on start",
            description: "Pin price tags to your model when Mesh Market starts. Chat can still toggle with !meshmarket show/hide.",
            default: true,
        },
    ];

    if (ctx.modelDirectory) {
        try {
            const catalog = await loadCatalogFromModel(ctx.modelDirectory);
            if (catalog.granularityLevels && catalog.granularityLevels.size > 0) {
                const levels = [...catalog.granularityLevels.entries()];
                const valueLabels: Record<number, string> = {};
                for (const [level, count] of levels) {
                    valueLabels[level] = `Level ${level} — ${count} buyable parts`;
                }
                const min = Math.min(...levels.map(([lv]) => lv));
                const max = Math.max(...levels.map(([lv]) => lv));
                controls.push({
                    id: "granularityLevel",
                    type: "slider",
                    label: "Mesh granularity",
                    description:
                        "Coarser = fewer, broader buyable parts. Finer = more, smaller pieces. Lowering granularity hides parts but keeps existing ownership.",
                    min,
                    max,
                    step: 1,
                    default: catalog.granularityLevel ?? min,
                    valueLabels,
                });
            }
        } catch (err) {
            console.error("  MeshMarket: schema load failed:", err);
        }
    }

    return controls;
}

function logCatalog(catalog: MeshUnitCatalog): void {
    if (catalog.granularityLevel !== null) {
        console.log(
            `  MeshMarket: ${catalog.units.length} buyable units at granularity level ${catalog.granularityLevel} (covering ${catalog.meshCount} ArtMeshes).`,
        );
    } else {
        console.log(
            `  MeshMarket: no model directory available — falling back to ${catalog.units.length} individual ArtMeshes.`,
        );
    }
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
