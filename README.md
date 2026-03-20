# Contentful Product Rename Agent

Monorepo for a Contentful app, Contentful App Action Functions, and a Mastra backend that proposes product rename changes and applies approved updates with user-scoped writes.

## Local HTTPS for Contentful

Contentful loads apps inside the web app over HTTPS, so local development should also use HTTPS.

1. Generate a local certificate for `localhost`, for example with `mkcert`.
2. Set these values in `.env`:
   - `VITE_PORT=3000`
   - `VITE_DEV_SSL_KEY_PATH=/absolute/path/to/localhost-key.pem`
   - `VITE_DEV_SSL_CERT_PATH=/absolute/path/to/localhost.pem`
3. Start the frontend with `npm run dev --workspace @contentful-rename/contentful-app`
4. Use `https://localhost:3000` as the app frontend URL in Contentful.

## Local Run Testing (Contentful + Mastra)

Use this flow when validating rename runs against a local Mastra backend.

1. Start the local Mastra API:
   - `npm run dev --workspace @contentful-rename/mastra`
2. Start a tunnel to the backend:
   - `npx localtunnel --port 4111 --print-requests`
   - Copy the generated URL (example: `https://example.loca.lt`).
3. In Contentful app config, set:
   - `mastraBaseUrl=<your tunnel URL>`
4. Keep both processes running while testing.

### Quick endpoint checks

- Backend health:
  - `curl -i <mastraBaseUrl>/health`
- Run creation:
  - `curl -i -X POST <mastraBaseUrl>/api/runs -H "Content-Type: application/json" --data '{"oldProductName":"Acme","newProductName":"Acme New","defaultLocale":"en-US","searchMode":"semantic","contentTypeIds":[]}'`

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
