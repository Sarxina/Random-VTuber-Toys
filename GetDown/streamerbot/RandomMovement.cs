using System;
using System.Collections.Generic;

public class CPHInline
{
    private const string GLOBAL_VAR = "GetDown_Active";

    public bool Execute()
    {
        bool active = CPH.GetGlobalVar<bool>(GLOBAL_VAR, false);
        if (active)
        {
            CPH.SetGlobalVar(GLOBAL_VAR, false, false);
            return true;
        }

        CPH.SetGlobalVar(GLOBAL_VAR, true, false);

        var rng = new Random();
        int fps = 20;
        int frameInterval = 1000 / fps;

        string[] paramNames = new string[]
        {
            "FaceAngleX", "FaceAngleY", "FaceAngleZ",
            "FacePositionX", "FacePositionY",
            "EyeOpenLeft", "EyeOpenRight",
            "EyeLeftX", "EyeLeftY", "EyeRightX", "EyeRightY",
            "MouthOpen", "MouthSmile",
            "BrowLeftY", "BrowRightY",
            "BodyAngleX", "BodyAngleY", "BodyAngleZ",
        };
        double[] paramMin = new double[]
        {
            -30, -30, -30,
            -10, -10,
            0, 0,
            -1, -1, -1, -1,
            0, -1,
            -1, -1,
            -15, -15, -15,
        };
        double[] paramMax = new double[]
        {
            30, 30, 30,
            10, 10,
            1, 1,
            1, 1, 1, 1,
            1, 1,
            1, 1,
            15, 15, 15,
        };

        int frame = 0;
        while (CPH.GetGlobalVar<bool>(GLOBAL_VAR, false))
        {
            frame++;
            double elapsed = (double)frame / fps;
            var paramList = new List<string>();

            for (int p = 0; p < paramNames.Length; p++)
            {
                double min = paramMin[p];
                double max = paramMax[p];
                double mid = (min + max) / 2.0;
                double range = max - min;
                double val;

                int technique = rng.Next(4);
                switch (technique)
                {
                    case 0:
                        val = rng.NextDouble() < 0.5 ? min : max;
                        break;
                    case 1:
                        double freq = 8.0 + rng.NextDouble() * 32.0;
                        val = mid + (range / 2.0) * Math.Sin(elapsed * freq * 2 * Math.PI);
                        break;
                    case 2:
                        val = min + rng.NextDouble() * range;
                        break;
                    default:
                        val = frame % 7 < 3 ? min : max;
                        break;
                }

                paramList.Add("{\"id\":\"" + paramNames[p] + "\",\"weight\":1,\"value\":" + val.ToString("F3") + "}");
            }

            string json = "{\"faceFound\":true,\"mode\":\"set\",\"parameterValues\":[" + string.Join(",", paramList) + "]}";
            CPH.VTubeStudioSendRawRequest("InjectParameterDataRequest", json);
            System.Threading.Thread.Sleep(frameInterval);
        }

        return true;
    }
}
