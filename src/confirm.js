import { acceptedContent, inputRequired } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { ok } from "./result.js";

const confirmationSchema = z.object({ confirm: z.boolean() });

export function registerConfirmTool(server, demoFiles) {
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

      // Client retries this same call with inputResponses.
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
        return ok({ status: "cancelled", deleted: [] });
      }

      const deleted = files.filter((file) => demoFiles.delete(file));
      return ok({ status: "deleted", deleted });
    },
  );
}
