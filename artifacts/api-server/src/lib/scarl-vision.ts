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

const MAX_INLINE_IMAGE_BYTES = 180_000;
const MAX_RETURNED_OVERLAYS = 6;

// Single model — skip router/extractor, go direct to vision model
const NIM_VISION_MODEL =
  process.env["NVIDIA_NIM_REASONER_MODEL"] ??
  process.env["NVIDIA_NIM_MODEL"] ??
  "meta/llama-3.2-11b-vision-instruct";

// Generous timeout — the #1 problem was 4-8s timeouts causing cascading failures
const VISION_TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT = `You are Scarl — a Smart Cognitive Augmented Reality Lens HUD AI. You receive a camera frame and return JSON analysis.

TEXT ANALYSIS IS YOUR ABSOLUTE HIGHEST PRIORITY. If there is ANY readable text, handwriting, screen text, book, or sign in the image, you MUST read it, transcribe it, and summarize it.

Return STRICT JSON ONLY (no prose, no markdown fences, no comments):

{
  "sceneSummary": "brief scene description, max 80 chars",
  "spokenReply": "useful analysis text for on-screen display, max 2 sentences",
  "primaryFocus": "dominant subject, 1-3 words lowercase",
  "overlays": [
    {
      "id": "ov-1",
      "kind": "text|warning|threat|person|object|navigation|suggestion|info",
      "label": "Short Label",
      "detail": "useful context about the item, max 50 chars",
      "severity": "low|medium|high|critical",
      "x": 0.5, "y": 0.5, "w": 0.3, "h": 0.3
    }
  ]
}

RULES:
- HIGHEST PRIORITY: If you see ANY text, set 'primaryFocus' to 'text'. Use 'spokenReply' to transcribe or summarize the text. Create an overlay with kind 'text' tightly boxing the text, and put the exact transcription in 'detail'.
- Return 2-6 overlays for the most notable items. Tightly fit each box around the actual object/text.
- x,y = center of object (0-1 normalized, 0,0=top-left). w,h = object size (0-1).
- 'detail' = useful context: color, state, brand, readable text. Include for every overlay.
- 'spokenReply' = brief analysis shown as text overlay. If text is present, read it here! Never say "Environment detected".
- If the user gave a prompt, answer it directly.
- NEVER output markdown, code fences, or text outside the JSON object.`;

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

function overlayPriority(o: VisionOverlay): number {
  const kind = (o.kind || "object").toLowerCase();
  const severity = (o.severity || "low").toLowerCase();
  let score = 0;
  if (severity === "critical") score += 100;
  if (severity === "high") score += 80;
  if (severity === "medium") score += 30;
  if (kind === "threat") score += 100;
  if (kind === "warning") score += 80;
  if (kind === "text") score += 70;
  if (kind === "navigation") score += 60;
  if (kind === "person") score += 45;
  if (kind === "suggestion" || kind === "reminder") score += 40;
  if (o.detail) score += 8;
  const area = Math.max(0, o.w ?? 0) * Math.max(0, o.h ?? 0);
  return score + Math.min(area * 20, 10);
}

function topOverlays(overlays: VisionOverlay[]): VisionOverlay[] {
  const seen = new Set<string>();
  return overlays
    .filter((overlay) => {
      const key = `${overlay.kind}:${overlay.label}:${Math.round((overlay.x ?? 0) * 10)}:${Math.round((overlay.y ?? 0) * 10)}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => overlayPriority(b) - overlayPriority(a))
    .slice(0, MAX_RETURNED_OVERLAYS)
    .map((overlay, index) => ({ ...overlay, id: overlay.id || `ov-${index + 1}` }));
}

function fallbackResult(reason: string): VisionResult {
  return {
    sceneSummary: "Vision processing error",
    spokenReply: "",
    primaryFocus: "unknown",
    overlays: [
      {
        id: "ov-fallback",
        kind: "warning",
        label: "Vision Error",
        detail: reason.slice(0, 80),
        severity: "medium",
        x: 0.5,
        y: 0.5,
        w: 0.3,
        h: 0.12,
      },
    ],
  /**
 * Two-step text-first vision analysis:
 * 1. OCR.space for highly accurate text extraction.
 * 2. Groq (Llama 3 8B) for blazing fast JSON formatting and summarization.
 */
export async function analyzeFrame(args: {
  imageBase64: string;
  mimeType: string;
  prompt?: string;
  mode?: string;
  log: Logger;
}): Promise<VisionResult> {
  const { imageBase64, mimeType, prompt, mode, log } = args;

  const ocrKey = process.env["OCR_SPACE_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];

  if (!ocrKey || !groqKey) {
    log.error("Missing OCR_SPACE_API_KEY or GROQ_API_KEY");
    return fallbackResult("API keys not configured.");
  }

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  try {
    log.info("Step 1: Extracting text via OCR.space...");
    const ocrStartTime = Date.now();
    const ocrFormData = new URLSearchParams();
    ocrFormData.append("apikey", ocrKey);
    ocrFormData.append("base64Image", dataUrl);
    ocrFormData.append("OCREngine", "2");

    const ocrResponse = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: ocrFormData,
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR.space returned ${ocrResponse.status}`);
    }

    const ocrData = await ocrResponse.json() as any;
    const extractedText = ocrData?.ParsedResults?.[0]?.ParsedText || "";
    log.info({ elapsed: Date.now() - ocrStartTime, chars: extractedText.length }, "OCR.space finished");

    log.info("Step 2: Processing via Groq...");
    const groqStartTime = Date.now();
    
    let userMessage = `Mode: ${mode ?? "scan"}.`;
    if (prompt) userMessage += `\nUser asked: "${prompt}".`;
    
    if (extractedText.trim().length > 0) {
      userMessage += `\n\nI am looking at this text:\n"${extractedText}"\n\nFormat this text, summarize what it is, and answer the user's question directly in spokenReply.`;
    } else {
      userMessage += `\n\nNo text was found in the image. Return a JSON response acknowledging this.`;
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 1024
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      log.error({ errText }, "Groq error");
      throw new Error(`Groq returned ${groqResponse.status}`);
    }

    const groqData = await groqResponse.json() as any;
    const text = groqData.choices?.[0]?.message?.content || "";
    log.info({ elapsed: Date.now() - groqStartTime }, "Groq finished");

    const parsed = tryParseJson(text) as Record<string, unknown>;
    const overlaysRaw = Array.isArray(parsed.overlays) ? parsed.overlays : [];
    
    // We don't have bounding boxes from Groq since it's just processing text.
    // So we map the text to a single overlay in the center of the screen if there's text.
    const overlays: VisionOverlay[] = [];
    if (extractedText.trim().length > 0) {
      overlays.push({
        id: "ov-text",
        kind: "text",
        label: "Document / Text",
        detail: extractedText.substring(0, 50).replace(/\n/g, ' ') + "...",
        severity: "info",
        x: 0.5,
        y: 0.5,
        w: 0.6,
        h: 0.4
      });
    }

    let sceneSummary = typeof parsed.sceneSummary === "string" && parsed.sceneSummary.length > 0
      ? parsed.sceneSummary.slice(0, 140)
      : "Text analysis complete.";

    return {
      sceneSummary,
      spokenReply: typeof parsed.spokenReply === "string" ? parsed.spokenReply.slice(0, 400) : "",
      primaryFocus: "text",
      overlays,
    };
  } catch (err) {
    log.error({ err }, "Vision analysis failed");
    const reason = err instanceof Error ? err.message : "Unknown error.";
    return fallbackResult(reason);
  }
}on);
  }
}
