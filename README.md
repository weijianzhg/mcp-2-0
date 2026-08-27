# Stateless MCP, stateful application

A minimal JavaScript demo of three MCP `2026-07-28` patterns with SDK v2:

1. Stateless MCP vs a stateful app
2. Multi round-trip requests
3. Caching

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run demo
```

The command starts a server on an available local port, exercises each
scenario, prints the results, and shuts the server down. The deletion example
uses an in-memory virtual file set and never touches files on disk.

```sh
npm test
```

To leave the server running for another MCP client:

```sh
npm run server
```

The endpoint is `http://127.0.0.1:3000/mcp`. Set `PORT` to override the port.

## 1. Stateless MCP vs stateful app

MCP `2026-07-28` has no protocol-level HTTP sessions. [`src/server.js`](src/server.js)
creates a fresh `McpServer` for each request:

```js
function createDemoServer(demoFiles) {
  const server = new McpServer({ name: "mcp-demo", version: "0.1.0" }, { cacheHints });
  registerStateTools(server);
  registerConfirmTool(server, demoFiles);
  return server;
}

const mcpHandler = createMcpHandler(() => createDemoServer(demoFiles), {
  legacy: "reject",
  onerror: (error) => console.error("MCP error:", error),
});
```

State stored on that instance disappears when the request ends. Application
state lives outside `McpServer` in [`src/state.js`](src/state.js) and is selected
with an explicit handle:

```js
const countersById = new Map();

export function registerStateTools(server) {
  const serverInstance = ++nextServerInstance;
  let ephemeral = 0; // dies with this request's McpServer

  server.registerTool(
    "increment-ephemeral",
    {
      description: "Increment state held only by this per-request server instance.",
      outputSchema: z.object({ value: z.number(), serverInstance: z.number() }),
    },
    async () => ok({ value: ++ephemeral, serverInstance }),
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
      return ok({ counterId, value: 0 });
    },
  );
}
```

The client carries `counterId` between otherwise independent calls. Calling
`increment-ephemeral` twice returns `1` from two different server instances;
calling `increment-counter` with the same handle returns `1`, then `2`.

The in-memory `Map` is only a stand-in. A production server should use a
shared store, bind handles to the authenticated principal, and enforce
authorization on every lookup.

## 2. Multi round-trip requests

A tool that needs more input returns `input_required`. The client gathers the
answer and retries the original request with `inputResponses`. From
[`src/confirm.js`](src/confirm.js):

```js
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
```

The demo client in [`src/demo.js`](src/demo.js) answers those elicitations and
retries automatically:

```js
client.setRequestHandler("elicitation/create", async (request) => {
  const confirm = confirmationAnswers.shift();
  elicitationRequests.push({ message: request.params.message, confirm });
  return { action: "accept", content: { confirm } };
});
```

Confirmation is user experience, not authorization. The server must still
authenticate the caller and independently enforce permission to delete files.

## 3. Caching

List results carry a freshness lifetime and sharing policy. [`src/server.js`](src/server.js)
marks the tool catalog as reusable for five minutes:

```js
const cacheHints = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
};

const server = new McpServer({ name: "mcp-demo", version: "0.1.0" }, { cacheHints });
```

The client in [`src/demo.js`](src/demo.js) uses fresh entries automatically:

```js
await client.listTools();
await client.listTools();
await client.listTools(undefined, { cacheMode: "refresh" });
```

The first call is a network request, the second is a cache hit, and
`cacheMode: "refresh"` forces a new request.

- `public` allows clients and shared intermediaries to reuse the result across users.
- `private` restricts reuse to the requesting authorization context.

A TTL is a freshness estimate. List-change notifications can invalidate cached
catalogs before their TTL expires.

## Project structure

```text
src/server.js       Per-request McpServer factory, HTTP, cacheHints
src/state.js        Ephemeral instance state vs app counters
src/confirm.js      Multi round-trip delete confirmation
src/demo.js         Client walkthrough of the three scenarios
src/result.js       Tiny ok()/fail() helpers
test/demo.test.js   One test per talking point
```

The MCP packages are pinned to `2.0.0`.
