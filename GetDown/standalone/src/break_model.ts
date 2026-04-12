import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MODEL_DIR = "CHANGE_ME"; // Set this to your model's folder path
const PHYSICS_FILE_NAME = "CHANGE_ME"; // Set this to your model's physics3.json filename

if (MODEL_DIR === "CHANGE_ME" || PHYSICS_FILE_NAME === "CHANGE_ME") {
    console.log("ERROR: You need to configure break_model.ts first!");
    console.log("  1. Set MODEL_DIR to your model's folder path");
    console.log(
        '     e.g. "C:\\\\Program Files (x86)\\\\Steam\\\\steamapps\\\\common\\\\VTube Studio\\\\VTube Studio_Data\\\\StreamingAssets\\\\Live2DModels\\\\MyModel"'
    );
    console.log("  2. Set PHYSICS_FILE_NAME to your model's physics filename");
    console.log('     e.g. "MyModel.physics3.json"');
    process.exit(1);
}

const PHYSICS_FILE = join(MODEL_DIR, PHYSICS_FILE_NAME);
const BACKUP_FILE = PHYSICS_FILE + ".backup";

// How extreme to make the changes (higher = more broken)
const RANGE_MULTIPLIER = 10;
const OUTPUT_SCALE_MULT = 5;
const MOBILITY = 1.0;
const DELAY = 0.01;
const ACCELERATION = 5.0;

interface PhysicsVertex {
    Mobility: number;
    Delay: number;
    Acceleration: number;
}

interface PhysicsOutput {
    Scale: number;
}

interface NormRange {
    Minimum: number;
    Maximum: number;
}

interface PhysicsSetting {
    Normalization?: { Position?: NormRange; Angle?: NormRange };
    Vertices?: PhysicsVertex[];
    Output?: PhysicsOutput[];
}

interface PhysicsData {
    PhysicsSettings?: PhysicsSetting[];
    Meta?: { PhysicsDictionary?: { Name: string }[] };
}

function main(): void {
    // Backup original
    if (!existsSync(BACKUP_FILE)) {
        copyFileSync(PHYSICS_FILE, BACKUP_FILE);
        console.log(`Backed up original to ${BACKUP_FILE}`);
    } else {
        console.log(`Backup already exists at ${BACKUP_FILE}`);
    }

    const data: PhysicsData = JSON.parse(readFileSync(PHYSICS_FILE, "utf-8"));

    const settings = data.PhysicsSettings ?? [];
    console.log(`Modifying ${settings.length} physics settings...\n`);

    for (let i = 0; i < settings.length; i++) {
        const setting = settings[i]!;
        const name =
            i < (data.Meta?.PhysicsDictionary?.length ?? 0)
                ? data.Meta!.PhysicsDictionary![i]!.Name
                : `Setting ${i}`;

        // Blow out normalization ranges
        const norm = setting.Normalization ?? {};
        for (const key of ["Position", "Angle"] as const) {
            const range = norm[key];
            if (range) {
                const center = (range.Minimum + range.Maximum) / 2;
                const halfRange = (range.Maximum - range.Minimum) / 2;
                range.Minimum = center - halfRange * RANGE_MULTIPLIER;
                range.Maximum = center + halfRange * RANGE_MULTIPLIER;
            }
        }

        // Crank vertex properties
        for (const vertex of setting.Vertices ?? []) {
            vertex.Mobility = MOBILITY;
            vertex.Delay = DELAY;
            vertex.Acceleration = ACCELERATION;
        }

        // Amplify output scales
        for (const output of setting.Output ?? []) {
            output.Scale = (output.Scale ?? 1) * OUTPUT_SCALE_MULT;
        }

        console.log(`  [${String(i + 1).padStart(2)}] ${name}`);
    }

    writeFileSync(PHYSICS_FILE, JSON.stringify(data, null, "\t"), "utf-8");

    console.log(`\nDone! Physics file modified.`);
    console.log(`Reload the model in VTube Studio to see the changes.`);
    console.log(`\nTo restore the original, run:`);
    console.log(`  npm run break -- --restore`);
}

function restore(): void {
    if (existsSync(BACKUP_FILE)) {
        copyFileSync(BACKUP_FILE, PHYSICS_FILE);
        console.log("Restored original physics file from backup.");
    } else {
        console.log("No backup found!");
    }
}

if (process.argv.includes("--restore")) {
    restore();
} else {
    main();
}
