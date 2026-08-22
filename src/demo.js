import { pathToFileURL } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startServer } from "./server.js";

function getOutput(result) {
  if (result.isError) {
    throw new Error(result.content.map((item) => item.text ?? "").join("\n"));
  }
  return result.structuredContent;
}

export async function runDemo(log = console.log) {
  const requests = [];
  const elicitationRequests = [];
  const confirmationAnswers = [true, false];
  const server = await startServer({
    port: 0,
    onRequest: (request) => requests.push(request),
  });
  const client = new Client(
    { name: "state-demo-client", version: "0.1.0" },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );

  client.setRequestHandler("elicitation/create", async (request) => {
    const confirm = confirmationAnswers.shift();
    if (confirm === undefined) throw new Error("No demo confirmation answer available");
    elicitationRequests.push({ message: request.params.message, confirm });
    return { action: "accept", content: { confirm } };
  });

  try {
    await client.connect(new StreamableHTTPClientTransport(server.url));

    const ephemeral = [
      getOutput(await client.callTool({ name: "increment-ephemeral-counter" })),
      getOutput(await client.callTool({ name: "increment-ephemeral-counter" })),
    ];

    const created = getOutput(await client.callTool({ name: "create-counter" }));
    const stateful = [
      created,
      getOutput(
        await client.callTool({
          name: "increment-counter",
          arguments: { counterId: created.counterId },
        }),
      ),
      getOutput(
        await client.callTool({
          name: "increment-counter",
          arguments: { counterId: created.counterId },
        }),
      ),
    ];

    const confirmedDeletion = getOutput(
      await client.callTool({
        name: "delete-files",
        arguments: { files: ["a.txt", "b.txt", "c.txt"] },
      }),
    );
    const cancelledDeletion = getOutput(
      await client.callTool({
        name: "delete-files",
        arguments: { files: ["keep.txt"] },
      }),
    );

    const progressByJob = { alpha: [], beta: [] };
    const [alphaWork, betaWork] = await Promise.all([
      client.callTool(
        { name: "run-work", arguments: { job: "alpha" } },
        { onprogress: (progress) => progressByJob.alpha.push(progress) },
      ),
      client.callTool(
        { name: "run-work", arguments: { job: "beta" } },
        { onprogress: (progress) => progressByJob.beta.push(progress) },
      ),
    ]);
    const workResults = [getOutput(alphaWork), getOutput(betaWork)];

    const toolListRequestsBefore = requests.filter(
      ({ method }) => method === "tools/list",
    ).length;
    const firstToolList = await client.listTools();
    const cachedToolList = await client.listTools();
    const toolListRequestsAfterCacheHit = requests.filter(
      ({ method }) => method === "tools/list",
    ).length;
    await client.listTools(undefined, { cacheMode: "refresh" });
    const toolListRequestsAfterRefresh = requests.filter(
      ({ method }) => method === "tools/list",
    ).length;
    const cacheability = {
      ttlMs: firstToolList.ttlMs,
      cacheScope: firstToolList.cacheScope,
      sameToolCount: firstToolList.tools.length === cachedToolList.tools.length,
      requestsForFirstAndRepeatedCall:
        toolListRequestsAfterCacheHit - toolListRequestsBefore,
      requestsAfterForcedRefresh: toolListRequestsAfterRefresh - toolListRequestsBefore,
    };

    log("\nEvery request is independent:");
    for (const request of requests) {
      const target = request.name ? `${request.method} (${request.name})` : request.method;
      log(
        `  ${target}; version=${request.protocolVersion}; session=${request.sessionId ?? "none"}`,
      );
    }

    log("\nState inside each server instance resets:");
    log(" ", ephemeral);

    log("\nState addressed by counterId persists:");
    log(" ", stateful);

    log("\nMulti round-trip confirmation:");
    for (const elicitation of elicitationRequests) {
      log(`  server asks: ${elicitation.message}`);
      log(`  client answers: ${elicitation.confirm}`);
    }
    log("  confirmed result:", confirmedDeletion);
    log("  cancelled result:", cancelledDeletion);

    log("\nRequest-scoped progress:");
    log("  alpha progress:", progressByJob.alpha.map(({ progress }) => progress));
    log("  beta progress:", progressByJob.beta.map(({ progress }) => progress));
    log("  results:", workResults);

    log("\nCacheable tool catalog:");
    log(" ", cacheability);

    return {
      requests,
      ephemeral,
      stateful,
      elicitationRequests,
      confirmedDeletion,
      cancelledDeletion,
      progressByJob,
      workResults,
      cacheability,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDemo();
}
