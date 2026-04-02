const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const { runAgentLoop, sessionStore } = require("./agent");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const port = Number(process.env.PORT || 8787);
const modelName = process.env.GEMINI_MODEL || "gemini-3-flash";
const requestLimit = process.env.REQUEST_BODY_LIMIT || "3mb";
const maxMessageLength = Number(process.env.MAX_MESSAGE_LENGTH || 4000);

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Blocked by CORS"));
    }
  })
);

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 30),
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.json({ limit: requestLimit }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "vantbot-server",
    uptimeSeconds: Math.floor(process.uptime()),
    sessions: sessionStore.sessions.size
  });
});

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return res.status(400).json({ error: "message cannot be empty" });
  }

  if (trimmedMessage.length > maxMessageLength) {
    return res.status(413).json({
      error: `message too long (max ${maxMessageLength} characters)`
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  const safeSessionId =
    typeof sessionId === "string" && sessionId.trim()
      ? sessionId.trim()
      : crypto.randomUUID();

  try {
    const result = await runAgentLoop({
      apiKey,
      sessionId: safeSessionId,
      userMessage: trimmedMessage,
      modelName
    });

    return res.json({
      sessionId: safeSessionId,
      reply: result.reply,
      trace: result.trace,
      screenshot: result.screenshot
    });
  } catch (error) {
    const errorMessage = String(error?.message || "");
    const invalidApiKey =
      errorMessage.includes("API key not valid") ||
      errorMessage.includes("API_KEY_INVALID") ||
      errorMessage.includes("Invalid API key");

    return res.status(500).json({
      error: invalidApiKey ? "GEMINI_API_KEY is invalid" : "Agent execution failed",
      details: invalidApiKey || process.env.NODE_ENV !== "production" ? errorMessage : undefined
    });
  }
});

app.post("/api/session/reset", async (req, res) => {
  const { sessionId } = req.body || {};

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId is required" });
  }

  await sessionStore.resetSession(sessionId);
  return res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  if (err && err.message === "Blocked by CORS") {
    return res.status(403).json({ error: "origin not allowed" });
  }

  return res.status(500).json({
    error: "unexpected server error",
    details: process.env.NODE_ENV === "production" ? undefined : err?.message
  });
});

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`VantBot server listening on http://localhost:${port}`);
});

async function shutdown() {
  await sessionStore.closeAll();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
