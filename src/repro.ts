// Repro driver. Boots the Mastra HTTP server in-process (same server Mastra
// runs in production, via @mastra/deployer's createNodeServer), then:
//
//   1. BUG   — sends a message through the stock AgentController route
//              (POST /api/agent-controller/:id/sessions/:resourceId/messages)
//              with `x-tenant-id: acme`, and checks what the agent's dynamic
//              instructions + tool observed for the tenant.
//   2. CONTROL — sends a message through a plain agent route with the SAME
//              header, forwarding requestContext the way the stock agent route
//              does, and checks the same observation.
//
// The assertion reads an in-process observation map that the agent's dynamic
// instructions/tool write to — so it does NOT depend on any model output.
//
// Expected: BUG channel sees tenant = MISSING; CONTROL channel sees tenant =
// acme. That difference is finding F1.
import { createNodeServer } from "@mastra/deployer/server";

import { mastra, CONTROLLER_KEY } from "./mastra/index.js";
import { getObservation, resetObservation } from "./mastra/observations.js";

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const TENANT = "acme";
const RESOURCE_ID = "resource-1";

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/agents`);
      if (res.ok || res.status === 401 || res.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not come up");
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": TENANT },
    body: JSON.stringify(body),
  });
}

/**
 * The AgentController message run is fire-and-forget on the server. Poll the
 * in-process observation map until the dynamic instructions have recorded what
 * they saw (or time out).
 */
async function waitForInstructions(channel: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getObservation(channel)?.instructionsTenant !== undefined) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  const server = await createNodeServer(mastra, { port: PORT });
  try {
    await waitForServer();

    // ---- BUG: stock AgentController route ----
    resetObservation("controller");
    // get-or-create the session (server-side), then send a message.
    const created = await post(`/api/agent-controller/${CONTROLLER_KEY}/sessions`, {
      resourceId: RESOURCE_ID,
    });
    if (!created.ok) {
      throw new Error(`session create failed: ${created.status} ${await created.text()}`);
    }
    const sent = await post(
      `/api/agent-controller/${CONTROLLER_KEY}/sessions/${RESOURCE_ID}/messages`,
      { message: "whoami" }
    );
    if (!sent.ok) {
      throw new Error(`controller sendMessage failed: ${sent.status} ${await sent.text()}`);
    }
    await waitForInstructions("controller");
    const bug = getObservation("controller");

    // ---- CONTROL: plain agent route (forwards requestContext) ----
    resetObservation("control");
    const ctl = await post(`/control/controlAgent/message`, { message: "whoami" });
    if (!ctl.ok) {
      throw new Error(`control message failed: ${ctl.status} ${await ctl.text()}`);
    }
    const control = getObservation("control");

    const fmt = (v: string | null | undefined) =>
      v === undefined ? "(never ran)" : v === null ? "MISSING" : v;

    console.log("\n=== RESULTS (x-tenant-id: acme on both requests) ===\n");
    console.log("AgentController route (stock /api/agent-controller/.../messages):");
    console.log(`  dynamic instructions saw tenantId = ${fmt(bug?.instructionsTenant)}`);
    console.log(`  dynamic tool         saw tenantId = ${fmt(bug?.toolTenant)}`);
    console.log("\nControl agent route (forwards requestContext, like the stock agent route):");
    console.log(`  dynamic instructions saw tenantId = ${fmt(control?.instructionsTenant)}`);
    console.log(`  dynamic tool         saw tenantId = ${fmt(control?.toolTenant)}`);

    const bugReproduced = bug?.instructionsTenant == null;
    const controlWorks = control?.instructionsTenant === TENANT;

    console.log("\n=== ASSERTIONS ===");
    console.log(
      `  [${bugReproduced ? "PASS" : "FAIL"}] BUG: AgentController route dropped the tenant (expected MISSING)`
    );
    console.log(
      `  [${controlWorks ? "PASS" : "FAIL"}] CONTROL: plain agent route saw the tenant (expected "${TENANT}")`
    );

    const ok = bugReproduced && controlWorks;
    console.log(
      `\n${ok ? "BUG REPRODUCED" : "INCONCLUSIVE"}: the same middleware yields ${fmt(
        control?.instructionsTenant
      )} on the agent route but ${fmt(bug?.instructionsTenant)} on the AgentController route.\n`
    );

    server.close();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    server.close();
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error("repro crashed:", err);
  process.exit(2);
});
