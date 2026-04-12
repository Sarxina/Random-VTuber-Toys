import type { VTSClient } from "@sarxina/sarxina-tools";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default asset paths. At runtime, __dirname resolves to either src/ (during
// dev with tsx) or dist/ (after tsc build) — both are one level below the
// standalone root, so ../assets/ works in both cases.
const DEFAULT_GIF_PATH = join(__dirname, "..", "assets", "jumpscare.gif");
const DEFAULT_WAV_PATH = join(__dirname, "..", "assets", "jumpscare.wav");

// --- Public types ---

export interface FoxyJumpscareContext {
    vts: VTSClient;
    config?: FoxyJumpscareConfig;
}

export interface FoxyJumpscareConfig {
    /** Path to the gif file shown during a jumpscare. Defaults to the bundled asset. */
    gifPath?: string;
    /** Path to the wav file played during a jumpscare. Defaults to the bundled asset. */
    wavPath?: string;
    /** 1 in N chance of a jumpscare firing per tick. Default 10000. */
    chanceDenominator?: number;
    /** How often to roll, in milliseconds. Default 1000. */
    tickIntervalMs?: number;
    /** Size of the jumpscare item in VTS (0-1, where 1 is fullscreen-ish). Default 0.5. */
    itemSize?: number;
    /** How long to display the jumpscare in milliseconds. Default 1200. */
    itemDurationMs?: number;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

// --- Implementation ---

export function startToy(ctx: FoxyJumpscareContext): ToyHandle {
    const config = ctx.config ?? {};
    const gifPath = config.gifPath ?? DEFAULT_GIF_PATH;
    const wavPath = config.wavPath ?? DEFAULT_WAV_PATH;
    const chanceDenominator = config.chanceDenominator ?? 10000;
    const tickIntervalMs = config.tickIntervalMs ?? 1000;
    const itemSize = config.itemSize ?? 0.5;
    const itemDurationMs = config.itemDurationMs ?? 1200;

    if (!existsSync(gifPath)) {
        throw new Error(`FoxyJumpscare: gif not found at ${gifPath}`);
    }

    const gifBase64 = readFileSync(gifPath).toString("base64");
    console.log(`  Loaded jumpscare gif (${Math.floor(gifBase64.length / 1024)} KB)`);

    let running = true;
    let currentTimeout: ReturnType<typeof setTimeout> | null = null;

    const triggerJumpscare = async (): Promise<void> => {
        playSound(wavPath);
        try {
            const instanceID = await ctx.vts.loadItem({
                fileName: "foxyjumpscare.gif",
                customDataBase64: gifBase64,
                size: itemSize,
                order: 30,
                locked: true,
                fadeTime: 0,
            });
            await sleep(itemDurationMs);
            await ctx.vts.unloadItem(instanceID);
        } catch (err) {
            console.error(`  Failed to show jumpscare: ${err instanceof Error ? err.message : err}`);
        }
    };

    // Random roll loop — silent, no per-tick output
    const scheduleNextTick = (): void => {
        if (!running) return;
        currentTimeout = setTimeout(() => {
            if (!running) return;
            const roll = Math.floor(Math.random() * chanceDenominator) + 1;
            if (roll === 1) {
                console.log("  *** IT'S ME ***");
                void triggerJumpscare();
            }
            scheduleNextTick();
        }, tickIntervalMs);
    };

    console.log(`  FoxyJumpscare running (1/${chanceDenominator} chance every ${tickIntervalMs / 1000}s)`);
    scheduleNextTick();

    return {
        stop: async () => {
            running = false;
            if (currentTimeout) {
                clearTimeout(currentTimeout);
                currentTimeout = null;
            }
        },
    };
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function playSound(wavPath: string): void {
    if (!existsSync(wavPath)) return;

    if (process.platform === "win32") {
        exec(`powershell -c "(New-Object Media.SoundPlayer '${wavPath}').PlaySync()"`);
    } else if (process.platform === "darwin") {
        exec(`afplay "${wavPath}"`);
    } else {
        exec(`ffplay -nodisp -autoexit -loglevel quiet "${wavPath}"`);
    }
}
