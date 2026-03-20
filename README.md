# Contentful Product Rename Agent

Monorepo for a Contentful app, Contentful App Action Functions, and a Mastra backend that proposes product rename changes and applies approved updates with user-scoped writes.

See `AGENT_CHECKLIST.md` for an operational checklist future agents can follow for setup, debugging, deployment, and handoff.

## Local HTTPS for Contentful

Contentful loads apps inside the web app over HTTPS, so local development should also use HTTPS.

1. Generate a local certificate for `localhost`, for example with `mkcert`.
2. Set these values in `.env`:
   - `VITE_PORT=3000`
   - `VITE_DEV_SSL_KEY_PATH=/absolute/path/to/localhost-key.pem`
   - `VITE_DEV_SSL_CERT_PATH=/absolute/path/to/localhost.pem`
3. Start the frontend with `npm run dev --workspace @contentful-rename/contentful-app`
4. Use `https://localhost:3000` as the app frontend URL in Contentful.

## Local Chat Testing (Contentful + Mastra)

Use this flow when validating the interactive rename assistant against a local Mastra backend.

1. Start the local Mastra API:
   - `npm run dev --workspace @contentful-rename/mastra`
2. Start a tunnel to the backend:
   - `npx localtunnel --port 4111 --print-requests`
   - Copy the generated URL (example: `https://example.loca.lt`).
3. In Contentful app config, set:
   - `mastraBaseUrl=<your tunnel URL>`
4. Keep both processes running while testing. The Contentful app talks to the backend over `/api/chat/stream`.

### Automated search validation

- Run the app workspace tests:
  - `npm test --workspace @contentful-rename/contentful-app`
- Run the workspace type validation:
  - `npm run typecheck --workspace @contentful-rename/contentful-app`

### Live Contentful smoke test

- With `CONTENTFUL_ACCESS_TOKEN`, `CONTENTFUL_ORG_ID`, and `CONTENTFUL_SPACE_ID` set, run:
  - `npm run test:search:live --workspace @contentful-rename/contentful-app`
- The smoke script defaults to query `porter`.
- Expected results:
  - `keyword` returns at least one entry ID.
  - `hybrid` returns at least one entry ID and does not throw.
  - `semantic` completes without throwing; when the index status is `ACTIVE`, it also returns at least one entry ID.
- Override the default test query if needed:
  - `SEARCH_SMOKE_QUERY=porter npm run test:search:live --workspace @contentful-rename/contentful-app`

### Quick endpoint checks

- Backend health:
  - `curl -i <mastraBaseUrl>/health`
- Chat stream handshake:
  - `curl -i -X POST <mastraBaseUrl>/api/chat/stream -H "Content-Type: application/json" --data '{"messages":[{"id":"msg-1","role":"user","parts":[{"type":"text","text":"Rename \"Acme\" to \"Acme New\" and search marketing pages first."}]}],"requestContext":{"defaultLocale":"en-US","allowedContentTypes":[],"maxDiscoveryQueries":5,"maxCandidatesPerRun":30},"memory":{"thread":"local-smoke-thread","resource":"contentful-space-local"}}'`

### Common tunnel failures

- `503 Tunnel Unavailable`
  - Tunnel process stopped or URL expired.
  - Restart tunnel and update `mastraBaseUrl`.
- `511 Network Authentication Required`
  - Tunnel provider is gatekeeping the request path.
  - Rotate to a fresh tunnel URL and re-save config.
- Health check timeout/unreachable
  - Local backend or tunnel is down.
  - Ensure Mastra dev server is running on port `4111`.
