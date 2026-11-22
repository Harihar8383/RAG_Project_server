// The generation model. A LangChain chain of the chat model and a string output parser streams plain text pieces.

export function createGeminiLlm({ apiKey, model = "gemini-2.5-flash" }) {
  let chain;

  async function getChain() {
    if (!chain) {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      const { StringOutputParser } = await import("@langchain/core/output_parsers");
      chain = new ChatGoogleGenerativeAI({ model, apiKey, temperature: 0.2, streaming: true, maxRetries: 1 }).pipe(
        new StringOutputParser()
      );
    }
    return chain;
  }

  return {
    /** Yields the answer text piece by piece. */
    async *stream(prompt, { signal } = {}) {
      const c = await getChain();
      for await (const piece of await c.stream(prompt, { signal })) {
        if (piece) yield piece;
      }
    },
  };
}
