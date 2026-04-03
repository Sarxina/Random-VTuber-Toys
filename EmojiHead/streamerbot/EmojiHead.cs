using System;
using System.IO;

public class CPHInline
{
    private const string GLOBAL_VAR = "EmojiHead_Active";
    private const string ITEM_ID_VAR = "EmojiHead_ItemID";

    // Artmesh to pin the emote to
    private const string PIN_ARTMESH = "FaceColorMain";

    // Path to emote image — update this to your emote PNG
    private const string EMOTE_PATH = @"C:\Users\aleck\Documents\Sarxina\Coding\Random VTuber Toys\EmojiHead\standalone\emotes\brainded.png";

    // Emote size (0-1)
    private const double EMOTE_SIZE = 0.22;

    public bool Execute()
    {
        bool active = CPH.GetGlobalVar<bool>(GLOBAL_VAR, false);
        return active ? Disable() : Enable();
    }

    private bool Enable()
    {
        byte[] imageBytes;
        try
        {
            imageBytes = File.ReadAllBytes(EMOTE_PATH);
        }
        catch (Exception ex)
        {
            CPH.LogInfo("[EmojiHead] Failed to read emote file: " + ex.Message);
            return false;
        }

        string base64 = Convert.ToBase64String(imageBytes);

        // Get model size to scale emote proportionally
        string modelPosResp = CPH.VTubeStudioSendRawRequest("GetModelPositionRequest", "{}");
        double modelSize = ExtractJsonDouble(modelPosResp, "size", -30.0);
        // VTS model size is roughly -30 (default). Larger values = bigger model on screen.
        // Convert to a multiplier: default -30 -> 1.0x
        double sizeMultiplier = Math.Pow(10.0, (modelSize + 30.0) / 30.0);
        double scaledSize = EMOTE_SIZE * sizeMultiplier;
        if (scaledSize > 1.0) scaledSize = 1.0;
        if (scaledSize < 0.01) scaledSize = 0.01;

        // Load item — fileName must be alphanumeric+hyphens, 8-32 chars
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
            + ",\"pinInfo\":{\"modelID\":\"\",\"artMeshID\":\"" + PIN_ARTMESH + "\",\"angle\":0,\"size\":" + scaledSize.ToString("F4") + "}}";

        CPH.VTubeStudioSendRawRequest("ItemPinRequest", pinJson);

        // Sort emote to same depth as the face (behind hair/ears, where the face sits)
        string sortJson = "{\"itemInstanceID\":\"" + instanceId + "\""
            + ",\"frontOn\":true"
            + ",\"backOn\":false"
            + ",\"setSplitPoint\":\"Unchanged\""
            + ",\"setFrontOrder\":\"UseArtMeshID\""
            + ",\"setBackOrder\":\"Unchanged\""
            + ",\"splitAt\":\"\""
            + ",\"withinModelOrderFront\":\"" + PIN_ARTMESH + "\""
            + ",\"withinModelOrderBack\":\"\"}";

        CPH.VTubeStudioSendRawRequest("ItemSortRequest", sortJson);

        // Hide face
        TintFace(0);

        CPH.SetGlobalVar(GLOBAL_VAR, true, false);
        CPH.SetGlobalVar(ITEM_ID_VAR, instanceId, false);
        CPH.LogInfo("[EmojiHead] ON - item " + instanceId);
        return true;
    }

    private bool Disable()
    {
        string instanceId = CPH.GetGlobalVar<string>(ITEM_ID_VAR, false) ?? "";

        // Restore face
        TintFace(255);

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
        CPH.LogInfo("[EmojiHead] OFF");
        return true;
    }

    private void TintFace(int alpha)
    {
        string[] facePatterns = new string[]
        {
            "FaceColor", "Freckles", "EyePupil", "Sclera", "Eyelash", "Eyelid",
            "ShadowOverEyes", "Eyebrow", "NoseMask", "NoseShadow", "NoseWhiteDot",
            "Nostrils", "Lips", "Mouth", "Tongue", "Teeth", "Canine", "Blush",
            "TopColor", "BottomColor"
        };
        string patterns = "\"" + string.Join("\",\"", facePatterns) + "\"";
        string json = "{\"colorTint\":{\"colorR\":255,\"colorG\":255,\"colorB\":255,\"colorA\":" + alpha
            + ",\"mixWithSceneLightingColor\":0}"
            + ",\"artMeshMatcher\":{\"tintAll\":false,\"artMeshNumber\":[],\"nameExact\":[]"
            + ",\"nameContains\":[" + patterns + "]"
            + ",\"tagExact\":[],\"tagContains\":[]}}";

        CPH.VTubeStudioSendRawRequest("ColorTintRequest", json);
    }

    private string FindHairArtMesh(string artMeshListResp)
    {
        // Look through the artmesh names for one containing "hair" (case-insensitive)
        // Prefer front-facing hair (fringe/bangs) over side/back hair
        string[] preferredPatterns = new string[] { "Fringe", "fringe", "Bangs", "bangs", "Front" };
        string fallbackHair = "";

        if (string.IsNullOrEmpty(artMeshListResp)) return "";

        // Find the artMeshNames array
        string arrayStart = "\"artMeshNames\":[";
        int idx = artMeshListResp.IndexOf(arrayStart);
        if (idx < 0) return "";
        idx += arrayStart.Length;
        int arrayEnd = artMeshListResp.IndexOf("]", idx);
        if (arrayEnd < 0) return "";

        string namesSection = artMeshListResp.Substring(idx, arrayEnd - idx);
        string[] names = namesSection.Replace("\"", "").Split(',');

        foreach (string rawName in names)
        {
            string name = rawName.Trim();
            if (name.Length == 0) continue;

            string lower = name.ToLower();
            if (!lower.Contains("hair")) continue;

            // Check preferred patterns first
            foreach (string pattern in preferredPatterns)
            {
                if (name.Contains(pattern))
                    return name;
            }

            // Store first hair mesh as fallback
            if (string.IsNullOrEmpty(fallbackHair))
                fallbackHair = name;
        }

        return fallbackHair;
    }

    private double ExtractJsonDouble(string json, string key, double defaultVal)
    {
        // Handles both "key":123.45 and "key":-30.0
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
