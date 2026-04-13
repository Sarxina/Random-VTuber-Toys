import type { TwitchChatManager, VTSClient, ClickPinResult } from "@sarxina/sarxina-tools";
import { ChatCommandManager } from "@sarxina/sarxina-tools";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

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

        const pngBuffer = await renderTagImage(tags);
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

// --- Rendering (SVG → sharp for crisp hinted text via Pango/FreeType) ---

function escapeXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

async function renderTagImage(tagList: string[]): Promise<Buffer> {
    const font = `${FONT_SIZE}px Verdana, sans-serif`;
    const contentWidth = MAX_WIDTH - PADDING_H * 2;
    const lineHeight = Math.floor(FONT_SIZE * LINE_SPACING);

    // Measure with @napi-rs/canvas — only used for layout widths, not rendering.
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

    let maxLineWidth = 0;
    for (const line of lines) {
        let lineWidth = 0;
        for (let li = 0; li < line.length; li++) {
            if (li > 0) lineWidth += commaWidth;
            lineWidth += tagWidths[line[li]!]!;
        }
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
    }

    const textHeight = PADDING_V * 2 + lines.length * lineHeight;
    const textWidth = Math.ceil(PADDING_H * 2 + maxLineWidth + 2);
    const totalHeight = Math.max(64, textHeight);
    const totalWidth = Math.max(64, textWidth);

    // Build SVG. <text> with text-anchor=start, dominant-baseline=text-before-edge
    // approximates canvas's textBaseline="top".
    const tspans: string[] = [];
    let y = PADDING_V;
    for (const line of lines) {
        let x = PADDING_H;
        for (let li = 0; li < line.length; li++) {
            const tagIdx = line[li]!;
            if (li > 0) {
                tspans.push(
                    `<text x="${x}" y="${y}" fill="${COMMA_COLOR}" font-family="Verdana, sans-serif" font-size="${FONT_SIZE}" dominant-baseline="text-before-edge" xml:space="preserve">, </text>`
                );
                x += commaWidth;
            }
            tspans.push(
                `<text x="${x}" y="${y}" fill="${TAG_COLOR}" font-family="Verdana, sans-serif" font-size="${FONT_SIZE}" dominant-baseline="text-before-edge">${escapeXml(tagList[tagIdx]!)}</text>`
            );
            x += tagWidths[tagIdx]!;
        }
        y += lineHeight;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" text-rendering="geometricPrecision">
<rect x="0" y="0" width="${textWidth}" height="${textHeight}" fill="${BG_COLOR}"/>
${tspans.join("\n")}
</svg>`;

    // Render at 3x resolution so Pango has more pixels for hinting, then
    // let sharp's Lanczos3 resizer downsample to target.
    const SS = 3;
    return sharp(Buffer.from(svg), { density: 72 * SS })
        .resize(totalWidth, totalHeight, { kernel: "lanczos3" })
        .png()
        .toBuffer();
}
