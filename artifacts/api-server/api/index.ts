// Vercel Serverless Function entry point
// This file re-exports the Express app so Vercel can use it as a serverless handler.
import app from "../src/app.js";

export default app;
