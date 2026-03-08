## AI-Assisted Development

I used Claude (Sonnet 4.6, Anthropic) as a development assistant throughout the project.
Key areas where AI assistance was used:

- Better understanding of the project
- Designing the RAG architecture
- Debugging the Vectorize upsert API (Bob vs string issue)
- Designing the PDF ingestion pipeline
- UI decisisons
- Understanding Unfamiliar Syntax and Concepts

## Prompt: Better understandign of the project

**Prompt Used**
"I am a 2nd-year Computer Engineering student applying for a summer internship
at Cloudflare. They recommend completing an optional assignment to fast-track
the application review. The assignment requirements are:

- LLM (recommend using Llama 3.3 on Workers AI)
- Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
- User input via chat or voice (recommend using Pages or Realtime)
- Memory or state

Since I have no prior experience with AI development or Cloudflare's ecosystem,
I need help understanding:

1. What each required component is and how they relate to each other
2. Whether the goal is an AI-powered application or just a chatbot
3. What language/stack to use
4. How to differentiate from a basic chatbot implementation"

**Why:**
As a 2nd-year student with no AI or Cloudflare experience, I needed to
understand the scope of the project before writing any code — both the
technical requirements and what would make a strong submission.

**Result:**
Decided to build an academic RAG assistant for EIC students at FEUP, using
AIChatAgent + Vectorize + Workers AI + Durable Objects — covering all 4
requirements while adding a differentiating factor with RAG over real course slides.

The requirements were filled like this:

- LLM → Workers AI (Llama 3.3) ✓
- Workflow / coordination → Durable Objects (AIChatAgent) ✓
- User input via chat → AIChatAgent + WebSockets ✓
- Memory or state → Durable Objects (automatic history) + Vectorize (RAG) ✓

I started for reading the available documentation on Cloudflare's website regarding Workers, AI Agents and Vectorize.

## Designing the RAG architecture

**Prompt used:**
"I want to build an academic assistant for EIC students at FEUP that answers
questions based on real course slides instead of just general knowledge.
How does RAG work, what Cloudflare technologies should I use, and how do
they all connect together?"

**Why:**
I wanted the assistant to answer based on actual FEUP course content rather
than generic AI knowledge. I needed to understand what RAG was, how embeddings
and vector databases work, and how to connect all the Cloudflare pieces together
before writing any code.

**Result:**
Defined the following architecture:

- **PDF files** — stored locally in the `pdfs/` folder, processed once
  by the ingestion script and never needed again at runtime
- **Workers AI (bge-base-en-v1.5)** — generates 768-dimension embeddings
- **Vectorize** — stores and queries embeddings by semantic similarity
- **AIChatAgent** — on each message, queries Vectorize with the user's question
  and injects the most relevant chunks into the system prompt before calling Llama 3.3

Key decisions made:

- cosine similarity as the distance metric — better for semantic text similarity
- topK: 5 — retrieves the 5 most relevant chunks per query
- chunk size of 500 characters with 50 character overlap — balances context
  richness with token efficiency
- XML tags to wrap injected context — helps the LLM distinguish between
  instructions and retrieved content

## Prompt: Debugging the Vectorize Upsert API

**Prompt used:**
"The Vectorize upsert API keeps returning error code 40023
'failed to parse upsert vectors request in json format: line None was not
expected format'. The JSON is valid, I confirmed it with JSON.parse().
What is wrong?"

**Why:**
After building the ingestion pipeline, the upsert to Vectorize was consistently
failing despite the NDJSON being valid. I had verified the JSON format, reduced
the batch size, and cleaned the text — nothing worked.

**Result:**
After checking the Cloudflare API reference, discovered that the endpoint
expects an `Uploadable` binary body, not a plain string. The fix was wrapping
the NDJSON in a `Blob` instead of passing it directly as a string:

before:
body: vectors.map(v => JSON.stringify(v)).join("\n")

after:
const blob = new Blob([body], { type: "application/x-ndjson" });
body: blob

**Lesson learned:**
When a Cloudflare API specifies the body type as `Uploadable` or `binary`,
it expects a `Blob` or `ReadStream` — not a plain string. Even if the content
is text-based like NDJSON, the binary wrapper is required.

## Prompt: Designing the PDF Ingestion Pipeline

**Prompt used:**
"I have PDF slides from my FEUP courses that I want to index into Vectorize.
How do I build a script that reads PDFs, splits them into chunks, generates
embeddings and inserts them into Vectorize? Should this be a separate script
or part of the Worker?"

**Why:**
The ingestion pipeline needed to run locally as a one-time setup script,
not as part of the Worker. I needed to understand how to extract text from
PDFs, split it into meaningful chunks, call the embeddings API from outside
a Worker context, and insert the vectors into Vectorize.

**Result:**
Built `src/ingest.ts` as a standalone Node.js script with the following pipeline:

PDF files → extract text (pdf-parse-fork)
→ split into 500 char chunks with 50 char overlap
→ batch into groups of 3
→ generate embeddings via Workers AI REST API
→ upsert to Vectorize with metadata (text + source filename)

Key decisions made:

- **Separate script** — ingestion only needs to run once when adding new documents,
  not on every chat message
- **REST API instead of env.AI binding** — the script runs locally outside the
  Worker context so direct bindings are not available
- **Batch size of 3** — larger batches caused the Vectorize upsert to fail due
  to body size limits
- **source metadata** — storing the filename with each vector allows the LLM
  to cite which slides it used in its response
- **upsert instead of insert** — allows re-running the script safely without
  duplicating vectors

## Prompt: UI Decisions

**Prompt used:**
"The template includes MCP panel, debug toggle, tool approval UI, and scheduled
task notifications. I don't need any of these for my use case. Help me identify
what to remove and what to keep."

**Why:**
The agents-starter template is a full-featured demo with many capabilities
that are not relevant to an academic assistant. Shipping unused UI elements
makes the app look unpolished and confusing to end users.

**Result:**
Removed the following from `app.tsx`:

- MCP panel and all related state (`mcpState`, `showMcpPanel`, `mcpName`,
  `mcpUrl`, `isAddingServer`, `mcpPanelRef`)
- Debug toggle (`showDebug`) and JSON message inspector
- Tool approval UI (`ToolPartView` approval/rejection buttons)
- Scheduled task toast notifications (`onMessage`, `useKumoToastManager`)
- `onToolCall` handler for `getUserTimezone`
- All unused imports from `@phosphor-icons/react` and `agents`

Additional UI decisions made:

- **Header title** — changed from "Agent Starter" to "EIC Assistant" to reflect
  the purpose of the application
- **Favicon** — replaced the default Cloudflare favicon with a custom icon
  relevant to the project
- **Assistant message background** — changed from `bg-kumo-base` to
  `bg-kumo-control` to improve contrast between the assistant's
  response and the page background in both light and dark modes
- **EIC label** — added a small "EIC" identifier badge before each assistant
  message to visually distinguish the assistant's responses from the user's messages
- **Welcome screen** — replaced the default example prompts with EIC-relevant
  questions and added an introductory description explaining what the assistant
  can help with

## Prompt: Understanding Unfamiliar Syntax and Concepts

**Prompt used:**
Multiple questions throughout development asking for explanations of
unfamiliar patterns encountered in the codebase.

**Why:**
As a 2nd-year student with no prior React or AI development experience,
the agents-starter template contained many patterns I had never seen before.
Rather than copying code blindly, I asked for explanations of each concept
before moving forward.

**Concepts explored:**

**React fundamentals:**

- React components as functions used as JSX tags (e.g. `<ThemeToggle />`)
  — understanding that a function returning JSX can be used as an HTML-like tag
- `useState` — how state triggers re-renders and the `[value, setValue]`
  destructuring pattern
- `useRef` — difference from state, used for direct DOM references without
  triggering re-renders
- `useEffect` — how dependency arrays control when effects run, and why
  multiple `useEffect` calls are valid in the same component
- `useCallback` — memoizing functions to avoid unnecessary re-renders

**Data flow:**

- How `useAgentChat` manages the `messages` array — discovered that it contains
  BOTH user and assistant messages, distinguished by the `role` field
  (`"user"` | `"assistant"`) rather than being two separate arrays
- How `sendMessage` adds to the `messages` array and simultaneously sends
  via WebSocket to the Worker
- How streaming works end-to-end: `streamText()` on the server →
  `toUIMessageStreamResponse()` → WebSocket chunks → `useAgentChat` updates
  `messages` word by word → React re-renders in real time

**TypeScript patterns:**

- Destructuring objects — `const { messages, sendMessage } = useAgentChat()`
- Why `UIMessagePart` required type assertion to extract text content
- How `.filter(Boolean)` removes falsy values from arrays
- The difference between `any` and typed interfaces for API responses

**Result:**
Understanding these patterns allowed me to confidently clean up the template,
remove unused functionality, and make informed UI decisions rather than
editing code without understanding the consequences.
