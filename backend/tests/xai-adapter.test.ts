import { describe, expect, test } from "bun:test";
import { createXaiAdapter } from "../src/xai-adapter";

describe("xAI completeChat transport", () => {
  test("preserves image content, assistant tool calls, and tool result ids", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const adapter = createXaiAdapter({ apiKey: "test-key", fetcher });
    const completeChat = (adapter as unknown as {
      completeChat(request: {
        messages: Array<{ role: string; content?: string; imageData?: string; tool_calls?: unknown; tool_call_id?: string }>;
      }): Promise<{ content: string }>;
    }).completeChat;

    const toolCalls = [{ id: "call-1", type: "function", function: { name: "web.search", arguments: "{}" } }];
    const result = await completeChat({
      messages: [
        { role: "user", content: "Was ist zu sehen?", imageData: "data:image/png;base64,AAAA" },
        { role: "assistant", content: "", tool_calls: toolCalls },
        { role: "tool", content: "result", tool_call_id: "call-1" },
      ],
    });

    expect(result.content).toBe("ok");
    expect(sentBody?.model).toBe("grok-2-vision-latest");
    const messages = sentBody?.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Was ist zu sehen?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    expect(messages[1]?.tool_calls).toEqual(toolCalls);
    expect(messages[2]?.tool_call_id).toBe("call-1");
  });
});
