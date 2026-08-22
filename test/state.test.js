import assert from "node:assert/strict";
import test from "node:test";

import { runDemo } from "../src/demo.js";

test("explicit counterId carries application state across stateless requests", async () => {
  const result = await runDemo(() => {});

  assert.ok(result.requests.every(({ sessionId }) => sessionId === null));
  assert.deepEqual(
    result.ephemeral.map(({ value }) => value),
    [1, 1],
  );
  assert.notEqual(result.ephemeral[0].serverInstance, result.ephemeral[1].serverInstance);
  assert.deepEqual(
    result.stateful.map(({ value }) => value),
    [0, 1, 2],
  );
  assert.ok(result.stateful.every(({ counterId }) => counterId === result.stateful[0].counterId));
});
