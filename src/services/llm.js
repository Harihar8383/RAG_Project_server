// The generation model. A LangChain chain of the chat model and a string output parser streams plain text pieces.
// When a model is overloaded (503) or out of quota (429) before it sends any text, the next model in the list answers.

import { log } from "../utils/log.js";

// Overload, quota and server-side failures. A bad request or a wrong key fails the same way on every model.
const NEXT_MODEL = /\b(429|500|503|504)\b|overloaded|high demand|unavailable|RESOURCE_EXHAUSTED|quota/i;
export const shouldTryNextModel = (err) => err?.name !== "AbortError" && NEXT_MODEL.test(String(err?.message || ""));

const REST_MS = 60000; // a busy model is skipped this long, so each question does not wait for it to fail again

/**
 * Streams from the first model that answers. `makeStream(model)` returns an async iterable of text pieces.
 * `resting` maps a model to the time until which it is skipped; it is shared between calls.
 */
export async function* streamWithFallback(models, makeStream, resting = new Map(), now = Date.now) {
  const awake = models.filter((model) => !(resting.get(model) > now()));
  const order = awake.length ? awake : models;
  for (let i = 0; i < order.length; i++) {
    let sent = false;
    try {
      for await (const piece of makeStream(order[i])) {
        sent = true;
        yield piece;
      }
      return;
    } catch (err) {
      const busy = shouldTryNextModel(err);
      if (busy) resting.set(order[i], now() + REST_MS);
      // Text already shown cannot be replaced by another model's answer.
      if (sent || i === order.length - 1 || !busy) throw err;
      log.warn("chat model unavailable, trying the next one", { model: order[i], next: order[i + 1] });
    }
  }
}

export function createGeminiLlm({ apiKey, models = ["gemini-3.1-flash-lite"] }) {
  const chains = new Map();
  const resting = new Map();

  async function getChain(model) {
    if (!chains.has(model)) {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      const { StringOutputParser } = await import("@langchain/core/output_parsers");
      // No library retries: an overloaded model often stays overloaded, so the next model is the retry.
      chains.set(model, new ChatGoogleGenerativeAI({ model, apiKey, temperature: 0.2, streaming: true, maxRetries: 0 }).pipe(new StringOutputParser()));
    }
    return chains.get(model);
  }

  return {
    /** Yields the answer text piece by piece. */
    stream(prompt, { signal } = {}) {
      return streamWithFallback(models, async function* (model) {
        const c = await getChain(model);
        for await (const piece of await c.stream(prompt, { signal })) {
          if (piece) yield piece;
        }
      }, resting);
    },
  };
}
