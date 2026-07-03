### Describe the Bug

The `@mastra/server` AgentController HTTP route handlers do **not** forward the
server middleware's `requestContext` to the `Session`, so identity injected in
`server.middleware` is silently dropped for AgentController-mode agents.

In `packages/server/src/server/handlers/agent-controller.ts`, the send-message
handler (`SEND_AGENT_CONTROLLER_MESSAGE_ROUTE`) resolves the session and calls:

```ts
const session = await getSession(controller, resourceId);
void session.sendMessage({ content: message });
```

No `requestContext` is passed, even though `Session.sendMessage` accepts one
(`sendMessage({ content, files, tracingContext, tracingOptions, requestContext })`).
Downstream, the run engine calls `buildRequestContext(requestContextInput)` with
`requestContextInput === undefined`, which does `requestContext ??= new RequestContext()`
— a brand-new **empty** context. So `agent.getInstructions({ requestContext })`
and every tool `execute({ requestContext })` see an empty context.

This contrasts with the regular agent message route (`handleAgentMessageRoute`),
which threads the server context through explicitly:

```ts
handler: async ({ agentId, mastra, requestContext: serverRequestContext, ...params }) => {
  ...
  await agent.generate(messages, { ...options, requestContext: serverRequestContext });
}
```

**Consequence:** a multi-tenant app that injects identity via `server.middleware`
(setting values on `c.get("requestContext")`) gets an **empty** request context
inside AgentController-mode agents' dynamic instructions and tools — while the
exact same middleware works fine for a plain `Agent` route. Multi-tenant
scoping, tenant-aware dynamic instructions, and tenant-scoped tools all silently
lose their identity when driven through the AgentController API.

The same omission affects the sibling session write routes in that file
(`steer`, `follow-up`, tool-approval / tool-suspension resume), which also call
the corresponding `session.*` methods without `requestContext` even though those
methods accept one.

### Steps To Reproduce

Minimal repro (no API key required — uses a no-network mock model; the assertion
reads what the agent's dynamic instructions observed, independent of any model
output):

1. A single Mastra server with `server.middleware` that reads `x-tenant-id` and
   sets it on the context: `c.get("requestContext").set("tenantId", <header>)`.
2. One backing `Agent` whose dynamic `instructions` (and a `createTool`) read
   `requestContext.get("tenantId")`.
3. The same agent exposed both ways: as a plain agent behind a custom route that
   forwards `requestContext` into `agent.generate(...)` (control), and as an
   `AgentController` via `new Mastra({ agentControllers: { demoController } })`.

Then:

```bash
npm install
npm run repro
```

The script boots the server (`createNodeServer(mastra)`) and sends `whoami` with
`x-tenant-id: acme` through both paths. Observed output:

```
AgentController route (stock /api/agent-controller/.../messages):
  dynamic instructions saw tenantId = MISSING

Control agent route (forwards requestContext, like the stock agent route):
  dynamic instructions saw tenantId = acme

  [PASS] BUG: AgentController route dropped the tenant (expected MISSING)
  [PASS] CONTROL: plain agent route saw the tenant (expected "acme")
```

Equivalent `curl` steps against a running server are in the repro README.

### Link to Minimal Reproducible Example

https://github.com/<your-username>/mastra-agentcontroller-requestcontext-repro

(Local path while unpublished: `var/mastra-f1-repro/` — a self-contained package
with `package.json`, `src/mastra/index.ts`, `src/repro.ts`, and `README.md`.)

### Expected Behavior

AgentController route handlers should forward the server `requestContext` to the
session methods, exactly like the agent message route does. For the message
handler:

```ts
const requestContext = c.get("requestContext");
void session.sendMessage({ content: message, requestContext });
```

(and the analogous one-line fix for `steer`, `follow-up`, and the tool-approval /
tool-suspension resume handlers, which each already accept a `requestContext`).

With this fix, identity set in `server.middleware` reaches AgentController-mode
agents' dynamic instructions and tools, matching plain-agent behavior.

### Environment Information

- `@mastra/core`: 1.48.0
- `@mastra/server`: 1.48.0
- `@mastra/deployer`: 1.48.0 (used only to boot the HTTP server in the repro)
- `mastra`: 1.17.0
- `ai`: 6.0.217
- `zod`: 4.2.1
- Node.js: v23.6.0
- npm: 11.11.1
- OS: macOS (Darwin 24.6.0)
- LLM provider: none — the repro uses a no-network mock language model
  (`MockLanguageModelV3` from `ai/test`). The bug is about `requestContext`
  propagation around the run, so no real model call is needed; the assertion
  reads what the agent's dynamic instructions observed for the tenant.

### Verification

- [x] I have searched the existing issues and this is not a duplicate.
- [x] I have provided a minimal reproducible example.
