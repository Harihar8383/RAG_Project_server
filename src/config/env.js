import dotenv from "dotenv";

// Load the .env file before any other module reads process.env.
dotenv.config();

// Kept so that start-up can warn: an unset NODE_ENV on a live server would run UploadThing in development mode.
export const NODE_ENV_DEFAULTED = !process.env.NODE_ENV;
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

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
    embeddingTokensPerMinute: Number(env.EMBEDDING_TOKENS_PER_MINUTE) || 30000,
    chatModel: env.CHAT_MODEL || "gemini-3.1-flash-lite",
    pineconeApiKey: env.PINECONE_API_KEY,
    pineconeIndex: env.PINECONE_INDEX || "rag-documents",
    pineconeIndexHost: env.INDEX_HOST_URL,
  };
}

/** Per-user daily limits on the shared API quota. Read on each call, so a change in the environment applies at once. */
export function dailyLimits(env = process.env) {
  return {
    questions: Number(env.DAILY_QUESTION_LIMIT) || 100,
    chunks: Number(env.DAILY_CHUNK_LIMIT) || 2000,
    mapItems: Number(env.DAILY_MAP_ITEM_LIMIT) || 200,
    sharedAnswers: Number(env.DAILY_SHARED_ANSWER_LIMIT) || 450,
  };
}

/** The similarity an Exam Map passage needs. The default is a starting guess: tune it with real notes. */
export const examMapMinScore = (env = process.env) => Number(env.EXAM_MAP_MIN_SCORE) || 0.65;

/** Names of the required variables that are missing, so a start-up error can list them without printing values. */
export function missingEnv(env = process.env) {
  return REQUIRED_FOR_RUNTIME.filter((name) => !env[name]);
}
