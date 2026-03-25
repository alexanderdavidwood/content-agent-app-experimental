const CONTENTFUL_WEB_APP_HOSTS = new Set([
  "app.contentful.com",
  "app.eu.contentful.com",
]);

function normalizeOrigin(origin: string) {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function isContentfulHostedAppOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      CONTENTFUL_WEB_APP_HOSTS.has(url.hostname) ||
      url.hostname.endsWith(".ctfcloud.net")
    );
  } catch {
    return false;
  }
}

export function parseConfiguredCorsOrigins(
  values: Array<string | undefined>,
): string[] {
  const allowedOrigins = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const candidate of value.split(",")) {
      const normalized = normalizeOrigin(candidate);
      if (normalized) {
        allowedOrigins.add(normalized);
      }
    }
  }

  return [...allowedOrigins];
}

export function resolveCorsOrigin(
  origin: string,
  configuredOrigins: string[],
  allowContentfulHostedAppOrigins = false,
  nodeEnv = process.env.NODE_ENV,
) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return null;
  }

  if (configuredOrigins.includes(normalizedOrigin)) {
    return normalizedOrigin;
  }

  if (allowContentfulHostedAppOrigins && isContentfulHostedAppOrigin(normalizedOrigin)) {
    return normalizedOrigin;
  }

  if (
    nodeEnv !== "production" &&
    (isLocalOrigin(normalizedOrigin) || isContentfulHostedAppOrigin(normalizedOrigin))
  ) {
    return normalizedOrigin;
  }

  return null;
}
