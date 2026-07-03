# Mastra AgentController drops server middleware `requestContext`

Minimal reproduction for a bug in `@mastra/server`'s AgentController HTTP route
handlers: the message handler calls `session.sendMessage({ content })` **without**
forwarding the server middleware's `requestContext`, so multi-tenant identity
injected in `server.middleware` never reaches AgentController-mode agents' dynamic
instructions and tools. The equivalent plain-agent route forwards it correctly.

See [`BUG_REPORT.md`](./BUG_REPORT.md) for the filed issue body.

## What this repro shows

A single Mastra server with:

1. `server.middleware` that reads the `x-tenant-id` header and sets it on the
   per-request context: `c.get("requestContext").set("tenantId", <header>)`.
2. A backing `Agent` whose **dynamic instructions** (and a dynamic tool) read
   `requestContext.get("tenantId")` and record what they saw.
3. The same agent logic exposed **both ways**:
   - **CONTROL** — a plain agent reached via a tiny custom route that forwards
     `requestContext` into `agent.generate(...)` (exactly what the stock agent
     route `handleAgentMessageRoute` does). Tenant **is** visible.
   - **BUG** — an `AgentController` registered via
     `new Mastra({ agentControllers: { ... } })`, reached via the stock route
     `POST /api/agent-controller/:id/sessions/:resourceId/messages`. Tenant is
     **dropped**.

The assertion reads an **in-process observation map** written by the dynamic
instructions, so it does **not** depend on any model output. That is why the
repro needs **no API key** — it uses a no-network mock model.

## Run

```bash
npm install
npm run repro
```

Expected output:

```
AgentController route (stock /api/agent-controller/.../messages):
  dynamic instructions saw tenantId = MISSING
  dynamic tool         saw tenantId = (never ran)

Control agent route (forwards requestContext, like the stock agent route):
  dynamic instructions saw tenantId = acme
  dynamic tool         saw tenantId = (never ran)

  [PASS] BUG: AgentController route dropped the tenant (expected MISSING)
  [PASS] CONTROL: plain agent route saw the tenant (expected "acme")

BUG REPRODUCED: the same middleware yields acme on the agent route but MISSING on the AgentController route.
```

`(never ran)` for the tool is expected: the no-network mock model never emits a
real tool call. The **dynamic-instructions** row is the model-independent signal
— it sees `acme` on the agent route and `MISSING` on the AgentController route
under the identical `x-tenant-id: acme` header.

### Reproduce over HTTP with curl (optional)

The bug is observable at the HTTP boundary too. Start the server (any entrypoint
that boots `mastra` from `src/mastra/index.ts`, e.g. `mastra dev`, or the
`createNodeServer(mastra)` call the repro script already makes), then:

```bash
# BUG path — stock AgentController route (tenant is dropped inside the run):
curl -s -X POST http://localhost:4199/api/agent-controller/demoController/sessions \
  -H 'content-type: application/json' -H 'x-tenant-id: acme' \
  -d '{"resourceId":"resource-1"}'
curl -s -X POST http://localhost:4199/api/agent-controller/demoController/sessions/resource-1/messages \
  -H 'content-type: application/json' -H 'x-tenant-id: acme' \
  -d '{"message":"whoami"}'

# CONTROL path — plain agent route (tenant is visible inside the run):
curl -s -X POST http://localhost:4199/control/controlAgent/message \
  -H 'content-type: application/json' -H 'x-tenant-id: acme' \
  -d '{"message":"whoami"}'
```

The server logs (and the in-process observation map) show the tenant is `MISSING`
for the AgentController path and `acme` for the control path.

## Files

```
package.json            pinned deps (@mastra/core@1.48.0, @mastra/server@1.48.0, mastra@1.17.0)
tsconfig.json
src/repro.ts            boots the server, drives both paths, asserts
src/mastra/index.ts     Mastra: middleware, control agent + route, AgentController
src/mastra/agent.ts     backing agent — dynamic instructions/tool read requestContext
src/mastra/mock-model.ts no-network mock language model (no API key needed)
src/mastra/observations.ts in-process record of what each path observed
```
