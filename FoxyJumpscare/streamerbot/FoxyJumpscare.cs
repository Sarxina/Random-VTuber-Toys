using System;
using System.IO;
using System.Threading;

public class CPHInline
{
    // ===== CONFIG =====
    // Paths are resolved relative to the SARXINA_TOYS global variable.
    // Set it once in Streamer.bot: Global Variables > Persisted Globals > add "SARXINA_TOYS"
    // with value = full path to where you cloned the Random VTuber Toys repo.
    private const string GLOBAL_REPO_ROOT = "SARXINA_TOYS";

    // 1 in CHANCE_DENOM every trigger tick
    private const int CHANCE_DENOM = 10000;

    // Item display
    private const double ITEM_SIZE = 0.5;      // 1.0 = roughly fullscreen
    private const int ITEM_DURATION_MS = 1200; // how long to keep it on screen
    // ==================

    private static readonly Random _rng = new Random();

    public bool Execute()
    {
        int roll = _rng.Next(1, CHANCE_DENOM + 1);
        if (roll != 1) return true;

        string repoRoot = CPH.GetGlobalVar<string>(GLOBAL_REPO_ROOT, true);
        if (string.IsNullOrEmpty(repoRoot))
        {
            CPH.LogWarn("[FoxyJumpscare] Global variable '" + GLOBAL_REPO_ROOT + "' not set. Set it in Streamer.bot to the path of your cloned repo.");
            return false;
        }

        string gifPath = Path.Combine(repoRoot, "FoxyJumpscare", "assets", "jumpscare.gif");
        string wavPath = Path.Combine(repoRoot, "FoxyJumpscare", "assets", "jumpscare.wav");

        CPH.LogInfo("[FoxyJumpscare] *** IT'S ME *** (rolled " + roll + "/" + CHANCE_DENOM + ")");

        if (!File.Exists(gifPath))
        {
            CPH.LogWarn("[FoxyJumpscare] GIF not found: " + gifPath);
            return false;
        }

        // Play audio alongside the visual
        if (File.Exists(wavPath))
        {
            try { CPH.PlaySound(wavPath, 1.0f, false); }
            catch (Exception ex) { CPH.LogWarn("[FoxyJumpscare] Sound failed: " + ex.Message); }
        }

        string base64;
        try
        {
            base64 = Convert.ToBase64String(File.ReadAllBytes(gifPath));
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[FoxyJumpscare] Could not read GIF: " + ex.Message);
            return false;
        }

        // VTS routes custom image parsing by filename extension — must match actual format
        string loadJson = "{\"fileName\":\"foxyjumpscare.gif\""
            + ",\"positionX\":0,\"positionY\":0"
            + ",\"size\":" + ITEM_SIZE.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)
            + ",\"rotation\":0,\"fadeTime\":0,\"order\":30"
            + ",\"failIfOrderTaken\":false,\"smoothing\":0"
            + ",\"censored\":false,\"flipped\":false,\"locked\":true"
            + ",\"unloadWhenPluginDisconnects\":true"
            + ",\"customDataBase64\":\"" + base64 + "\""
            + ",\"customDataAskUserFirst\":false"
            + ",\"customDataSkipAskingUserIfWhitelisted\":true"
            + ",\"customDataAskTimer\":-1}";

        string loadResp = CPH.VTubeStudioSendRawRequest("ItemLoadRequest", loadJson);
        if (string.IsNullOrEmpty(loadResp) || loadResp.Contains("\"success\":false"))
        {
            CPH.LogWarn("[FoxyJumpscare] VTS rejected the load: " + loadResp);
            return false;
        }

        string instanceId = ExtractJsonValue(loadResp, "instanceID");
        if (string.IsNullOrEmpty(instanceId))
        {
            CPH.LogWarn("[FoxyJumpscare] Could not extract instanceID");
            return false;
        }

        Thread.Sleep(ITEM_DURATION_MS);

        string unloadJson = "{\"unloadAllInScene\":false"
            + ",\"unloadAllLoadedByThisPlugin\":false"
            + ",\"allowUnloadingItemsLoadedByUserOrOtherPlugins\":false"
            + ",\"instanceIDs\":[\"" + instanceId + "\"]}";

        CPH.VTubeStudioSendRawRequest("ItemUnloadRequest", unloadJson);
        return true;
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
