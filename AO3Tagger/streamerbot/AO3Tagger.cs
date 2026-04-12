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
        CPH.TryGetArg("triggerName", out string triggerName);
        if (triggerName == "Model Clicked")
            return HandleCalibrationClick();

        return HandleChatCommand();
    }

    // ===== CALIBRATION (Model Clicked trigger) =====

    private bool HandleCalibrationClick()
    {
        CPH.TryGetArg("artMesh0.hitInfo.artMeshId", out string artMeshId);
        CPH.TryGetArg("artMesh0.hitInfo.modelId", out string modelId);
        CPH.TryGetArg("artMesh0.hitInfo.vertexId1", out double v1);
        CPH.TryGetArg("artMesh0.hitInfo.vertexId2", out double v2);
        CPH.TryGetArg("artMesh0.hitInfo.vertexId3", out double v3);
        CPH.TryGetArg("artMesh0.hitInfo.vertexWeight1", out double w1);
        CPH.TryGetArg("artMesh0.hitInfo.vertexWeight2", out double w2);
        CPH.TryGetArg("artMesh0.hitInfo.vertexWeight3", out double w3);

        if (string.IsNullOrEmpty(artMeshId))
            return true;

        // Save precise forehead location — always overwrites
        string foreheadJson = "{\"type\":\"precise\""
            + ",\"artMeshId\":\"" + artMeshId + "\""
            + ",\"modelId\":\"" + (modelId ?? "") + "\""
            + ",\"vertexId1\":" + v1
            + ",\"vertexId2\":" + v2
            + ",\"vertexId3\":" + v3
            + ",\"vertexWeight1\":" + w1
            + ",\"vertexWeight2\":" + w2
            + ",\"vertexWeight3\":" + w3
            + "}";

        SaveConfigValue("foreheadLocation", foreheadJson);
        CPH.SendMessage("Forehead position saved! You can disable the Model Clicked trigger now.");
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
            RemoveConfigValue("foreheadLocation");
            CPH.SendMessage("Forehead position reset.");
            return true;
        }

        if (string.IsNullOrEmpty(arg)) return true;

        tags.Add(arg);
        CPH.SetGlobalVar(TAGS_VAR, string.Join("|", tags), false);

        // Render
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

        PinItem(instanceId);

        return true;
    }

    // ===== PINNING =====

    private void PinItem(string instanceId)
    {
        // 1. Check for saved foreheadLocation
        string foreheadJson = GetConfigValue("foreheadLocation");
        if (!string.IsNullOrEmpty(foreheadJson))
        {
            string type = ExtractJsonValue(foreheadJson, "type");
            string artMeshId = ExtractJsonValue(foreheadJson, "artMeshId");

            if (type == "precise")
            {
                PinWithVertexData(instanceId, artMeshId,
                    ExtractJsonValue(foreheadJson, "modelId"),
                    ExtractJsonNumber(foreheadJson, "vertexId1"),
                    ExtractJsonNumber(foreheadJson, "vertexId2"),
                    ExtractJsonNumber(foreheadJson, "vertexId3"),
                    ExtractJsonNumber(foreheadJson, "vertexWeight1"),
                    ExtractJsonNumber(foreheadJson, "vertexWeight2"),
                    ExtractJsonNumber(foreheadJson, "vertexWeight3"));
                return;
            }
            else if (type == "center" && !string.IsNullOrEmpty(artMeshId))
            {
                PinToMeshCenter(instanceId, artMeshId);
                return;
            }
        }

        // 2. No saved location — try auto-detect
        string resp = CPH.VTubeStudioSendRawRequest("ArtMeshListRequest", "{}");
        if (string.IsNullOrEmpty(resp))
        {
            ShowCannotFindPopup();
            return;
        }

        List<string> meshes = ExtractArtMeshNames(resp);
        string foundMesh = FindBestForeheadMesh(meshes);

        if (!string.IsNullOrEmpty(foundMesh))
        {
            // Save as center type for next time
            string centerJson = "{\"type\":\"center\",\"artMeshId\":\"" + foundMesh + "\"}";
            SaveConfigValue("foreheadLocation", centerJson);
            PinToMeshCenter(instanceId, foundMesh);
            return;
        }

        // 3. Auto-detect failed — show popup in VTS
        ShowCannotFindPopup();
    }

    private string FindBestForeheadMesh(List<string> meshes)
    {
        foreach (string[] patterns in FALLBACK_PATTERNS)
        {
            foreach (string pattern in patterns)
            {
                // Prefer center meshes (no left/right)
                string centerMatch = meshes.Find(m =>
                    m.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0
                    && m.IndexOf("left", StringComparison.OrdinalIgnoreCase) < 0
                    && m.IndexOf("right", StringComparison.OrdinalIgnoreCase) < 0
                    && m.IndexOf("_l_", StringComparison.OrdinalIgnoreCase) < 0
                    && m.IndexOf("_r_", StringComparison.OrdinalIgnoreCase) < 0);

                if (!string.IsNullOrEmpty(centerMatch))
                    return centerMatch;

                // Fall back to any match
                string anyMatch = meshes.Find(m =>
                    m.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0);

                if (!string.IsNullOrEmpty(anyMatch))
                    return anyMatch;
            }
        }
        return null;
    }

    private void ShowCannotFindPopup()
    {
        string selectJson = "{\"textOverride\":\"Hey! AO3Tagger couldn't find your forehead mesh. "
            + "Could you close this, go to Streamer.bot, enable the Model Clicked trigger, "
            + "and click on your forehead? Check the green comment in the action for details!\""
            + ",\"helpOverride\":\"AO3Tagger needs to know where your forehead is to pin tags there. "
            + "Close this popup, then follow the instructions in the green comment at the top of the AO3Tagger action in Streamer.bot.\""
            + ",\"requestedArtMeshCount\":0"
            + ",\"activeArtMeshes\":[]}";

        CPH.VTubeStudioSendRawRequest("ArtMeshSelectionRequest", selectJson);
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

    // ===== SARXINA_CONFIG =====

    private string GetConfigValue(string key)
    {
        string raw = CPH.GetGlobalVar<string>(CONFIG_VAR, false) ?? "{}";

        string search = "\"" + key + "\":";
        int idx = raw.IndexOf(search);
        if (idx < 0) return null;

        idx += search.Length;
        while (idx < raw.Length && raw[idx] == ' ') idx++;
        if (idx >= raw.Length) return null;

        if (raw[idx] == '{')
        {
            int depth = 0;
            int start = idx;
            for (int i = idx; i < raw.Length; i++)
            {
                if (raw[i] == '{') depth++;
                else if (raw[i] == '}') depth--;
                if (depth == 0) return raw.Substring(start, i - start + 1);
            }
            return null;
        }

        int valStart = idx;
        if (raw[idx] == '"')
        {
            valStart++;
            int end = raw.IndexOf('"', valStart);
            return end >= 0 ? raw.Substring(valStart, end - valStart) : null;
        }

        int valEnd = raw.IndexOfAny(new[] { ',', '}' }, valStart);
        return valEnd >= 0 ? raw.Substring(valStart, valEnd - valStart).Trim() : null;
    }

    private void SaveConfigValue(string key, string jsonValue)
    {
        string raw = CPH.GetGlobalVar<string>(CONFIG_VAR, false) ?? "{}";

        string search = "\"" + key + "\":";
        int idx = raw.IndexOf(search);
        if (idx >= 0)
        {
            int valueStart = idx + search.Length;
            while (valueStart < raw.Length && raw[valueStart] == ' ') valueStart++;

            int valueEnd = valueStart;
            if (valueStart < raw.Length && raw[valueStart] == '{')
            {
                int depth = 0;
                for (int i = valueStart; i < raw.Length; i++)
                {
                    if (raw[i] == '{') depth++;
                    else if (raw[i] == '}') depth--;
                    if (depth == 0) { valueEnd = i + 1; break; }
                }
            }
            else
            {
                valueEnd = raw.IndexOfAny(new[] { ',', '}' }, valueStart);
                if (valueEnd < 0) valueEnd = raw.Length;
            }

            int removeStart = idx;
            int removeEnd = valueEnd;
            if (removeEnd < raw.Length && raw[removeEnd] == ',') removeEnd++;
            else if (removeStart > 0 && raw[removeStart - 1] == ',') removeStart--;

            raw = raw.Remove(removeStart, removeEnd - removeStart);
        }

        raw = raw.TrimEnd();
        if (raw.EndsWith("}"))
        {
            string inner = raw.Substring(1, raw.Length - 2).Trim();
            if (string.IsNullOrEmpty(inner))
                raw = "{\"" + key + "\":" + jsonValue + "}";
            else
                raw = "{" + inner + ",\"" + key + "\":" + jsonValue + "}";
        }

        CPH.SetGlobalVar(CONFIG_VAR, raw, false);
    }

    private void RemoveConfigValue(string key)
    {
        string raw = CPH.GetGlobalVar<string>(CONFIG_VAR, false) ?? "{}";

        string search = "\"" + key + "\":";
        int idx = raw.IndexOf(search);
        if (idx < 0) return;

        int valueStart = idx + search.Length;
        while (valueStart < raw.Length && raw[valueStart] == ' ') valueStart++;

        int valueEnd = valueStart;
        if (valueStart < raw.Length && raw[valueStart] == '{')
        {
            int depth = 0;
            for (int i = valueStart; i < raw.Length; i++)
            {
                if (raw[i] == '{') depth++;
                else if (raw[i] == '}') depth--;
                if (depth == 0) { valueEnd = i + 1; break; }
            }
        }
        else
        {
            valueEnd = raw.IndexOfAny(new[] { ',', '}' }, valueStart);
            if (valueEnd < 0) valueEnd = raw.Length;
        }

        int removeStart = idx;
        int removeEnd = valueEnd;
        if (removeEnd < raw.Length && raw[removeEnd] == ',') removeEnd++;
        else if (removeStart > 0 && raw[removeStart - 1] == ',') removeStart--;

        raw = raw.Remove(removeStart, removeEnd - removeStart);
        CPH.SetGlobalVar(CONFIG_VAR, raw, false);
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

    private string ExtractJsonNumber(string json, string key)
    {
        string search = "\"" + key + "\":";
        int start = json.IndexOf(search);
        if (start < 0) return "0";
        start += search.Length;
        int end = json.IndexOfAny(new[] { ',', '}', ' ' }, start);
        if (end < 0) return "0";
        return json.Substring(start, end - start).Trim();
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
