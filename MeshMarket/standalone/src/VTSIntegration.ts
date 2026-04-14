import type { VTSClient } from "@sarxina/sarxina-tools";
import type { TagRenderer } from "./TagRenderer.js";

/**
 * Thin wrapper around the shared VTSClient for Mesh Market's specific needs:
 * listing artmeshes, pinning tag PNGs to them, and removing tags.
 *
 * Maintains an internal meshID -> itemInstanceID map so we can update a
 * mesh's tag (new price, new owner) by unloading the old item and pinning
 * a fresh one.
 */
export class VTSIntegration {
    private pinned = new Map<string, string>(); // meshID -> itemInstanceID
    private tagSize = 0.08; // Arbitrary small size; actual display size comes from PNG pixel dims

    constructor(
        private vts: VTSClient,
        private renderer: TagRenderer
    ) {}

    async listMeshes(): Promise<string[]> {
        return this.vts.listArtMeshes();
    }

    /** Render + load + pin a price tag onto a mesh. Replaces existing tag. */
    async pinTag(meshID: string, ownerLogin: string | null, price: number): Promise<void> {
        await this.unpinTag(meshID); // Remove any existing tag first

        const png = await this.renderer.render(ownerLogin, price);
        const b64 = png.toString("base64");

        const instanceID = await this.vts.loadItem({
            fileName: `meshmarket_${meshID.replace(/[^a-zA-Z0-9]/g, "_")}.png`,
            customDataBase64: b64,
            positionX: 0,
            positionY: 0,
            size: this.tagSize,
            fadeTime: 0.05,
            order: 50,
            customDataAskUserFirst: false,
            customDataSkipAskingUserIfWhitelisted: true,
        });

        await this.vts.pinItem(instanceID, {
            artMeshID: meshID,
            angle: 0,
            size: this.tagSize,
            angleRelativeTo: "RelativeToModel",
            sizeRelativeTo: "RelativeToWorld",
            vertexPinType: "Center",
        });

        this.pinned.set(meshID, instanceID);
    }

    /** Remove the tag from a single mesh. */
    async unpinTag(meshID: string): Promise<void> {
        const instanceID = this.pinned.get(meshID);
        if (!instanceID) return;
        this.pinned.delete(meshID);
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
        const meshIDs = Array.from(this.pinned.keys());
        for (const meshID of meshIDs) {
            await this.unpinTag(meshID);
        }
    }
}
