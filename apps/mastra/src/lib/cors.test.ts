import assert from "node:assert/strict";
import test from "node:test";

import { parseConfiguredCorsOrigins, resolveCorsOrigin } from "./cors";

test("parseConfiguredCorsOrigins normalizes comma-separated values", () => {
  assert.deepEqual(
    parseConfiguredCorsOrigins([
      " https://app.contentful.com, https://example.ctfcloud.net/path ",
      undefined,
      "https://app.eu.contentful.com",
    ]),
    [
      "https://app.contentful.com",
      "https://example.ctfcloud.net",
      "https://app.eu.contentful.com",
    ],
  );
});

test("resolveCorsOrigin allows the exact configured iframe origin in production", () => {
  assert.equal(
    resolveCorsOrigin(
      "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
      ["https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net"],
      false,
      "production",
    ),
    "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
  );
});

test("resolveCorsOrigin rejects unconfigured Contentful-hosted origins in production", () => {
  assert.equal(
    resolveCorsOrigin(
      "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
      ["https://app.contentful.com"],
      false,
      "production",
    ),
    null,
  );
});

test("resolveCorsOrigin allows Contentful-hosted origins in production when enabled", () => {
  assert.equal(
    resolveCorsOrigin(
      "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
      [],
      true,
      "production",
    ),
    "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
  );
});

test("resolveCorsOrigin allows Contentful-hosted origins outside production", () => {
  assert.equal(
    resolveCorsOrigin(
      "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
      [],
      false,
      "development",
    ),
    "https://3d400b41-e914-42ac-9fbf-33a738d2a866.ctfcloud.net",
  );
});
