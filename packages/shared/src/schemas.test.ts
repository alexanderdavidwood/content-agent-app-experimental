import assert from "node:assert/strict";
import test from "node:test";

import {
  appInstallationParametersSchema,
  chatExecutionContextSchema,
  mcpEnvironmentSetupStatusSchema,
  mcpSessionStatusSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolInputSchema,
  readEntriesToolInputSchema,
  searchEntriesToolOutputSchema,
  updateEntryAndPublishToolOutputSchema,
  validateApprovedChangesToolOutputSchema,
} from "./schemas";

test("listContentTypesToolInputSchema defaults optional values", () => {
  const parsed = listContentTypesToolInputSchema.parse({});

  assert.deepEqual(parsed.contentTypeIds, []);
  assert.equal(parsed.includeFields, false);
  assert.equal(parsed.limit, 20);
});

test("readEntriesToolInputSchema rejects more than twenty entry ids", () => {
  assert.throws(() =>
    readEntriesToolInputSchema.parse({
      entryIds: Array.from({ length: 21 }, (_, index) => `entry-${index + 1}`),
      locales: ["en-US"],
    }),
  );
});

test("updateEntryAndPublishToolOutputSchema accepts partial publish failures", () => {
  const parsed = updateEntryAndPublishToolOutputSchema.parse({
    entryId: "entry-1",
    contentTypeId: "page",
    status: "UPDATED_NOT_PUBLISHED",
    version: 4,
    updatedAt: "2026-03-22T10:00:00.000Z",
    message: "publish denied",
  });

  assert.equal(parsed.status, "UPDATED_NOT_PUBLISHED");
  assert.equal(parsed.message, "publish denied");
});

test("installation parameters default new tool availability flags to true", () => {
  const parsed = appInstallationParametersSchema.parse({
    mastraBaseUrl: "https://example.com",
  });

  assert.equal(parsed.contentOpsProvider, "hybrid");
  assert.equal(parsed.mcpAutoFallbackToClientSdk, true);
  assert.equal(parsed.generalContentToolAvailability.listEntries, true);
  assert.equal(parsed.generalContentToolAvailability.publishEntry, false);
  assert.deepEqual(parsed.toolAvailability, {
    semanticSearch: true,
    entrySearch: true,
    preApplyValidation: true,
  });
});

test("chat execution context defaults time zone, current date, and tool availability", () => {
  const parsed = chatExecutionContextSchema.parse({
    defaultLocale: "en-US",
  });

  assert.equal(parsed.timeZone, "UTC");
  assert.match(parsed.currentDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(parsed.contentOpsProvider, "hybrid");
  assert.equal(parsed.generalContentToolAvailability.getContentType, true);
  assert.equal(parsed.mcpAutoFallbackToClientSdk, true);
  assert.equal(parsed.toolAvailability.entrySearch, true);
  assert.equal(parsed.toolAvailability.preApplyValidation, true);
});

test("locale and search result schemas validate the new inspection outputs", () => {
  const locales = getLocalesToolOutputSchema.parse({
    locales: [
      {
        code: "en-US",
        name: "English (United States)",
        default: true,
      },
    ],
  });
  const searchResult = searchEntriesToolOutputSchema.parse({
    filters: {
      queryText: "Acme",
      contentTypeIds: ["landingPage"],
      status: "draft",
      updatedAtFrom: "2026-03-15",
      updatedAtTo: "2026-03-22",
      limit: 20,
    },
    total: 1,
    entries: [
      {
        entryId: "entry-1",
        contentTypeId: "landingPage",
        version: 3,
        updatedAt: "2026-03-22T10:00:00.000Z",
        displayFieldId: "title",
        displayFieldValue: "Acme landing page",
      },
    ],
    warnings: [],
  });

  assert.equal(locales.locales[0]?.code, "en-US");
  assert.equal(searchResult.entries[0]?.displayFieldValue, "Acme landing page");
});

test("pre-apply validation schema accepts blocking issues and warnings", () => {
  const parsed = validateApprovedChangesToolOutputSchema.parse({
    runId: "run-1",
    canApply: false,
    operations: [],
    blockingIssues: [
      {
        code: "version_mismatch",
        severity: "blocking",
        message: "Entry version changed.",
        entryId: "entry-1",
      },
    ],
    warnings: [
      {
        code: "risk_flag_present",
        severity: "warning",
        message: "Approved change still has risk flags.",
        entryId: "entry-1",
        fieldId: "title",
        locale: "en-US",
      },
    ],
  });

  assert.equal(parsed.blockingIssues[0]?.severity, "blocking");
  assert.equal(parsed.warnings[0]?.severity, "warning");
});

test("mcp session and environment setup schemas accept hybrid status payloads", () => {
  const session = mcpSessionStatusSchema.parse({
    provider: "hybrid",
    state: "connected",
    sessionId: "session-1",
    sessionCookieId: "cookie-1",
    connectedAt: "2026-03-23T09:00:00.000Z",
    availableTools: ["list_content_types", "get_entry"],
    effectiveTools: [
      {
        toolName: "listEntries",
        enabledInAppConfig: true,
        availableViaMcp: true,
        fallbackAvailable: true,
        status: "enabled",
      },
    ],
  });

  const setup = mcpEnvironmentSetupStatusSchema.parse({
    provider: "hybrid",
    state: "ready",
    spaceId: "space-1",
    environmentId: "master",
    requiredCategories: [
      {
        category: "entries",
        access: "read-only",
      },
    ],
    availableTools: ["search_entries"],
    missingTools: [],
  });

  assert.equal(session.effectiveTools[0]?.toolName, "listEntries");
  assert.equal(setup.requiredCategories[0]?.category, "entries");
});
