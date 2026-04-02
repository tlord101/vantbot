const { GoogleGenerativeAI } = require("@google/generative-ai");
const { chromium } = require("playwright");

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_NAV_TIMEOUT_MS = 30000;
const DEFAULT_ACTION_TIMEOUT_MS = 15000;

const TOOL_DECLARATIONS = [
  {
    name: "goto",
    description: "Navigate the current browser page to a URL",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "Absolute URL to visit"
        }
      },
      required: ["url"]
    }
  },
  {
    name: "click",
    description: "Click an element on the page by CSS selector",
    parameters: {
      type: "OBJECT",
      properties: {
        selector: {
          type: "STRING",
          description: "CSS selector for the element to click"
        }
      },
      required: ["selector"]
    }
  },
  {
    name: "type",
    description: "Type text into an input element found by CSS selector",
    parameters: {
      type: "OBJECT",
      properties: {
        selector: {
          type: "STRING",
          description: "CSS selector for input/textarea"
        },
        text: {
          type: "STRING",
          description: "Text to type"
        }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the current page",
    parameters: {
      type: "OBJECT",
      properties: {
        fullPage: {
          type: "BOOLEAN",
          description: "Capture full page when true"
        }
      }
    }
  }
];

const SYSTEM_INSTRUCTION = [
  "You are VantBot, a browser automation agent.",
  "Use the available tools to inspect websites and gather facts before answering.",
  "Work step-by-step and only call tools with concrete selectors and URLs.",
  "Prefer one action per tool call.",
  "When enough evidence is gathered, reply with a concise final answer."
].join(" ");

class SessionStore {
  constructor(options = {}) {
    this.browserPromise = null;
    this.sessions = new Map();
    this.maxSessions = options.maxSessions || 30;
    this.sessionTtlMs = options.sessionTtlMs || 20 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired();
    }, 60 * 1000);

    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  async getBrowser() {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: true
      });

      this.browserPromise.catch(() => {
        this.browserPromise = null;
      });
    }

    return this.browserPromise;
  }

  async getSession(sessionId) {
    await this.cleanupExpired();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    if (this.sessions.size >= this.maxSessions) {
      await this.dropOldestSession();
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS);
    page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);

    const now = Date.now();
    const created = { context, page, createdAt: now, lastUsedAt: now };
    this.sessions.set(sessionId, created);

    return created;
  }

  async resetSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return;
    }

    await existing.context.close();
    this.sessions.delete(sessionId);
  }

  async cleanupExpired() {
    const now = Date.now();
    const tasks = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUsedAt > this.sessionTtlMs) {
        tasks.push(
          session.context.close().catch(() => undefined).then(() => {
            this.sessions.delete(sessionId);
          })
        );
      }
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  async dropOldestSession() {
    let oldestId = null;
    let oldestStamp = Number.POSITIVE_INFINITY;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastUsedAt < oldestStamp) {
        oldestStamp = session.lastUsedAt;
        oldestId = sessionId;
      }
    }

    if (oldestId) {
      await this.resetSession(oldestId);
    }
  }

  async closeAll() {
    clearInterval(this.cleanupTimer);

    const closeTasks = Array.from(this.sessions.values()).map((session) =>
      session.context.close().catch(() => undefined)
    );

    await Promise.all(closeTasks);
    this.sessions.clear();

    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close().catch(() => undefined);
      this.browserPromise = null;
    }
  }
}

const sessionStore = new SessionStore();

function assertSafeUrl(input) {
  let parsed;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  return parsed.toString();
}

function parseArgs(args) {
  if (!args) {
    return {};
  }

  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }

  return args;
}

async function snapshot(page, fullPage = false) {
  const bytes = await page.screenshot({
    type: "png",
    fullPage: Boolean(fullPage)
  });

  return Buffer.from(bytes).toString("base64");
}

async function runTool(page, call) {
  const args = parseArgs(call.args);

  if (call.name === "goto") {
    if (!args.url) {
      throw new Error("goto requires a url argument");
    }

    const safeUrl = assertSafeUrl(args.url);
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAV_TIMEOUT_MS });
    const screenshotBase64 = await snapshot(page);

    return {
      ok: true,
      action: "goto",
      url: page.url(),
      title: await page.title(),
      screenshotBase64
    };
  }

  if (call.name === "click") {
    if (!args.selector) {
      throw new Error("click requires a selector argument");
    }

    await page.waitForSelector(args.selector, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
    await page.click(args.selector, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);

    const screenshotBase64 = await snapshot(page);

    return {
      ok: true,
      action: "click",
      selector: args.selector,
      url: page.url(),
      title: await page.title(),
      screenshotBase64
    };
  }

  if (call.name === "type") {
    if (!args.selector || typeof args.text !== "string") {
      throw new Error("type requires selector and text arguments");
    }

    await page.waitForSelector(args.selector, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
    await page.fill(args.selector, args.text, { timeout: DEFAULT_ACTION_TIMEOUT_MS });

    const screenshotBase64 = await snapshot(page);

    return {
      ok: true,
      action: "type",
      selector: args.selector,
      textLength: args.text.length,
      url: page.url(),
      title: await page.title(),
      screenshotBase64
    };
  }

  if (call.name === "screenshot") {
    const screenshotBase64 = await snapshot(page, args.fullPage);

    return {
      ok: true,
      action: "screenshot",
      url: page.url(),
      title: await page.title(),
      screenshotBase64
    };
  }

  throw new Error(`Unsupported tool: ${call.name}`);
}

function toFunctionResponsePayload(result) {
  const payload = { ...result };
  delete payload.screenshotBase64;

  return payload;
}

async function runAgentLoop({ apiKey, sessionId, userMessage, modelName }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
  });

  const session = await sessionStore.getSession(sessionId);
  const contents = [
    {
      role: "user",
      parts: [{ text: userMessage }]
    }
  ];

  const trace = [];
  const maxSteps =
    Number.isInteger(Number(process.env.AGENT_MAX_STEPS)) &&
    Number(process.env.AGENT_MAX_STEPS) > 0 &&
    Number(process.env.AGENT_MAX_STEPS) <= 30
      ? Number(process.env.AGENT_MAX_STEPS)
      : DEFAULT_MAX_STEPS;
  let finalText = "";
  let lastScreenshotBase64 = null;

  for (let step = 0; step < maxSteps; step += 1) {
    session.lastUsedAt = Date.now();
    const result = await model.generateContent({ contents });
    const response = result.response;

    const candidateParts =
      response?.candidates?.[0]?.content?.parts || [{ text: response.text() }];

    contents.push({ role: "model", parts: candidateParts });

    const functionCalls =
      typeof response.functionCalls === "function" ? response.functionCalls() : [];

    if (!functionCalls || functionCalls.length === 0) {
      finalText = response.text() || "I could not complete that request.";
      break;
    }

    for (const call of functionCalls) {
      const stepEntry = {
        tool: call.name,
        args: parseArgs(call.args)
      };

      try {
        const toolResult = await runTool(session.page, call);
        lastScreenshotBase64 = toolResult.screenshotBase64 || lastScreenshotBase64;

        stepEntry.ok = true;
        stepEntry.url = toolResult.url;

        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: toFunctionResponsePayload(toolResult)
              }
            },
            ...(toolResult.screenshotBase64
              ? [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: toolResult.screenshotBase64
                    }
                  }
                ]
              : [])
          ]
        });
      } catch (error) {
        stepEntry.ok = false;
        stepEntry.error = error.message;

        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: {
                  ok: false,
                  error: error.message
                }
              }
            }
          ]
        });
      }

      trace.push(stepEntry);
    }
  }

  if (!finalText) {
    finalText = "I reached the step limit before finishing. Please refine the request.";
  }

  return {
    reply: finalText,
    trace,
    screenshot: lastScreenshotBase64
      ? `data:image/png;base64,${lastScreenshotBase64}`
      : null
  };
}

module.exports = {
  runAgentLoop,
  sessionStore
};
