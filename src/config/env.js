import dotenv from "dotenv";

// Load the .env file before any other module reads process.env.
dotenv.config();

export const REQUIRED_FOR_RUNTIME = [
  "MONGO_URI",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "GOOGLE_API_KEY",
  "PINECONE_API_KEY",
  "UPLOADTHING_TOKEN",
];

export function readConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8000,
    clientUrl: env.CLIENT_URL || "http://localhost:5173",
    mongoUri: env.MONGO_URI,
    googleApiKey: env.GOOGLE_API_KEY,
    embeddingModel: env.EMBEDDING_MODEL || "gemini-embedding-001",
    embeddingDimensions: Number(env.EMBEDDING_DIMENSIONS) || 768,
    chatModel: env.CHAT_MODEL || "gemini-2.5-flash",
    pineconeApiKey: env.PINECONE_API_KEY,
    pineconeIndex: env.PINECONE_INDEX || "rag-documents",
    pineconeIndexHost: env.INDEX_HOST_URL,
  };
}

/** Names of the required variables that are missing, so a start-up error can list them without printing values. */
export function missingEnv(env = process.env) {
  return REQUIRED_FOR_RUNTIME.filter((name) => !env[name]);
}
