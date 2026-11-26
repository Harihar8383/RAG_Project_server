import test from "node:test";
import assert from "node:assert/strict";
import { streamWithFallback } from "../src/services/llm.js";

const collect = async (iterable) => {
  let text = "";
  for await (const piece of iterable) text += piece;
  return text;
};
const failing = (message) => async function* () { throw new Error(message); }; // eslint-disable-line require-yield
const answering = (text) => async function* () { yield text; };

test("L01 An overloaded or rate-limited model hands over to the next one", async () => {
  const tried = [];
  const models = { a: failing("[503 Service Unavailable] high demand"), b: failing("[429 Too Many Requests]"), c: answering("ok") };
  const text = await collect(streamWithFallback(["a", "b", "c"], (m) => (tried.push(m), models[m]())));
  assert.equal(text, "ok");
  assert.deepEqual(tried, ["a", "b", "c"]);
});

test("L03 A busy model is skipped for a minute, then tried again", async () => {
  let clock = 0;
  const resting = new Map();
  const tried = [];
  const run = () => collect(streamWithFallback(["a", "b"], (m) => (tried.push(m), (m === "a" ? failing("[503]") : answering("ok"))()), resting, () => clock));
  await run();
  await run();
  clock = 61000;
  await run();
  assert.deepEqual(tried, ["a", "b", "b", "a", "b"]);
});

test("L02 Other errors, the last model's error and errors after text has streamed are not retried", async () => {
  await assert.rejects(collect(streamWithFallback(["a", "b"], () => failing("[400 Bad Request]")())), /400/);
  await assert.rejects(collect(streamWithFallback(["a"], () => failing("[503] high demand")())), /503/);
  const tried = [];
  const halfway = async function* () { yield "part"; throw new Error("[503] high demand"); };
  await assert.rejects(collect(streamWithFallback(["a", "b"], (m) => (tried.push(m), halfway()))), /503/);
  assert.deepEqual(tried, ["a"]);
});
