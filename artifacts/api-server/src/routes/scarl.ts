import { Router, type IRouter } from "express";
import { db, memoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  AnalyzeSceneBody,
  AnalyzeSceneResponse,
  SystemStatusResponse,
  GetMemoryResponse,
} from "@workspace/api-zod";
import { analyzeFrame } from "../lib/scarl-vision.js";

const router: IRouter = Router();

const STARTED_AT = Date.now();

router.get("/scarl/status", (_req, res) => {
  const data = SystemStatusResponse.parse({
    aiOnline: Boolean(process.env["NVIDIA_NIM_API_KEY"]),
    connection: "nim",
    battery: 92,
    mode: "assist",
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    version: "0.1.0",
  });
  res.json(data);
});

router.get("/scarl/memory", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(memoryTable)
      .orderBy(desc(memoryTable.createdAt))
      .limit(8);

    const data = GetMemoryResponse.parse({
      entries: rows.map((row) => ({
        id: row.id,
        summary: row.summary,
        primaryFocus: row.primaryFocus ?? undefined,
        timestamp: row.createdAt.toISOString(),
      })),
    });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to read memory");
    res.json(GetMemoryResponse.parse({ entries: [] }));
  }
});

router.post("/scarl/analyze", async (req, res) => {
  const parsed = AnalyzeSceneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }

  const { imageBase64, mimeType, prompt, mode } = parsed.data;

  // Strip a data URL prefix if the client forgot to remove it
  const cleanBase64 = imageBase64.includes(",")
    ? imageBase64.split(",", 2)[1] ?? imageBase64
    : imageBase64;

  const result = await analyzeFrame({
    imageBase64: cleanBase64,
    mimeType,
    prompt,
    mode,
    log: req.log,
  });

  // Persist a compact memory entry (best-effort)
  try {
    await db.insert(memoryTable).values({
      summary: result.sceneSummary,
      primaryFocus: result.primaryFocus,
      spokenReply: result.spokenReply,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to persist memory");
  }

  const response = AnalyzeSceneResponse.parse({
    sceneSummary: result.sceneSummary,
    spokenReply: result.spokenReply,
    primaryFocus: result.primaryFocus,
    overlays: result.overlays,
    timestamp: new Date().toISOString(),
  });

  res.json(response);
});

export default router;
