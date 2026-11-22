// Gemini embeddings through the REST API. The LangChain wrapper of the installed version cannot request a reduced
// output size, and gemini-embedding-001 returns 3072 values by default, so the request sets outputDimensionality.
// Google states that embeddings with fewer than 3072 dimensions must be normalized by the caller.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const BATCH_SIZE = 100;

export function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((x) => x / length);
}

export function createGeminiEmbeddings({
  apiKey,
  model = "gemini-embedding-001",
  dimensions = 768,
  fetchImpl = fetch,
}) {
  async function embedBatch(texts, taskType) {
    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: dimensions,
    }));
    const res = await fetchImpl(`${BASE_URL}/models/${model}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ requests }),
    });
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

  async function embedAll(texts, taskType) {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), taskType)));
    }
    return out;
  }

  return {
    dimensions,
    embedDocuments: (texts) => embedAll(texts, "RETRIEVAL_DOCUMENT"),
    embedQuery: async (text) => (await embedAll([text], "RETRIEVAL_QUERY"))[0],
  };
}
