import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { Readable } from "node:stream";

const port = Number(process.env.HTTPS_PROXY_PORT ?? 4112);
const targetOrigin = process.env.HTTPS_PROXY_TARGET_ORIGIN ?? "http://localhost:4111";
const keyPath = process.env.VITE_DEV_SSL_KEY_PATH;
const certPath = process.env.VITE_DEV_SSL_CERT_PATH;

if (!keyPath || !certPath) {
  throw new Error(
    "VITE_DEV_SSL_KEY_PATH and VITE_DEV_SSL_CERT_PATH must be set to start the HTTPS proxy.",
  );
}

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function filterHeaders(headers) {
  const next = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (!value || hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        next.append(name, item);
      }
      continue;
    }

    next.set(name, value);
  }

  return next;
}

function filterResponseHeaders(headers) {
  const next = {};

  for (const [name, value] of headers.entries()) {
    if (hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }

    next[name] = value;
  }

  return next;
}

const server = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  async (req, res) => {
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const targetUrl = new URL(req.url ?? "/", targetOrigin);
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: filterHeaders(req.headers),
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? "half" : undefined,
        signal: controller.signal,
      });

      res.writeHead(response.status, filterResponseHeaders(response.headers));

      if (!response.body) {
        res.end();
        return;
      }

      Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`HTTPS proxy request failed: ${message}`);
    }
  },
);

server.listen(port, "localhost", () => {
  console.log(`HTTPS proxy listening on https://localhost:${port}`);
  console.log(`Forwarding requests to ${targetOrigin}`);
});
