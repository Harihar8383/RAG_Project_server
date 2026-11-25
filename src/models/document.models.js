import mongoose from "mongoose";

export const DOCUMENT_STATUSES = ["uploaded", "processing", "indexed", "failed"];

const documentSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    key: {
      // The key from UploadThing, used to delete the stored file
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: DOCUMENT_STATUSES,
      default: "uploaded",
    },
    // A short, safe reason that the interface shows when status is "failed"
    failureReason: {
      type: String,
    },
    // Number of chunks written to the vector index, used to remove the vectors of this document
    chunkCount: {
      type: Number,
      default: 0,
    },
    // Chunks already embedded and stored, so a retry resumes instead of starting again
    indexedChunks: {
      type: Number,
      default: 0,
    },
    // SHA-256 of the file bytes, used to skip a file that is already in the project
    contentHash: {
      type: String,
    },
  },
  { timestamps: true }
);
documentSchema.index({ project: 1, createdAt: -1 });
documentSchema.index({ status: 1 });

const Document = mongoose.model("Document", documentSchema);

export default Document;
