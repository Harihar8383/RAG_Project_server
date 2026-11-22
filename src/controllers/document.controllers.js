import Document from "../models/document.models.js";
import { assertObjectId, findOwnedProject } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";

async function findOwnedDocument(req) {
  const project = await findOwnedProject(req);
  assertObjectId(req.params.documentId, "document id");
  const doc = await Document.findOne({ _id: req.params.documentId, project: project._id });
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

// @route GET /api/projects/:projectId/documents
export const getProjectDocuments = async (req, res) => {
  const project = await findOwnedProject(req);
  const documents = await Document.find({ project: project._id }).sort({ createdAt: -1 });
  res.status(200).json(documents);
};

// @route DELETE /api/projects/:projectId/documents/:documentId
// Removes the vectors, the stored file and the record of one document.
export const deleteDocument = async (req, res) => {
  const doc = await findOwnedDocument(req);
  await req.app.locals.services.rag.deleteDocument(doc);
  res.status(200).json({ message: "Document deleted successfully." });
};

// @route POST /api/projects/:projectId/documents/:documentId/retry
// Starts processing again for a document that failed. A retry replaces earlier vectors and creates no duplicates.
export const retryDocument = async (req, res) => {
  const doc = await findOwnedDocument(req);
  if (doc.status === "processing") throw new HttpError(409, "The document is already being processed.");
  const { rag } = req.app.locals.services;
  setImmediate(() => rag.processDocument(doc._id).catch(() => {}));
  res.status(202).json({ message: "Processing started." });
};
