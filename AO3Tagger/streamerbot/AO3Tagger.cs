using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public class CPHInline
{
    // ===== CONFIG =====
    private const string GLOBAL_REPO_ROOT = "SARXINA_TOYS";
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
    private const string PIN_ARTMESH_PATTERN = "head";

    // ==================

    public bool Execute()
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

        if (string.IsNullOrEmpty(arg)) return true;

        tags.Add(arg);
        CPH.SetGlobalVar(TAGS_VAR, string.Join("|", tags), false);

        // Render and display
        byte[] pngBytes = RenderTagImage(tags);
        if (pngBytes == null) return false;

        string base64 = Convert.ToBase64String(pngBytes);

        // Unload previous item
        UnloadCurrentItem();

        // Load new item
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

        // Pin to head
        string pinMesh = FindPinMesh();
        if (!string.IsNullOrEmpty(pinMesh))
        {
            string pinJson = "{\"pin\":true"
                + ",\"itemInstanceID\":\"" + instanceId + "\""
                + ",\"angleRelativeTo\":\"RelativeToModel\""
                + ",\"sizeRelativeTo\":\"RelativeToWorld\""
                + ",\"vertexPinType\":\"Center\""
                + ",\"pinInfo\":{\"modelID\":\"\",\"artMeshID\":\"" + pinMesh + "\",\"angle\":0,\"size\":" + ITEM_SIZE.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) + "}}";
            CPH.VTubeStudioSendRawRequest("ItemPinRequest", pinJson);
        }

        return true;
    }

    private byte[] RenderTagImage(List<string> tags)
    {
        using (Font font = new Font(FONT_FAMILY, FONT_SIZE, FontStyle.Regular, GraphicsUnit.Pixel))
        using (Font commaFont = new Font(FONT_FAMILY, FONT_SIZE, FontStyle.Regular, GraphicsUnit.Pixel))
        {
            // AO3 colors
            Color tagColor = Color.FromArgb(153, 0, 0);    // #900
            Color commaColor = Color.FromArgb(42, 42, 42);  // #2a2a2a
            Color bgColor = Color.White;

            // First pass: measure total height
            float lineHeight = FONT_SIZE * LINE_SPACING;
            float contentWidth = MAX_WIDTH - (PADDING_H * 2);

            // Measure all tag widths and comma
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

            // Calculate layout: which tags on which line
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
                    neededWidth = tagWidths[i]; // no comma at start of line
                }

                currentLine.Add(i);
                currentX += neededWidth;
            }
            if (currentLine.Count > 0) lines.Add(currentLine);

            // Calculate actual content width
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

            // Add extra transparent space below so the pin point (image center) sits above the text
            int textHeight = (int)(PADDING_V * 2 + lines.Count * lineHeight);
            int bottomOffset = 80; // pushes the visual content above the pin point
            int totalHeight = Math.Max(64, textHeight + bottomOffset);
            int totalWidth = Math.Max(64, (int)(PADDING_H * 2 + maxLineWidth + 2));

            // Second pass: render
            using (Bitmap bmp = new Bitmap(totalWidth, totalHeight))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    g.Clear(Color.Transparent);
                    // Draw white background only for the text area
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

                                // Draw comma before tag (except first on line)
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

    private string FindPinMesh()
    {
        string resp = CPH.VTubeStudioSendRawRequest("ArtMeshListRequest", "{}");
        if (string.IsNullOrEmpty(resp)) return "";

        string arrayStart = "\"artMeshNames\":[";
        int idx = resp.IndexOf(arrayStart);
        if (idx < 0) return "";
        idx += arrayStart.Length;
        int arrayEnd = resp.IndexOf("]", idx);
        if (arrayEnd < 0) return "";

        string section = resp.Substring(idx, arrayEnd - idx);
        string[] meshes = section.Replace("\"", "").Split(',');

        // Look for forehead-area mesh — common Live2D naming conventions
        // Priority: forehead > eyebrow > brow > nose > face (avoid "head" — matches BackHead on many models)
        string[] patterns = new string[] { "forehead", "eyebrow", "brow", "nose", "face" };
        foreach (string pattern in patterns)
        {
            foreach (string mesh in meshes)
            {
                if (mesh.Trim().ToLower().Contains(pattern))
                    return mesh.Trim();
            }
        }

        return meshes.Length > 0 ? meshes[0].Trim() : "";
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
