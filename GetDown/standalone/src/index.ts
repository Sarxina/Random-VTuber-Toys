import type { TwitchChatManager, VTSClient, ModelParameter } from "@sarxina/sarxina-tools";
import { ChatCommandManager } from "@sarxina/sarxina-tools";

// --- Public types ---

export interface GetDownContext {
    chat: TwitchChatManager;
    vts: VTSClient;
    config?: GetDownConfig;
}

export interface GetDownConfig {
    /** Chat command to toggle on/off. Default "!getdown". */
    triggerCommand?: string;
    /** Frames per second for the animation loop. Default 30. */
    fps?: number;
}

export interface ToyHandle {
    stop: () => Promise<void>;
}

// --- Terminal UI helpers ---

interface ParamValue {
    id: string;
    value: number;
    min: number;
    max: number;
}

function clearScreen(): void {
    process.stdout.write(process.platform === "win32" ? "\x1Bc" : "\x1B[2J\x1B[H");
}

function printHeader(): void {
    console.log("\x1B[1;36m" + "=".repeat(50));
    console.log("  GetDown - Random Movement Generator");
    console.log("=".repeat(50) + "\x1B[0m");
    console.log();
    console.log("  Press \x1B[1;33mCtrl+C\x1B[0m to stop");
    console.log();
}

function printParams(paramValues: ParamValue[], frame: number): void {
    process.stdout.write("\x1B[7;0H");
    process.stdout.write(`  \x1B[1mFrame ${frame}\x1B[0m\n`);
    process.stdout.write(`  ${"─".repeat(46)}\n`);

    for (const pv of paramValues) {
        const { id: name, value: val, max } = pv;

        let color: string;
        if (Math.abs(val) > 50) {
            color = "\x1B[1;31m";
        } else if (Math.abs(val) > 10) {
            color = "\x1B[1;33m";
        } else {
            color = "\x1B[0;37m";
        }

        const barWidth = 20;
        const barCenter = Math.floor(barWidth / 2);
        const norm = Math.max(-1, Math.min(1, val / Math.max(Math.abs(max || 100), 1)));
        let barPos = Math.floor(barCenter + norm * barCenter);
        barPos = Math.max(0, Math.min(barWidth - 1, barPos));

        const bar = Array(barWidth).fill("·") as string[];
        bar[barCenter] = "│";
        bar[barPos] = "█";
        const barStr = bar.join("");

        process.stdout.write(
            `  ${color}${name.padEnd(22)}\x1B[0m [${barStr}] ${color}${val.toFixed(2).padStart(8)}\x1B[0m\n`
        );
    }

    process.stdout.write("\x1B[J");
}

// --- Implementation ---

export function startToy(ctx: GetDownContext): ToyHandle {
    const config = ctx.config ?? {};
    const triggerCommand = config.triggerCommand ?? "!getdown";
    const fps = config.fps ?? 30;
    const frameInterval = 1000 / fps;

    let running = false;
    let animationTimerId: ReturnType<typeof setTimeout> | null = null;

    const runRandomMovements = async (): Promise<void> => {
        let modelParams: ModelParameter[] | null;
        try {
            modelParams = await ctx.vts.getInputParameters();
        } catch {
            console.error("  Could not get model parameters.");
            return;
        }

        if (!modelParams || modelParams.length === 0) {
            console.error("  No model parameters found.");
            return;
        }

        const paramInfo = new Map<string, { min: number; max: number }>();
        for (const p of modelParams) {
            paramInfo.set(p.name, { min: p.min, max: p.max });
        }

        // Find left/right pairs for desync
        const leftRightPairs: [string, string][] = [];
        const seen = new Set<string>();
        for (const name of paramInfo.keys()) {
            const nl = name.toLowerCase();
            if (nl.includes("left")) {
                const rightName = name.replace("Left", "Right").replace("left", "right");
                if (paramInfo.has(rightName) && !seen.has(name)) {
                    leftRightPairs.push([name, rightName]);
                    seen.add(name);
                    seen.add(rightName);
                }
            }
        }

        clearScreen();
        printHeader();

        let frame = 0;
        let elapsed = 0;
        const techniques = ["snap", "oscillate", "sine_stack", "hold_extreme"] as const;

        const tick = (): void => {
            if (!running) return;
            const frameStart = performance.now();
            frame++;

            const paramValues: ParamValue[] = [];

            for (const [name, info] of paramInfo) {
                const { min: lo, max: hi } = info;
                const mid = (lo + hi) / 2;
                let rng = hi - lo;
                if (rng === 0) rng = 1;

                const technique = techniques[Math.floor(Math.random() * techniques.length)]!;
                let val: number;

                switch (technique) {
                    case "snap":
                        val = Math.random() < 0.5 ? lo : hi;
                        break;
                    case "oscillate": {
                        const freq = Math.random() * 32 + 8;
                        val = mid + (rng / 2) * Math.sin(elapsed * freq * 2 * Math.PI);
                        break;
                    }
                    case "sine_stack": {
                        val = mid;
                        for (let i = 0; i < 4; i++) {
                            const freq = Math.random() * 22 + 3;
                            val += (rng / 4) * Math.sin(elapsed * freq + i * 1.7);
                        }
                        val = Math.max(lo, Math.min(hi, val));
                        break;
                    }
                    case "hold_extreme":
                        val = frame % 7 < 3 ? lo : hi;
                        break;
                }

                paramValues.push({ id: name, value: val, min: lo, max: hi });
            }

            // Desync left/right pairs
            for (const [leftName, rightName] of leftRightPairs) {
                const loL = paramInfo.get(leftName)!.min;
                const hiL = paramInfo.get(leftName)!.max;
                const loR = paramInfo.get(rightName)!.min;
                const hiR = paramInfo.get(rightName)!.max;

                const phase = Math.sin(elapsed * (Math.random() * 10 + 5));
                let leftVal: number;
                let rightVal: number;
                if (phase > 0) {
                    leftVal = hiL;
                    rightVal = loR;
                } else {
                    leftVal = loL;
                    rightVal = hiR;
                }

                if (Math.random() < 0.2) {
                    leftVal = rightVal = hiL;
                }

                for (const pv of paramValues) {
                    if (pv.id === leftName) pv.value = leftVal;
                    else if (pv.id === rightName) pv.value = rightVal;
                }
            }

            // Send to VTube Studio (fire-and-forget for performance)
            ctx.vts.injectParameters(
                paramValues.map((pv) => ({ id: pv.id, value: pv.value }))
            );

            printParams(paramValues, frame);

            elapsed += frameInterval / 1000;
            const frameTime = performance.now() - frameStart;
            const sleepTime = Math.max(0, frameInterval - frameTime);
            animationTimerId = setTimeout(tick, sleepTime);
        };

        tick();
    };

    // Chat command to toggle on/off
    new ChatCommandManager(
        triggerCommand,
        (subcommand, chatter) => {
            const arg = subcommand.trim().toLowerCase();
            if (arg === "" || arg === "on") {
                if (!running) {
                    console.log(`\n  ${chatter} started random movement!`);
                    running = true;
                    void runRandomMovements();
                }
            } else if (arg === "off") {
                if (running) {
                    console.log(`\n  ${chatter} stopped random movement.`);
                    running = false;
                    if (animationTimerId) {
                        clearTimeout(animationTimerId);
                        animationTimerId = null;
                    }
                }
            }
        },
        ctx.chat
    );

    console.log(`  GetDown running — listening for "${triggerCommand}" in Twitch chat`);

    return {
        stop: async () => {
            running = false;
            if (animationTimerId) {
                clearTimeout(animationTimerId);
                animationTimerId = null;
            }
        },
    };
}
