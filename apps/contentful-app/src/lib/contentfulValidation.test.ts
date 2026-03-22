import assert from "node:assert/strict";
import test from "node:test";

import { validateApprovedChanges } from "./contentfulClient";

function createSdk(cma: any) {
  return {
    cma,
    cmaAdapter: {},
    ids: { space: "space-id", environment: "master" },
    parameters: {},
  } as any;
}

test("validateApprovedChanges returns blocking issues and warnings before apply", async () => {
  const sdk = createSdk({
    entry: {
      async getMany() {
        return {
          items: [
            {
              sys: {
                id: "entry-1",
                version: 5,
                updatedAt: "2026-03-22T10:00:00.000Z",
                contentType: { sys: { id: "landingPage" } },
              },
              fields: {
                title: {
                  "en-US": "Acme Lite",
                  "fr-FR": "Acme Lite FR",
                },
                body: { "en-US": "Acme Lite docs" },
              },
            },
          ],
        };
      },
    },
    contentType: {
      async get() {
        return {
          sys: { id: "landingPage" },
          fields: [
            { id: "title", type: "Symbol" },
            { id: "body", type: "Array" },
          ],
        };
      },
    },
    locale: {
      async getMany() {
        return {
          items: [
            {
              code: "en-US",
              name: "English (United States)",
              default: true,
            },
          ],
        };
      },
    },
  });

  const result = await validateApprovedChanges(sdk, {
    runId: "run-1",
    input: {
      oldProductName: "Acme Lite",
      newProductName: "Acme Core",
      defaultLocale: "en-US",
      searchMode: "semantic",
      contentTypeIds: ["landingPage"],
    },
    candidateSnapshots: [
      {
        entryId: "entry-1",
        contentTypeId: "landingPage",
        version: 4,
        updatedAt: "2026-03-20T10:00:00.000Z",
        fields: [
          {
            fieldId: "title",
            locale: "en-US",
            fieldType: "Symbol",
            rawValue: "Acme Lite",
            segments: [],
          },
          {
            fieldId: "title",
            locale: "fr-FR",
            fieldType: "Symbol",
            rawValue: "Acme Lite FR",
            segments: [],
          },
          {
            fieldId: "body",
            locale: "en-US",
            fieldType: "Text",
            rawValue: "Acme Lite docs",
            segments: [],
          },
        ],
      },
    ],
    proposedChanges: [
      {
        changeId: "change-title",
        entryId: "entry-1",
        fieldId: "title",
        locale: "en-US",
        originalText: "Acme Lite",
        proposedText: "Acme Core",
        reason: "Rename title",
        confidence: 0.95,
        riskFlags: ["LEGAL_CONTEXT"],
      },
      {
        changeId: "change-body",
        entryId: "entry-1",
        fieldId: "body",
        locale: "en-US",
        originalText: "Acme Lite docs",
        proposedText: "Acme Core docs",
        reason: "Rename body",
        confidence: 0.9,
        riskFlags: [],
      },
      {
        changeId: "change-fr",
        entryId: "entry-1",
        fieldId: "title",
        locale: "fr-FR",
        originalText: "Acme Lite FR",
        proposedText: "Acme Core FR",
        reason: "Rename title in FR",
        confidence: 0.9,
        riskFlags: [],
      },
    ],
    approvals: [
      { changeId: "change-title", approved: true },
      { changeId: "change-body", approved: true },
      { changeId: "change-fr", approved: true },
    ],
  });

  assert.equal(result.canApply, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === "version_mismatch"));
  assert.ok(result.blockingIssues.some((issue) => issue.code === "unsupported_field_type"));
  assert.ok(result.blockingIssues.some((issue) => issue.code === "locale_missing"));
  assert.ok(result.warnings.some((issue) => issue.code === "risk_flag_present"));
});

test("validateApprovedChanges warns when approvals produce zero operations", async () => {
  const sdk = createSdk({
    locale: {
      async getMany() {
        return {
          items: [
            {
              code: "en-US",
              name: "English (United States)",
              default: true,
            },
          ],
        };
      },
    },
  });

  const result = await validateApprovedChanges(sdk, {
    runId: "run-2",
    input: {
      oldProductName: "Acme Lite",
      newProductName: "Acme Core",
      defaultLocale: "en-US",
      searchMode: "semantic",
      contentTypeIds: [],
    },
    candidateSnapshots: [],
    proposedChanges: [],
    approvals: [],
  });

  assert.equal(result.canApply, false);
  assert.ok(result.warnings.some((issue) => issue.code === "no_operations"));
});
