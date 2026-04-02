import { useMemo, useState } from "react";
import { Bot, SendHorizontal, Sparkles, User, RotateCcw, Camera } from "lucide-react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_AGENT_TIMEOUT_MS || 120000);

const STARTER_PROMPTS = [
  "Go to eBay and find the current price of a PS5 Slim.",
  "Open Hacker News and tell me the top story title.",
  "Go to weather.com and summarize today's forecast for New York."
];

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}`;
}

function apiPath(path) {
  if (!API_BASE_URL) {
    return path;
  }

  return `${API_BASE_URL}${path}`;
}

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "I am VantBot. Tell me what to do in the browser, and I will act step-by-step.",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [sessionId, setSessionId] = useState(() => {
    const stored = localStorage.getItem("vantbot-session-id");
    if (stored) {
      return stored;
    }

    const generated = createSessionId();
    localStorage.setItem("vantbot-session-id", generated);
    return generated;
  });

  const canSend = input.trim().length > 0 && !busy;

  const traceLabel = useMemo(() => {
    if (trace.length === 0) {
      return "No browser actions yet";
    }

    return `${trace.length} browser action${trace.length > 1 ? "s" : ""}`;
  }, [trace]);

  async function sendPrompt(promptText) {
    const text = promptText.trim();
    if (!text || busy) {
      return;
    }

    const userMessage = { role: "user", text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(apiPath("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: text,
            sessionId
          })
        });
      } finally {
        clearTimeout(timer);
      }

      const payload = await response.json();
      if (!response.ok) {
        const message = payload.details ? `${payload.error}: ${payload.details}` : payload.error || "Request failed";
        throw new Error(message);
      }

      setTrace(Array.isArray(payload.trace) ? payload.trace : []);
      setScreenshot(payload.screenshot || null);

      if (payload.sessionId && payload.sessionId !== sessionId) {
        setSessionId(payload.sessionId);
        localStorage.setItem("vantbot-session-id", payload.sessionId);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: payload.reply || "No response from agent.",
          timestamp: Date.now()
        }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Agent failed: ${error.name === "AbortError" ? "Request timed out" : error.message}`,
          timestamp: Date.now()
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function resetSession() {
    setBusy(true);

    try {
      await fetch(apiPath("/api/session/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
    } catch {
      // Ignore reset errors and still rotate to a fresh local session id.
    }

    const generated = createSessionId();
    setSessionId(generated);
    localStorage.setItem("vantbot-session-id", generated);
    setTrace([]);
    setScreenshot(null);
    setMessages([
      {
        role: "assistant",
        text: "Session reset. Ready for a new browser task.",
        timestamp: Date.now()
      }
    ]);
    setBusy(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    void sendPrompt(input);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 lg:flex-row">
      <section className="flex min-h-[70vh] flex-1 flex-col rounded-3xl border border-white/60 bg-[var(--panel)] p-4 shadow-panel backdrop-blur-xl md:p-6">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Browser AI Agent</p>
            <h1 className="font-heading text-3xl font-bold text-ink">VantBot</h1>
          </div>
          <button
            onClick={resetSession}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw size={16} />
            New Session
          </button>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => void sendPrompt(prompt)}
              disabled={busy}
              className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            return (
              <article
                key={`${message.timestamp}-${index}`}
                className={`message-enter ml-0 flex max-w-[90%] items-start gap-3 rounded-2xl border px-3 py-2 ${
                  isUser
                    ? "ml-auto border-orange-200 bg-orange-50 text-slate-900"
                    : "border-teal-200 bg-teal-50 text-slate-900"
                }`}
              >
                <span
                  className={`mt-1 rounded-lg p-1 ${isUser ? "bg-orange-100 text-[var(--user)]" : "bg-teal-100 text-[var(--assistant)]"}`}
                >
                  {isUser ? <User size={14} /> : <Bot size={14} />}
                </span>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
              </article>
            );
          })}

          {busy && (
            <article className="message-enter flex max-w-[90%] items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-slate-700">
              <span className="rounded-lg bg-teal-100 p-1 text-[var(--assistant)]">
                <Sparkles size={14} />
              </span>
              VantBot is driving the browser...
            </article>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy}
            placeholder="Ask VantBot to browse for you"
            className="h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-tide focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-tide px-4 text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <SendHorizontal size={16} />
          </button>
        </form>
      </section>

      <aside className="w-full rounded-3xl border border-white/60 bg-[var(--panel)] p-4 shadow-panel backdrop-blur-xl lg:w-[24rem]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold text-ink">Agent Trace</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-600">{traceLabel}</span>
        </div>

        <div className="mb-4 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-[var(--line)] bg-white/80 p-3">
          {trace.length === 0 && <p className="text-sm text-slate-500">Tool calls will appear here.</p>}
          {trace.map((step, index) => (
            <div key={`${step.tool}-${index}`} className="rounded-xl border border-slate-200 bg-white p-2">
              <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Step {index + 1}</p>
              <p className="text-sm font-semibold text-slate-800">{step.tool}</p>
              <p className="line-clamp-2 text-xs text-slate-600">{step.ok ? step.url || "Action completed" : step.error}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-white/80 p-3">
          <div className="mb-2 flex items-center gap-2 text-slate-600">
            <Camera size={16} />
            <span className="font-mono text-xs uppercase tracking-[0.15em]">Latest Screenshot</span>
          </div>
          {screenshot ? (
            <img
              src={screenshot}
              alt="Latest automated browser state"
              className="h-auto w-full rounded-xl border border-slate-200"
            />
          ) : (
            <p className="text-sm text-slate-500">No screenshot captured yet.</p>
          )}
        </div>
      </aside>
    </main>
  );
}
