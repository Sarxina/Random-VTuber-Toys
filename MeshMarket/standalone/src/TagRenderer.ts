import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { measureText, renderTextImage } from "@sarxina/sarxina-tools";

/**
 * Price tag — text composited onto the vendored `assets/price-tag.png`.
 * Two rows: owner name on top, "PRICE MB" on bottom.
 *
 * The body of the tag (everything to the right of the hole) is the safe
 * region for text. Body coordinates are expressed as fractions of the
 * tag image so they survive any future asset swap or resize.
 *
 * This class only produces PNG buffers. Pinning to a mesh is VTSIntegration's
 * job.
 */

const TAG_WIDTH = 360; // ~3x previous tag width
const FONT_FAMILY = "Arial, sans-serif";
const TEXT_COLOR = "#111111";
const PRICE_COLOR = "#006b2a"; // green — feels market-y

// Body region of the tag image (fractions of width/height).
// Tag has the hole on the left ~25% of the width; the body fills the rest.
const BODY_LEFT_FRAC = 0.32;
const BODY_RIGHT_FRAC = 0.96;
const BODY_TOP_FRAC = 0.18;
const BODY_BOTTOM_FRAC = 0.82;

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

export class TagRenderer {
    async render(ownerLogin: string | null, price: number): Promise<Buffer> {
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

        // Pick text sizes that fit the body. Price is the louder one.
        const ownerFontSize = Math.round(bodyH * 0.30);
        const priceFontSize = Math.round(bodyH * 0.45);
        const rowGap = Math.round(bodyH * 0.05);

        // Centre each row horizontally within the body.
        const ownerW = measureText(ownerText, ownerFontSize, FONT_FAMILY);
        const priceW = measureText(priceText, priceFontSize, FONT_FAMILY);
        const ownerX = bodyL + (bodyW - ownerW) / 2;
        const priceX = bodyL + (bodyW - priceW) / 2;

        // Stack vertically, centred on the body.
        const blockH = ownerFontSize + rowGap + priceFontSize;
        const startY = bodyT + (bodyH - blockH) / 2;
        const ownerY = startY;
        const priceY = startY + ownerFontSize + rowGap;

        const textOverlay = await renderTextImage({
            width: tagW,
            height: tagH,
            backgroundColor: "transparent",
            fontFamily: FONT_FAMILY,
            elements: [
                {
                    text: ownerText,
                    x: ownerX,
                    y: ownerY,
                    fontSize: ownerFontSize,
                    color: TEXT_COLOR,
                },
                {
                    text: priceText,
                    x: priceX,
                    y: priceY,
                    fontSize: priceFontSize,
                    color: PRICE_COLOR,
                },
            ],
        });

        return await sharp(loadTagBuffer())
            .resize(tagW, tagH, { kernel: "lanczos3" })
            .composite([{ input: textOverlay, top: 0, left: 0 }])
            .png()
            .toBuffer();
    }
}
