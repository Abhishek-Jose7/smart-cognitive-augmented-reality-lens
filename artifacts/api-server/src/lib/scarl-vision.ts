import type { Logger } from "pino";

export interface VisionOverlay {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  severity?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface VisionResult {
  sceneSummary: string;
  spokenReply: string;
  primaryFocus: string;
  overlays: VisionOverlay[];
}

const NIM_BASE_URL =
  process.env["NVIDIA_NIM_BASE_URL"] ?? "https://integrate.api.nvidia.com/v1";
const NIM_MODEL =
  process.env["NVIDIA_NIM_MODEL"] ?? "meta/llama-3.2-11b-vision-instruct";

// NIM caps inline image payloads at ~180KB of base64. Beyond that we'd have to
// upload to their assets endpoint, which is overkill for our use case — we just
// trim instead. Frontend already JPEG-compresses at quality 0.7.
const MAX_INLINE_IMAGE_BYTES = 180_000;

const SYSTEM_PROMPT = `You are Scarl — a Smart Cognitive Augmented Reality Lens — the AI inside a pair of wearable smart glasses worn by the user. You receive a single still frame from the user's field of view (landscape) and respond like a professional, calm assistant. Your job is to keep the user's view clear and only surface what matters.

Return STRICT JSON ONLY (no prose, no markdown fences, no comments) with this exact shape:

{
  "sceneSummary": "one short sentence describing the scene, max 80 chars",
  "spokenReply": "what to speak aloud — see SPEECH RULES below",
  "primaryFocus": "the dominant subject of the frame in 1-3 words, lowercase",
  "overlays": [
    {
      "id": "ov-1",
      "kind": "object" | "person" | "text" | "warning" | "suggestion" | "reminder" | "navigation" | "threat" | "info",
      "label": "Short Title-Case noun phrase, max 2 words",
      "detail": "optional one-line context, max 60 chars",
      "severity": "low" | "medium" | "high" | "critical",
      "x": 0.5, "y": 0.5, "w": 0.3, "h": 0.3
    }
  ]
}

OVERLAY RULES — keep view UNCLUTTERED:
- Box ONLY salient identifiable items. Skip background fill, generic ground, walls, sky, duplicates, tiny irrelevant trinkets.
- Return 3 to 8 overlays. Fewer is better. Empty list is fine if there's truly nothing notable.
- Each overlay = one tightly-fit box around ONE thing. Coordinates normalized [0,1], (0,0) top-left, x/y are CENTER.
- 'label' = short noun ("Laptop", "Mug", "Door", "Person", "Plant"). No all-caps, no exclamation, max 2 words.
- 'detail' is OPTIONAL — include only when useful: a quoted reading of visible text, a state ("Open", "Half full", "Plugged in"), a hazard reason ("Hot — steam visible"). Max 50 chars. Omit otherwise.
- 'kind' guidance:
    - 'object' for inanimate things (default)
    - 'person' for humans (do not guess identity)
    - 'text' for prominent readable text/signage — ALWAYS quote what it says in 'detail' (e.g. "Reads: PUSH TO EXIT")
    - 'warning' for mild hazards (sharp, hot, slippery)
    - 'threat' for serious danger (fire, oncoming vehicle)
    - 'navigation' for directional cues — prepend an arrow in label ("↑ Doorway", "← Exit")
    - 'reminder' / 'suggestion' for proactive nudges (medicine, posture, fatigue) — use sparingly
    - 'info' only when nothing else fits
- 'severity' default 'low'. 'high' for risky. 'critical' only for true emergencies.
- ALWAYS provide non-trivial w and h (0.06 - 0.45). Tightly hug the actual object.

SPEECH RULES (THIS IS IMPORTANT):
- The frontend already labels objects visually. DO NOT narrate every object. Speech is for ASSISTANCE, not narration.
- spokenReply may be an EMPTY STRING ("") if there is nothing genuinely useful to say. Prefer silence over chatter.
- Speak ONLY in these cases:
    1. The frame contains a question, request, or instructional text that the user could be asking about → ANSWER the question concisely. Example text "What is 12 + 7?" → spokenReply: "Twelve plus seven is nineteen."
    2. The frame contains other prominent text the user would want read → quote it briefly. Example sign "Closed for renovation" → spokenReply: "The sign reads 'Closed for renovation'."
    3. There is a hazard (kind=warning/threat or severity=high/critical) → lead with the hazard. Example: "Heads up — kettle is steaming, watch your hand."
    4. There's a useful proactive insight (medicine, fatigue, navigation) → say it briefly.
    5. The user asked a direct question via the prompt below → answer it.
- Otherwise: spokenReply = "" (empty). DO NOT describe the room.
- Max 1 sentence, ~16 words. Address the user as "you". No "I see…" intros.

EDGE CASES:
- Blank/dark/unreadable frame: return ONE 'info' overlay { label: "Vision Unclear", detail: "Frame too dark or covered" } centered, spokenReply: "Vision is unclear — point the lens at something I can see."
- Camera covered: same as above.

ABSOLUTE RULES:
- Never apologize. Never refuse. Never explain that you are an AI or a model.
- NEVER include markdown, code fences, comments, or any text outside the JSON object.`;

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in model response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeOverlay(raw: unknown, idx: number): VisionOverlay {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof o.id === "string" && o.id.length > 0 ? o.id : `ov-${idx + 1}`,
    kind: typeof o.kind === "string" ? o.kind : "object",
    label:
      typeof o.label === "string" && o.label.length > 0
        ? o.label.slice(0, 32)
        : "Object",
    detail: typeof o.detail === "string" ? o.detail.slice(0, 80) : undefined,
    severity: typeof o.severity === "string" ? o.severity : "low",
    x: clamp01(o.x, 0.5),
    y: clamp01(o.y, 0.5),
    w: clamp01(o.w, 0.2),
    h: clamp01(o.h, 0.2),
  };
}

function fallbackResult(reason: string): VisionResult {
  return {
    sceneSummary: "Vision offline",
    spokenReply: "Scarl vision is temporarily offline.",
    primaryFocus: "unknown",
    overlays: [
      {
        id: "ov-fallback",
        kind: "warning",
        label: "Vision Offline",
        detail: reason.slice(0, 80),
        severity: "medium",
        x: 0.5,
        y: 0.5,
        w: 0.4,
        h: 0.2,
      },
    ],
  };
}

export async function analyzeFrame(args: {
  imageBase64: string;
  mimeType: string;
  prompt?: string;
  mode?: string;
  log: Logger;
}): Promise<VisionResult> {
  const { imageBase64, mimeType, prompt, mode, log } = args;

  const apiKey = process.env["NVIDIA_NIM_API_KEY"];
  if (!apiKey) {
    log.error("Missing NVIDIA_NIM_API_KEY");
    return fallbackResult("API key not configured.");
  }

  if (imageBase64.length > MAX_INLINE_IMAGE_BYTES) {
    log.warn(
      { bytes: imageBase64.length },
      "Image exceeds NIM inline limit; vision call will likely fail",
    );
    return fallbackResult("Image too large for inline upload.");
  }

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const userInstruction = [
    `Mode: ${mode ?? "scan"}.`,
    prompt
      ? `User said: "${prompt}". Treat this as a direct question — answer it concisely in spokenReply.`
      : "Standard ambient scan.",
    "Return the JSON object now.",
  ].join(" ");

  // NIM's vision models expect the image as an inline HTML <img> tag inside
  // the user message string, not as an OpenAI-style image_url content part.
  const userContent = `${userInstruction}\n\n<img src="${dataUrl}" />`;

  try {
    const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: NIM_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body: body.slice(0, 500) }, "NIM error");
      return fallbackResult(`NIM ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) {
      log.warn("Empty NIM response");
      return fallbackResult("Empty response from vision model.");
    }

    const parsed = tryParseJson(text) as Record<string, unknown>;
    const overlaysRaw = Array.isArray(parsed.overlays) ? parsed.overlays : [];

    return {
      sceneSummary:
        typeof parsed.sceneSummary === "string" && parsed.sceneSummary.length > 0
          ? parsed.sceneSummary.slice(0, 140)
          : "Scene captured.",
      spokenReply:
        typeof parsed.spokenReply === "string" ? parsed.spokenReply.slice(0, 400) : "",
      primaryFocus:
        typeof parsed.primaryFocus === "string" ? parsed.primaryFocus : "scene",
      overlays: overlaysRaw.slice(0, 12).map(normalizeOverlay),
    };
  } catch (err) {
    log.error({ err }, "Vision analysis failed");
    const reason = err instanceof Error ? err.message : "Unknown error.";
    return fallbackResult(reason);
  }
}
