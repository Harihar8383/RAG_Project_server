// Tests for the shared quota, the Exam Map and the quiz. They prove the logic, not how accurate real matches are.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./fakes/harness.js";
import { db } from "./fakes/memoryDb.js";
import { parseTopics, keyTerms, judge } from "../src/services/examMap.js";
import { sampleText, parseQuiz, QUIZ_CHAR_BUDGET } from "../src/services/quiz.js";
import { SHARED_USER } from "../src/services/usage.js";

let h;
beforeEach(async () => {
  h = await startHarness();
  process.env.EXAM_MAP_MIN_SCORE = "0.5"; // suited to the bag-of-words fake embedding
});
afterEach(async () => {
  for (const name of ["EXAM_MAP_MIN_SCORE", "DAILY_SHARED_ANSWER_LIMIT", "DAILY_MAP_ITEM_LIMIT"]) delete process.env[name];
  await h.close();
});

const PAGE = (text, page = 1) => ({ pageContent: text, page });
const NOTES = "Photosynthesis converts light energy into chemical energy.";
const project = async (user = "user_a") => (await h.json("POST", "/api/projects", user, { name: "Biology" })).body;
const addFile = async (p, name = "bio.pdf", pages = [PAGE(NOTES, 3)]) => {
  const doc = await h.addDocument({ user: "user_a", projectId: p._id, name, pages });
  await h.services.rag.processDocument(doc._id);
  return doc;
};
const mapUrl = (p) => `/api/projects/${p._id}/exam-map`;
const makeMap = (p, text, user = "user_a") => h.json("POST", mapUrl(p), user, { text });
const sharedAnswers = () => db.rows("Usage").find((u) => u.user === SHARED_USER)?.answers ?? 0;
const quizReply = (page = 3) =>
  JSON.stringify({
    questions: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, options: ["a", "b", "c", "d"], answer: i % 4, page })),
  });
const quizUrl = (p, doc) => `/api/projects/${p._id}/documents/${doc._id}/quiz`;

test("E01 Topics lose bullets and numbers, repeats are dropped, and key words ignore filler and plurals", () => {
  assert.deepEqual(parseTopics("1. Cell division\n- cell division\n\n(b) OS\n2.1 Enzymes\nQ3) Define osmosis\nx"), [
    "Cell division", "OS", "Enzymes", "Define osmosis",
  ]);
  assert.deepEqual(keyTerms("Explain the processes of OS threads"), ["process", "os", "thread"]);
});

test("E02 A strong match needs similarity and key words in the same passage", () => {
  const passage = (text, score) => ({ score, metadata: { text, fileName: "a", documentId: "d" } });
  const terms = keyTerms("cell division");
  assert.equal(judge(terms, [passage("cell division has two stages", 0.9)], 0.5).label, "strong");
  assert.equal(judge(terms, [passage("unrelated words", 0.9)], 0.5).label, "check");
  assert.equal(judge(terms, [passage("cell division", 0.1), passage("other", 0.9)], 0.5).label, "check");
  const none = judge(terms, [passage("other", 0.1)], 0.5);
  assert.equal(none.label, "none");
  assert.equal(none.passage, undefined);
});

test("E02b Words in the passage lower the similarity needed, and small typos in long words still match", () => {
  const passage = (text, score) => ({ score, metadata: { text, fileName: "a", documentId: "d" } });
  const notes = "Inheritance: a class reuses and extends another class.";
  const typo = judge(keyTerms("inheritence"), [passage("other", 0.64), passage(notes, 0.62)], 0.65, 0.6);
  assert.equal(typo.label, "strong");
  assert.deepEqual(typo.matched, ["inheritance"]);
  assert.equal(judge(keyTerms("inheritance"), [passage(notes, 0.55)], 0.65, 0.6).label, "check");
  assert.equal(judge(keyTerms("OS"), [passage("other", 0.62)], 0.65, 0.6).label, "none");
  assert.equal(judge(keyTerms("glass"), [passage("class", 0.9)], 0.95, 0.6).label, "none"); // short words need an exact match
});

test("E03 The Exam Map uses one embedding request, no model call, and reports evidence and skipped files", async () => {
  const p = await project();
  await addFile(p);
  await h.addDocument({ user: "user_a", projectId: p._id, name: "later.pdf", pages: [PAGE("x")] });
  const res = await makeMap(p, "Photosynthesis converts light energy\nFrench revolution causes");
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.items.map((i) => i.label), ["strong", "none"]);
  assert.equal(res.body.items[0].page, 3);
  assert.match(res.body.items[0].passage, /Photosynthesis/);
  assert.deepEqual(res.body.skippedFiles, ["later.pdf"]);
  assert.deepEqual(h.services.state.queryBatches, [2]);
  assert.equal(h.services.state.llmPrompts.length, 0);
  assert.equal((await h.json("GET", mapUrl(p), "user_a")).body._id, res.body._id);
});

test("E04 The Exam Map checks ownership and input before it spends quota", async () => {
  const p = await project();
  assert.equal((await makeMap(p, "topic")).status, 400, "no ready file");
  await addFile(p);
  assert.equal((await makeMap(p, "  ")).status, 400);
  assert.equal((await makeMap(p, Array.from({ length: 51 }, (_, i) => `topic ${i}`).join("\n"))).status, 400);
  assert.equal((await makeMap(p, "x".repeat(10001))).status, 400);
  assert.equal((await makeMap(p, "topic", "user_b")).status, 404);
  assert.equal((await h.json("GET", mapUrl(p), "user_b")).status, 404);
  assert.deepEqual(h.services.state.queryBatches, []);
});

test("E05 The Exam Map limit returns 429, and a failed map gives its topics back", async () => {
  const p = await project();
  await addFile(p);
  process.env.DAILY_MAP_ITEM_LIMIT = "2";
  h.services.state.failEmbeddings = true;
  assert.equal((await makeMap(p, "one\ntwo")).status, 502);
  h.services.state.failEmbeddings = false;
  assert.equal((await makeMap(p, "one\ntwo")).status, 201);
  assert.equal((await makeMap(p, "three")).status, 429);
});

test("E06 A user can correct a label, and the original is kept", async () => {
  const p = await project();
  await addFile(p);
  const map = (await makeMap(p, "Photosynthesis converts light energy")).body;
  const url = `${mapUrl(p)}/${map._id}/items/${map.items[0]._id}`;
  assert.equal((await h.json("PATCH", url, "user_b", { label: "none" })).status, 404);
  assert.equal((await h.json("PATCH", url, "user_a", { label: "covered" })).status, 400);
  assert.equal((await h.json("PATCH", url, "user_a", { label: "check" })).status, 200);
  const saved = (await h.json("GET", mapUrl(p), "user_a")).body.items[0];
  assert.deepEqual([saved.label, saved.override], ["strong", "check"]);
});

test("E07 Deleting a file removes its evidence from the Exam Map, and deleting the project removes the map", async () => {
  const p = await project();
  const doc = await addFile(p);
  await makeMap(p, "Photosynthesis converts light energy");
  await h.json("DELETE", `/api/projects/${p._id}/documents/${doc._id}`, "user_a");
  const item = (await h.json("GET", mapUrl(p), "user_a")).body.items[0];
  assert.equal(item.label, "none");
  for (const field of ["passage", "fileName", "page", "documentId"]) assert.equal(item[field], undefined, field);
  await h.json("DELETE", `/api/projects/${p._id}`, "user_a");
  assert.equal(db.rows("ExamMap").length, 0);
});

test("E12 A file deleted while the Exam Map is built leaves no passage in it", async () => {
  const p = await project();
  const doc = await addFile(p);
  const search = h.services.rag.search;
  h.services.rag.search = async (args) => {
    const found = await search(args);
    await h.json("DELETE", `/api/projects/${p._id}/documents/${doc._id}`, "user_a");
    return found;
  };
  const res = await makeMap(p, "Photosynthesis converts light energy");
  assert.equal(res.status, 201);
  assert.equal(res.body.items[0].label, "none");
  assert.equal(res.body.items[0].passage, undefined);
});

test("E08 The shared limit stops all users, and counts only real model calls", async () => {
  const p = await project();
  const c = (await h.json("POST", `/api/projects/${p._id}/chats`, "user_a", { title: "c" })).body;
  process.env.DAILY_SHARED_ANSWER_LIMIT = "1";
  await h.ask("user_a", p._id, c._id, "Nothing is uploaded yet?");
  assert.equal(sharedAnswers(), 0, "no model call without sources");
  await addFile(p);
  assert.equal((await h.ask("user_a", p._id, c._id, "What converts light?")).status, 200);
  const other = await project("user_b");
  const c2 = (await h.json("POST", `/api/projects/${other._id}/chats`, "user_b", { title: "c" })).body;
  const refused = await h.ask("user_b", other._id, c2._id, "Hello?");
  assert.equal(refused.status, 429);
  assert.match(refused.body.error, /shared answer limit/);
  assert.equal(db.rows("Usage").find((u) => u.user !== SHARED_USER && u.questions === 0) !== undefined, true);
});

test("E09 A quiz costs one model call, even for two quick clicks, and is then reused", async () => {
  const p = await project();
  const doc = await addFile(p);
  h.services.state.llmAnswer = "```json\n" + quizReply() + "\n```";
  h.services.state.llmDelayMs = 5;
  const [a, b] = await Promise.all([h.json("POST", quizUrl(p, doc), "user_a"), h.json("POST", quizUrl(p, doc), "user_a")]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(a.body.questions.length, 5);
  assert.equal((await h.json("POST", quizUrl(p, doc), "user_a")).status, 200);
  assert.equal(h.services.state.llmPrompts.length, 1);
  assert.equal(sharedAnswers(), 1);
  const list = await h.json("GET", `/api/projects/${p._id}/documents`, "user_a");
  assert.ok(!("quiz" in list.body[0]), "answers are not sent with the file list");
});

test("E10 Bad quiz output is rejected and not saved; others cannot open a quiz", async () => {
  const p = await project();
  const doc = await addFile(p);
  h.services.state.llmAnswer = quizReply(99); // a page that was never sent
  assert.equal((await h.json("POST", quizUrl(p, doc), "user_a")).status, 502);
  h.services.state.llmAnswer = "not json";
  assert.equal((await h.json("POST", quizUrl(p, doc), "user_a")).status, 502);
  assert.equal(db.rows("Document")[0].quiz, undefined);
  assert.equal((await h.json("POST", quizUrl(p, doc), "user_b")).status, 404);
  db.rows("Document")[0].status = "failed";
  assert.equal((await h.json("POST", quizUrl(p, doc), "user_a")).status, 409);
});

test("E11 Long files are sampled from start to end within the budget; files without pages get none", () => {
  const sample = sampleText(Array.from({ length: 100 }, (_, i) => PAGE("x".repeat(1500), i + 1)));
  assert.ok(sample.readChars <= QUIZ_CHAR_BUDGET && sample.readChars < sample.totalChars);
  assert.equal(sample.segments[0].page, 1);
  assert.ok(sample.segments.at(-1).page > 80);
  assert.equal(parseQuiz(quizReply(7), [{ text: "t", page: null }])[0].page, null);
});
