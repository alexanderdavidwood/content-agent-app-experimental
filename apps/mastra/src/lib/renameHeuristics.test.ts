import test from "node:test";
import assert from "node:assert/strict";

import { buildHeuristicDiscoveryPlan, buildHeuristicProposals } from "./renameHeuristics";

test("buildHeuristicDiscoveryPlan keeps semantic queries within the MVP cap", () => {
  const plan = buildHeuristicDiscoveryPlan({
    oldProductName: "Acme Widget",
    newProductName: "Acme Nova",
    defaultLocale: "en-US",
    searchMode: "semantic",
    contentTypeIds: [],
  });

  assert.ok(plan.queries.length > 0);
  assert.ok(plan.queries.length <= 5);
  assert.ok(plan.aliases.includes("Acme Widget"));
});

test("buildHeuristicProposals creates segment-level rich text proposals", () => {
  const proposals = buildHeuristicProposals(
    {
      oldProductName: "Acme Widget",
      newProductName: "Acme Nova",
      defaultLocale: "en-US",
      searchMode: "semantic",
      contentTypeIds: [],
    },
    [
      {
        entryId: "entry-1",
        contentTypeId: "page",
        version: 3,
        updatedAt: "2026-03-19T00:00:00.000Z",
        fields: [
          {
            fieldId: "body",
            locale: "en-US",
            fieldType: "RichText",
            rawValue: {
              nodeType: "document",
              content: [
                {
                  nodeType: "paragraph",
                  content: [
                    {
                      nodeType: "text",
                      value: "Acme Widget is referenced in legal terms.",
                      marks: [],
                    },
                  ],
                },
              ],
            },
            segments: [
              {
                segmentId: "body:0.0",
                path: [0, 0],
                text: "Acme Widget is referenced in legal terms.",
                marks: [],
              },
            ],
          },
        ],
      },
    ],
  );

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.segmentId, "body:0.0");
  assert.ok(proposals[0]?.proposedText.includes("Acme Nova"));
  assert.ok(proposals[0]?.riskFlags.includes("LEGAL_CONTEXT"));
});
