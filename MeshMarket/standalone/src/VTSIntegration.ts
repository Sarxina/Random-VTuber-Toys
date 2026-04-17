import { createHash } from "node:crypto";
import type { VTSClient } from "@sarxina/sarxina-tools";
import type { TagRenderer } from "./TagRenderer.js";

/**
 * Build a VTS-acceptable filename for a tag image. VTS rejects custom-data
 * filenames that aren't `[a-zA-Z0-9-]+\.(png|jpg)` of length 8-32. Unit IDs
 * include underscores and can be far too long, so hash to a stable 16-char
 * hex string and wrap with a fixed prefix/suffix (length 23 total).
 */
function tagFilename(unitID: string): string {
    const hash = createHash("sha1").update(unitID).digest("hex").slice(0, 16);
    return `mm-${hash}.png`;
}

/**
 * Thin wrapper around the shared VTSClient for Mesh Market's specific needs:
 * listing artmeshes, pinning tag PNGs to them, and removing tags.
 *
 * Tags are tracked by **unit ID** (a Live2D Part ID, or an ArtMesh ID in
 * fallback mode). Each tag pins to one anchor ArtMesh chosen by the caller
 * — we don't care which one as long as the same anchor is used consistently
 * for that unit, since we update a tag by unloading and re-pinning.
 */
export class VTSIntegration {
    private pinned = new Map<string, string>(); // unitID -> itemInstanceID
    private tagSize = 0.15;

    constructor(
        private vts: VTSClient,
        private renderer: TagRenderer
    ) {}

    async listMeshes(): Promise<string[]> {
        return this.vts.listArtMeshes();
    }

    /** Render + load + pin a price tag onto a unit, anchored to one of its meshes. */
    async pinTag(
        unitID: string,
        anchorMeshID: string,
        ownerLogin: string | null,
        price: number,
    ): Promise<void> {
        await this.unpinTag(unitID); // Remove any existing tag first

        const png = await this.renderer.render(unitID, ownerLogin, price);
        const b64 = png.toString("base64");

        const instanceID = await this.vts.loadItem({
            fileName: tagFilename(unitID),
            customDataBase64: b64,
            positionX: 0,
            positionY: 0,
            size: this.tagSize,
            fadeTime: 0.05,
            order: 30,
            customDataAskUserFirst: false,
            customDataSkipAskingUserIfWhitelisted: true,
        });

        await this.vts.pinItem(instanceID, {
            artMeshID: anchorMeshID,
            angle: 0,
            size: this.tagSize,
            angleRelativeTo: "RelativeToModel",
            sizeRelativeTo: "RelativeToWorld",
            vertexPinType: "Center",
        });

        this.pinned.set(unitID, instanceID);
    }

    /** Remove the tag from a single unit. */
    async unpinTag(unitID: string): Promise<void> {
        const instanceID = this.pinned.get(unitID);
        if (!instanceID) return;
        this.pinned.delete(unitID);
        try {
            await this.vts.unpinItem(instanceID);
        } catch {
            /* already unpinned */
        }
        try {
            await this.vts.unloadItem(instanceID);
        } catch {
            /* already unloaded */
        }
    }

    /** Remove every pinned tag. Called on tag toggle-off or toy stop. */
    async unpinAll(): Promise<void> {
        const unitIDs = Array.from(this.pinned.keys());
        for (const unitID of unitIDs) {
            await this.unpinTag(unitID);
        }
    }
}
