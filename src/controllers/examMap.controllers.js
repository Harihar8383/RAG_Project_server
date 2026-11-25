import ExamMap from "../models/examMap.models.js";
import Document from "../models/document.models.js";
import { assertObjectId, findOwnedProject } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";
import { log, safeError } from "../utils/log.js";
import { dailyLimits, examMapMinScore } from "../config/env.js";
import { LABELS, MAX_TEXT, MAX_TOPICS, judge, keyTerms, parseTopics } from "../services/examMap.js";
import { takeUsage, refundUsage } from "../services/usage.js";
import { TOP_K } from "../services/rag.js";

const SEARCHES_AT_ONCE = 10;

// @route GET /api/projects/:projectId/exam-map  (the latest map, or null)
export const getExamMap = async (req, res) => {
  const project = await findOwnedProject(req);
  const [map] = await ExamMap.find({ project: project._id }).sort({ createdAt: -1 }).limit(1);
  res.status(200).json(map || null);
};

// @route POST /api/projects/:projectId/exam-map  { text }
export const createExamMap = async (req, res) => {
  const project = await findOwnedProject(req);
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (text.length > MAX_TEXT) throw new HttpError(400, `The text is limited to ${MAX_TEXT} characters.`);
  const topics = parseTopics(text);
  if (!topics.length) throw new HttpError(400, "Paste at least one topic or question, one per line.");
  if (topics.length > MAX_TOPICS) throw new HttpError(400, `Use up to ${MAX_TOPICS} lines at a time. You sent ${topics.length}.`);

  const documents = await Document.find({ project: project._id });
  if (!documents.some((d) => d.status === "indexed")) throw new HttpError(400, "Upload a file and wait until it is Ready.");

  const userId = req.localUser._id;
  if (!(await takeUsage(userId, "mapItems", topics.length, dailyLimits().mapItems))) {
    throw new HttpError(429, "You reached today's Exam Map limit. Try again tomorrow.");
  }

  const { embeddings, rag } = req.app.locals.services;
  const items = [];
  try {
    const vectors = await embeddings.embedQueries(topics);
    for (let i = 0; i < topics.length; i += SEARCHES_AT_ONCE) {
      const batch = topics.slice(i, i + SEARCHES_AT_ONCE).map(async (topic, j) => {
        const matches = await rag.search({ vector: vectors[i + j], ownerId: userId, projectId: project._id, limit: TOP_K });
        const terms = keyTerms(topic);
        return { topic, terms, ...judge(terms, matches, examMapMinScore()) };
      });
      items.push(...(await Promise.all(batch)));
    }
  } catch (err) {
    await refundUsage(userId, "mapItems", topics.length);
    log.warn("exam map failed", safeError(err));
    if (/\b429\b|daily limit/i.test(err?.message || "")) throw new HttpError(429, "The search service reached its usage limit. Try again later.");
    throw new HttpError(502, "The Exam Map could not be made. Try again.");
  }

  // A file deleted while the topics were searched must not leave its text in the saved map.
  // shortcut: a delete in the few milliseconds before the save below is not caught; use a transaction if that matters.
  const live = new Set((await Document.find({ project: project._id, status: "indexed" })).map((d) => String(d._id)));
  const saved = items.map((item) =>
    !item.documentId || live.has(item.documentId) ? item : { topic: item.topic, terms: item.terms, label: "none", matched: [] }
  );

  // Only the latest map of a project is kept.
  await ExamMap.deleteMany({ project: project._id });
  const map = await ExamMap.create({
    project: project._id,
    user: userId,
    items: saved,
    skippedFiles: documents.filter((d) => d.status !== "indexed").map((d) => d.name),
  });
  res.status(201).json(map);
};

// @route PATCH /api/projects/:projectId/exam-map/:mapId/items/:itemId  { label: "strong" | "check" | "none" | null }
export const correctExamMapItem = async (req, res) => {
  const project = await findOwnedProject(req);
  const { mapId, itemId } = req.params;
  assertObjectId(mapId, "map id");
  assertObjectId(itemId, "item id");
  const label = req.body?.label ?? null;
  if (label !== null && !LABELS.includes(label)) throw new HttpError(400, "Unknown label.");
  const result = await ExamMap.updateOne(
    { _id: mapId, project: project._id, "items._id": itemId },
    { $set: { "items.$.override": label } }
  );
  if (!result.matchedCount) throw new HttpError(404, "Exam Map item not found.");
  res.status(200).json({ override: label });
};
