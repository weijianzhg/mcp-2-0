import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { registerConfirmTool } from "./confirm.js";
import { registerStateTools } from "./state.js";

const cacheHints = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
};

function createDemoServer(demoFiles) {
  const server = new McpServer({ name: "mcp-demo", version: "0.1.0" }, { cacheHints });
  registerStateTools(server);
  registerConfirmTool(server, demoFiles);
  return server;
}

export async function startServer({ port = 3000, onRequest } = {}) {
  const demoFiles = new Set(["a.txt", "b.txt", "c.txt", "keep.txt"]);
  const mcpHandler = createMcpHandler(() => createDemoServer(demoFiles), {
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
