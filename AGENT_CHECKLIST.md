# Agent Checklist

Use this checklist before making changes, while debugging, and before handoff.

## 1) Startup / Environment

- [ ] Confirm local deps are installed (`npm install`).
- [ ] Confirm `.env` has required values (`OPENAI_API_KEY`, `CONTENTFUL_*`, local HTTPS vars).
- [ ] Start local Mastra backend: `npm run dev --workspace @contentful-rename/mastra`.
- [ ] Start frontend (if needed): `npm run dev --workspace @contentful-rename/contentful-app`.
- [ ] Verify local backend health: `curl -i http://localhost:4111/health`.

## 2) Local Testing With Contentful

- [ ] Start a public tunnel to local Mastra port `4111`.
- [ ] Verify tunnel `/health` returns `200`.
- [ ] In Contentful app config, set `mastraBaseUrl` to current tunnel URL.
- [ ] Save config and hard refresh app page.
- [ ] Recheck backend in-app before starting run.

## 3) If Chat Setup Fails

- [ ] Check in-app error artifact text first (preflight message).
- [ ] Validate tunnel URL still alive (`/health`).
- [ ] If `503 Tunnel Unavailable`, restart tunnel and update config URL.
- [ ] If `511 Network Authentication Required`, rotate tunnel URL and retry.
- [ ] Verify `/chat/stream` responds with curl before retesting in UI.

## 4) Search Quality Debug

- [ ] Confirm `searchMode` used in run (`semantic`, `keyword`, or `hybrid`).
- [ ] Inspect discovery queries + aliases from the assistant response or suspended tool payloads.
- [ ] Validate search app action returns entry IDs.
- [ ] Run `npm test --workspace @contentful-rename/contentful-app`.
- [ ] Run `npm run typecheck --workspace @contentful-rename/contentful-app`.
- [ ] Run `npm run test:search:live --workspace @contentful-rename/contentful-app` to validate `porter` against live Contentful data.
- [ ] Confirm `keyword` and `hybrid` return entry IDs for `porter`.
- [ ] If semantic index status is `ACTIVE`, confirm `semantic` also returns entry IDs for `porter`.
- [ ] Confirm candidate snapshots include lexical matches to old product name.
- [ ] Verify proposed changes count aligns with candidate quality.

## 5) Contentful Bundle Deploy

- [ ] Build app bundle: `npm run build --workspace @contentful-rename/contentful-app`.
- [ ] Upload bundle/functions via `contentful-app-scripts upload`.
- [ ] Activate the new bundle.
- [ ] Hard refresh Contentful app locations (`Config`, `Page`, optional `Agent`).
- [ ] Verify no blank page and run flow still works.

## 6) Code Hygiene Before Handoff

- [ ] Run typecheck: `npm run typecheck`.
- [ ] Run build: `npm run build`.
- [ ] Check changed files: `git status --short`.
- [ ] Ensure no secrets/certs are staged.
- [ ] Summarize what changed, why, and any known limitations.

## 7) Optional Backlog (Future Improvements)

- [ ] Replace tunnel dependency with stable hosted backend for `/chat/stream`.
- [ ] Add automatic retry/backoff for transient tunnel failures.
- [ ] Add telemetry around run failure reasons in frontend.
- [ ] Consider migration to native Mastra Cloud endpoint model (if replacing custom Hono routes).
