import type {
    ActionRegistry,
    ClickPinResult,
    TwitchChatTriggerInput,
    TwitchManager,
    TwitchRewardTriggerInput,
    VTSClient,
} from "@sarxina/sarxina-tools";
import { Action } from "@sarxina/sarxina-tools";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

// --- Toy-control schema for the plugin-manager UI. Defined inline here as
// the simplest path; mirrors plugin-manager's `electron/toyControls.ts`.
// ---

export type AO3TaggerTriggerType = "chat" | "reward";

export interface AO3TaggerControl {
    readonly id: string;
    readonly label: string;
    readonly type: "radio" | "textInput" | "numberInput";
    readonly default: string | number;
    readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    readonly min?: number;
    readonly placeholder?: string;
    readonly showWhen?: { readonly id: string; readonly equals: string | number | boolean };
}

export function getControlSchema(): readonly AO3TaggerControl[] {
    return [
        {
            id: "triggerType",
            type: "radio",
            label: "Trigger Type",
            default: "chat",
            options: [
                { value: "chat", label: "Chat Command" },
                { value: "reward", label: "Channel Points" },
            ],
        },
        {
            id: "triggerCommand",
            type: "textInput",
            label: "Command String",
            default: "!ao3tag",
            placeholder: "!ao3tag",
            showWhen: { id: "triggerType", equals: "chat" },
        },
        {
            id: "rewardTitle",
            type: "textInput",
            label: "Reward Title",
            default: "AO3 Tag",
            placeholder: "AO3 Tag",
            showWhen: { id: "triggerType", equals: "reward" },
        },
        {
            id: "rewardCost",
            type: "numberInput",
            label: "Reward Cost",
            default: 500,
            min: 1,
            showWhen: { id: "triggerType", equals: "reward" },
        },
    ];
}

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
    chat: TwitchManager;
    actionRegistry: ActionRegistry;
    vts: VTSClient;
    /** Exact pin coordinates from a user click. If provided, tags are pinned
     *  to this exact spot. If not, tags are loaded without pinning. */
    foreheadPin?: ClickPinResult;
    config?: AO3TaggerConfig;
}

export interface AO3TaggerConfig {
    /** Chat command vs. channel point redeem. Default "chat". */
    triggerType?: AO3TaggerTriggerType;
    /** Chat command that adds/clears tags. Used when triggerType is "chat". Default "!ao3tag". */
    triggerCommand?: string;
    /** Title of the channel point reward. Used when triggerType is "reward". Default "AO3 Tag". */
    rewardTitle?: string;
    /** Cost of the reward in channel points. Used when triggerType is "reward" and the reward needs to be created. Default 500. */
    rewardCost?: number;
    /** Size of the tag overlay in VTS (0-1). Default 0.42. */
    itemSize?: number;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

// --- Implementation ---

export function startToy(ctx: AO3TaggerContext): ToyHandle {
    const config = ctx.config ?? {};
    const triggerType: AO3TaggerTriggerType = config.triggerType ?? "chat";
    const triggerCommand = config.triggerCommand ?? "!ao3tag";
    const rewardTitle = config.rewardTitle ?? "AO3 Tag";
    const rewardCost = config.rewardCost ?? 500;
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

    // Branch on triggerType. The handler is the same end-state — feed the
    // user's input into handleSubcommand — but the source/filter and how the
    // input is extracted differ between chat and reward.
    let actionName: string;
    let action: Action;
    if (triggerType === "reward") {
        actionName = `ao3tagger-reward-${rewardTitle}`;
        action = new Action(
            actionName,
            [{
                source: { platform: "twitch", kind: "reward" },
                filters: [{ field: "rewardTitle", op: "equals", value: rewardTitle }],
            }],
            // For redeems, the user's input IS the reward's `input` field —
            // no prefix to strip.
            [(firing) => {
                const { input } = firing.input as TwitchRewardTriggerInput;
                void handleSubcommand(input);
            }],
        );
        // Best-effort: create the reward on Twitch if it's missing. Logs but
        // doesn't fail the toy if creation can't happen (e.g. token scope or
        // non-affiliate channel).
        void ensureRewardExists(rewardTitle, rewardCost);
        console.log(`  AO3Tagger running — listening for redeems of "${rewardTitle}"`);
    } else {
        actionName = `ao3tagger-${triggerCommand}`;
        action = new Action(
            actionName,
            [{
                source: { platform: "twitch", kind: "chat" },
                filters: [{ field: "message", op: "startsWithWord", value: triggerCommand }],
            }],
            [(firing) => {
                const { message } = firing.input as TwitchChatTriggerInput;
                const spaceIdx = message.indexOf(" ");
                const subcommand = spaceIdx === -1 ? "" : message.slice(spaceIdx + 1);
                void handleSubcommand(subcommand);
            }],
        );
        console.log(`  AO3Tagger running — listening for "${triggerCommand}" in Twitch chat`);
    }
    ctx.actionRegistry.register(action);

    return {
        stop: async () => {
            ctx.actionRegistry.unregister(actionName);
            await unloadCurrentItem();
        },
    };
}

// --- Helix helper: ensure a custom reward exists ---

interface HelixReward {
    id: string;
    title: string;
    cost: number;
}

/**
 * Look up the broadcaster's custom rewards via Helix. If a reward with the
 * given title already exists, do nothing. Otherwise, create it.
 *
 * Best-effort: logs and returns if env vars are missing, the broadcaster
 * isn't affiliate, or the access token lacks `channel:manage:redemptions`.
 * The toy still works for redeems that the streamer creates manually with
 * the right title.
 */
async function ensureRewardExists(title: string, cost: number): Promise<void> {
    const clientId = process.env["TWITCH_CLIENT_ID"];
    const accessToken = process.env["TWITCH_ACCESS_TOKEN"];
    const broadcasterId = process.env["TWITCH_BROADCASTER_ID"];
    if (!clientId || !accessToken || !broadcasterId) {
        console.log("  AO3Tagger: Twitch env vars missing — skipping reward auto-create.");
        return;
    }
    try {
        const list = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
            {
                headers: {
                    "Client-Id": clientId,
                    Authorization: `Bearer ${accessToken}`,
                },
            },
        );
        if (!list.ok) {
            console.log(
                `  AO3Tagger: could not list rewards (${list.status}). Create one named "${title}" manually.`,
            );
            return;
        }
        const json = (await list.json()) as { data: HelixReward[] };
        if (json.data.some((r) => r.title === title)) {
            return;
        }
        const create = await fetch(
            `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
            {
                method: "POST",
                headers: {
                    "Client-Id": clientId,
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ title, cost, is_enabled: true }),
            },
        );
        if (create.ok) {
            console.log(`  AO3Tagger: created channel point reward "${title}" (${cost} points).`);
        } else {
            console.log(
                `  AO3Tagger: failed to create reward "${title}" (${create.status}). Create it manually.`,
            );
        }
    } catch (err) {
        console.log(
            `  AO3Tagger: reward setup error (${err instanceof Error ? err.message : err}). Create it manually.`,
        );
    }
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
