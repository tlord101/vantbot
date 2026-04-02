# VantBot

VantBot is a Browser AI Agent with:

- A React + Tailwind chat frontend
- A Node.js + Express backend
- Gemini function calling connected to Playwright tools

The backend runs an agent loop where Gemini can call browser tools repeatedly until it has enough evidence to return a final answer.

## Tech Stack

- Backend: Node.js, Express, Playwright (Chromium), @google/generative-ai
- Frontend: React (Vite), Tailwind CSS, Lucide React icons

## Project Structure

```text
.
|-- client
|   |-- src
|   |   |-- App.jsx
|   |   |-- index.css
|   |   `-- main.jsx
|   |-- index.html
|   |-- postcss.config.js
|   |-- tailwind.config.js
|   `-- vite.config.js
|-- server
|   |-- agent.js
|   `-- index.js
|-- .env.example
`-- package.json
```

## Setup

1. Install dependencies from the repository root:

```bash
npm install
```

2. Install Playwright Chromium:

```bash
npm run setup:browsers
```

3. Create a local environment file:

```bash
cp .env.example .env
```

4. Set your Gemini API key in `.env`:

```env
GEMINI_API_KEY=your_key_here
```

## Run In Development

From the repository root:

```bash
npm run dev
```

This starts:

- Backend API at http://localhost:8787
- Frontend at http://localhost:5173

## Agent Loop Overview

The backend loop in `server/agent.js` does this:

1. Send user prompt to Gemini with tool declarations: `goto`, `click`, `type`, `screenshot`.
2. If Gemini requests a tool:
	 - Execute the Playwright action on a persistent page for that session.
	 - Capture a screenshot.
	 - Return action result + screenshot back to Gemini.
3. Repeat until Gemini returns a final text answer.

Each chat session keeps its own Playwright browser context and page so page state is preserved across turns.

## API Endpoints

- `GET /api/health`
- `POST /api/chat`
	- body: `{ "message": "...", "sessionId": "optional" }`
	- returns: `{ sessionId, reply, trace, screenshot }`
- `POST /api/session/reset`
	- body: `{ "sessionId": "..." }`

## Notes

- Default model is `gemini-3-flash` (override with `GEMINI_MODEL`).
- Screenshot data is returned as a base64 data URL and shown in the frontend side panel.
- API includes production middleware: helmet headers, request rate limiting, and origin allow-list checks.
- Session contexts are persistent per session id and automatically cleaned up after inactivity.

## Production Environment Variables

- `GEMINI_API_KEY`: required
- `GEMINI_MODEL`: default `gemini-3-flash`
- `PORT`: default `8787`
- `CLIENT_ORIGIN`: comma-separated allowed origins for CORS
- `RATE_LIMIT_PER_MINUTE`: default `30`
- `MAX_MESSAGE_LENGTH`: default `4000`
- `REQUEST_BODY_LIMIT`: default `3mb`
- `AGENT_MAX_STEPS`: default `12` (max `30`)
- `VITE_API_BASE_URL`: optional frontend API base URL for deployed client builds
- `VITE_AGENT_TIMEOUT_MS`: optional frontend timeout for chat requests