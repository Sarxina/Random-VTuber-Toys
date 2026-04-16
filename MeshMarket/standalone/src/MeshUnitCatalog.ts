import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { analyzeMeshHierarchy } from "@sarxina/sarxina-tools";

/**
 * A buyable unit in MeshMarket. In hierarchy mode this is a Live2D Part
 * containing one or more ArtMeshes. In fallback mode (no model directory
 * available) it's a single ArtMesh wrapped as a one-mesh unit.
 */
export interface MeshUnit {
    /** Stable identifier — Live2D Part ID, or ArtMesh ID in fallback mode. */
    readonly id: string;
    /** VTS ArtMesh IDs that belong to this unit. Always non-empty. */
    readonly meshIds: readonly string[];
}

export interface MeshUnitCatalog {
    readonly units: readonly MeshUnit[];
    /** Total ArtMeshes covered across all units. */
    readonly meshCount: number;
    /**
     * Granularity level used (only meaningful when loaded from a model file —
     * `null` in fallback mode).
     */
    readonly granularityLevel: number | null;
    /**
     * Map from granularity level → unit count, exposed so callers (the launcher
     * UI in particular) can populate a level picker without reloading the model.
     * `null` in fallback mode.
     */
    readonly granularityLevels: ReadonlyMap<number, number> | null;
    /** O(1) lookup by unit ID. */
    findUnit(id: string): MeshUnit | null;
}

/**
 * Build a MeshUnit catalog by parsing the Live2D model at `modelDirectory`
 * via `@sarxina/sarxina-tools`'s mesh hierarchy analyzer. The directory
 * must contain a `.model3.json` manifest pointing at the model's `.moc3`.
 */
export async function loadCatalogFromModel(
    modelDirectory: string,
    granularityLevel?: number,
): Promise<MeshUnitCatalog> {
    const entries = readdirSync(modelDirectory);
    const manifestName = entries.find((f) => f.endsWith(".model3.json"));
    if (!manifestName) {
        throw new Error(`No .model3.json manifest found in ${modelDirectory}`);
    }
    const manifestPath = path.join(modelDirectory, manifestName);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        FileReferences?: { Moc?: string };
    };
    const mocRel = manifest.FileReferences?.Moc;
    if (!mocRel) {
        throw new Error(`Manifest ${manifestName} has no FileReferences.Moc`);
    }
    const mocPath = path.join(modelDirectory, mocRel);

    const hierarchy = await analyzeMeshHierarchy(mocPath, 30);
    const level = granularityLevel ?? hierarchy.recommendedLevel;
    const groups = hierarchy.getGroupsAtLevel(level);

    const units: MeshUnit[] = groups.map((g) => ({ id: g.id, meshIds: g.meshIds }));
    const byId = new Map(units.map((u) => [u.id, u] as const));

    return {
        units,
        meshCount: units.reduce((sum, u) => sum + u.meshIds.length, 0),
        granularityLevel: level,
        granularityLevels: hierarchy.granularityLevels,
        findUnit: (id) => byId.get(id) ?? null,
    };
}

/**
 * Fallback catalog: each VTS ArtMesh is its own unit. Used when no model
 * directory was supplied, so MeshMarket can still operate (preserving the
 * pre-hierarchy behaviour of buying individual meshes).
 */
export function buildFallbackCatalog(meshIds: readonly string[]): MeshUnitCatalog {
    const units: MeshUnit[] = meshIds.map((id) => ({ id, meshIds: [id] }));
    const byId = new Map(units.map((u) => [u.id, u] as const));
    return {
        units,
        meshCount: meshIds.length,
        granularityLevel: null,
        granularityLevels: null,
        findUnit: (id) => byId.get(id) ?? null,
    };
}
