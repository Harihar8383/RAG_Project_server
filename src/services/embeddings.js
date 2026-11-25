// Gemini embeddings through the REST API. The LangChain wrapper of the installed version cannot request a reduced
// output size, and gemini-embedding-001 returns 3072 values by default, so the request sets outputDimensionality.
// Google states that embeddings with fewer than 3072 dimensions must be normalized by the caller.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 60000;
const MAX_QUERY_WAIT_MS = 5000; // a user is waiting, and the chat gives up after a quiet period

export function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((x) => x / length);
}

// shortcut: estimates tokens as characters / 4; switch to the countTokens API if 429s still appear.
const estimateTokens = (texts) => Math.ceil(texts.reduce((sum, t) => sum + t.length, 0) / 4);

/** How long to wait before retrying a 429 or 503: the Retry-After header, Google's retryDelay, or a growing backoff. */
export function retryDelayMs(res, bodyText, attempt) {
  const header = Number(res.headers?.get?.("retry-after"));
  if (header > 0) return Math.min(header * 1000, MAX_WAIT_MS);
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bodyText || "");
  if (match) return Math.min(Math.ceil(Number(match[1]) * 1000), MAX_WAIT_MS);
  return (attempt + 1) * 2000;
}

export function createGeminiEmbeddings({
  apiKey,
  model = "gemini-embedding-001",
  dimensions = 768,
  tokensPerMinute = 30000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  // Tokens sent in the last minute, so document batches stay under the per-minute limit instead of hitting 429.
  const sent = [];
  async function pace(tokens, wait) {
    for (;;) {
      while (sent.length && sent[0].at <= now() - 60000) sent.shift();
      const used = sent.reduce((sum, s) => sum + s.tokens, 0);
      if (!wait || sent.length === 0 || used + tokens <= tokensPerMinute) {
        sent.push({ at: now(), tokens });
        return;
      }
      await sleep(sent[0].at + 60000 - now());
    }
  }

  async function embedBatch(texts, taskType, wait) {
    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: dimensions,
    }));
    await pace(estimateTokens(texts), wait);
    let res;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      res = await fetchImpl(`${BASE_URL}/models/${model}:batchEmbedContents`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status !== 429 && res.status !== 503) break;
      const body = await res.text().catch(() => "");
      // A daily quota does not come back within minutes, so waiting only burns time.
      if (res.status === 429 && /PerDay/i.test(body)) throw new Error("The embedding service reached its daily limit.");
      const delay = retryDelayMs(res, body, attempt);
      if (attempt === MAX_ATTEMPTS - 1 || (!wait && delay > MAX_QUERY_WAIT_MS)) break;
      await sleep(delay);
    }
    if (!res.ok) throw new Error(`The embedding service answered with status ${res.status}.`);
    const json = await res.json();
    if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
      throw new Error("The embedding service returned an unexpected response.");
    }
    return json.embeddings.map((e) => {
      if (e.values.length !== dimensions) {
        throw new Error(`Expected ${dimensions} embedding values but received ${e.values.length}.`);
      }
      return normalize(e.values);
    });
  }

  async function embedAll(texts, taskType, wait) {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), taskType, wait)));
    }
    return out;
  }

  return {
    dimensions,
    embedDocuments: (texts) => embedAll(texts, "RETRIEVAL_DOCUMENT", true),
    // A question is counted but never held back, because the user is waiting for the answer.
    embedQuery: async (text) => (await embedAll([text], "RETRIEVAL_QUERY", false))[0],
  };
}
