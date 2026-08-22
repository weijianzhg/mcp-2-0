import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

// This Map represents durable application storage. It deliberately lives
// outside McpServer so fresh server instances can access the same counters.
const countersById = new Map();
let nextServerInstance = 0;

function createStateServer() {
  const serverInstance = ++nextServerInstance;
  let ephemeralCounter = 0;
  const server = new McpServer({ name: "mcp-state-demo", version: "0.1.0" });

  server.registerTool(
    "increment-ephemeral-counter",
    {
      description: "Increment state held only by this per-request server instance.",
      outputSchema: z.object({
        value: z.number(),
        serverInstance: z.number(),
      }),
    },
    async () => {
      ephemeralCounter += 1;
      const structuredContent = { value: ephemeralCounter, serverInstance };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "create-counter",
    {
      description: "Create application state and return its explicit handle.",
      outputSchema: z.object({ counterId: z.uuid(), value: z.number() }),
    },
    async () => {
      const counterId = randomUUID();
      countersById.set(counterId, 0);
      const structuredContent = { counterId, value: 0 };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "increment-counter",
    {
      description: "Increment application state selected by counterId.",
      inputSchema: z.object({ counterId: z.uuid() }),
      outputSchema: z.object({ counterId: z.uuid(), value: z.number() }),
    },
    async ({ counterId }) => {
      const currentValue = countersById.get(counterId);
      if (currentValue === undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown counterId: ${counterId}` }],
        };
      }

      const value = currentValue + 1;
      countersById.set(counterId, value);
      const structuredContent = { counterId, value };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  return server;
}

export async function startServer({ port = 3000, onRequest } = {}) {
  const mcpHandler = createMcpHandler(createStateServer, {
    legacy: "reject",
    onerror: (error) => console.error("MCP error:", error),
  });
  const handleMcpRequest = toNodeHandler(mcpHandler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    if (!validateHost(request, response) || !validateOrigin(request, response)) return;

    onRequest?.({
      method: request.headers["mcp-method"] ?? null,
      name: request.headers["mcp-name"] ?? null,
      protocolVersion: request.headers["mcp-protocol-version"] ?? null,
      sessionId: request.headers["mcp-session-id"] ?? null,
    });
    await handleMcpRequest(request, response);
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", resolve);
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: new URL(`http://127.0.0.1:${actualPort}/mcp`),
    async close() {
      await mcpHandler.close();
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({ port: Number(process.env.PORT ?? 3000) });
  console.log(`MCP server listening at ${server.url}`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
