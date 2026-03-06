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

    const messages = await convertToModelMessages(this.messages);
    const lastMessage = messages[messages.length - 1];
    const query =
      typeof lastMessage?.content === "string" ? lastMessage.content : "";

    const context = await searchVectorize(query, this.env);

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      maxOutputTokens: 1024,
      system: `You are an academic assistant for students of Computer Engineering and Computing at the University of Porto (FEUP).
You help with questions about programming, algorithms, data structures, databases, operating systems, and other subjects in the degree.
You always respond in English, in a clear and pedagogical way.
You MUST refuse to answer any question that is not directly related to Computer Engineering topics such as programming, algorithms, data structures, databases, operating systems, computer networks, or software engineering. If asked about anything else (economics, history, sports, etc.), respond ONLY with: "I can only help with Computer Engineering and Computing topics. Please ask me something related to your degree."
Use the following context of the slides of the classes to answer:
<context>
${context}
</context>

If the context does not have relevant information, answer with your knowledge`,
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
