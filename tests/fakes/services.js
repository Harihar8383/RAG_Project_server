// Fake outside services for offline tests. They have the same interface as the real adapters in src/services.
import { createRag } from "../../src/services/rag.js";
import { UnsupportedFileTypeError, isSupportedName } from "../../src/services/loader.js";

const DIM = 64;
const hash = (word) => {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % DIM;
};
const normalize = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
/** A bag-of-words embedding, so texts that share words are close under cosine similarity. */
export const embedText = (text) => {
  const v = new Array(DIM).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) v[hash(word)] += 1;
  return normalize(v);
};
const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function createFakeServices() {
  const files = new Map(); // url -> [{ pageContent, page }]
  const storedKeys = new Set();
  const vectors = new Map(); // id -> { values, metadata }
  const state = {
    failEmbeddings: false,
    failDeleteFile: false,
    failLoader: false,
    llmAnswer: "The documents say so [S1].",
    llmFailMessage: null, // text of the error the model throws
    llmFailAfter: null, // number of pieces after which the model throws
    llmDelayMs: 0,
    identityDelayMs: 0,
    llmHang: false, // the model never answers
    embedHang: false, // the embedding service never answers
    embedCalls: 0,
    llmPrompts: [],
    deletedKeys: [],
  };

  const services = {
    state,
    files,
    storedKeys,
    vectors,

    embeddings: {
      dimensions: DIM,
      async embedDocuments(texts) {
        state.embedCalls += 1;
        if (state.failEmbeddings) throw new Error("embedding request failed https://secret.example/key=abc");
        return texts.map(embedText);
      },
      async embedQuery(text) {
        if (state.embedHang) await new Promise(() => {});
        return embedText(text);
      },
    },

    vectorStore: {
      async upsert(records) {
        for (const r of records) vectors.set(r.id, { values: r.values, metadata: r.metadata });
      },
      async query({ vector, topK, filter = {} }) {
        const ok = (meta) =>
          Object.entries(filter).every(([k, c]) => (c && typeof c === "object" && "$eq" in c ? meta[k] === c.$eq : meta[k] === c));
        return [...vectors.entries()]
          .filter(([, v]) => ok(v.metadata))
          .map(([id, v]) => ({ id, score: cosine(vector, v.values), metadata: v.metadata }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      },
      async deleteByIds(ids) {
        for (const id of ids) vectors.delete(id);
      },
    },

    fileStore: {
      async deleteFile(key) {
        if (state.failDeleteFile) throw new Error("storage unavailable");
        storedKeys.delete(key);
        state.deletedKeys.push(key);
      },
    },

    loader: {
      async load({ url, name }) {
        if (state.failLoader) throw new Error("The stored file could not be downloaded (status 500).");
        if (!isSupportedName(name)) throw new UnsupportedFileTypeError();
        if (!files.has(url)) throw new Error("The stored file could not be downloaded (status 404).");
        return files.get(url);
      },
    },

    llm: {
      async *stream(prompt, { signal } = {}) {
        state.llmPrompts.push(prompt);
        if (state.llmHang) await new Promise((resolve) => signal?.addEventListener("abort", resolve));
        const pieces = state.llmAnswer.split(/(?<=\s)/);
        for (let i = 0; i < pieces.length; i += 1) {
          if (signal?.aborted) return;
          if (state.llmFailAfter !== null && i >= state.llmFailAfter) throw new Error(state.llmFailMessage || "model unavailable");
          if (state.llmDelayMs) await new Promise((r) => setTimeout(r, state.llmDelayMs));
          yield pieces[i];
        }
      },
    },

    identity: {
      async getEmail(userId) {
        if (state.identityDelayMs) await new Promise((r) => setTimeout(r, state.identityDelayMs));
        return `${userId}@example.test`;
      },
    },
  };
  services.rag = createRag(services);

  /** Registers a stored file so the loader can "download" it. */
  services.addFile = ({ url, key, pages }) => {
    files.set(url, pages);
    storedKeys.add(key);
  };
  return services;
}
