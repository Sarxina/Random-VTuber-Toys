import "dotenv/config";
import { VTSClient } from "@sarxina/sarxina-tools";
import { startToy } from "./index.js";

const VTS_URL = process.env["VTS_URL"] ?? "ws://localhost:8001";

console.log(`  Connecting to VTube Studio at ${VTS_URL}...`);
const vts = await VTSClient.connect({
    url: VTS_URL,
    pluginName: "FoxyJumpscare",
    pluginDeveloper: "Sarxina",
});
console.log("  Authenticated with VTube Studio.");

const handle = startToy({ vts });

process.on("SIGINT", async () => {
    console.log("\n  Stopping...");
    await handle.stop();
    vts.disconnect();
    process.exit(0);
});
