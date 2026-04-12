# SARXINA_CONFIG Schema

A single Streamer.bot global variable (`SARXINA_CONFIG`) containing a JSON string. All Sarxina plugins read from and write to this one variable.

## Schema

```json
{
  "foreheadLocation": {
    "type": "precise | center",
    "artMeshId": "string",
    "modelId": "string",
    "vertexId1": 0,
    "vertexId2": 0,
    "vertexId3": 0,
    "vertexWeight1": 0.0,
    "vertexWeight2": 0.0,
    "vertexWeight3": 0.0
  }
}
```

### foreheadLocation

Where overlays and tags pin to on the model's forehead.

- **`type: "precise"`** — Set by the Model Clicked calibration trigger. Uses `vertexPinType: "Provided"` with exact barycentric coordinates. All vertex fields are populated.
- **`type: "center"`** — Set by auto-detection (name-based mesh guessing). Uses `vertexPinType: "Center"` on the matched mesh. Only `artMeshId` is used; vertex fields may be absent.

The Model Clicked trigger always overwrites this field, regardless of what was there before. This is intentional — a manual click is always more accurate than a guess.

### Adding new fields

Other Sarxina plugins can add their own top-level keys to this config. Keep keys descriptive and namespaced if there's any risk of collision (e.g. `ao3tagger_tags` rather than just `tags`).
