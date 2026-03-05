import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse-fork";
import dotenv from "dotenv";

dotenv.config();

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

interface Chunk {
  id: string;
  text: string;
  source: string;
}

function cleanText(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string, source: string): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  let id = 0;

  while (i < text.length) {
    const chunk = text.slice(i, i + CHUNK_SIZE);

    if (chunk.trim().length > 50) {
      chunks.push({
        id: `${source}-${id}`,
        text: cleanText(chunk.trim()),
        source
      });
      id++;
    }

    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: texts })
    }
  );

  const data = (await response.json()) as {
    result: { data: number[][] } | null;
  };
  if (!data.result) throw new Error("Embedding API returned null result");
  return data.result.data as number[][];
}

function getPDFs(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getPDFs(fullPath));
    } else if (entry.name.endsWith(".pdf")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function ingest() {
  const pdfsDir = path.join(process.cwd(), "pdfs");
  const files = getPDFs(pdfsDir);

  console.log(`Found ${files.length} PDFs \n`);

  for (const file of files) {
    const fileName = path.basename(file);

    console.log(`Processing: ${fileName}\n`);

    const buffer = fs.readFileSync(file);
    const parsed = await pdfParse(buffer);

    const chunks = chunkText(parsed.text, fileName);
    console.log(`  -> ${chunks.length} chunks generated`);

    for (let i = 0; i < chunks.length; i += 3) {
      const batch = chunks.slice(i, i + 3);

      const embedding = await getEmbeddings(batch.map((c) => c.text));

      const vectors = batch.map((chunk, idx) => ({
        id: chunk.id,
        values: embedding[idx],
        metadata: {
          text: cleanText(chunk.text),
          source: chunk.source
        }
      }));

      const body = vectors.map((v) => JSON.stringify(v)).join("\n");
      const blob = new Blob([body], { type: "application/x-ndjson" });

      const upsertResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/vectorize/v2/indexes/eic-embeddings/upsert`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`
          },
          body: blob
        }
      );
      const upsertData = (await upsertResponse.json()) as {
        result: { data: number[][] };
      };
      console.log("Upsert response:", JSON.stringify(upsertData));
      console.log(`   -> Lote ${Math.floor(i / 10) + 1} inserted\n`);
    }
  }

  console.log("ingestion completed");
}

ingest().catch(console.error);
