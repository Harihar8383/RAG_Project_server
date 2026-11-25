import { readConfig, missingEnv, NODE_ENV_DEFAULTED } from "./config/env.js"; // loads .env first
import connectDB from "./config/db.js";
import { createServices } from "./services/index.js";
import { createApp } from "./app.js";
import { log } from "./utils/log.js";

const startServer = async () => {
  const missing = missingEnv();
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  const config = readConfig();
  if (NODE_ENV_DEFAULTED) log.warn("NODE_ENV is not set, so the server runs in development mode. Set NODE_ENV=production on a live server.");
  await connectDB();
  const services = createServices();
  // Jobs of a stopped server never finish, so their documents become retryable.
  const interrupted = await services.rag.failInterrupted();
  if (interrupted) log.warn("documents marked as interrupted", { count: interrupted });
  const app = createApp({ services, clientUrl: config.clientUrl });
  app.listen(config.port, () => {
    log.info(`Server is running at http://localhost:${config.port}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error?.message);
  process.exit(1);
});
