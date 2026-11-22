import { createUploadthing } from "uploadthing/express";
import { UploadThingError } from "uploadthing/server";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import Document from "./models/document.models.js";
import Project from "./models/project.models.js";
import { ensureUser, isObjectId } from "./middleware/auth.js";
import { log, safeError } from "./utils/log.js";

const f = createUploadthing();

/**
 * Builds the upload router. Only PDF, DOCX, text and CSV files are accepted, and a file can only be attached to a
 * project that belongs to the signed-in user. Indexing starts in the background after the record is saved.
 */
export function createUploadRouter(services) {
  const authMiddleware = async ({ req, input }) => {
    let userId = null;
    try {
      userId = getAuth(req)?.userId || null;
    } catch {
      userId = null;
    }
    if (!userId) throw new UploadThingError("Unauthorized");
    if (!isObjectId(input.projectId)) throw new UploadThingError("Invalid project id");

    const user = await ensureUser(userId, services);
    const project = await Project.findOne({ _id: input.projectId, user: user._id });
    if (!project) throw new UploadThingError("Project not found");

    return { userId, projectId: String(project._id) };
  };

  const onUploadComplete = async ({ metadata, file }) => {
    let doc;
    try {
      doc = await Document.create({
        project: metadata.projectId,
        name: file.name,
        url: file.ufsUrl,
        key: file.key,
        status: "uploaded",
      });
    } catch (error) {
      log.error("document record could not be saved", safeError(error));
      // Do not leave an orphan file behind, and tell the client that the upload did not succeed.
      try {
        await services.fileStore.deleteFile(file.key);
      } catch {
        // the failure is already logged
      }
      throw new UploadThingError("The document could not be saved.");
    }
    log.info("document uploaded", { documentId: String(doc._id) });
    setImmediate(() => services.rag.processDocument(doc._id).catch(() => {}));
    return { documentId: String(doc._id) };
  };

  return {
    documentUploader: f({
      pdf: { maxFileSize: "32MB", maxFileCount: 5 },
      text: { maxFileSize: "4MB", maxFileCount: 5 },
      "text/csv": { maxFileSize: "4MB", maxFileCount: 5 },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxFileSize: "16MB", maxFileCount: 5 },
    })
      .input(z.object({ projectId: z.string() }))
      .middleware(authMiddleware)
      .onUploadComplete(onUploadComplete),
  };
}
