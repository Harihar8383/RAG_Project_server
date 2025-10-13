import { createUploadthing } from "uploadthing/express";
import { UploadThingError } from "uploadthing/server";

const f = createUploadthing();

// Middleware to authenticate the user for each upload
const authMiddleware = async ({ req }) => {
  // `req.auth` is populated by our clerkMiddleware
  const auth = req.auth;
  if (!auth.userId) throw new UploadThingError("Unauthorized");

  // Return whatever you want to be available in onUploadComplete
  return { userId: auth.userId };
};

// Define your FileRouter
export const uploadRouter = {
  // Define a route for document uploads
  documentUploader: f({
    // Specify allowed file types and sizes
    pdf: { maxFileSize: "32MB", maxFileCount: 5 },
    text: { maxFileSize: "4MB", maxFileCount: 5 }, // for .csv
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxFileSize: "16MB", maxFileCount: 5 },
  })
    // Apply the authentication middleware
    .middleware(authMiddleware)
    // This code runs on your server after a successful upload
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("[UploadThing] Upload complete for userId:", metadata.userId);
      console.log("[UploadThing] File details:", file);

      // IMPORTANT: This is where we will trigger our RAG pipeline in the next step.
      // We will save the file details to our database here.

      return { uploadedBy: metadata.userId };
    }),
};