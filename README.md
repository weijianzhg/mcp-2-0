# Stateless MCP, stateful application

A minimal JavaScript example showing how application state works with the
stateless MCP `2026-07-28` protocol.

The example has one server, one demo, and four tools split across three scenarios:

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

No request carries an `Mcp-Session-Id`. The application is stateful, but the
protocol remains stateless.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run demo
```

The demo starts the server on an available local port, runs all three
scenarios, prints the relevant request headers, confirmation exchange, and
results, and shuts down. The deletion example uses an in-memory virtual file
set and never touches files on disk.

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
src/server.js    MCP server, state tools, and MRTR confirmation tool
src/demo.js      client that demonstrates and verifies their behavior
test/state.test.js
```

The process-level `Map` in `src/server.js` stands in for durable storage. A
production server should use a database or shared store and bind opaque IDs to
the authenticated principal, with authorization and expiry checks.

The MCP packages are pinned to `2.0.0`, which includes the `inputRequired`
and `acceptedContent` helpers used by the MRTR example.
