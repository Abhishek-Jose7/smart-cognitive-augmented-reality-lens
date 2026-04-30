import app from "./app";
import { logger } from "./lib/logger";

const port = Number(process.env["PORT"] || "3000");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// Only start the listener if we're not running on Vercel
// Vercel handles the server lifecycle internally.
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

export default app;
