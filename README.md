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
