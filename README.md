# Stateless MCP, stateful application

A minimal JavaScript example showing how application state works with the
stateless MCP `2026-07-28` protocol.

The example has one server, one demo, and five tools split across five scenarios:

- `increment-ephemeral-counter` keeps state inside a per-request `McpServer`.
  Calling it twice returns `1` twice from two different server instances.
- `create-counter` creates application state and returns a `counterId`.
- `increment-counter` accepts that ID, allowing the counter to advance from
  `0` to `1` to `2` across independent requests.
- `delete-files` demonstrates a multi round-trip request (MRTR). The first
  call returns `input_required` with an embedded confirmation prompt. The
  client answers it and automatically retries the same tool call with
  `inputResponses`; the server then either deletes the virtual files or
  cancels the operation.
- `run-work` emits progress on the response stream belonging to one tool call.
  Two concurrent calls demonstrate that each progress callback receives only
  its own updates.
- `tools/list` advertises a five-minute public cache lifetime. Two consecutive
  client calls produce one network request; an explicit refresh produces a
  second request.

No request carries an `Mcp-Session-Id`. The application is stateful, but the
protocol remains stateless.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run demo
```

The demo starts the server on an available local port, runs all five
scenarios, prints the relevant request headers, confirmation exchange, and
request-scoped events, and then shuts down. It also prints the cache policy and
network request counts. The deletion example uses an in-memory virtual file set
and never touches files on disk.

To leave the server running for another MCP client:

```sh
npm run server
```

Its endpoint is `http://127.0.0.1:3000/mcp`. Set `PORT` to override the port.

Run the integration test with:

```sh
npm test
```

## Project structure

```text
src/server.js    MCP server and tools for state, MRTR, and progress
src/demo.js      client that demonstrates and verifies their behavior
test/state.test.js
```

The process-level `Map` in `src/server.js` stands in for durable storage. A
production server should use a database or shared store and bind opaque IDs to
the authenticated principal, with authorization and expiry checks.

The MCP packages are pinned to `2.0.0`, which includes the `inputRequired`
and `acceptedContent` helpers used by the MRTR example.

## Cacheability

MCP `2026-07-28` adds `ttlMs` and `cacheScope` to `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, and `resources/read` results.
This server marks its tool catalog as reusable for five minutes:

```js
const server = new McpServer(serverInfo, {
  cacheHints: {
    "tools/list": {
      ttlMs: 300_000,
      cacheScope: "public",
    },
  },
});
```

The client uses fresh entries automatically:

```js
await client.listTools(); // network request; stores the result
await client.listTools(); // cache hit; no network request

await client.listTools(undefined, {
  cacheMode: "refresh",
}); // forces a network request and updates the cache
```

Use `public` only when the result is safe to share between users. Use `private`
for user-specific catalogs or resources, and configure the client's
`cachePartition` with a stable authorization-context identifier when a cache
store is shared. A TTL is a freshness estimate; list-change notifications can
invalidate a cached result before it expires.
