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

test("delete-files uses MRTR to confirm or cancel destructive work", async () => {
  const result = await runDemo(() => {});

  assert.deepEqual(result.elicitationRequests, [
    { message: "Delete 3 virtual files?", confirm: true },
    { message: "Delete 1 virtual file?", confirm: false },
  ]);
  assert.deepEqual(result.confirmedDeletion, {
    status: "deleted",
    deleted: ["a.txt", "b.txt", "c.txt"],
  });
  assert.deepEqual(result.cancelledDeletion, { status: "cancelled", deleted: [] });

  const deleteRequests = result.requests.filter(({ name }) => name === "delete-files");
  assert.equal(deleteRequests.length, 4);
  assert.ok(deleteRequests.every(({ sessionId }) => sessionId === null));
});

test("progress remains scoped to each tool request", async () => {
  const result = await runDemo(() => {});

  assert.deepEqual(
    result.progressByJob.alpha.map(({ progress }) => progress),
    [10, 30, 70],
  );
  assert.deepEqual(
    result.progressByJob.beta.map(({ progress }) => progress),
    [10, 30, 70],
  );
  assert.deepEqual(result.workResults, [
    { job: "alpha", status: "complete" },
    { job: "beta", status: "complete" },
  ]);
});

test("tools/list reuses a fresh public cache entry", async () => {
  const result = await runDemo(() => {});

  assert.deepEqual(result.cacheability, {
    ttlMs: 300_000,
    cacheScope: "public",
    sameToolCount: true,
    requestsForFirstAndRepeatedCall: 1,
    requestsAfterForcedRefresh: 2,
  });
});
