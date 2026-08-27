import { pathToFileURL } from "node:url";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startServer } from "./server.js";

function getOutput(result) {
  if (result.isError) {
    throw new Error(result.content.map((item) => item.text ?? "").join("\n"));
  }
  return result.structuredContent;
}

export async function startDemo() {
  const requests = [];
  const elicitationRequests = [];
  const confirmationAnswers = [true, false];
  const server = await startServer({
    port: 0,
    onRequest: (request) => requests.push(request),
  });
  const client = new Client(
    { name: "mcp-demo-client", version: "0.1.0" },
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

  await client.connect(new StreamableHTTPClientTransport(server.url));
  return { client, server, requests, elicitationRequests };
}

export async function demoState(client, log = () => {}) {
  const ephemeral = [
    getOutput(await client.callTool({ name: "increment-ephemeral" })),
    getOutput(await client.callTool({ name: "increment-ephemeral" })),
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

  log("\n1. Stateless MCP vs stateful app");
  log("  ephemeral (resets each request):", ephemeral);
  log("  app state (counterId persists):", stateful);

  return { ephemeral, stateful };
}

export async function demoConfirm(client, elicitationRequests, log = () => {}) {
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

  log("\n2. Multi round-trip requests");
  for (const elicitation of elicitationRequests) {
    log(`  server asks: ${elicitation.message}`);
    log(`  client answers: ${elicitation.confirm}`);
  }
  log("  confirmed:", confirmedDeletion);
  log("  cancelled:", cancelledDeletion);

  return { elicitationRequests, confirmedDeletion, cancelledDeletion };
}

export async function demoCache(client, requests, log = () => {}) {
  const toolListRequestsBefore = requests.filter(({ method }) => method === "tools/list").length;
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
    requestsForFirstAndRepeatedCall: toolListRequestsAfterCacheHit - toolListRequestsBefore,
    requestsAfterForcedRefresh: toolListRequestsAfterRefresh - toolListRequestsBefore,
  };

  log("\n3. Caching");
  log(" ", cacheability);

  return { cacheability };
}

export async function runDemo(log = console.log) {
  const { client, server, requests, elicitationRequests } = await startDemo();

  try {
    const state = await demoState(client, log);
    const confirm = await demoConfirm(client, elicitationRequests, log);
    const cache = await demoCache(client, requests, log);

    log("\nEvery request is independent:");
    for (const request of requests) {
      const target = request.name ? `${request.method} (${request.name})` : request.method;
      log(
        `  ${target}; version=${request.protocolVersion}; session=${request.sessionId ?? "none"}`,
      );
    }

    return { requests, ...state, ...confirm, ...cache };
  } finally {
    await client.close();
    await server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDemo();
}
