#!/usr/bin/env node
// Copies FoxyJumpscare/assets/ to FoxyJumpscare/standalone/assets/ so the
// published npm package (and the tsx-run dev workflow) can find the gif
// and wav via a ../assets/ relative path from either src/ or dist/.
// Idempotent — only copies if the source is newer or the dest is missing.

import { cpSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const standaloneDir = join(__dirname, "..");
const srcAssets = join(standaloneDir, "..", "assets");
const destAssets = join(standaloneDir, "assets");

if (!existsSync(srcAssets)) {
    console.error(`No source assets found at ${srcAssets}`);
    process.exit(1);
}

// Only copy if dest is missing or source is newer than dest
let needsCopy = !existsSync(destAssets);
if (!needsCopy) {
    const srcMtime = statSync(srcAssets).mtimeMs;
    const destMtime = statSync(destAssets).mtimeMs;
    needsCopy = srcMtime > destMtime;
}

if (needsCopy) {
    mkdirSync(destAssets, { recursive: true });
    cpSync(srcAssets, destAssets, { recursive: true, force: true });
    console.log(`Copied assets to ${destAssets}`);
} else {
    console.log("Assets already up to date");
}
