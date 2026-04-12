import type { TwitchChatManager, VTSClient } from "@sarxina/sarxina-tools";
import { ChatCommandManager } from "@sarxina/sarxina-tools";
import { createCanvas } from "canvas";

// --- Rendering config ---

const FONT_SIZE = 13;
const MAX_WIDTH = 500;
const PADDING = 12;
const LINE_SPACING = 1.35;

const TAG_COLOR = "rgb(153, 0, 0)";
const COMMA_COLOR = "rgb(42, 42, 42)";
const BG_COLOR = "rgb(255, 255, 255)";

// --- Public types ---

export interface AO3TaggerContext {
    chat: TwitchChatManager;
    vts: VTSClient;
    config?: AO3TaggerConfig;
}

export interface AO3TaggerConfig {
    /** Chat command that adds/clears tags. Default "!ao3tag". */
    triggerCommand?: string;
    /** Size of the tag overlay in VTS (0-1). Default 0.32. */
    itemSize?: number;
    /** Art mesh name patterns to search for when pinning to the head. */
    pinPatterns?: string[];
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

// --- Implementation ---

export function startToy(ctx: AO3TaggerContext): ToyHandle {
    const config = ctx.config ?? {};
    const triggerCommand = config.triggerCommand ?? "!ao3tag";
    const itemSize = config.itemSize ?? 0.32;
    const pinPatterns = config.pinPatterns ?? ["forehead", "eyebrow", "brow", "nose", "face"];

    const tags: string[] = [];
    let currentItemId: string | null = null;

    const unloadCurrentItem = async (): Promise<void> => {
        if (!currentItemId) return;
        try {
            await ctx.vts.unloadItem(currentItemId);
        } catch {
            // Item may already be gone
        }
        currentItemId = null;
    };

    const displayTags = async (): Promise<void> => {
        if (tags.length === 0) {
            await unloadCurrentItem();
            return;
        }

        const pngBuffer = renderTagImage(tags);
        const b64 = pngBuffer.toString("base64");

        await unloadCurrentItem();

        try {
            currentItemId = await ctx.vts.loadItem({
                fileName: "ao3taggerimg.png",
                customDataBase64: b64,
                positionY: 0.5,
                size: itemSize,
                fadeTime: 0.1,
                order: 25,
            });

            // Pin to head
            const pinMesh = await ctx.vts.findArtMesh(pinPatterns);
            if (pinMesh && currentItemId) {
                await ctx.vts.pinItem(currentItemId, {
                    artMeshID: pinMesh,
                    size: itemSize,
                });
                console.log(`  Pinned to ${pinMesh}`);
            }
        } catch (err) {
            console.error(`  Failed to display tags: ${err instanceof Error ? err.message : err}`);
        }
    };

    const handleSubcommand = async (subcommand: string): Promise<void> => {
        const arg = subcommand.trim();
        const lower = arg.toLowerCase();

        if (lower === "clear" || lower === "off") {
            tags.length = 0;
            await unloadCurrentItem();
            console.log("  Tags cleared.");
            return;
        }

        if (!arg) return;

        tags.push(arg);
        console.log(`  Tags: ${tags.join(", ")}`);
        await displayTags();
    };

    new ChatCommandManager(
        triggerCommand,
        (subcommand, _chatter) => {
            void handleSubcommand(subcommand);
        },
        ctx.chat
    );

    console.log(`  AO3Tagger running — listening for "${triggerCommand}" in Twitch chat`);

    return {
        stop: async () => {
            await unloadCurrentItem();
        },
    };
}

// --- Rendering ---

function renderTagImage(tagList: string[]): Buffer {
    const font = `${FONT_SIZE}px Verdana, sans-serif`;
    const contentWidth = MAX_WIDTH - PADDING * 2;
    const lineHeight = Math.floor(FONT_SIZE * LINE_SPACING);

    // Measure tags
    const measureCanvas = createCanvas(1, 1);
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = font;

    const tagWidths = tagList.map((tag) => measureCtx.measureText(tag).width);
    const commaWidth = measureCtx.measureText(", ").width;

    // Layout: which tags on which line
    const lines: number[][] = [];
    let currentLine: number[] = [];
    let currentX = 0;

    for (let i = 0; i < tagList.length; i++) {
        let needed = tagWidths[i]!;
        if (i > 0 && currentLine.length > 0) {
            needed += commaWidth;
        }

        if (currentX + needed > contentWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = [];
            currentX = 0;
            needed = tagWidths[i]!;
        }

        currentLine.push(i);
        currentX += needed;
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    // Render
    const totalHeight = Math.max(64, PADDING * 2 + lines.length * lineHeight);
    const totalWidth = Math.max(64, MAX_WIDTH);
    const canvas = createCanvas(totalWidth, totalHeight);
    const canvasCtx = canvas.getContext("2d");

    canvasCtx.fillStyle = BG_COLOR;
    canvasCtx.fillRect(0, 0, totalWidth, totalHeight);
    canvasCtx.font = font;
    canvasCtx.textBaseline = "top";

    let y = PADDING;
    for (const line of lines) {
        let x = PADDING;
        for (let li = 0; li < line.length; li++) {
            const tagIdx = line[li]!;
            if (li > 0) {
                canvasCtx.fillStyle = COMMA_COLOR;
                canvasCtx.fillText(", ", x, y);
                x += commaWidth;
            }
            canvasCtx.fillStyle = TAG_COLOR;
            canvasCtx.fillText(tagList[tagIdx]!, x, y);
            x += tagWidths[tagIdx]!;
        }
        y += lineHeight;
    }

    return canvas.toBuffer("image/png");
}
