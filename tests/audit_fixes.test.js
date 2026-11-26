// Tests for the audit fixes: delete during indexing, restart recovery, resume, quotas, sources, history and loaders.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startHarness, waitFor } from "./fakes/harness.js";
import { db } from "./fakes/memoryDb.js";
import { createUploadRouter } from "../src/uploadthing.js";
import { citedLabels, INTERRUPTED_REASON, MAX_CHUNKS_PER_FILE } from "../src/services/rag.js";
import { createGeminiEmbeddings, retryDelayMs } from "../src/services/embeddings.js";
import { createDocumentLoader } from "../src/services/loader.js";

let h;
beforeEach(async () => { h = await startHarness(); });
afterEach(async () => {
  delete process.env.DAILY_QUESTION_LIMIT;
  delete process.env.DAILY_CHUNK_LIMIT;
  await h.close();
});

const PAGE = (text, page = 1) => ({ pageContent: text, page });
const row = (id) => db.rows("Document").find((d) => d._id === id);
const project = async (user = "user_a") => (await h.json("POST", "/api/projects", user, { name: "Alpha" })).body;
const chat = async (p, user = "user_a") => (await h.json("POST", `/api/projects/${p._id}/chats`, user, { title: "Conversation 1" })).body;
const vectorsOf = (docId) => [...h.services.vectors.values()].filter((v) => v.metadata.documentId === docId);

test("A01 A file deleted during indexing leaves no vectors and cannot be cited", async () => {
  const p = await project();
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "secret.txt", pages: [PAGE("The vault code is 4417.")] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const embed = h.services.embeddings.embedDocuments;
  h.services.embeddings.embedDocuments = async (texts) => { await gate; return embed(texts); };

  const run = h.services.rag.processDocument(doc._id);
  await waitFor(() => row(doc._id)?.status === "processing");
  assert.equal((await h.json("DELETE", `/api/projects/${p._id}/documents/${doc._id}`, "user_a")).status, 200);
  release();
  await run;

  assert.equal(vectorsOf(doc._id).length, 0);
  const c = await chat(p);
  const { events } = await h.ask("user_a", p._id, c._id, "What is the vault code?");
  assert.deepEqual(events.find((e) => "sources" in e).sources, []);
});

test("A02 Search ignores vectors of a document that is not indexed", async () => {
  const p = await project();
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "a.txt", pages: [PAGE("Refunds take 30 days.")] });
  await h.services.rag.processDocument(doc._id);
  row(doc._id).status = "failed";
  const c = await chat(p);
  const { events } = await h.ask("user_a", p._id, c._id, "How long do refunds take?");
  assert.deepEqual(events.find((e) => "sources" in e).sources, []);
});

test("A03 Documents left queued or processing by a stopped server become retryable", async () => {
  const p = await project();
  const pr = db.rows("Project")[0];
  for (const status of ["uploaded", "processing", "indexed"]) db.insert("Document", { project: pr._id, name: `${status}.txt`, url: "u", key: status, status });
  assert.equal(await h.services.rag.failInterrupted(), 2);
  const byName = Object.fromEntries(db.rows("Document").map((d) => [d.name, d]));
  assert.equal(byName["uploaded.txt"].failureReason, INTERRUPTED_REASON);
  assert.equal(byName["processing.txt"].status, "failed");
  assert.equal(byName["indexed.txt"].status, "indexed");
  assert.ok(p);
});

test("A04 Only a failed document can be retried, and a retry is queued once", async () => {
  const p = await project();
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "a.txt", pages: [PAGE("Text.")] });
  await h.services.rag.processDocument(doc._id);
  const url = `/api/projects/${p._id}/documents/${doc._id}/retry`;
  assert.equal((await h.json("POST", url, "user_a")).status, 409);
  row(doc._id).status = "failed";
  const [first, second] = await Promise.all([h.json("POST", url, "user_a"), h.json("POST", url, "user_a")]);
  assert.deepEqual([first.status, second.status].sort(), [202, 409]);
  await waitFor(() => row(doc._id).status === "indexed");
});

test("A05 A retry resumes after the last stored batch", async () => {
  const p = await project();
  const pages = Array.from({ length: 130 }, (_, i) => PAGE(`Passage number ${i} about topic ${i}.`, i + 1));
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "big.pdf", pages });
  const sent = [];
  const embed = h.services.embeddings.embedDocuments;
  h.services.embeddings.embedDocuments = async (texts) => {
    sent.push(texts.length);
    if (sent.length === 2) throw new Error("embedding request failed");
    return embed(texts);
  };
  await h.services.rag.processDocument(doc._id);
  assert.equal(row(doc._id).status, "failed");
  assert.equal(row(doc._id).indexedChunks, 100);
  assert.equal(vectorsOf(doc._id).length, 100);

  await h.services.rag.processDocument(doc._id);
  assert.deepEqual(sent, [100, 30, 30]);
  assert.equal(row(doc._id).status, "indexed");
  assert.equal(vectorsOf(doc._id).length, 130);
});

test("A06 The same file twice in one project is not embedded again", async () => {
  const p = await project();
  const pages = [PAGE("Same text.")];
  const a = await h.addDocument({ user: "user_a", projectId: p._id, name: "a.txt", pages, hash: "h1" });
  const b = await h.addDocument({ user: "user_a", projectId: p._id, name: "b.txt", pages, hash: "h1" });
  await h.services.rag.processDocument(a._id);
  const calls = h.services.state.embedCalls;
  await h.services.rag.processDocument(b._id);
  assert.equal(h.services.state.embedCalls, calls);
  assert.equal(row(b._id).failureReason, "The same file is already in this project.");
});

test("A07 A file with too many passages fails with a clear reason", async () => {
  const p = await project();
  const pages = Array.from({ length: MAX_CHUNKS_PER_FILE + 1 }, (_, i) => PAGE(`Row ${i}.`));
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "huge.csv", pages });
  await h.services.rag.processDocument(doc._id);
  assert.match(row(doc._id).failureReason, /too large/);
  assert.equal(h.services.state.embedCalls, 0);
});

test("A08 Daily limits stop questions and indexing, and a failed job gives its chunks back", async () => {
  const p = await project();
  const c = await chat(p);
  process.env.DAILY_QUESTION_LIMIT = "1";
  assert.equal((await h.ask("user_a", p._id, c._id, "First?")).status, 200);
  const second = await h.ask("user_a", p._id, c._id, "Second?");
  assert.equal(second.status, 429);
  assert.match(second.body.error, /question limit/);

  process.env.DAILY_CHUNK_LIMIT = "1";
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "two.pdf", pages: [PAGE("One.", 1), PAGE("Two.", 2)] });
  await h.services.rag.processDocument(doc._id);
  assert.match(row(doc._id).failureReason, /daily limit/);

  process.env.DAILY_CHUNK_LIMIT = "5";
  h.services.state.failEmbeddings = true;
  await h.services.rag.processDocument(doc._id);
  assert.equal(db.rows("Usage")[0].chunks, 0);
});

test("A09 Sources list only what the answer cites, with the passage text", async () => {
  const p = await project();
  for (const [name, text] of [["a.txt", "Apples are red."], ["b.txt", "Bananas are yellow."]]) {
    const d = await h.addDocument({ user: "user_a", projectId: p._id, name, pages: [PAGE(text)] });
    await h.services.rag.processDocument(d._id);
  }
  h.services.state.llmAnswer = "They are red [S1].";
  const c = await chat(p);
  const { events } = await h.ask("user_a", p._id, c._id, "What colour are apples?");
  const sources = events.find((e) => e.sources).sources;
  assert.deepEqual(sources.map((s) => s.label), ["S1"]);
  assert.ok(sources[0].text);
  assert.deepEqual([...citedLabels("x [S1, S3] y [S2]")], ["S1", "S3", "S2"]);
});

test("A10 A follow-up question gets the conversation, and the first question names the chat", async () => {
  const p = await project();
  const d = await h.addDocument({ user: "user_a", projectId: p._id, name: "policy.txt", pages: [PAGE("The refund policy allows returns in 30 days.")] });
  await h.services.rag.processDocument(d._id);
  const c = await chat(p);
  await h.ask("user_a", p._id, c._id, "What is the refund policy?");
  await h.ask("user_a", p._id, c._id, "And for digital items?");
  const prompt = h.services.state.llmPrompts.at(-1);
  assert.match(prompt, /CONVERSATION SO FAR/);
  assert.match(prompt, /User: What is the refund policy\?/);
  const chats = await h.json("GET", `/api/projects/${p._id}/chats`, "user_a");
  assert.equal(chats.body[0].title, "What is the refund policy?");
});

test("A11 The document list hides the storage url and key", async () => {
  const p = await project();
  await h.addDocument({ user: "user_a", projectId: p._id, name: "a.txt", pages: [PAGE("x")] });
  const list = await h.json("GET", `/api/projects/${p._id}/documents`, "user_a");
  assert.equal(list.body.length, 1);
  assert.ok(!("url" in list.body[0]) && !("key" in list.body[0]));
});

test("A12 The upload middleware rejects file types that indexing cannot read", async () => {
  const p = await project();
  const mw = createUploadRouter(h.services).documentUploader.middleware;
  const req = { auth: () => ({ userId: "user_a", tokenType: "session_token" }) };
  await assert.rejects(() => mw({ req, input: { projectId: p._id }, files: [{ name: "notes.md" }] }), /Only PDF/);
  assert.equal((await mw({ req, input: { projectId: p._id }, files: [{ name: "notes.TXT" }] })).projectId, p._id);
});

test("A16 A delete that overlaps the last indexing steps leaves no vectors", async () => {
  const p = await project();
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name: "a.txt", pages: [PAGE("Secret text.")] });
  let releaseEmbed;
  let releaseFile;
  const embedGate = new Promise((r) => { releaseEmbed = r; });
  const fileGate = new Promise((r) => { releaseFile = r; });
  const embed = h.services.embeddings.embedDocuments;
  h.services.embeddings.embedDocuments = async (texts) => { await embedGate; return embed(texts); };
  const removeFile = h.services.fileStore.deleteFile;
  h.services.fileStore.deleteFile = async (key) => { await fileGate; return removeFile(key); };

  const run = h.services.rag.processDocument(doc._id);
  await waitFor(() => row(doc._id)?.chunkCount === 1);
  // The delete has removed the vectors but not yet the record when indexing stores its batch.
  const deletion = h.json("DELETE", `/api/projects/${p._id}/documents/${doc._id}`, "user_a");
  await waitFor(() => row(doc._id)?.status === "failed");
  releaseEmbed();
  await run;
  releaseFile();
  assert.equal((await deletion).status, 200);
  assert.equal(vectorsOf(doc._id).length, 0);
});

test("A17 A question does not wait through a long retry delay", async () => {
  const { embeddings, waits, calls } = fakeGemini([{ status: 429, body: '{"retryDelay":"40s"}' }]);
  await assert.rejects(() => embeddings.embedQuery("q"), /status 429/);
  assert.deepEqual(waits, []);
  assert.equal(calls.length, 1);
});

test("A18 Deleting a file removes its passage text from old answers and keeps the others", async () => {
  const p = await project();
  const docs = [];
  for (const [name, text] of [["a.txt", "Apples are red."], ["b.txt", "Bananas are yellow."]]) {
    const d = await h.addDocument({ user: "user_a", projectId: p._id, name, pages: [PAGE(text)] });
    await h.services.rag.processDocument(d._id);
    docs.push(d);
  }
  h.services.state.llmAnswer = "Both [S1, S2].";
  const c = await chat(p);
  await h.ask("user_a", p._id, c._id, "What colours?");
  await h.json("DELETE", `/api/projects/${p._id}/documents/${docs[0]._id}`, "user_a");
  const history = await h.json("GET", `/api/projects/${p._id}/chats/${c._id}/messages`, "user_a");
  const byFile = Object.fromEntries(history.body[1].sources.map((s) => [s.fileName, s.text]));
  assert.equal(byFile["a.txt"], undefined);
  assert.equal(byFile["b.txt"], "Bananas are yellow.");
});

// Embeddings with a fake fetch, clock and sleep.
function fakeGemini(responses) {
  let t = 0;
  const waits = [];
  const calls = [];
  const embeddings = createGeminiEmbeddings({
    apiKey: "k",
    dimensions: 2,
    tokensPerMinute: 10,
    now: () => t,
    sleep: async (ms) => { waits.push(ms); t += ms; },
    fetchImpl: async (_url, init) => {
      const count = JSON.parse(init.body).requests.length;
      calls.push(count);
      const next = responses.shift() || { status: 200 };
      if (next.status !== 200) return new Response(next.body || "", { status: next.status, headers: next.headers });
      return new Response(JSON.stringify({ embeddings: Array.from({ length: count }, () => ({ values: [3, 4] })) }));
    },
  });
  return { embeddings, waits, calls };
}

test("A13 Embeddings wait as long as Google asks on 429, and stop at once on a daily limit", async () => {
  const retry = '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"7s"}]}}';
  const ok = fakeGemini([{ status: 429, body: retry }]);
  assert.deepEqual(await ok.embeddings.embedDocuments(["ab"]), [[0.6, 0.8]]);
  assert.deepEqual(ok.waits, [7000]);

  const daily = fakeGemini([{ status: 429, body: '{"quotaId":"EmbedContentRequestsPerDayPerProjectPerModel-FreeTier"}' }]);
  await assert.rejects(() => daily.embeddings.embedDocuments(["ab"]), /daily limit/);
  assert.equal(daily.calls.length, 1);

  assert.equal(retryDelayMs(new Response("", { headers: { "retry-after": "3" } }), "", 0), 3000);
});

test("A14 Document batches are paced under the per-minute token limit, questions are not held back", async () => {
  const text = "x".repeat(32); // about 8 tokens, so two batches do not fit in one minute of 10 tokens
  const { embeddings, waits } = fakeGemini([]);
  await embeddings.embedDocuments(Array(100).fill("a"));
  assert.deepEqual(waits, []);
  await embeddings.embedQuery(text);
  assert.deepEqual(waits, [], "a question never waits");
  await embeddings.embedDocuments([text]);
  assert.equal(waits.length, 1);
});

test("A15 The real loader reads the sample PDF, DOCX and CSV and hashes the bytes", async () => {
  const loader = createDocumentLoader({ fetchImpl: async (file) => new Response(fs.readFileSync(new URL(`../scripts/fixtures/${file}`, import.meta.url))) });
  const pdf = await loader.load({ url: "orion-fleet.pdf", name: "orion-fleet.pdf" });
  assert.ok(pdf.pages.length >= 1 && pdf.pages[0].page === 1);
  assert.match(pdf.hash, /^[a-f0-9]{64}$/);
  const docx = await loader.load({ url: "lotus-leave.docx", name: "lotus-leave.docx" });
  assert.ok(docx.pages[0].pageContent.trim().length > 0);
  const csv = await loader.load({ url: "pricing.csv", name: "pricing.csv" });
  assert.equal(csv.pages.length, 1, "CSV rows are joined into one text");
});
