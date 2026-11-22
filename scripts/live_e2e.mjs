// Live end-to-end run against the real services (Clerk, MongoDB, UploadThing, Pinecone, Gemini).
//
// Prerequisites
//   1. A filled-in .env (see .env.example) and the Pinecone index created with 768 dimensions and the cosine metric.
//   2. The server running: npm run dev  (default http://localhost:8000).
//   3. A development Clerk instance. The script creates two throwaway users and one session each through the
//      Clerk Backend API, uses their real session tokens, and deletes the users at the end.
//
// Run: npm run test:live
// Optional: LIVE_BASE_URL=http://localhost:8000/api  LIVE_TIMEOUT_MS=120000

import "../src/config/env.js";
import { genUploader } from "uploadthing/client";

const BASE = process.env.LIVE_BASE_URL || `http://localhost:${process.env.PORT || 8000}/api`;
const TIMEOUT = Number(process.env.LIVE_TIMEOUT_MS || 120000);
const CLERK = "https://api.clerk.com/v1";
const stamp = Date.now();

const results = [];
let failed = false;

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    failed = true;
    results.push({ name, ok: false, detail: err.message });
    console.log(`FAIL  ${name}  ${err.message}`);
  }
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function clerk(path, method = "GET", body) {
  const res = await fetch(`${CLERK}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${method} ${path} answered ${res.status}`);
  return json;
}

async function makeUser(label) {
  // Clerk test addresses (the +clerk_test suffix) are accepted by development instances.
  const user = await clerk("/users", "POST", {
    email_address: [`live-${label}-${stamp}+clerk_test@example.com`],
    password: `Live-${stamp}-Pass!x9`,
    skip_password_checks: true,
  });
  const session = await clerk("/sessions", "POST", { user_id: user.id });
  return { id: user.id, sessionId: session.id, token: null, tokenAt: 0 };
}

// Clerk session tokens are short lived (about one minute), so each request uses a token that is at most 30 s old.
async function freshToken(user) {
  if (!user.token || Date.now() - user.tokenAt > 30000) {
    const out = await clerk(`/sessions/${user.sessionId}/tokens`, "POST");
    user.token = out.jwt;
    user.tokenAt = Date.now();
  }
  return user.token;
}

async function api(user, path, init = {}) {
  const token = await freshToken(user);
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

async function json(user, path, init) {
  const res = await api(user, path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function ask(user, projectId, chatId, content) {
  const res = await api(user, `/projects/${projectId}/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  must(res.ok, `message request answered ${res.status}`);
  const text = await res.text();
  const events = text
    .split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data:")))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(5)));
  return {
    events,
    answer: events.filter((e) => e.chunk).map((e) => e.chunk).join(""),
    sources: events.find((e) => e.sources)?.sources || [],
    error: events.find((e) => e.error)?.error,
    done: events.some((e) => e.done),
  };
}

async function waitForStatus(user, projectId, documentId, wanted) {
  const end = Date.now() + TIMEOUT;
  for (;;) {
    const { body } = await json(user, `/projects/${projectId}/documents`);
    const doc = body.find((d) => d._id === documentId);
    if (doc && wanted.includes(doc.status)) return doc;
    if (Date.now() > end) throw new Error(`document stayed ${doc?.status} for ${TIMEOUT} ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const SAMPLE = [
  "Northwind Handbook",
  "",
  "The refund window for all online orders is 30 days from the delivery date.",
  "Customers who return an item after the window receive store credit instead of a refund.",
  "The warehouse in Pune ships orders on weekdays before 6 pm local time.",
  "",
  "The support desk answers at support at northwind.example and replies within one working day.",
].join("\n");

async function main() {
  for (const name of ["CLERK_SECRET_KEY", "MONGO_URI", "GOOGLE_API_KEY", "PINECONE_API_KEY", "UPLOADTHING_TOKEN"]) {
    must(process.env[name], `${name} is missing from .env`);
  }
  let alice;
  let bob;
  let projectId;

  await step("Server is reachable", async () => {
    const res = await fetch(`${BASE}/health`);
    must(res.ok, `GET /health answered ${res.status}`);
  });

  await step("A signed-out request is refused with 401 JSON", async () => {
    const res = await fetch(`${BASE}/projects`, { redirect: "manual" });
    must(res.status === 401, `status ${res.status}`);
  });

  await step("Two throwaway Clerk users and real session tokens are created", async () => {
    alice = await makeUser("a");
    bob = await makeUser("b");
  });

  try {
    await step("Alice creates a project", async () => {
      const { status, body } = await json(alice, "/projects", {
        method: "POST",
        body: JSON.stringify({ name: `Live test ${stamp}`, description: "Created by live_e2e" }),
      });
      must(status === 201 && body._id, `status ${status}`);
      projectId = body._id;
    });

    let document;
    await step("Alice uploads a text file through UploadThing", async () => {
      const { uploadFiles } = genUploader({ url: `${BASE}/uploadthing`, package: "uploadthing" });
      const file = new File([SAMPLE], "northwind-handbook.txt", { type: "text/plain" });
      const out = await uploadFiles("documentUploader", {
        files: [file],
        input: { projectId },
        headers: { Authorization: `Bearer ${await freshToken(alice)}` },
      });
      must(out.length === 1, "no upload result");
      const end = Date.now() + TIMEOUT;
      while (!document) {
        const { body } = await json(alice, `/projects/${projectId}/documents`);
        document = body.find((d) => d.name === "northwind-handbook.txt");
        if (!document && Date.now() > end) throw new Error("the document record never appeared");
        if (!document) await new Promise((r) => setTimeout(r, 2000));
      }
    });

    await step("The document reaches the indexed state", async () => {
      const doc = await waitForStatus(alice, projectId, document._id, ["indexed", "failed"]);
      must(doc.status === "indexed", `status ${doc.status}: ${doc.failureReason}`);
      must(doc.chunkCount > 0, "chunkCount is 0");
      document = doc;
      return `${doc.chunkCount} chunk(s)`;
    });

    let chatId;
    await step("Alice creates a conversation", async () => {
      const { status, body } = await json(alice, `/projects/${projectId}/chats`, {
        method: "POST",
        body: JSON.stringify({ title: "Live conversation" }),
      });
      must(status === 201, `status ${status}`);
      chatId = body._id;
    });

    await step("A question is answered from the document with a source", async () => {
      const r = await ask(alice, projectId, chatId, "How many days is the refund window?");
      must(r.done && !r.error, `stream ended with ${r.error || "no done event"}`);
      must(/30/.test(r.answer), `answer did not mention 30: ${r.answer.slice(0, 120)}`);
      must(r.sources.some((s) => s.fileName === "northwind-handbook.txt"), "no source named the file");
      const statuses = r.events.filter((e) => e.status).map((e) => e.status);
      must(statuses[0] === "retrieving", `first status was ${statuses[0]}`);
      return `sources ${r.sources.map((s) => s.label).join(",")}`;
    });

    await step("A question outside the document gets the not-found reply", async () => {
      const r = await ask(alice, projectId, chatId, "What is the capital of Australia?");
      must(r.done, "stream did not finish");
      must(!/Canberra/i.test(r.answer), `the model answered from outside the context: ${r.answer.slice(0, 120)}`);
    });

    await step("The history holds all four messages in order", async () => {
      const { body } = await json(alice, `/projects/${projectId}/chats/${chatId}/messages`);
      must(body.length === 4, `${body.length} messages`);
      must(body[0].role === "user" && body[1].role === "assistant", "order is wrong");
      must(body[1].sources.length > 0, "the first answer lost its sources");
    });

    await step("Bob cannot read, ask in, list or delete Alice's data", async () => {
      for (const [method, path] of [
        ["GET", `/projects/${projectId}`],
        ["GET", `/projects/${projectId}/documents`],
        ["GET", `/projects/${projectId}/chats`],
        ["GET", `/projects/${projectId}/chats/${chatId}/messages`],
        ["DELETE", `/projects/${projectId}/documents/${document._id}`],
        ["DELETE", `/projects/${projectId}`],
      ]) {
        const { status } = await json(bob, path, { method });
        must(status === 403 || status === 404, `${method} ${path} answered ${status}`);
      }
      const res = await api(bob, `/projects/${projectId}/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "What is the refund window?" }),
      });
      must(res.status === 403 || res.status === 404, `Bob's question answered ${res.status}`);
    });

    await step("Bob's own project never retrieves Alice's document", async () => {
      const p = await json(bob, "/projects", { method: "POST", body: JSON.stringify({ name: "Bob project" }) });
      const c = await json(bob, `/projects/${p.body._id}/chats`, { method: "POST", body: JSON.stringify({ title: "Bob chat" }) });
      const r = await ask(bob, p.body._id, c.body._id, "How many days is the refund window?");
      must(r.sources.length === 0, `Bob received ${r.sources.length} source(s)`);
      await json(bob, `/projects/${p.body._id}`, { method: "DELETE" });
    });

    await step("Deleting the document removes its record", async () => {
      const del = await json(alice, `/projects/${projectId}/documents/${document._id}`, { method: "DELETE" });
      must(del.status === 200, `status ${del.status}`);
      const { body } = await json(alice, `/projects/${projectId}/documents`);
      must(!body.some((d) => d._id === document._id), "the record is still listed");
    });

    await step("After the delete, the same question retrieves no source", async () => {
      // Pinecone is eventually consistent, so allow a short wait for the delete to be visible
      let last;
      for (let i = 0; i < 6; i += 1) {
        last = await ask(alice, projectId, chatId, "How many days is the refund window?");
        if (last.sources.length === 0) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error(`still retrieved ${last.sources.length} source(s)`);
    });

    await step("Deleting the project removes it and its conversations", async () => {
      const del = await json(alice, `/projects/${projectId}`, { method: "DELETE" });
      must(del.status === 200, `status ${del.status}`);
      const { status } = await json(alice, `/projects/${projectId}`);
      must(status === 404, `GET after delete answered ${status}`);
    });
  } finally {
    await step("Throwaway Clerk users are deleted", async () => {
      for (const u of [alice, bob].filter(Boolean)) await clerk(`/users/${u.id}`, "DELETE");
    });
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} live steps passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`Live run stopped: ${err.message}`);
  process.exit(1);
});
