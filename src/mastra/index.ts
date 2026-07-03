// Minimal Mastra server reproducing the AgentController requestContext gap.
//
// - `server.middleware` reads the `x-tenant-id` header and injects it into the
//   per-request `requestContext` (exactly how a multi-tenant app injects
//   identity from a verified JWT/session).
// - The SAME agent logic is exposed two ways:
//     1. CONTROL: a plain agent, reached via a tiny custom route that forwards
//        requestContext into `agent.streamVNext(...)` — the tenant IS visible.
//     2. BUG: an AgentController, reached via the stock
//        `/api/agent-controller/:id/sessions/:resourceId/messages` route — the
//        stock handler calls `session.sendMessage({ content })` WITHOUT
//        `requestContext`, so the tenant is DROPPED.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentController } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { InMemoryStore } from "@mastra/core/storage";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";

import { createBackingAgent } from "./agent.js";

// One agent instance per observation channel. Both are constructed identically;
// they differ only in which request path invokes them.
export const controllerAgent = createBackingAgent("controller");
export const controlAgent = createBackingAgent("control");

export const CONTROLLER_KEY = "demoController";

// AgentController requires a workspace instance; a throwaway temp dir is enough
// for this repro (no files are actually written by the demo agent).
const workspaceRoot = mkdtempSync(join(tmpdir(), "mastra-f1-repro-"));

const controller = new AgentController({
  id: "demo-controller",
  agent: controllerAgent,
  workspace: new Workspace({
    id: "demo-workspace",
    filesystem: new LocalFilesystem({ basePath: workspaceRoot }),
  }),
  modes: [{ id: "chat", name: "Chat", metadata: { default: true } }],
});

// CONTROL route: mirrors what the stock *agent* message route does — it forwards
// the middleware's requestContext into the run. Proves the middleware itself
// works and the tenant is reachable when context is threaded through.
const controlRoute = registerApiRoute("/control/:agentId/message", {
  method: "POST",
  handler: async (c) => {
    const mastra = c.get("mastra");
    const requestContext = c.get("requestContext");
    const { agentId } = c.req.param() as { agentId: string };
    const { message } = (await c.req.json().catch(() => ({}))) as { message?: string };

    const agent = mastra.getAgent(agentId);
    // Forward requestContext exactly like the stock agent route
    // (handleAgentMessageRoute) does — this is the one line the AgentController
    // message handler omits.
    await agent.generate(message ?? "hello", { requestContext }).catch(() => undefined);
    return c.json({ ok: true });
  },
});

export const mastra = new Mastra({
  storage: new InMemoryStore(),
  agents: { controlAgent },
  agentControllers: { [CONTROLLER_KEY]: controller },
  server: {
    port: 4199,
    apiRoutes: [controlRoute],
    middleware: [
      async (c, next) => {
        const tenantId = c.req.header("x-tenant-id");
        if (tenantId) {
          // The exact multi-tenant injection pattern: set identity on the
          // per-request requestContext from a request header.
          c.get("requestContext").set("tenantId", tenantId);
        }
        await next();
      },
    ],
  },
});
