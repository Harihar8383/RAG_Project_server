import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { createRouteHandler } from "uploadthing/express";
import projectRoutes from "./routes/project.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import documentRoutes from "./routes/document.routes.js";
import { createUploadRouter } from "./uploadthing.js";
import { notFound, errorHandler } from "./middleware/errors.js";

/**
 * Builds the Express application. The services (database adapters, vector store, models) are injected, so tests run
 * the real routes and controllers against fakes. `session` replaces Clerk's middleware in tests.
 */
export function createApp({ services, clientUrl = "http://localhost:5173", session = clerkMiddleware(), mountUploads = true } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.locals.services = services;

  app.use(cors({ origin: clientUrl }));
  app.use(express.json({ limit: "1mb" }));
  app.use(session);

  app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));

  // UploadThing route handler, which validates the Clerk session in the upload middleware
  if (mountUploads) {
    app.use("/api/uploadthing", createRouteHandler({ router: createUploadRouter(services) }));
  }
  app.use("/api/projects/:projectId/documents", documentRoutes);
  app.use("/api/projects/:projectId/chats", chatRoutes);
  app.use("/api/projects", projectRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
