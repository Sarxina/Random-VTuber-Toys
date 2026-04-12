using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

/*
 * ============================================================
 *  AO3Tagger for Streamer.bot — by Sarxina
 * ============================================================
 *
 *  TRIGGERS:
 *    1. Twitch Chat Message — fires on !ao3tag commands
 *    2. VTube Studio > Model Clicked (DISABLED by default)
 *
 *  If the tag appears in a strange place (or doesn't appear
 *  at all), it's because the plugin couldn't auto-detect
 *  your forehead. To fix this:
 *
 *    1. Enable the "Model Clicked" trigger above
 *    2. Click on your model's forehead in VTube Studio
 *    3. You'll see a confirmation in chat
 *    4. Disable the "Model Clicked" trigger
 *
 *  That's it — the position is saved and used from now on.
 *  To reset it later, type !ao3tag reset in chat.
 * ============================================================
 */

public class CPHInline
{
    // ===== CONFIG =====
    private const string CONFIG_VAR = "SARXINA_CONFIG";
    private const string TAGS_VAR = "AO3Tagger_Tags";
    private const string ITEM_ID_VAR = "AO3Tagger_ItemID";

    // Rendering
    private const string FONT_FAMILY = "Verdana";
    private const float FONT_SIZE = 13f;
    private const int MAX_WIDTH = 500;
    private const int PADDING_H = 12;
    private const int PADDING_V = 4;
    private const float LINE_SPACING = 1.35f;

    // VTS item
    private const double ITEM_SIZE = 0.42;

    // Forehead detection fallback patterns (tried in order)
    private static readonly string[][] FALLBACK_PATTERNS = new string[][]
    {
        new[] { "forehead" },
        new[] { "hair_front", "hair_mid", "bangs", "fringe" },
        new[] { "brow", "eyebrow" },
        new[] { "eye" },
        new[] { "nose" },
        new[] { "face", "FaceColor", "D_FACE" },
    };

    // ==================

    public bool Execute()
    {
        // Check if this was triggered by a model click (calibration)
        bool isModelClick = false;
        CPH.TryGetArg("modelWasClicked", out isModelClick);

        if (isModelClick)
            return HandleCalibrationClick();

        return HandleChatCommand();
    }

    // ===== CALIBRATION (Model Clicked trigger) =====

    private bool HandleCalibrationClick()
    {
        // Streamer.bot exposes the ModelClickedEvent data as args.
        // The exact variable names depend on how Streamer.bot flattens
        // the JSON. Try the most likely patterns.
        //
        // If this doesn't work on your version, add a test action that
        // dumps all args to find the exact names:
        //   foreach (var kvp in args)
        //       CPH.LogInfo($"{kvp.Key} = {kvp.Value}");

        string artMeshID = "";
        string modelID = "";
        string vertexID1 = "0", vertexID2 = "0", vertexID3 = "0";
        string vertexWeight1 = "0", vertexWeight2 = "0", vertexWeight3 = "0";

        // Pattern 1: Streamer.bot flattens with dot notation
        if (CPH.TryGetArg("artMeshHits.0.hitInfo.artMeshID", out string dotArtMesh))
        {
            artMeshID = dotArtMesh;
            CPH.TryGetArg("artMeshHits.0.hitInfo.modelID", out modelID);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexID1", out vertexID1);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexID2", out vertexID2);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexID3", out vertexID3);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexWeight1", out vertexWeight1);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexWeight2", out vertexWeight2);
            CPH.TryGetArg("artMeshHits.0.hitInfo.vertexWeight3", out vertexWeight3);
        }
        // Pattern 2: Streamer.bot uses bracket notation
        else if (CPH.TryGetArg("artMeshHits[0].hitInfo.artMeshID", out string bracketArtMesh))
        {
            artMeshID = bracketArtMesh;
            CPH.TryGetArg("artMeshHits[0].hitInfo.modelID", out modelID);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexID1", out vertexID1);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexID2", out vertexID2);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexID3", out vertexID3);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexWeight1", out vertexWeight1);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexWeight2", out vertexWeight2);
            CPH.TryGetArg("artMeshHits[0].hitInfo.vertexWeight3", out vertexWeight3);
        }
        else
        {
            // Could not find artmesh data — log all args for debugging
            CPH.LogWarn("AO3Tagger: Could not find artmesh hit data in Model Clicked args.");
            CPH.LogWarn("AO3Tagger: Please run a test action that dumps all args to find the correct variable names.");
            CPH.SendMessage("Could not read the click data. Check Streamer.bot logs for details.");
            return true;
        }

        if (string.IsNullOrEmpty(artMeshID))
        {
            CPH.SendMessage("Click didn't land on the model. Try again!");
            return true;
        }

        // Save to config
        var config = LoadConfig();
        config["foreheadPin"] = artMeshID + "|" + (modelID ?? "")
            + "|" + vertexID1 + "|" + vertexID2 + "|" + vertexID3
            + "|" + vertexWeight1 + "|" + vertexWeight2 + "|" + vertexWeight3;
        SaveConfig(config);

        CPH.SendMessage("Forehead position saved! You can now disable the Model Clicked trigger.");
        return true;
    }

    // ===== CHAT COMMAND (!ao3tag) =====

    private bool HandleChatCommand()
    {
        string message = "";
        CPH.TryGetArg("message", out message);
        string lower = (message ?? "").Trim().ToLower();

        if (!lower.StartsWith("!ao3tag")) return true;

        string arg = (message ?? "").Trim();
        if (arg.Length > 7) arg = arg.Substring(7).Trim();
        else arg = "";

        // Get current tags
        string tagsStr = CPH.GetGlobalVar<string>(TAGS_VAR, false) ?? "";
        List<string> tags = new List<string>();
        if (!string.IsNullOrEmpty(tagsStr))
        {
            foreach (string t in tagsStr.Split('|'))
            {
                if (!string.IsNullOrEmpty(t)) tags.Add(t);
            }
        }

        if (lower == "!ao3tag clear" || lower == "!ao3tag off")
        {
            tags.Clear();
            CPH.SetGlobalVar(TAGS_VAR, "", false);
            UnloadCurrentItem();
            return true;
        }

        if (lower == "!ao3tag reset")
        {
            var config = LoadConfig();
            config.Remove("foreheadPin");
            SaveConfig(config);
            CPH.SendMessage("Forehead position reset. It will auto-detect next time, or enable the Model Clicked trigger to set it manually.");
            return true;
        }

        if (string.IsNullOrEmpty(arg)) return true;

        tags.Add(arg);
        CPH.SetGlobalVar(TAGS_VAR, string.Join("|", tags), false);

        // Render and display
        byte[] pngBytes = RenderTagImage(tags);
        if (pngBytes == null) return false;

        string base64 = Convert.ToBase64String(pngBytes);

        UnloadCurrentItem();

        // Load item
        string loadJson = "{\"fileName\":\"ao3taggerimg.png\""
            + ",\"positionX\":0,\"positionY\":0.7"
            + ",\"size\":" + ITEM_SIZE.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)
            + ",\"rotation\":0,\"fadeTime\":0.1,\"order\":25"
            + ",\"failIfOrderTaken\":false,\"smoothing\":0"
            + ",\"censored\":false,\"flipped\":false,\"locked\":false"
            + ",\"unloadWhenPluginDisconnects\":true"
            + ",\"customDataBase64\":\"" + base64 + "\""
            + ",\"customDataAskUserFirst\":false"
            + ",\"customDataSkipAskingUserIfWhitelisted\":true"
            + ",\"customDataAskTimer\":-1}";

        string loadResp = CPH.VTubeStudioSendRawRequest("ItemLoadRequest", loadJson);
        if (string.IsNullOrEmpty(loadResp) || loadResp.Contains("\"success\":false"))
            return false;

        string instanceId = ExtractJsonValue(loadResp, "instanceID");
        if (string.IsNullOrEmpty(instanceId)) return false;

        CPH.SetGlobalVar(ITEM_ID_VAR, instanceId, false);

        // Try to pin
        PinItem(instanceId);

        return true;
    }

    // ===== PINNING =====

    private void PinItem(string instanceId)
    {
        // First check for a saved calibration pin
        var config = LoadConfig();
        if (config.ContainsKey("foreheadPin"))
        {
            string pinData = config["foreheadPin"];
            string[] parts = pinData.Split('|');
            if (parts.Length >= 8)
            {
                PinWithVertexData(instanceId, parts[0], parts[1],
                    parts[2], parts[3], parts[4],
                    parts[5], parts[6], parts[7]);
                return;
            }
        }

        // No saved pin — try auto-detect
        string resp = CPH.VTubeStudioSendRawRequest("ArtMeshListRequest", "{}");
        if (string.IsNullOrEmpty(resp)) return;

        List<string> meshes = ExtractArtMeshNames(resp);

        foreach (string[] patterns in FALLBACK_PATTERNS)
        {
            foreach (string pattern in patterns)
            {
                // Find a center mesh (no left/right) first
                string centerMatch = meshes.Find(m =>
                    m.ToLower().Contains(pattern.ToLower())
                    && !m.ToLower().Contains("left")
                    && !m.ToLower().Contains("right")
                    && !m.ToLower().Contains("_l_")
                    && !m.ToLower().Contains("_r_"));

                if (!string.IsNullOrEmpty(centerMatch))
                {
                    PinToMeshCenter(instanceId, centerMatch);
                    return;
                }

                // Fall back to any match
                string anyMatch = meshes.Find(m => m.ToLower().Contains(pattern.ToLower()));
                if (!string.IsNullOrEmpty(anyMatch))
                {
                    PinToMeshCenter(instanceId, anyMatch);
                    return;
                }
            }
        }

        // Nothing found — no pin, item floats at load position
    }

    private void PinToMeshCenter(string instanceId, string artMeshId)
    {
        string pinJson = "{\"pin\":true"
            + ",\"itemInstanceID\":\"" + instanceId + "\""
            + ",\"angleRelativeTo\":\"RelativeToModel\""
            + ",\"sizeRelativeTo\":\"RelativeToWorld\""
            + ",\"vertexPinType\":\"Center\""
            + ",\"pinInfo\":{\"modelID\":\"\",\"artMeshID\":\"" + artMeshId
            + "\",\"angle\":0,\"size\":" + ITEM_SIZE.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) + "}}";
        CPH.VTubeStudioSendRawRequest("ItemPinRequest", pinJson);
    }

    private void PinWithVertexData(string instanceId, string artMeshId, string modelId,
        string v1, string v2, string v3, string w1, string w2, string w3)
    {
        string pinJson = "{\"pin\":true"
            + ",\"itemInstanceID\":\"" + instanceId + "\""
            + ",\"angleRelativeTo\":\"RelativeToModel\""
            + ",\"sizeRelativeTo\":\"RelativeToWorld\""
            + ",\"vertexPinType\":\"Provided\""
            + ",\"pinInfo\":{\"modelID\":\"" + modelId + "\""
            + ",\"artMeshID\":\"" + artMeshId + "\""
            + ",\"angle\":0"
            + ",\"size\":" + ITEM_SIZE.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)
            + ",\"vertexID1\":" + v1
            + ",\"vertexID2\":" + v2
            + ",\"vertexID3\":" + v3
            + ",\"vertexWeight1\":" + w1
            + ",\"vertexWeight2\":" + w2
            + ",\"vertexWeight3\":" + w3 + "}}";
        CPH.VTubeStudioSendRawRequest("ItemPinRequest", pinJson);
    }

    // ===== CONFIG (SARXINA_CONFIG) =====

    private Dictionary<string, string> LoadConfig()
    {
        string raw = CPH.GetGlobalVar<string>(CONFIG_VAR, false) ?? "{}";
        var result = new Dictionary<string, string>();
        // Simple key:value parser (no nested objects)
        raw = raw.Trim().TrimStart('{').TrimEnd('}');
        if (string.IsNullOrEmpty(raw)) return result;

        foreach (string pair in raw.Split(','))
        {
            string[] kv = pair.Split(new[] { ':' }, 2);
            if (kv.Length == 2)
            {
                string key = kv[0].Trim().Trim('"');
                string val = kv[1].Trim().Trim('"');
                result[key] = val;
            }
        }
        return result;
    }

    private void SaveConfig(Dictionary<string, string> config)
    {
        var pairs = new List<string>();
        foreach (var kvp in config)
        {
            pairs.Add("\"" + kvp.Key + "\":\"" + kvp.Value + "\"");
        }
        CPH.SetGlobalVar(CONFIG_VAR, "{" + string.Join(",", pairs) + "}", false);
    }

    // ===== RENDERING =====

    private byte[] RenderTagImage(List<string> tags)
    {
        using (Font font = new Font(FONT_FAMILY, FONT_SIZE, FontStyle.Regular, GraphicsUnit.Pixel))
        using (Font commaFont = new Font(FONT_FAMILY, FONT_SIZE, FontStyle.Regular, GraphicsUnit.Pixel))
        {
            Color tagColor = Color.FromArgb(153, 0, 0);
            Color commaColor = Color.FromArgb(42, 42, 42);
            Color bgColor = Color.White;

            float lineHeight = FONT_SIZE * LINE_SPACING;
            float contentWidth = MAX_WIDTH - (PADDING_H * 2);

            List<float> tagWidths = new List<float>();
            float commaWidth;

            using (Bitmap temp = new Bitmap(1, 1))
            using (Graphics g = Graphics.FromImage(temp))
            {
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                StringFormat sf = StringFormat.GenericTypographic;
                sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;

                foreach (string tag in tags)
                {
                    SizeF size = g.MeasureString(tag, font, 9999, sf);
                    tagWidths.Add(size.Width);
                }
                commaWidth = g.MeasureString(", ", commaFont, 9999, sf).Width;
            }

            List<List<int>> lines = new List<List<int>>();
            List<int> currentLine = new List<int>();
            float currentX = 0;

            for (int i = 0; i < tags.Count; i++)
            {
                float neededWidth = tagWidths[i];
                if (i > 0 && currentLine.Count > 0) neededWidth += commaWidth;

                if (currentX + neededWidth > contentWidth && currentLine.Count > 0)
                {
                    lines.Add(currentLine);
                    currentLine = new List<int>();
                    currentX = 0;
                    neededWidth = tagWidths[i];
                }

                currentLine.Add(i);
                currentX += neededWidth;
            }
            if (currentLine.Count > 0) lines.Add(currentLine);

            float maxLineWidth = 0;
            for (int lineIdx = 0; lineIdx < lines.Count; lineIdx++)
            {
                float lineWidth = 0;
                for (int li = 0; li < lines[lineIdx].Count; li++)
                {
                    if (li > 0) lineWidth += commaWidth;
                    lineWidth += tagWidths[lines[lineIdx][li]];
                }
                if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
            }

            int textHeight = (int)(PADDING_V * 2 + lines.Count * lineHeight);
            int totalHeight = Math.Max(64, textHeight);
            int totalWidth = Math.Max(64, (int)(PADDING_H * 2 + maxLineWidth + 2));

            using (Bitmap bmp = new Bitmap(totalWidth, totalHeight))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    g.Clear(Color.Transparent);
                    g.FillRectangle(new SolidBrush(bgColor), 0, 0, totalWidth, textHeight);

                    StringFormat sf = StringFormat.GenericTypographic;
                    sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;

                    using (Brush tagBrush = new SolidBrush(tagColor))
                    using (Brush commaBrush = new SolidBrush(commaColor))
                    {
                        float y = PADDING_V;

                        foreach (List<int> line in lines)
                        {
                            float x = PADDING_H;

                            for (int li = 0; li < line.Count; li++)
                            {
                                int tagIdx = line[li];

                                if (li > 0)
                                {
                                    g.DrawString(", ", commaFont, commaBrush, x, y, sf);
                                    x += commaWidth;
                                }

                                g.DrawString(tags[tagIdx], font, tagBrush, x, y, sf);
                                x += tagWidths[tagIdx];
                            }

                            y += lineHeight;
                        }
                    }
                }

                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return ms.ToArray();
                }
            }
        }
    }

    // ===== HELPERS =====

    private void UnloadCurrentItem()
    {
        string instanceId = CPH.GetGlobalVar<string>(ITEM_ID_VAR, false) ?? "";
        if (string.IsNullOrEmpty(instanceId)) return;

        string unloadJson = "{\"unloadAllInScene\":false"
            + ",\"unloadAllLoadedByThisPlugin\":false"
            + ",\"allowUnloadingItemsLoadedByUserOrOtherPlugins\":false"
            + ",\"instanceIDs\":[\"" + instanceId + "\"]}";

        CPH.VTubeStudioSendRawRequest("ItemUnloadRequest", unloadJson);
        CPH.SetGlobalVar(ITEM_ID_VAR, "", false);
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

    private List<string> ExtractArtMeshNames(string json)
    {
        var result = new List<string>();
        string arrayStart = "\"artMeshNames\":[";
        int idx = json.IndexOf(arrayStart);
        if (idx < 0) return result;
        idx += arrayStart.Length;
        int arrayEnd = json.IndexOf("]", idx);
        if (arrayEnd < 0) return result;

        string section = json.Substring(idx, arrayEnd - idx);
        string[] names = section.Replace("\"", "").Split(',');
        foreach (string name in names)
        {
            string trimmed = name.Trim();
            if (!string.IsNullOrEmpty(trimmed))
                result.Add(trimmed);
        }
        return result;
    }
}
