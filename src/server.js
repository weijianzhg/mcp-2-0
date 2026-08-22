import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  acceptedContent,
  createMcpHandler,
  inputRequired,
  McpServer,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

// This Map represents durable application storage. It deliberately lives
// outside McpServer so fresh server instances can access the same counters.
const countersById = new Map();
let nextServerInstance = 0;

const confirmationSchema = z.object({ confirm: z.boolean() });

function createStateServer(demoFiles) {
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

  server.registerTool(
    "delete-files",
    {
      description: "Delete virtual demo files after asking the user for confirmation.",
      inputSchema: z.object({ files: z.array(z.string()).min(1) }),
      outputSchema: z.object({
        status: z.enum(["cancelled", "deleted"]),
        deleted: z.array(z.string()),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ files }, ctx) => {
      const confirmation = acceptedContent(
        ctx.mcpReq.inputResponses,
        "confirm",
        confirmationSchema,
      );

      if (confirmation === undefined) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Delete ${files.length} virtual file${files.length === 1 ? "" : "s"}?`,
              requestedSchema: confirmationSchema,
            }),
          },
        });
      }

      if (!confirmation.confirm) {
        const structuredContent = { status: "cancelled", deleted: [] };
        return {
          content: [{ type: "text", text: "Cancelled" }],
          structuredContent,
        };
      }

      const deleted = files.filter((file) => demoFiles.delete(file));
      const structuredContent = { status: "deleted", deleted };
      return {
        content: [{ type: "text", text: `Deleted: ${deleted.join(", ") || "none"}` }],
        structuredContent,
      };
    },
  );

  return server;
}

export async function startServer({ port = 3000, onRequest } = {}) {
  // Like countersById, this store lives outside each per-request McpServer.
  // It is scoped to one HTTP server so separate demos cannot interfere.
  const demoFiles = new Set(["a.txt", "b.txt", "c.txt", "keep.txt"]);
  const mcpHandler = createMcpHandler(() => createStateServer(demoFiles), {
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
