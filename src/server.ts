import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, pruneMessages } from "ai";

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

async function searchVectorize(query: string, env: Env): Promise<string> {
  const embeddingResult = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query]
  })) as EmbeddingResponse;

  const results = await env.VECTORIZE.query(embeddingResult.data[0], {
    topK: 5,
    returnMetadata: "all"
  });

  const context = results.matches
    .map((match) => match.metadata?.text as string)
    .filter(Boolean)
    .join("\n\n");

  return context;
}

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const lastMessage = this.messages[this.messages.length - 1];
    const query =
      lastMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => (part as { type: "text"; text: string }).text)
        .join(" ") ?? "";

    const context = await searchVectorize(query, this.env);

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      maxOutputTokens: 1024,
      system: `You are an academic assistant EXCLUSIVELY for students of Computer Engineering and Computing at the University of Porto (FEUP).

              STRICT RULES - NEVER BREAK THESE:
              1. You ONLY answer questions directly about: programming languages (C, C++, Java, Python, Dart), algorithms, data structures, databases, SQL, operating systems, computer networks, software engineering, or computer architecture.
              2. If the question is about ANY other topic - biology, economics, history, sports, medicine, psychology, or anything not in rule 1 - you MUST respond with ONLY: "I can only help with Computer Engineering and Computing topics. Please ask me something related to your degree at FEUP."
              3. Do NOT try to connect unrelated topics to computer science. A question about the brain, muscles, or biology is NOT a computer science question.

              CONTEXT FROM SLIDES:
              <context>
              ${context}
              </context>

              SOURCE RULES:
              - If you used the context above to answer, end your response with "📄 Source: [value of the source field from context]"
              - If the context was not relevant and you answered from general knowledge, end with "💡 Source: General knowledge"
              - NEVER invent or fabricate source names`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
