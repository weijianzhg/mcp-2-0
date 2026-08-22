# Stateless MCP, stateful application

A minimal JavaScript project demonstrating the main MCP `2026-07-28`
request/response patterns with the MCP TypeScript SDK v2.

The demo covers:

- Stateless HTTP requests with no `Mcp-Session-Id`.
- Application-managed state addressed by explicit handles.
- Multi round-trip requests for user confirmation.
- Progress updates scoped to an individual operation.
- Cacheable tool discovery with TTL and sharing scope.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run demo
```

The command starts a server on an available local port, exercises every
scenario, prints the results, and shuts the server down. The deletion example
uses an in-memory virtual file set and never touches files on disk.

Run the integration tests with:

```sh
npm test
```

To leave the server running for another MCP client:

```sh
npm run server
```

The endpoint is `http://127.0.0.1:3000/mcp`. Set `PORT` to override the port.

## 1. Stateless requests

MCP `2026-07-28` removes protocol-level HTTP sessions. This project creates a
fresh `McpServer` for each request, so any request can reach any server instance:

```js
const mcpHandler = createMcpHandler(
  () => createStateServer(demoFiles),
  {
    legacy: "reject",
    onerror: (error) => console.error("MCP error:", error),
  },
);
```

The client explicitly selects the modern protocol revision:

```js
const client = new Client(
  { name: "state-demo-client", version: "0.1.0" },
  {
    capabilities: { elicitation: { form: {} } },
    versionNegotiation: {
      mode: { pin: "2026-07-28" },
    },
  },
);
```

State stored inside one `McpServer` instance therefore disappears after that
request. Calling the demo's ephemeral counter twice produces `1` from two
different server instances.

## 2. Stateful application data

Stateless MCP does not require a stateless application. Durable state belongs
outside the per-request MCP server and is selected using an explicit handle:

```js
const countersById = new Map();

server.registerTool(
  "create-counter",
  {
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
```

The client carries the handle between otherwise independent calls:

```js
const created = await client.callTool({ name: "create-counter" });
const { counterId } = created.structuredContent;

await client.callTool({
  name: "increment-counter",
  arguments: { counterId },
});
```

The in-memory `Map` is only a stand-in. A production server should use a
database or shared store, bind handles to the authenticated principal, and
enforce authorization and expiry on every lookup.

## 3. Multi round-trip confirmation

A tool that needs more input returns `input_required`. The client obtains the
answer and retries the original request with `inputResponses`, so the server
does not initiate a second JSON-RPC request on the operation stream.

```js
server.registerTool(
  "delete-files",
  {
    inputSchema: z.object({ files: z.array(z.string()).min(1) }),
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
            message: `Delete ${files.length} virtual files?`,
            requestedSchema: confirmationSchema,
          }),
        },
      });
    }

    if (!confirmation.confirm) {
      return {
        content: [{ type: "text", text: "Cancelled" }],
        structuredContent: { status: "cancelled", deleted: [] },
      };
    }

    const deleted = files.filter((file) => demoFiles.delete(file));
    return {
      content: [{ type: "text", text: `Deleted: ${deleted.join(", ")}` }],
      structuredContent: { status: "deleted", deleted },
    };
  },
);
```

The SDK can fulfil the request and retry automatically using the normal
elicitation handler:

```js
client.setRequestHandler("elicitation/create", async (request) => {
  const confirm = await askUser(request.params.message);
  return {
    action: "accept",
    content: { confirm },
  };
});
```

Confirmation is user experience, not authorization. The server must still
authenticate the caller and independently enforce permission to delete files.

## 4. Request-scoped progress

Progress remains attached to the request that started the work. Concurrent
operations receive only their own updates instead of sharing one global event
stream.

```js
server.registerTool(
  "run-work",
  { inputSchema: z.object({ job: z.string() }) },
  async ({ job }, ctx) => {
    const progressToken = ctx.mcpReq._meta?.progressToken;

    for (const progress of [10, 30, 70]) {
      if (progressToken !== undefined) {
        await ctx.mcpReq.notify({
          method: "notifications/progress",
          params: {
            progressToken,
            progress,
            total: 100,
            message: `${job}: ${progress}%`,
          },
        });
      }
    }

    return {
      content: [{ type: "text", text: `${job}: complete` }],
      structuredContent: { job, status: "complete" },
    };
  },
);
```

Each client call supplies its own progress callback:

```js
await Promise.all([
  client.callTool(
    { name: "run-work", arguments: { job: "alpha" } },
    { onprogress: (update) => alphaProgress.push(update) },
  ),
  client.callTool(
    { name: "run-work", arguments: { job: "beta" } },
    { onprogress: (update) => betaProgress.push(update) },
  ),
]);
```

## 5. Cacheability

Cacheable responses include a freshness lifetime and sharing policy. This
reduces repeated discovery traffic when one agent connects to many MCP servers.

This server marks its tool catalog as reusable for five minutes:

```js
const server = new McpServer(
  { name: "mcp-state-demo", version: "0.1.0" },
  {
    cacheHints: {
      "tools/list": {
        ttlMs: 300_000,
        cacheScope: "public",
      },
    },
  },
);
```

The client uses fresh entries automatically:

```js
await client.listTools(); // network request; stores the result
await client.listTools(); // cache hit; no network request

await client.listTools(undefined, {
  cacheMode: "refresh",
}); // forces a network request and updates the cache
```

The fields apply to `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list`, and `resources/read` results.

- `public` allows clients and shared intermediaries to reuse the result across
  users.
- `private` restricts reuse to the requesting authorization context. When a
  cache store is shared, set the client's `cachePartition` to a stable
  principal identifier.

A TTL is a freshness estimate. List-change notifications can invalidate cached
catalogs before their TTL expires.

## Project structure

```text
src/server.js       MCP server and tool implementations
src/demo.js         Client exercising all five scenarios
test/state.test.js  Integration tests for every scenario
```

The MCP packages are pinned to `2.0.0`, including the `inputRequired`,
`acceptedContent`, caching, and request-scoped progress APIs used here.
