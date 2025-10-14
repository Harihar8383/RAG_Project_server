import { createUploadthing } from "uploadthing/express";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import Document from "./models/document.models.js";

const f = createUploadthing();

// The middleware now accepts `input` as an argument
const authMiddleware = async ({ req, input }) => {
  const auth = req.auth();
  if (!auth.userId) throw new UploadThingError("Unauthorized");

  // --- CHANGE #1: Return both userId and the input ---
  // This makes both available in the `metadata` of onUploadComplete
  return { userId: auth.userId, projectId: input.projectId };
};

export const uploadRouter = {
  documentUploader: f({
    pdf: { maxFileSize: "32MB", maxFileCount: 5 },
    text: { maxFileSize: "4MB", maxFileCount: 5 },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxFileSize: "16MB", maxFileCount: 5 },
  })
    .input(z.object({ projectId: z.string() }))
    .middleware(authMiddleware)
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("[UploadThing] Upload complete for userId:", metadata.userId);
      
      // --- CHANGE #2: Access projectId directly from metadata ---
      const { projectId } = metadata;

      try {
        const newDocument = await Document.create({
          project: projectId,
          name: file.name,
          url: file.ufsUrl,
          key: file.key,
        });
        console.log("[DB] Saved document to database:", newDocument);
      } catch (error) {
        console.error("[DB] Error saving document:", error);
      }

      return { uploadedBy: metadata.userId };
    }),
};