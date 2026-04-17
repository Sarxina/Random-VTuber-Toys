import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { measureText, renderTextImage } from "@sarxina/sarxina-tools";

/**
 * Price tag — text composited onto the vendored `assets/price-tag.png`.
 * Three rows: unit/part name on top, owner in the middle, price on bottom.
 *
 * The body of the tag (everything to the right of the hole) is the safe
 * region for text. Body coordinates are expressed as fractions of the
 * tag image so they survive any future asset swap or resize.
 */

const TAG_WIDTH = 360;
const FONT_FAMILY = "Arial, sans-serif";
const TEXT_COLOR = "#111111";
const OWNER_COLOR = "#444444";
const PRICE_COLOR = "#006b2a";

const BODY_LEFT_FRAC = 0.32;
const BODY_RIGHT_FRAC = 0.96;
const BODY_TOP_FRAC = 0.14;
const BODY_BOTTOM_FRAC = 0.86;

const TAG_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "price-tag.png",
);

let cachedTag: Buffer | null = null;
function loadTagBuffer(): Buffer {
    if (!cachedTag) cachedTag = readFileSync(TAG_PATH);
    return cachedTag;
}

let cachedAspect: number | null = null;
async function getTagAspect(): Promise<number> {
    if (cachedAspect !== null) return cachedAspect;
    const meta = await sharp(loadTagBuffer()).metadata();
    if (!meta.width || !meta.height) throw new Error("price-tag.png has no dimensions");
    cachedAspect = meta.width / meta.height;
    return cachedAspect;
}

/** Strip Live2D rigger conventions and split words so names fit + read better. */
function formatUnitName(unitId: string): string {
    return unitId.replace(/_Folder$/i, "").replace(/_/g, " ").trim();
}

/**
 * Fit text within maxWidth: shrink the font first, then truncate with an
 * ellipsis if even the smallest font overflows. Returns the possibly-truncated
 * text alongside the font size that fits.
 */
function fitLine(
    text: string,
    maxWidth: number,
    maxFontSize: number,
    minFontSize: number,
    family: string,
): { text: string; fontSize: number } {
    for (let size = maxFontSize; size >= minFontSize; size--) {
        if (measureText(text, size, family) <= maxWidth) return { text, fontSize: size };
    }
    let truncated = text;
    while (truncated.length > 1 && measureText(truncated + "…", minFontSize, family) > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return { text: truncated + "…", fontSize: minFontSize };
}

export class TagRenderer {
    async render(unitId: string, ownerLogin: string | null, price: number): Promise<Buffer> {
        const nameText = formatUnitName(unitId);
        const ownerText = ownerLogin ?? "—";
        const priceText = `${price} MB`;

        const aspect = await getTagAspect();
        const tagW = TAG_WIDTH;
        const tagH = Math.round(tagW / aspect);

        const bodyL = tagW * BODY_LEFT_FRAC;
        const bodyR = tagW * BODY_RIGHT_FRAC;
        const bodyT = tagH * BODY_TOP_FRAC;
        const bodyB = tagH * BODY_BOTTOM_FRAC;
        const bodyW = bodyR - bodyL;
        const bodyH = bodyB - bodyT;

        // Base font sizes as fractions of body height. Unit name auto-shrinks
        // to fit width (long part IDs shouldn't explode the layout).
        const nameMaxFont = Math.round(bodyH * 0.24);
        const ownerFont = Math.round(bodyH * 0.20);
        const priceFont = Math.round(bodyH * 0.32);
        const rowGap = Math.round(bodyH * 0.03);

        const fittedName = fitLine(nameText, bodyW, nameMaxFont, Math.round(nameMaxFont * 0.5), FONT_FAMILY);
        const displayName = fittedName.text;
        const nameFont = fittedName.fontSize;

        const nameW = measureText(displayName, nameFont, FONT_FAMILY);
        const ownerW = measureText(ownerText, ownerFont, FONT_FAMILY);
        const priceW = measureText(priceText, priceFont, FONT_FAMILY);

        const nameX = bodyL + (bodyW - nameW) / 2;
        const ownerX = bodyL + (bodyW - ownerW) / 2;
        const priceX = bodyL + (bodyW - priceW) / 2;

        const blockH = nameFont + rowGap + ownerFont + rowGap + priceFont;
        const startY = bodyT + (bodyH - blockH) / 2;
        const nameY = startY;
        const ownerY = nameY + nameFont + rowGap;
        const priceY = ownerY + ownerFont + rowGap;

        const textOverlay = await renderTextImage({
            width: tagW,
            height: tagH,
            backgroundColor: "transparent",
            fontFamily: FONT_FAMILY,
            elements: [
                { text: displayName, x: nameX, y: nameY, fontSize: nameFont, color: TEXT_COLOR },
                { text: ownerText, x: ownerX, y: ownerY, fontSize: ownerFont, color: OWNER_COLOR },
                { text: priceText, x: priceX, y: priceY, fontSize: priceFont, color: PRICE_COLOR },
            ],
        });

        return await sharp(loadTagBuffer())
            .resize(tagW, tagH, { kernel: "lanczos3" })
            .composite([{ input: textOverlay, top: 0, left: 0 }])
            .png()
            .toBuffer();
    }
}
