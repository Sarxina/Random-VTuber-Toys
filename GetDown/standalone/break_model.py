"""
Modifies a copy of the physics3.json to make the model go completely unhinged.

Changes:
- Normalization ranges blown out 10x (allows extreme deformation)
- Vertex mobility cranked to max (everything flails freely)
- Delay reduced to near-zero (no damping, instant whiplash)
- Acceleration maxed out (snappy violent movements)
- Output scales multiplied 5x (amplifies all physics output)
"""

import json
import shutil
import sys
import os

MODEL_DIR = r"CHANGE_ME"  # Set this to your model's folder path
PHYSICS_FILE = "CHANGE_ME"  # Set this to your model's physics3.json filename

if MODEL_DIR == "CHANGE_ME" or PHYSICS_FILE == "CHANGE_ME":
    print("ERROR: You need to configure break_model.py first!")
    print("  1. Set MODEL_DIR to your model's folder path")
    print('     e.g. r"C:\\Program Files (x86)\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Live2DModels\\MyModel"')
    print("  2. Set PHYSICS_FILE to your model's physics filename")
    print('     e.g. "MyModel.physics3.json"')
    sys.exit(1)

PHYSICS_FILE = os.path.join(MODEL_DIR, PHYSICS_FILE)
BACKUP_FILE = PHYSICS_FILE + ".backup"

# How extreme to make the changes (higher = more broken)
RANGE_MULTIPLIER = 10       # Normalization range multiplier
OUTPUT_SCALE_MULT = 5       # Output scale multiplier
MOBILITY = 1.0              # Max mobility for all vertices
DELAY = 0.01                # Near-zero damping
ACCELERATION = 5.0          # High acceleration


def main():
    # Backup original
    if not os.path.exists(BACKUP_FILE):
        shutil.copy2(PHYSICS_FILE, BACKUP_FILE)
        print(f"Backed up original to {BACKUP_FILE}")
    else:
        print(f"Backup already exists at {BACKUP_FILE}")

    with open(PHYSICS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    settings = data.get("PhysicsSettings", [])
    print(f"Modifying {len(settings)} physics settings...\n")

    for i, setting in enumerate(settings):
        name = data["Meta"]["PhysicsDictionary"][i]["Name"] if i < len(data["Meta"]["PhysicsDictionary"]) else f"Setting {i}"

        # Blow out normalization ranges
        norm = setting.get("Normalization", {})
        for key in ["Position", "Angle"]:
            if key in norm:
                orig_min = norm[key]["Minimum"]
                orig_max = norm[key]["Maximum"]
                center = (orig_min + orig_max) / 2
                half_range = (orig_max - orig_min) / 2
                norm[key]["Minimum"] = center - half_range * RANGE_MULTIPLIER
                norm[key]["Maximum"] = center + half_range * RANGE_MULTIPLIER

        # Crank vertex properties
        for vertex in setting.get("Vertices", []):
            vertex["Mobility"] = MOBILITY
            vertex["Delay"] = DELAY
            vertex["Acceleration"] = ACCELERATION

        # Amplify output scales
        for output in setting.get("Output", []):
            output["Scale"] = output.get("Scale", 1) * OUTPUT_SCALE_MULT

        print(f"  [{i+1:2d}] {name}")

    with open(PHYSICS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent="\t", ensure_ascii=False)

    print(f"\nDone! Physics file modified.")
    print(f"Reload the model in VTube Studio to see the changes.")
    print(f"\nTo restore the original, run:")
    print(f"  python break_model.py --restore")


def restore():
    if os.path.exists(BACKUP_FILE):
        shutil.copy2(BACKUP_FILE, PHYSICS_FILE)
        print("Restored original physics file from backup.")
    else:
        print("No backup found!")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--restore":
        restore()
    else:
        main()
