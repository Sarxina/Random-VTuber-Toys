using System;
using System.Collections.Generic;

public class CPHInline
{
    // Configuration
    private const int FPS = 30;
    private const int DURATION_MS = 5000;
    private const int FRAME_INTERVAL = 1000 / FPS;

    private static readonly Random rng = new Random();

    // Parameter definitions: name, min, max
    private static readonly (string name, double min, double max)[] Params = new[]
    {
        ("FaceAngleX",  -30.0,  30.0),
        ("FaceAngleY",  -30.0,  30.0),
        ("FaceAngleZ",  -30.0,  30.0),
        ("FacePositionX", -10.0, 10.0),
        ("FacePositionY", -10.0, 10.0),
        ("EyeOpenLeft",   0.0,   1.0),
        ("EyeOpenRight",  0.0,   1.0),
        ("EyeLeftX",     -1.0,   1.0),
        ("EyeLeftY",     -1.0,   1.0),
        ("EyeRightX",    -1.0,   1.0),
        ("EyeRightY",    -1.0,   1.0),
        ("MouthOpen",     0.0,   1.0),
        ("MouthSmile",   -1.0,   1.0),
        ("BrowLeftY",    -1.0,   1.0),
        ("BrowRightY",   -1.0,   1.0),
        ("BodyAngleX",  -15.0,  15.0),
        ("BodyAngleY",  -15.0,  15.0),
        ("BodyAngleZ",  -15.0,  15.0),
    };

    public bool Execute()
    {
        int totalFrames = DURATION_MS / FRAME_INTERVAL;

        for (int frame = 0; frame < totalFrames; frame++)
        {
            var paramList = new List<string>();

            foreach (var (name, min, max) in Params)
            {
                // Pure random each frame — snap between extremes
                double val;
                int technique = rng.Next(4);

                switch (technique)
                {
                    case 0: // Snap to min or max
                        val = rng.NextDouble() < 0.5 ? min : max;
                        break;
                    case 1: // High-frequency oscillation
                        double freq = 8.0 + rng.NextDouble() * 32.0;
                        double elapsed = (double)frame / FPS;
                        val = (min + max) / 2.0 + (max - min) / 2.0 * Math.Sin(elapsed * freq * 2 * Math.PI);
                        break;
                    case 2: // Full random
                        val = min + rng.NextDouble() * (max - min);
                        break;
                    default: // Hold at extreme
                        val = frame % 7 < 3 ? min : max;
                        break;
                }

                paramList.Add($"{{\"id\":\"{name}\",\"value\":{val:F3}}}");
            }

            string json = $"{{\"faceFound\":true,\"mode\":\"set\",\"parameterValues\":[{string.Join(",", paramList)}]}}";

            CPH.VTubeStudioSendRawRequest("InjectParameterDataRequest", json);
            CPH.Wait(FRAME_INTERVAL);
        }

        return true;
    }
}
