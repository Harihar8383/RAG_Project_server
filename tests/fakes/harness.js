// Test harness: the real application with fake services, an in-memory database and a header-based Clerk session.
import { createApp } from "../../src/app.js";
import { createFakeServices } from "./services.js";
import { db } from "./memoryDb.js";

process.env.CLERK_SECRET_KEY ||= "sk_test_dummy";
process.env.CLERK_PUBLISHABLE_KEY ||= "pk_test_ZHVtbXkuY2xlcmsuYWNjb3VudHMuZGV2JA";

/** Simulates Clerk: the x-test-user header decides who is signed in, and req.auth is a function as in Clerk 1.7. */
const session = (req, _res, next) => {
  const userId = req.get("x-test-user") || null;
  req.auth = () => ({ userId, tokenType: "session_token" });
  next();
};

export async function startHarness() {
  db.reset();
  const services = createFakeServices();
  const app = createApp({ services, session, mountUploads: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = (method, path, user, body) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (method, path, user, body) => {
    const res = await call(method, path, user, body);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  /** Posts a question and reads the whole event stream. Returns { status, events }. */
  const ask = async (user, projectId, chatId, content) => {
    const res = await call("POST", `/api/projects/${projectId}/chats/${chatId}/messages`, user, { content });
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      return { status: res.status, events: parseSse(await res.text()) };
    }
    return { status: res.status, events: [], body: await res.json().catch(() => null) };
  };

  /** Arranges an indexed document for a user without going through UploadThing. */
  const addDocument = async ({ user, projectId, name, pages, key = `key-${name}-${projectId}` }) => {
    const url = `https://files.example.test/${key}`;
    services.addFile({ url, key, pages });
    const project = db.rows("Project").find((p) => p._id === projectId);
    const row = db.insert("Document", { project: project._id, name, url, key, status: "uploaded", chunkCount: 0 });
    return row;
  };

  return {
    app, services, base, call, json, ask, addDocument,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function parseSse(text) {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data:"))
    .map((block) => JSON.parse(block.slice(5)));
}

/** Waits until a condition holds, for the background indexing job. */
export async function waitFor(check, { timeout = 3000, step = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, step));
  }
}
