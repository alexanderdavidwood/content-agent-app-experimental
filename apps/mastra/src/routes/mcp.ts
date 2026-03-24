import { Hono } from "hono";
import { z } from "zod";

import {
  beginContentfulMcpAuthorization,
  buildClientMetadataDocument,
  completeContentfulMcpAuthorization,
  resolvePublicAppBaseUrl,
} from "../lib/mcp/remoteContentfulMcpClient";
import {
  buildMcpEnvironmentSetupStatus,
  buildMcpSessionStatus,
  clearMcpSessionCookie,
  readMcpSessionIdFromCookie,
  writeMcpSessionCookie,
} from "../lib/mcp/status";
import { deleteMcpSession, getMcpSession } from "../lib/mcp/sessionStore";

const connectStartBodySchema = z.object({
  provider: z.enum(["client-sdk", "remote-mcp", "hybrid"]).default("hybrid"),
  spaceId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  contentfulUserId: z.string().min(1).optional(),
});

function parseBoolean(value: string | null | undefined, fallback: boolean) {
  if (value == null || value.length === 0) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function parseProvider(value: string | null | undefined): "client-sdk" | "remote-mcp" | "hybrid" {
  return value === "client-sdk" || value === "remote-mcp" || value === "hybrid"
    ? value
    : "hybrid";
}

function readGeneralContentToolAvailability(url: URL) {
  return {
    listContentTypes: parseBoolean(
      url.searchParams.get("listContentTypes"),
      true,
    ),
    getContentType: parseBoolean(url.searchParams.get("getContentType"), true),
    listEntries: parseBoolean(url.searchParams.get("listEntries"), true),
    getEntry: parseBoolean(url.searchParams.get("getEntry"), true),
    getLocales: parseBoolean(url.searchParams.get("getLocales"), true),
    updateEntry: parseBoolean(url.searchParams.get("updateEntry"), false),
    publishEntry: parseBoolean(url.searchParams.get("publishEntry"), false),
  };
}

function readStatusRequest(url: URL) {
  return {
    provider: parseProvider(url.searchParams.get("provider")),
    spaceId: url.searchParams.get("spaceId") ?? undefined,
    environmentId: url.searchParams.get("environmentId") ?? undefined,
    organizationId: url.searchParams.get("organizationId") ?? undefined,
    contentfulUserId: url.searchParams.get("contentfulUserId") ?? undefined,
    mcpAutoFallbackToClientSdk: parseBoolean(
      url.searchParams.get("mcpAutoFallbackToClientSdk"),
      true,
    ),
    generalContentToolAvailability: readGeneralContentToolAvailability(url),
  };
}

function callbackHtml(input: {
  status: "connected" | "error";
  origin: string;
  message?: string;
}) {
  const payload = JSON.stringify({
    type: "contentful-mcp-connected",
    status: input.status,
    message: input.message,
  });
  const targetOrigin = JSON.stringify(input.origin || "*");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Contentful MCP</title>
  </head>
  <body>
    <script>
      const payload = ${payload};
      const targetOrigin = ${targetOrigin};
      if (window.opener) {
        window.opener.postMessage(payload, targetOrigin);
      }
      window.close();
    </script>
    <p>${input.status === "connected" ? "Connected." : "Connection failed."}</p>
  </body>
</html>`;
}

export const mcpRoute = new Hono()
  .get("/client-metadata", (c) => {
    const publicAppBaseUrl = resolvePublicAppBaseUrl(c.req.url);
    return c.json(buildClientMetadataDocument(publicAppBaseUrl), 200, {
      "Cache-Control": "no-store",
    });
  })
  .get("/session", async (c) => {
    const request = readStatusRequest(new URL(c.req.url));
    const sessionId = await readMcpSessionIdFromCookie(c);
    const status = await buildMcpSessionStatus({
      ...request,
      sessionId,
    });

    return c.json(status, 200, {
      "Cache-Control": "no-store",
    });
  })
  .get("/environment-setup", async (c) => {
    const request = readStatusRequest(new URL(c.req.url));
    const sessionId = await readMcpSessionIdFromCookie(c);
    const status = await buildMcpEnvironmentSetupStatus({
      provider: request.provider,
      sessionId,
      spaceId: request.spaceId,
      environmentId: request.environmentId,
      organizationId: request.organizationId,
      contentfulUserId: request.contentfulUserId,
    });

    return c.json(status, 200, {
      "Cache-Control": "no-store",
    });
  })
  .post("/connect/start", async (c) => {
    const body = connectStartBodySchema.parse(
      await c.req.json().catch(() => ({})),
    );

    const authorization = await beginContentfulMcpAuthorization({
      requestUrl: c.req.url,
      uiOrigin: c.req.header("Origin") ?? undefined,
      spaceId: body.spaceId,
      environmentId: body.environmentId,
      organizationId: body.organizationId,
      contentfulUserId: body.contentfulUserId,
    });

    await writeMcpSessionCookie(c, authorization.sessionId, c.req.url);

    return c.json(
      {
        sessionId: authorization.sessionId,
        redirectUrl: authorization.redirectUrl.toString(),
      },
      200,
      {
        "Cache-Control": "no-store",
      },
    );
  })
  .get("/connect/callback", async (c) => {
    const sessionId = await readMcpSessionIdFromCookie(c);
    const session = sessionId ? await getMcpSession(sessionId) : null;
    const targetOrigin = session?.blob.uiOrigin ?? "*";
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!sessionId || !code) {
      clearMcpSessionCookie(c, c.req.url);
      return c.html(
        callbackHtml({
          status: "error",
          origin: targetOrigin,
          message: "Missing OAuth session or authorization code.",
        }),
        400,
      );
    }

    try {
      await completeContentfulMcpAuthorization({
        sessionId,
        authorizationCode: code,
        expectedState: state,
        requestUrl: c.req.url,
      });
      await writeMcpSessionCookie(c, sessionId, c.req.url);

      return c.html(
        callbackHtml({
          status: "connected",
          origin: targetOrigin,
        }),
        200,
      );
    } catch (error) {
      return c.html(
        callbackHtml({
          status: "error",
          origin: targetOrigin,
          message: error instanceof Error ? error.message : String(error),
        }),
        500,
      );
    }
  })
  .post("/disconnect", async (c) => {
    const request = readStatusRequest(new URL(c.req.url));
    const sessionId = await readMcpSessionIdFromCookie(c);

    if (sessionId) {
      await deleteMcpSession(sessionId);
    }

    clearMcpSessionCookie(c, c.req.url);

    const status = await buildMcpSessionStatus({
      ...request,
      sessionId: null,
    });

    return c.json(status, 200, {
      "Cache-Control": "no-store",
    });
  });
