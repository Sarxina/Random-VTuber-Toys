import { measureText, renderTextImage } from "@sarxina/sarxina-tools";

/**
 * Price tag: two rows — owner name on top, "PRICE MB" on bottom. White
 * background with a thin border-ish padding. Unowned meshes show "—" as
 * the owner row.
 *
 * This class only produces PNG buffers. Pinning to a mesh is VTSIntegration's
 * job.
 */
const FONT_FAMILY = "Arial, sans-serif";
const OWNER_FONT_SIZE = 11;
const PRICE_FONT_SIZE = 15;
const PADDING_H = 8;
const PADDING_V = 5;
const ROW_GAP = 2;

const TEXT_COLOR = "#111111";
const PRICE_COLOR = "#006b2a";   // green — feels market-y
const UNOWNED_COLOR = "#888888"; // grayed out owner row when nobody owns it

const MIN_DIM = 64; // VTS rejects items smaller than 64x64

export class TagRenderer {
    render(ownerLogin: string | null, price: number): Promise<Buffer> {
        const ownerText = ownerLogin ?? "—";
        const priceText = `${price} MB`;

        const ownerWidth = measureText(ownerText, OWNER_FONT_SIZE, FONT_FAMILY);
        const priceWidth = measureText(priceText, PRICE_FONT_SIZE, FONT_FAMILY);
        const contentWidth = Math.max(ownerWidth, priceWidth);
        const contentHeight = OWNER_FONT_SIZE + ROW_GAP + PRICE_FONT_SIZE;

        const textW = Math.ceil(contentWidth + PADDING_H * 2);
        const textH = Math.ceil(contentHeight + PADDING_V * 2);
        const width = Math.max(MIN_DIM, textW);
        const height = Math.max(MIN_DIM, textH);

        const ownerY = PADDING_V;
        const priceY = PADDING_V + OWNER_FONT_SIZE + ROW_GAP;

        return renderTextImage({
            width,
            height,
            bgRect: { x: 0, y: 0, width: textW, height: textH, color: "#ffffff" },
            fontFamily: FONT_FAMILY,
            fontColor: TEXT_COLOR,
            elements: [
                {
                    text: ownerText,
                    x: PADDING_H,
                    y: ownerY,
                    fontSize: OWNER_FONT_SIZE,
                    color: ownerLogin ? TEXT_COLOR : UNOWNED_COLOR,
                },
                {
                    text: priceText,
                    x: PADDING_H,
                    y: priceY,
                    fontSize: PRICE_FONT_SIZE,
                    color: PRICE_COLOR,
                },
            ],
        });
    }
}
