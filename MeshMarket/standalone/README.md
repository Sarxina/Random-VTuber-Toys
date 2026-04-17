# @sarxina/meshmarket

A Sarxina Plugin Manager toy that lets Twitch chat buy and sell parts of your Live2D model.

Chatters earn MeshBucks via channel point redemptions and bid on buyable units in an auction-style market. Each unit is a Live2D Part (a semantic group like `Hair_Folder` or `CoatOutfit_Folder`) composed of many individual ArtMeshes, derived from the model's `.moc3` hierarchy. The streamer can tune the granularity and game speed at runtime from the launcher's plugin controls.

## Commands (in Twitch chat)

- `!meshmarket balance` — shows your MeshBucks balance and owned parts count
- `!meshmarket buy <part> <amount>` — bid on a part
- `!meshmarket list` — shows how many buyable units are available
- `!meshmarket mine` — lists parts you own
- `!meshmarket show` / `!meshmarket hide` — broadcaster-only; toggles price tags on the model
