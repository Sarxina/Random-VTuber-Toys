"""Quick utility to list all artmesh names on the currently loaded VTube Studio model."""
import asyncio
import json
import random
import websockets

API_URL = "ws://localhost:8004"

async def main():
    async with websockets.connect(API_URL) as ws:
        # Auth
        req = {"apiName": "VTubeStudioPublicAPI", "apiVersion": "1.0", "requestID": "1",
               "messageType": "AuthenticationTokenRequest",
               "data": {"pluginName": "ArtMeshLister", "pluginDeveloper": "Sarxina"}}
        await ws.send(json.dumps(req))
        resp = json.loads(await ws.recv())
        token = resp["data"]["authenticationToken"]
        print("Approve the plugin in VTube Studio if prompted...")
        await asyncio.sleep(2)

        req = {"apiName": "VTubeStudioPublicAPI", "apiVersion": "1.0", "requestID": "2",
               "messageType": "AuthenticationRequest",
               "data": {"pluginName": "ArtMeshLister", "pluginDeveloper": "Sarxina", "authenticationToken": token}}
        await ws.send(json.dumps(req))
        resp = json.loads(await ws.recv())
        if not resp["data"].get("authenticated"):
            print("Auth failed")
            return

        # Get artmeshes
        req = {"apiName": "VTubeStudioPublicAPI", "apiVersion": "1.0", "requestID": "3",
               "messageType": "ArtMeshListRequest"}
        await ws.send(json.dumps(req))
        resp = json.loads(await ws.recv())
        names = resp["data"]["artMeshNames"]
        print(f"\n{len(names)} artmeshes:\n")
        for name in sorted(names):
            print(f"  {name}")

asyncio.run(main())
