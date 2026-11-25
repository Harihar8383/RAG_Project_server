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

// The storage URL opens the file without a login, so it and the storage key stay on the server.
function publicDocument(doc) {
  // eslint-disable-next-line no-unused-vars
  const { url, key, contentHash, quiz, ...rest } = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return rest;
}

// @route POST /api/projects/:projectId/documents/:documentId/quiz
export const makeQuiz = async (req, res) => {
  const doc = await findOwnedDocument(req);
  if (doc.status !== "indexed") throw new HttpError(409, "Wait until the file is Ready.");
  res.status(200).json(await req.app.locals.services.quiz.get(doc, req.localUser._id));
};

// @route GET /api/projects/:projectId/documents
export const getProjectDocuments = async (req, res) => {
  const project = await findOwnedProject(req);
  const documents = await Document.find({ project: project._id }).sort({ createdAt: -1 });
  res.status(200).json(documents.map(publicDocument));
};

// @route DELETE /api/projects/:projectId/documents/:documentId
// Removes the vectors, the stored file and the record of one document.
export const deleteDocument = async (req, res) => {
  const doc = await findOwnedDocument(req);
  await req.app.locals.services.rag.deleteDocument(doc);
  res.status(200).json({ message: "Document deleted successfully." });
};

// @route POST /api/projects/:projectId/documents/:documentId/retry
// Queues a failed document again. The status change is atomic, so two quick clicks start only one job.
export const retryDocument = async (req, res) => {
  const doc = await findOwnedDocument(req);
  const claimed = await Document.findOneAndUpdate(
    { _id: doc._id, status: "failed" },
    { $set: { status: "uploaded" }, $unset: { failureReason: "" } }
  );
  if (!claimed) throw new HttpError(409, "Only a document that failed can be retried.");
  req.app.locals.services.rag.enqueue(doc._id);
  res.status(202).json({ message: "Processing started." });
};
