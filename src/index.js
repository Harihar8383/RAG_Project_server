import { readConfig, missingEnv } from "./config/env.js"; // loads .env first
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
  await connectDB();
  const app = createApp({ services: createServices(), clientUrl: config.clientUrl });
  app.listen(config.port, () => {
    log.info(`Server is running at http://localhost:${config.port}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error?.message);
  process.exit(1);
});
