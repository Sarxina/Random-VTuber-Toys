using System;
using System.IO;
using System.Net.Http;
using System.Collections.Generic;

public class CPHInline
{
    private const string GLOBAL_VAR = "EmojiHead_Active";
    private const string ITEM_ID_VAR = "EmojiHead_ItemID";
    private const string FACE_MESH_VAR = "EmojiHead_FaceMesh";

    // Emote size (0-1)
    private const double EMOTE_SIZE = 0.62;


    public bool Execute()
    {
        bool active = CPH.GetGlobalVar<bool>(GLOBAL_VAR, false);

        string message = "";
        CPH.TryGetArg("message", out message);
        string lower = (message ?? "").Trim().ToLower();

        // Ignore messages that don't start with !emojihead
        if (!string.IsNullOrEmpty(lower) && !lower.StartsWith("!emojihead"))
            return true;

        // "!emojihead off" always disables
        if (lower == "!emojihead off")
            return active ? Disable() : true;

        // If active and a new emote is provided, disable first then re-enable
        if (active)
        {
            Disable();
        }

        return Enable();
    }

    private bool Enable()
    {
        byte[] imageBytes = null;
        string emoteName = "emote";

        // Try to get emote from chat message
        int emoteCount = 0;
        CPH.TryGetArg("emoteCount", out emoteCount);

        if (emoteCount > 0)
        {
            // Get emotes as raw object and use reflection (it's List<Twitch.Common.Models.Emote>)
            object emotesRaw = null;
            CPH.TryGetArg("emotes", out emotesRaw);

            if (emotesRaw != null)
            {
                var countProp = emotesRaw.GetType().GetProperty("Count");
                int count = (int)countProp.GetValue(emotesRaw);

                if (count > 0)
                {
                    var itemProp = emotesRaw.GetType().GetProperty("Item");
                    var firstEmote = itemProp.GetValue(emotesRaw, new object[] { 0 });

                    var imageUrlProp = firstEmote.GetType().GetProperty("ImageUrl");
                    var nameProp = firstEmote.GetType().GetProperty("Name");

                    if (imageUrlProp != null)
                    {
                        string imageUrl = imageUrlProp.GetValue(firstEmote) as string;
                        if (nameProp != null)
                            emoteName = (nameProp.GetValue(firstEmote) as string) ?? "emote";

                        if (!string.IsNullOrEmpty(imageUrl))
                        {
                            // Ensure we get the largest size (3.0)
                            imageUrl = imageUrl.Replace("/1.0", "/3.0").Replace("/2.0", "/3.0");

                            try
                            {
                                using (var http = new HttpClient())
                                {
                                    imageBytes = http.GetByteArrayAsync(imageUrl).GetAwaiter().GetResult();
                                }
                            }
                            catch (Exception ex)
                            {
                                CPH.LogInfo("[EmojiHead] Failed to download emote: " + ex.Message);
                            }
                        }
                    }
                }
            }
        }

        // No emote found — skip
        if (imageBytes == null)
        {
            CPH.LogInfo("[EmojiHead] No emote found in message, skipping.");
            return true;
        }

        string base64 = Convert.ToBase64String(imageBytes);

        // Query model artmeshes
        string artMeshResp = CPH.VTubeStudioSendRawRequest("ArtMeshListRequest", "{}");
        string[] allMeshes = ParseArtMeshNames(artMeshResp);

        // Find the best artmesh to pin to (nose > face > head)
        string pinMesh = FindPinMesh(allMeshes);
        if (string.IsNullOrEmpty(pinMesh))
        {
            CPH.LogInfo("[EmojiHead] Could not find a face artmesh to pin to.");
            return false;
        }
        CPH.LogInfo("[EmojiHead] Pinning to: " + pinMesh);

        // Find face artmeshes to hide
        string[] faceMeshes = FindFaceMeshes(allMeshes);
        CPH.LogInfo("[EmojiHead] Hiding " + faceMeshes.Length + " face artmeshes");

        double scaledSize = EMOTE_SIZE;

        // Load item
        string loadJson = "{\"fileName\":\"emojihead.png\""
            + ",\"positionX\":0,\"positionY\":0"
            + ",\"size\":" + scaledSize.ToString("F4")
            + ",\"rotation\":0,\"fadeTime\":0.2,\"order\":1"
            + ",\"failIfOrderTaken\":false,\"smoothing\":0"
            + ",\"censored\":false,\"flipped\":false,\"locked\":false"
            + ",\"unloadWhenPluginDisconnects\":true"
            + ",\"customDataBase64\":\"" + base64 + "\""
            + ",\"customDataAskUserFirst\":false"
            + ",\"customDataSkipAskingUserIfWhitelisted\":true"
            + ",\"customDataAskTimer\":-1}";

        string loadResp = CPH.VTubeStudioSendRawRequest("ItemLoadRequest", loadJson);
        if (string.IsNullOrEmpty(loadResp) || loadResp.Contains("APIError"))
        {
            CPH.LogInfo("[EmojiHead] Failed to load item: " + loadResp);
            return false;
        }

        string instanceId = ExtractJsonValue(loadResp, "instanceID");
        if (string.IsNullOrEmpty(instanceId))
        {
            CPH.LogInfo("[EmojiHead] Could not get instanceID from response: " + loadResp);
            return false;
        }

        // Pin to face
        string pinJson = "{\"pin\":true"
            + ",\"itemInstanceID\":\"" + instanceId + "\""
            + ",\"angleRelativeTo\":\"RelativeToModel\""
            + ",\"sizeRelativeTo\":\"RelativeToWorld\""
            + ",\"vertexPinType\":\"Center\""
            + ",\"pinInfo\":{\"modelID\":\"\",\"artMeshID\":\"" + pinMesh + "\",\"angle\":0,\"size\":" + scaledSize.ToString("F4") + "}}";

        CPH.VTubeStudioSendRawRequest("ItemPinRequest", pinJson);

        // Sort emote to same depth as the face (behind hair/ears)
        string sortJson = "{\"itemInstanceID\":\"" + instanceId + "\""
            + ",\"frontOn\":true"
            + ",\"backOn\":false"
            + ",\"setSplitPoint\":\"Unchanged\""
            + ",\"setFrontOrder\":\"UseArtMeshID\""
            + ",\"setBackOrder\":\"Unchanged\""
            + ",\"splitAt\":\"\""
            + ",\"withinModelOrderFront\":\"" + pinMesh + "\""
            + ",\"withinModelOrderBack\":\"\"}";

        CPH.VTubeStudioSendRawRequest("ItemSortRequest", sortJson);

        // Hide face artmeshes by exact name
        TintMeshes(faceMeshes, 0);

        CPH.SetGlobalVar(GLOBAL_VAR, true, false);
        CPH.SetGlobalVar(ITEM_ID_VAR, instanceId, false);
        // Store face mesh names for disable
        CPH.SetGlobalVar(FACE_MESH_VAR, string.Join("|", faceMeshes), false);
        CPH.LogInfo("[EmojiHead] ON - item " + instanceId);
        return true;
    }

    private bool Disable()
    {
        string instanceId = CPH.GetGlobalVar<string>(ITEM_ID_VAR, false) ?? "";
        string faceMeshStr = CPH.GetGlobalVar<string>(FACE_MESH_VAR, false) ?? "";

        // Restore face
        if (!string.IsNullOrEmpty(faceMeshStr))
        {
            string[] faceMeshes = faceMeshStr.Split('|');
            TintMeshes(faceMeshes, 255);
        }

        // Unload item
        if (!string.IsNullOrEmpty(instanceId))
        {
            string unloadJson = "{\"unloadAllInScene\":false"
                + ",\"unloadAllLoadedByThisPlugin\":false"
                + ",\"allowUnloadingItemsLoadedByUserOrOtherPlugins\":false"
                + ",\"instanceIDs\":[\"" + instanceId + "\"]}";

            CPH.VTubeStudioSendRawRequest("ItemUnloadRequest", unloadJson);
        }

        CPH.SetGlobalVar(GLOBAL_VAR, false, false);
        CPH.SetGlobalVar(ITEM_ID_VAR, "", false);
        CPH.SetGlobalVar(FACE_MESH_VAR, "", false);
        CPH.LogInfo("[EmojiHead] OFF");
        return true;
    }

    private void TintMeshes(string[] meshNames, int alpha)
    {
        // Use nameExact for precise control
        string names = "\"" + string.Join("\",\"", meshNames) + "\"";
        string json = "{\"colorTint\":{\"colorR\":255,\"colorG\":255,\"colorB\":255,\"colorA\":" + alpha
            + ",\"mixWithSceneLightingColor\":0}"
            + ",\"artMeshMatcher\":{\"tintAll\":false,\"artMeshNumber\":[],\"nameExact\":[" + names + "]"
            + ",\"nameContains\":[]"
            + ",\"tagExact\":[],\"tagContains\":[]}}";

        CPH.VTubeStudioSendRawRequest("ColorTintRequest", json);
    }

    private string[] ParseArtMeshNames(string resp)
    {
        if (string.IsNullOrEmpty(resp)) return new string[0];
        string arrayStart = "\"artMeshNames\":[";
        int idx = resp.IndexOf(arrayStart);
        if (idx < 0) return new string[0];
        idx += arrayStart.Length;
        int arrayEnd = resp.IndexOf("]", idx);
        if (arrayEnd < 0) return new string[0];

        string section = resp.Substring(idx, arrayEnd - idx);
        string[] raw = section.Replace("\"", "").Split(',');
        var result = new List<string>();
        foreach (string s in raw)
        {
            string trimmed = s.Trim();
            if (trimmed.Length > 0) result.Add(trimmed);
        }
        return result.ToArray();
    }

    private string FindPinMesh(string[] meshNames)
    {
        string[] pinPatterns = new string[] { "nose", "face", "head" };
        foreach (string pattern in pinPatterns)
        {
            foreach (string mesh in meshNames)
            {
                if (mesh.ToLower().Contains(pattern))
                    return mesh;
            }
        }
        // Last resort: return first mesh
        return meshNames.Length > 0 ? meshNames[0] : "";
    }

    private string[] FindFaceMeshes(string[] allMeshes)
    {
        string[] facePatterns = new string[]
        {
            "face", "freckle", "eyepupil", "pupil", "sclera", "eyelash", "eyelid",
            "shadowovereye", "eyebrow", "brow",
            "nose", "nostril",
            "lip", "mouth", "tongue", "teeth", "canine", "gum",
            "blush"
        };
        string[] keepPatterns = new string[]
        {
            "hair", "ear", "glass", "earring", "neckpiece", "neckpie", "choker",
            "horn", "antenna", "halo", "crown", "hat", "ribbon",
            "braid", "ponytail", "pigtail", "bangs", "fringe", "ahoge"
        };

        var result = new List<string>();
        foreach (string mesh in allMeshes)
        {
            string lower = mesh.ToLower();

            bool isFace = false;
            foreach (string pattern in facePatterns)
            {
                if (lower.Contains(pattern))
                {
                    isFace = true;
                    break;
                }
            }
            if (!isFace) continue;

            bool keep = false;
            foreach (string pattern in keepPatterns)
            {
                if (lower.Contains(pattern))
                {
                    keep = true;
                    break;
                }
            }
            if (keep) continue;

            result.Add(mesh);
        }
        return result.ToArray();
    }

    private double ExtractJsonDouble(string json, string key, double defaultVal)
    {
        string search = "\"" + key + "\":";
        int start = json.IndexOf(search);
        if (start < 0) return defaultVal;
        start += search.Length;
        int end = start;
        while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '.' || json[end] == '-' || json[end] == 'E' || json[end] == 'e' || json[end] == '+'))
            end++;
        if (end == start) return defaultVal;
        double result;
        if (double.TryParse(json.Substring(start, end - start), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out result))
            return result;
        return defaultVal;
    }

    private string ExtractJsonValue(string json, string key)
    {
        string search = "\"" + key + "\":\"";
        int start = json.IndexOf(search);
        if (start < 0) return "";
        start += search.Length;
        int end = json.IndexOf("\"", start);
        if (end < 0) return "";
        return json.Substring(start, end - start);
    }
}
