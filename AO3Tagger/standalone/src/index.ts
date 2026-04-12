import type { TwitchChatManager, VTSClient, ClickPinResult } from "@sarxina/sarxina-tools";
import { ChatCommandManager } from "@sarxina/sarxina-tools";
import { createCanvas } from "@napi-rs/canvas";

// --- Rendering config (matched to Streamer.bot version) ---

const FONT_SIZE = 13;
const MAX_WIDTH = 500;
const PADDING_H = 12;
const PADDING_V = 4;
const LINE_SPACING = 1.35;

const TAG_COLOR = "rgb(153, 0, 0)";
const COMMA_COLOR = "rgb(42, 42, 42)";
const BG_COLOR = "rgb(255, 255, 255)";

// --- Public types ---

export interface AO3TaggerContext {
    chat: TwitchChatManager;
    vts: VTSClient;
    /** Exact pin coordinates from a user click. If provided, tags are pinned
     *  to this exact spot. If not, tags are loaded without pinning. */
    foreheadPin?: ClickPinResult;
    config?: AO3TaggerConfig;
}

export interface AO3TaggerConfig {
    /** Chat command that adds/clears tags. Default "!ao3tag". */
    triggerCommand?: string;
    /** Size of the tag overlay in VTS (0-1). Default 0.42. */
    itemSize?: number;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

// --- Implementation ---

export function startToy(ctx: AO3TaggerContext): ToyHandle {
    const config = ctx.config ?? {};
    const triggerCommand = config.triggerCommand ?? "!ao3tag";
    const itemSize = config.itemSize ?? 0.42;

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
                positionX: 0,
                positionY: 0.7,
                size: itemSize,
                fadeTime: 0.1,
                order: 25,
                customDataAskUserFirst: false,
                customDataSkipAskingUserIfWhitelisted: true,
            });

            // Pin to the exact forehead position if we have it
            if (ctx.foreheadPin && currentItemId) {
                await ctx.vts.pinItemExact(currentItemId, ctx.foreheadPin, {
                    size: itemSize,
                });
                console.log(`  Pinned to ${ctx.foreheadPin.artMeshID}`);
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

// --- Rendering (matched to Streamer.bot C# version) ---

function renderTagImage(tagList: string[]): Buffer {
    const font = `${FONT_SIZE}px Verdana, sans-serif`;
    const contentWidth = MAX_WIDTH - PADDING_H * 2;
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

    // Calculate actual content width (tight fit, not fixed MAX_WIDTH)
    let maxLineWidth = 0;
    for (const line of lines) {
        let lineWidth = 0;
        for (let li = 0; li < line.length; li++) {
            if (li > 0) lineWidth += commaWidth;
            lineWidth += tagWidths[line[li]!]!;
        }
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
    }

    // Image dimensions: tight to content, but VTS requires at least 64x64
    const textHeight = PADDING_V * 2 + lines.length * lineHeight;
    const textWidth = Math.ceil(PADDING_H * 2 + maxLineWidth + 2);
    const totalHeight = Math.max(64, textHeight);
    const totalWidth = Math.max(64, textWidth);

    const canvas = createCanvas(totalWidth, totalHeight);
    const canvasCtx = canvas.getContext("2d");

    // Transparent background, white fill only for the text area
    canvasCtx.clearRect(0, 0, totalWidth, totalHeight);
    canvasCtx.fillStyle = BG_COLOR;
    canvasCtx.fillRect(0, 0, textWidth, textHeight);

    canvasCtx.font = font;
    canvasCtx.textBaseline = "top";

    let y = PADDING_V;
    for (const line of lines) {
        let x = PADDING_H;
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
