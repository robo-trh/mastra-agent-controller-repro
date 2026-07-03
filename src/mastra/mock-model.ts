// A no-network mock language model so the repro runs with NO API key.
//
// The bug being demonstrated is about `requestContext` propagation into the
// AgentController run, which happens *around* the model call (dynamic
// instructions + dynamic tools read requestContext before/independent of model
// output). So the model only has to produce a syntactically valid stream; its
// content is irrelevant to the assertion.
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

export function createMockModel() {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock-echo",
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "id-1", modelId: "mock-echo", timestamp: new Date(0) },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
      }),
    }),
  });
}
