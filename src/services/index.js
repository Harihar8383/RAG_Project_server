import { readConfig } from "../config/env.js";
import { createGeminiEmbeddings } from "./embeddings.js";
import { createGeminiLlm } from "./llm.js";
import { createPineconeStore } from "./vectorStore.js";
import { createUploadThingFileStore } from "./fileStore.js";
import { createDocumentLoader } from "./loader.js";
import { createClerkIdentity } from "./identity.js";
import { createRag } from "./rag.js";

/** Builds the real adapters. Tests build the same shape from in-memory fakes. */
export function createServices(env = process.env) {
  const config = readConfig(env);
  const services = {
    embeddings: createGeminiEmbeddings({
      apiKey: config.googleApiKey,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      tokensPerMinute: config.embeddingTokensPerMinute,
    }),
    llm: createGeminiLlm({ apiKey: config.googleApiKey, model: config.chatModel }),
    vectorStore: createPineconeStore({
      apiKey: config.pineconeApiKey,
      indexName: config.pineconeIndex,
      indexHost: config.pineconeIndexHost,
    }),
    fileStore: createUploadThingFileStore(),
    loader: createDocumentLoader(),
    identity: createClerkIdentity(),
  };
  services.rag = createRag(services);
  return services;
}
