import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatDebugError,
  parseChatDebugError,
  serializeChatDebugError,
} from "./debugErrors";

test("createChatDebugError preserves context and serializes cleanly", () => {
  const error = createChatDebugError(new Error("Boom"), {
    code: "example_failure",
    phase: "error",
    toolName: "discoverCandidatesClient",
    details: {
      query: "porter",
    },
  });

  assert.equal(error.message, "Boom");
  assert.equal(error.code, "example_failure");
  assert.equal(error.phase, "error");
  assert.equal(error.toolName, "discoverCandidatesClient");
  assert.match(error.details[0] ?? "", /query: porter/);

  const reparsed = parseChatDebugError(serializeChatDebugError(error));
  assert.deepEqual(reparsed, error);
});

test("parseChatDebugError ignores plain text values", () => {
  assert.equal(parseChatDebugError("not json"), null);
});
