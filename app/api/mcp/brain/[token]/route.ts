// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The QC Brain connector a client adds to their own Claude (claude.ai, the desktop app, Claude Code). An MCP
 * server over plain HTTP: JSON-RPC requests in, JSON answers out, nothing kept between requests. The link's
 * secret names one client; every tool works inside that client's folder and nowhere else (see
 * app/lib/brain-connector.ts). No session cookie is involved: the link is the key.
 */
import { NextResponse } from "next/server";
import { CLIENT_CORNER, connectorFor, listFiles, readFile, searchFolder, writeClientNote, type Connector } from "../../../../lib/brain-connector";

export const maxDuration = 60;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const TOOLS = [
  {
    name: "list_brain_files",
    description: "Every file in this company's QC Brain folder (the context QC Growth keeps on them: brief, ICP, personas, voice, engagement, pipeline, call notes, messaging and more), with size. Files under from-client/ are the company's own notes. Start here to see what exists.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_brain_file",
    description: "The full text of one file in the folder, by the path list_brain_files gave (for example \"brief.md\" or \"weekly-calls/2026-10-02.md\").",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Path relative to the folder, as listed." } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "search_brain",
    description: "Find lines across the folder's documents that contain every word of the query. Returns file, line number and the line, so read_brain_file can open the right document.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to look for, e.g. \"pricing objection\"." } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "write_client_note",
    description: `Save a note into this company's own area of the brain, ${CLIENT_CORNER}/ (created or replaced). Use it to give QC Growth context: product updates, new targets, call takeaways, corrections. It can only write there; QC's own documents can't be changed. Markdown is best.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: `A file name inside ${CLIENT_CORNER}/, e.g. "product-updates.md" or "2026-10/pricing-change.md".` },
        content: { type: "string", description: "The whole note. Replaces the file if it already exists." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
];

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const textResult = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

async function callTool(connector: Connector, name: string, args: Record<string, unknown>) {
  const arg = (key: string) => (typeof args[key] === "string" ? String(args[key]) : "");
  try {
    if (name === "list_brain_files") {
      const files = await listFiles(connector.folder);
      return textResult({ company: connector.name, files, note: `${files.length} files. Files under ${CLIENT_CORNER}/ were written by ${connector.name}; everything else is kept by QC Growth.` });
    }
    if (name === "read_brain_file") return textResult(await readFile(connector.folder, arg("path")));
    if (name === "search_brain") {
      const hits = await searchFolder(connector.folder, arg("query"));
      return textResult(hits.length ? hits : "No lines matched every word. Try fewer or different words.");
    }
    if (name === "write_client_note") {
      const saved = await writeClientNote(connector, arg("path"), typeof args.content === "string" ? args.content : "");
      return textResult(`${saved.created ? "Saved" : "Updated"} ${saved.path}. QC Growth's team will see it in ${connector.name}'s brain.`);
    }
    return textResult(`Unknown tool ${name}.`, true);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : "That didn't work.", true);
  }
}

async function handle(connector: Connector, message: Rpc) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qc-brain", title: `QC Brain · ${connector.name}`, version: "1.0.0" },
      instructions: `This is ${connector.name}'s QC Brain: the living context QC Growth keeps on ${connector.name} (who they are, who they sell to, their voice, engagement notes, calls, messaging). Read it before answering questions about ${connector.name}'s go-to-market. ${connector.name} can add their own notes with write_client_note; those live in ${CLIENT_CORNER}/.`,
    });
  }
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = typeof params?.name === "string" ? params.name : "";
    const args = (params?.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
    return ok(id, await callTool(connector, name, args));
  }
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  return fail(id, -32601, `Method not found: ${method}`);
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const connector = await connectorFor((await context.params).token).catch(() => null);
  if (!connector) return NextResponse.json(fail(null, -32001, "This QC Brain link isn't valid any more. Get a new one from the Brain tab in QC Portal."), { status: 401 });
  const body = (await request.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 });
  const messages = Array.isArray(body) ? body : [body];
  const answers = [];
  for (const message of messages) {
    // A notification (no id) gets no answer.
    if (message.id === undefined || message.id === null) { if (message.method) continue; }
    answers.push(await handle(connector, message));
  }
  if (!answers.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? answers : answers[0]);
}

/** No server-sent stream: this connector only answers requests. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 200 });
}
