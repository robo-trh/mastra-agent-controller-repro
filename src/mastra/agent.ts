// The backing agent. Its dynamic instructions and its dynamic tool both read
// `requestContext.get("tenantId")` — the value the server middleware injected
// from the `x-tenant-id` header — and record what they saw into a shared,
// per-channel observation map. That map is the model-independent observable the
// repro script asserts on.
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createMockModel } from "./mock-model.js";
import { recordInstructionsTenant, recordToolTenant } from "./observations.js";

/**
 * Build an Agent bound to a `channel` label so the repro can attribute what the
 * instructions/tool observed on each request path (controller vs control).
 *
 * The SAME construction is used for both paths; the only difference in the repro
 * is HOW the agent is invoked (AgentController HTTP route vs plain agent route).
 */
export function createBackingAgent(channel: string) {
  // The tool records the tenant it sees too, but with the no-network mock model
  // the agent never emits a real tool call, so this stays "(never ran)". The
  // dynamic-instructions observation below is the model-independent signal the
  // repro asserts on; the tool is included to show WHERE tenant-scoped tools
  // would read identity in a real deployment.
  const whoamiTool = createTool({
    id: "whoami",
    description: "Report the tenant identity visible in the request context.",
    inputSchema: z.object({}),
    outputSchema: z.object({ tenantId: z.string() }),
    execute: async ({ requestContext }) => {
      const tenantId = (requestContext?.get("tenantId") as string | undefined) ?? null;
      recordToolTenant(channel, tenantId);
      return { tenantId: tenantId ?? "MISSING" };
    },
  });

  return new Agent({
    id: `backing-agent-${channel}`,
    name: `Backing Agent (${channel})`,
    model: createMockModel(),
    tools: { whoami: whoamiTool },
    instructions: ({ requestContext }) => {
      const tenantId = (requestContext?.get("tenantId") as string | undefined) ?? null;
      recordInstructionsTenant(channel, tenantId);
      if (!tenantId) {
        return "Instructions-level identity: MISSING (requestContext did not reach dynamic instructions).";
      }
      return `Instructions-level identity: tenantId=${tenantId}. Call the whoami tool and report its output.`;
    },
  });
}
