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
const MAX_RETURNED_OVERLAYS = 6;

const OBJECT_LABELS = [
  "person",
  "laptop",
  "screen",
  "chair",
  "table",
  "sofa",
  "couch",
  "plant",
  "tv",
  "television",
  "cabinet",
  "door",
  "window",
  "bed",
  "phone",
  "book",
  "bottle",
  "cup",
  "clock",
  "vase",
  "remote",
  "microwave",
  "oven",
  "fridge",
  "sink",
  "car",
  "bicycle",
  "dog",
  "cat",
  "backpack",
  "umbrella",
] as const;

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
- Return 1 to 6 overlays. Prefer the most useful visible things. Empty list is fine if there's truly nothing notable.
- Each overlay = one tightly-fit box around ONE thing. Coordinates normalized [0,1], (0,0) top-left, x/y are CENTER.
- CRITICAL: Bounding boxes MUST tightly hug the actual object. Do NOT use centered fixed-size rectangles. Measure the actual position and size of each object in the image.
- 'label' = short noun ("Laptop", "Mug", "Door", "Person", "Plant"). No all-caps, no exclamation, max 2 words.
- 'detail' provides USEFUL CONTEXT about the object: its state, brand, color, what it's doing, or any readable text on it. Examples: "Open, silver MacBook", "Half full glass", "Black leather", "Samsung TV, off", "Red ceramic, steaming". Include detail for EVERY overlay. Max 50 chars.
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
- The frontend displays ALL analysis as TEXT OVERLAYS. Speech is ONLY used when the user explicitly asks via wake word "Hey Friday".
- spokenReply should contain the analysis text that will be shown as an on-screen text overlay. This is NOT spoken aloud by default.
- Write spokenReply as a brief, useful analysis of what you see. Focus on actionable information, not just listing objects.
- Examples of good spokenReply:
    - "Living room with dining area. Table set for dinner, TV cabinet against the wall."
    - "Indoor workspace — laptop open on desk, good lighting conditions."
    - "The sign reads 'Closed for renovation'. Door is locked."
    - "Kitchen counter with coffee maker brewing, steam rising from mug."
- Max 2 sentences, ~25 words. Address the user as "you" when relevant.
- If the user asked a question via prompt, answer it directly and concisely.

EDGE CASES:
- Blank/dark/unreadable frame: return ONE 'info' overlay { label: "Vision Unclear", detail: "Frame too dark or covered" } centered, spokenReply: "Vision is unclear — point the lens at something."
- Camera covered: same as above.
- DO NOT just say "Environment detected" — always describe WHAT is in the environment specifically.

ABSOLUTE RULES:
- Never apologize. Never refuse. Never explain that you are an AI or a model.
- NEVER include markdown, code fences, comments, or any text outside the JSON object.
- NEVER use generic phrases like "Environment detected" or "Scene captured". Be SPECIFIC about what you see.`;

const DETECTION_AND_TEXT_APPENDIX = `
UPDATED DETECTION RULES:
- Return at most 6 overlays. Pick the most useful visible boxes: hazards first, then readable text/questions, then people, then salient objects.
- Bounding boxes must be visible whenever objects/text come into view. Do not omit boxes for prominent objects.
- Do not return duplicate boxes for the same item. Prefer 4-6 high-signal boxes over many weak ones.
- CRITICAL: Each bounding box must TIGHTLY FIT the actual object. Measure position carefully:
  - x, y = center of the object as fraction of image (0-1)
  - w, h = actual width and height of the object as fraction of image (0-1)
  - Objects on the left side of the image should have x < 0.4
  - Objects on the right side should have x > 0.6
  - Objects at the top should have y < 0.4
  - Objects at the bottom should have y > 0.6
  - Small objects should have small w and h (0.06-0.15)
  - Large objects should have larger w and h (0.2-0.45)

UPDATED TEXT RULES:
- If visible text is a question, worksheet, prompt, or form field, answer it directly in spokenReply.
- If visible text is a big paragraph, page, article, note, email, or notice, summarize the main point in spokenReply.
- If visible text is short signage, read or interpret it briefly.
- Always include a text overlay around the readable text region when text drives the answer.
- The whole purpose is detection, analysis, and answer: identify what matters, analyze it, and answer the user's likely need.`;

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

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildFallbackOverlays(args: {
  isTextHeavy: boolean;
  extractedContext: string;
}): VisionOverlay[] {
  const { isTextHeavy, extractedContext } = args;
  const context = extractedContext.toLowerCase();

  if (isTextHeavy) {
    return [
      {
        id: "ov-text-fallback",
        kind: "text",
        label: "Text",
        detail: extractedContext.slice(0, 70) || "Readable text detected",
        severity: "medium",
        x: 0.5,
        y: 0.55,
        w: 0.56,
        h: 0.32,
      },
    ];
  }

  const labels: string[] = [];
  for (const label of OBJECT_LABELS) {
    if (context.includes(label) && !labels.includes(label)) labels.push(label);
    if (labels.length >= MAX_RETURNED_OVERLAYS) break;
  }

  // If no objects found from the label list, try to extract from context
  if (labels.length === 0 && extractedContext.length > 10) {
    // Return a generic "scene" overlay with the context as detail
    return [{
      id: "ov-scene-1",
      kind: "info",
      label: "Scene",
      detail: extractedContext.slice(0, 60),
      severity: "low",
      x: 0.5,
      y: 0.5,
      w: 0.4,
      h: 0.3,
    }];
  }

  // Distribute boxes across the frame instead of fixed slots
  return labels.slice(0, MAX_RETURNED_OVERLAYS).map((label, index) => {
    const columns = Math.min(labels.length, 3);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const xBase = 0.2 + (col * 0.3);
    const yBase = 0.35 + (row * 0.3);

    return {
      id: `ov-fallback-${index + 1}`,
      kind: label === "person" ? "person" : "object",
      label: titleCase(label === "tv" ? "TV" : label),
      detail: `Detected in scene`,
      severity: "low",
      x: Math.min(Math.max(xBase, 0.1), 0.9),
      y: Math.min(Math.max(yBase, 0.15), 0.85),
      w: 0.18,
      h: 0.22,
    };
  });
}

async function answerFromTextContext(args: {
  extractedContext: string;
  prompt?: string;
  apiKey: string;
  log: Logger;
}): Promise<string> {
  const { extractedContext, prompt, apiKey, log } = args;
  const instruction = [
    "You are Scarl. Use the visible text below to answer the user's likely need.",
    "If it is a question, answer it directly. If it is a paragraph, summarize it.",
    "Return one short spoken sentence only, no markdown.",
    prompt ? `User prompt: ${prompt}` : "",
    `Visible text: ${extractedContext}`,
  ].filter(Boolean).join("\n");

  return callNimChat(
    NIM_REASONER_MODEL,
    [{ role: "user", content: instruction }],
    apiKey,
    log,
    { maxTokens: 120, temp: 0.2, timeoutMs: 5000 },
  );
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

const NIM_ROUTER_MODEL = process.env["NVIDIA_NIM_ROUTER_MODEL"] ?? "meta/llama-3.2-11b-vision-instruct";
const NIM_COSMOS_MODEL = process.env["NVIDIA_NIM_COSMOS_MODEL"] ?? "nvidia/cosmos-nemotron-34b";
const NIM_OCR_MODEL = process.env["NVIDIA_NIM_OCR_MODEL"] ?? "nvidia/nv-ocr-v1";
const NIM_REASONER_MODEL = process.env["NVIDIA_NIM_REASONER_MODEL"] ?? "meta/llama-3.2-11b-vision-instruct";

async function callNimChat(
  model: string,
  messages: any[],
  apiKey: string,
  log: Logger,
  options: { maxTokens?: number; temp?: number; timeoutMs?: number } = {}
) {
  const { maxTokens = 1024, temp = 0.2, timeoutMs = 3000 } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: temp,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body: body.slice(0, 500), model }, "NIM error");
      throw new Error(`NIM ${response.status} from ${model}`);
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new Error(`Empty response from model ${model}`);
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`TIMEOUT: ${model} took >${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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

  try {
    // 1. Router: Determine if Environment or Text-heavy.
    const lowerPrompt = (prompt ?? "").toLowerCase();
    const isExplicitText =
      lowerPrompt.includes("read") ||
      lowerPrompt.includes("text") ||
      lowerPrompt.includes("say") ||
      lowerPrompt.includes("question") ||
      lowerPrompt.includes("answer") ||
      lowerPrompt.includes("summarize");

    let isTextHeavy = isExplicitText;
    
    if (!isExplicitText) {
      try {
        log.info("Step 1: Routing image content (4s timeout)...");
        const routerInstruction = "Respond with EXACTLY ONE WORD: 'TEXT' if this image contains a readable question, worksheet, document, screen, sign, paragraph, page, or other prominent text. Otherwise respond with 'ENVIRONMENT'.";
        const routerRes = await callNimChat(NIM_ROUTER_MODEL, [
          { role: "user", content: `${routerInstruction}\n\n<img src="${dataUrl}" />` }
        ], apiKey, log, { maxTokens: 5, temp: 0.1, timeoutMs: 4000 });
        
        isTextHeavy = routerRes.trim().toUpperCase().includes("TEXT");
        log.info({ isTextHeavy, routerRes }, "Routing decision");
      } catch (err) {
        log.warn({ err }, "Router failed or timed out, defaulting to ENVIRONMENT");
        isTextHeavy = false;
      }
    } else {
      log.info({ isTextHeavy, mode, prompt }, "Router forced by text prompt");
    }

    // 2. Extractor: Cosmos for Environment, OCR for Text
    let extractedContext = "";
    try {
      if (isTextHeavy) {
        log.info(`Step 2: Extracting text using ${NIM_OCR_MODEL} (8s timeout)...`);
        const ocrInstruction = "Extract all readable text from this image exactly as written.";
        extractedContext = await callNimChat(NIM_OCR_MODEL, [
          { role: "user", content: `${ocrInstruction}\n\n<img src="${dataUrl}" />` }
        ], apiKey, log, { maxTokens: 1024, temp: 0.1, timeoutMs: 8000 });
      } else {
        log.info(`Step 2: Analyzing environment using ${NIM_COSMOS_MODEL} (8s timeout)...`);
        const cosmosInstruction = "Describe this scene in detail. List every identifiable object, person, furniture, and item you can see, with their approximate position (left, center, right, foreground, background). Note any text, signs, screens, or labels visible. Describe colors, materials, and states of objects.";
        extractedContext = await callNimChat(NIM_COSMOS_MODEL, [
          { role: "user", content: `${cosmosInstruction}\n\n<img src="${dataUrl}" />` }
        ], apiKey, log, { maxTokens: 1024, temp: 0.2, timeoutMs: 8000 });
      }
    } catch (err) {
      log.warn({ err }, "Extractor failed or timed out, using fallback context");
      // Better fallback than "Environment detected" — describe what we can
      extractedContext = isTextHeavy
        ? "Unable to read text clearly."
        : "Scene analysis timed out. Objects may be present but could not be identified in time.";
    }

    // 3. Reasoner: Generate final JSON using Multimodal Reasoning
    try {
      log.info(`Step 3: Reasoning final output using ${NIM_REASONER_MODEL} (8s timeout)...`);
      const userInstruction = [
        `Mode: ${mode ?? "scan"}.`,
        prompt
          ? `User said: "${prompt}". Treat this as a direct question — answer it concisely in spokenReply.`
          : "Standard ambient scan.",
        `Context extracted from vision: "${extractedContext}"`,
        isTextHeavy
          ? "Text was detected. If it is a question, answer it; if it is a long paragraph, summarize it; also box the text region."
          : "Environment was detected. Box the most important 3-6 objects, people, hazards, or cues. Be SPECIFIC about each item — include useful details like color, state, brand, material in the detail field.",
        "Based on the image and the context above, return the JSON object with precise bounding boxes that TIGHTLY FIT each object.",
        "IMPORTANT: Do NOT use generic summaries like 'Environment detected'. Describe what you ACTUALLY see.",
      ].join("\n");

      // We MUST send the image again so the reasoner can determine coordinates
      const text = await callNimChat(NIM_REASONER_MODEL, [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${DETECTION_AND_TEXT_APPENDIX}` },
        { role: "user", content: `${userInstruction}\n\n<img src="${dataUrl}" />` }
      ], apiKey, log, { maxTokens: 1024, temp: 0.2, timeoutMs: 8000 });

      const parsed = tryParseJson(text) as Record<string, unknown>;
      const overlaysRaw = Array.isArray(parsed.overlays) ? parsed.overlays : [];

      const overlays = topOverlays(overlaysRaw.slice(0, 12).map(normalizeOverlay));

      // Ensure sceneSummary is never generic
      let sceneSummary = typeof parsed.sceneSummary === "string" && parsed.sceneSummary.length > 0
        ? parsed.sceneSummary.slice(0, 140)
        : "Scene captured.";
      
      // Block generic summaries
      const genericPhrases = ["environment detected", "scene captured", "nothing notable"];
      if (genericPhrases.some(p => sceneSummary.toLowerCase().includes(p)) && extractedContext.length > 20) {
        sceneSummary = extractedContext.slice(0, 100);
      }

      return {
        sceneSummary,
        spokenReply:
          typeof parsed.spokenReply === "string" ? parsed.spokenReply.slice(0, 400) : "",
        primaryFocus:
          typeof parsed.primaryFocus === "string" ? parsed.primaryFocus : "scene",
        overlays: overlays.length > 0
          ? overlays
          : buildFallbackOverlays({ isTextHeavy, extractedContext }),
      };
    } catch (err) {
      log.warn({ err }, "Reasoner failed or timed out, using fallback JSON builder");
      let spokenReply = extractedContext.length > 100
        ? extractedContext.slice(0, 150) + "..."
        : extractedContext;

      if (isTextHeavy && extractedContext && !extractedContext.toLowerCase().includes("unable to read")) {
        try {
          spokenReply = await answerFromTextContext({ extractedContext, prompt, apiKey, log });
        } catch (answerErr) {
          log.warn({ err: answerErr }, "Text-only answer fallback failed");
        }
      }

      // Better fallback summary
      const fallbackSummary = isTextHeavy
        ? "Text captured — reading content."
        : extractedContext.length > 20
          ? extractedContext.slice(0, 80)
          : "Analyzing scene...";

      return {
        sceneSummary: fallbackSummary,
        spokenReply,
        primaryFocus: isTextHeavy ? "text" : "environment",
        overlays: buildFallbackOverlays({ isTextHeavy, extractedContext }),
      };
    }
  } catch (err) {
    log.error({ err }, "Vision analysis pipeline crashed");
    const reason = err instanceof Error ? err.message : "Unknown error.";
    return fallbackResult(reason);
  }
}
