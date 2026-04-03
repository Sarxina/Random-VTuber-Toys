// VTube Studio connection
export const VTS_API_URL = process.env.VTS_API_URL || "ws://localhost:8004";

// Artmesh to pin the emote onto (center of the face)
export const PIN_ARTMESH = "FaceColorMain";

// Emote image to use as placeholder
export const DEFAULT_EMOTE_PATH = "./emotes/brainded.png";

// Emote size when pinned (0-1)
export const EMOTE_SIZE = 0.4;

// Chat command to trigger the emote head
export const TRIGGER_COMMAND = "!emojihead";

// Artmesh name patterns to hide when the emote is active.
// These are partial matches — any artmesh whose name contains one of these strings will be hidden.
// Covers face, eyes, nose, mouth, eyebrows, blush, freckles.
// Does NOT hide: ears, hair, glasses, earrings, neck pieces, or other accessories.
export const FACE_HIDE_PATTERNS = [
  "FaceColor",
  "Freckles",
  "EyePupil",
  "Sclera",
  "Eyelash",
  "Eyelid",
  "ShadowOverEyes",
  "Eyebrow",
  "NoseMask",
  "NoseShadow",
  "NoseWhiteDot",
  "Nostrils",
  "Lips",
  "Mouth",
  "Tongue",
  "Teeth",
  "Canine",
  "Blush",
  "TopColor",
  "BottomColor",
];
