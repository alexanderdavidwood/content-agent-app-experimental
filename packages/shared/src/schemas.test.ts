import assert from "node:assert/strict";
import test from "node:test";

import {
  listContentTypesToolInputSchema,
  readEntriesToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
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
