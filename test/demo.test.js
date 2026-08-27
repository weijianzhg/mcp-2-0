import assert from "node:assert/strict";
import test from "node:test";

import { demoCache, demoConfirm, demoState, startDemo } from "../src/demo.js";

async function withDemo(run) {
  const demo = await startDemo();
  try {
    return await run(demo);
  } finally {
    await demo.client.close();
    await demo.server.close();
  }
}

test("1. counterId carries app state across stateless requests", async () => {
  await withDemo(async ({ client, requests }) => {
    const { ephemeral, stateful } = await demoState(client);

    assert.ok(requests.every(({ sessionId }) => sessionId === null));
    assert.deepEqual(
      ephemeral.map(({ value }) => value),
      [1, 1],
    );
    assert.notEqual(ephemeral[0].serverInstance, ephemeral[1].serverInstance);
    assert.deepEqual(
      stateful.map(({ value }) => value),
      [0, 1, 2],
    );
    assert.ok(stateful.every(({ counterId }) => counterId === stateful[0].counterId));
  });
});

test("2. delete-files uses MRTR to confirm or cancel", async () => {
  await withDemo(async ({ client, requests, elicitationRequests }) => {
    const { confirmedDeletion, cancelledDeletion } = await demoConfirm(
      client,
      elicitationRequests,
    );

    assert.deepEqual(elicitationRequests, [
      { message: "Delete 3 virtual files?", confirm: true },
      { message: "Delete 1 virtual file?", confirm: false },
    ]);
    assert.deepEqual(confirmedDeletion, {
      status: "deleted",
      deleted: ["a.txt", "b.txt", "c.txt"],
    });
    assert.deepEqual(cancelledDeletion, { status: "cancelled", deleted: [] });

    const deleteRequests = requests.filter(({ name }) => name === "delete-files");
    assert.equal(deleteRequests.length, 4);
    assert.ok(deleteRequests.every(({ sessionId }) => sessionId === null));
  });
});

test("3. tools/list reuses a fresh public cache entry", async () => {
  await withDemo(async ({ client, requests }) => {
    const { cacheability } = await demoCache(client, requests);

    assert.deepEqual(cacheability, {
      ttlMs: 300_000,
      cacheScope: "public",
      sameToolCount: true,
      requestsForFirstAndRepeatedCall: 1,
      requestsAfterForcedRefresh: 2,
    });
  });
});
