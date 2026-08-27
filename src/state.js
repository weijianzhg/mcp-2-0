import { randomUUID } from "node:crypto";

import * as z from "zod/v4";

import { fail, ok } from "./result.js";

// Lives outside McpServer so every request can see the same counters.
const countersById = new Map();
let nextServerInstance = 0;

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

  server.registerTool(
    "increment-counter",
    {
      description: "Increment application state selected by counterId.",
      inputSchema: z.object({ counterId: z.uuid() }),
      outputSchema: z.object({ counterId: z.uuid(), value: z.number() }),
    },
    async ({ counterId }) => {
      const current = countersById.get(counterId);
      if (current === undefined) return fail(`Unknown counterId: ${counterId}`);

      const value = current + 1;
      countersById.set(counterId, value);
      return ok({ counterId, value });
    },
  );
}
