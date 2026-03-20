import test from "node:test";
import assert from "node:assert/strict";

import { extractRichTextSegments, updateRichTextSegment } from "./richText";

test("extractRichTextSegments returns text nodes with stable paths", () => {
  const document = {
    nodeType: "document",
    content: [
      {
        nodeType: "paragraph",
        content: [
          {
            nodeType: "text",
            value: "Legacy product name",
            marks: [],
          },
        ],
      },
    ],
  };

  const segments = extractRichTextSegments("body", document);

  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0]?.path, [0, 0]);
  assert.equal(segments[0]?.text, "Legacy product name");
});

test("updateRichTextSegment replaces only the addressed text node", () => {
  const document = {
    nodeType: "document",
    content: [
      {
        nodeType: "paragraph",
        content: [
          {
            nodeType: "text",
            value: "Legacy product name",
            marks: [],
          },
          {
            nodeType: "text",
            value: " stays here",
            marks: [],
          },
        ],
      },
    ],
  };

  const updated = updateRichTextSegment(document, [0, 0], "New product name");

  assert.equal(updated.content?.[0]?.content?.[0]?.value, "New product name");
  assert.equal(updated.content?.[0]?.content?.[1]?.value, " stays here");
});
