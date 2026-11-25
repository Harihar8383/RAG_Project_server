import Chat from "../models/chat.models.js";
import Message from "../models/message.models.js";
import { assertObjectId, findOwnedProject } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";
import { log, safeError } from "../utils/log.js";
import { dailyLimits } from "../config/env.js";
import { NOT_FOUND_TEXT, citedLabels } from "../services/rag.js";
import { takeUsage } from "../services/usage.js";

const MAX_QUESTION = 4000;
const ANSWER_IDLE_MS = 45000;
const HISTORY_MESSAGES = 6;
const HISTORY_CHARS = 1000;
const DEFAULT_TITLE = /^Conversation \d+$/;

// The message the user sees. It names a usage limit or a stall, and hides every other detail of the failure.
function answerErrorText(err) {
  const text = String(err?.message || "");
  if (/AnswerStalled/.test(text)) return "The answer service did not respond in time. Try again in a moment.";
  if (/\b429\b|quota|rate limit|RESOURCE_EXHAUSTED|daily limit/i.test(text)) {
    return "The answer service has reached its usage limit. Try again later.";
  }
  return "The answer could not be completed.";
}

async function findOwnedChat(req) {
  const project = await findOwnedProject(req);
  assertObjectId(req.params.chatId, "chat id");
  const chat = await Chat.findOne({ _id: req.params.chatId, project: project._id, user: req.localUser._id });
  if (!chat) throw new HttpError(404, "Chat not found.");
  return { project, chat };
}

// @route GET /api/projects/:projectId/chats
export const getProjectChats = async (req, res) => {
  const project = await findOwnedProject(req);
  const chats = await Chat.find({ project: project._id, user: req.localUser._id }).sort({ createdAt: -1 });
  res.status(200).json(chats);
};

// @route POST /api/projects/:projectId/chats
export const createChat = async (req, res) => {
  const project = await findOwnedProject(req);
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
  if (!title) throw new HttpError(400, "Chat title is required.");
  const chat = await Chat.create({ title, project: project._id, user: req.localUser._id });
  res.status(201).json(chat);
};

// @route DELETE /api/projects/:projectId/chats/:chatId
export const deleteChat = async (req, res) => {
  const { chat } = await findOwnedChat(req);
  await req.app.locals.services.rag.deleteChat(chat);
  res.status(200).json({ message: "Chat deleted successfully." });
};

// @route GET /api/projects/:projectId/chats/:chatId/messages
export const getChatMessages = async (req, res) => {
  const { chat } = await findOwnedChat(req);
  const messages = await Message.find({ chat: chat._id }).sort({ createdAt: 1 });
  res.status(200).json(messages);
};

// @route POST /api/projects/:projectId/chats/:chatId/messages
// Saves the question, then streams server-sent events: retrieving, generating, chunk..., sources, done (or error).
export const createChatMessage = async (req, res) => {
  const { project, chat } = await findOwnedChat(req);
  const question = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!question) throw new HttpError(400, "Message content is required.");
  if (question.length > MAX_QUESTION) throw new HttpError(400, `Message content is limited to ${MAX_QUESTION} characters.`);
  if (!(await takeUsage(req.localUser._id, "questions", 1, dailyLimits().questions))) {
    throw new HttpError(429, "You reached today's question limit. Try again tomorrow.");
  }

  const { rag } = req.app.locals.services;
  // The last few turns, oldest first, so a follow-up such as "and for digital items?" keeps its meaning.
  const history = (await Message.find({ chat: chat._id }).sort({ createdAt: -1 }).limit(HISTORY_MESSAGES))
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));
  const previousQuestion = history.filter((m) => m.role === "user").pop()?.content;

  await Message.create({ chat: chat._id, role: "user", content: question });
  if (history.length === 0 && DEFAULT_TITLE.test(chat.title)) {
    await Chat.updateOne({ _id: chat._id }, { $set: { title: question.slice(0, 60) } });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (payload) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const controller = new AbortController();
  let clientLeft = false;
  res.on("close", () => {
    if (!res.writableFinished) {
      clientLeft = true;
      controller.abort();
    }
  });

  // If the embedding service, the vector index or the model stops answering, abort after a quiet period
  // so that the user sees an error instead of a spinner that never ends.
  const idleMs = req.app.locals.answerIdleMs ?? ANSWER_IDLE_MS;
  let stalled = false;
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, idleMs);
  };
  const stalledError = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error(stalled ? "AnswerStalled" : "AbortError")));
  });
  stalledError.catch(() => {});

  const startedAt = Date.now();
  let answer = "";
  let sources = [];
  // Only the sources the answer cites are shown and stored.
  const usedSources = () => {
    const cited = citedLabels(answer);
    return sources.filter((s) => cited.has(s.label));
  };
  try {
    resetIdle();
    send({ status: "retrieving" });
    const retrieved = await Promise.race([
      rag.retrieveContext({
        query: previousQuestion ? `${previousQuestion}\n${question}` : question,
        ownerId: req.localUser._id,
        projectId: project._id,
      }),
      stalledError,
    ]);
    resetIdle();
    log.info("chat retrieval done", { chatId: String(chat._id), ms: Date.now() - startedAt, sources: retrieved.sources.length });
    sources = retrieved.sources;

    send({ status: "generating" });
    if (sources.length === 0) {
      // Nothing in the project matches, so the model is not asked to answer from an empty context.
      answer = NOT_FOUND_TEXT;
      send({ chunk: answer });
    } else {
      for await (const piece of rag.streamAnswer({ context: retrieved.context, question, history, signal: controller.signal })) {
        if (clientLeft) break;
        resetIdle();
        if (!answer) log.info("chat first token", { chatId: String(chat._id), ms: Date.now() - startedAt });
        answer += piece;
        send({ chunk: piece });
      }
    }

    clearTimeout(idleTimer);
    if (stalled) throw new Error("AnswerStalled");
    if (clientLeft) {
      await Message.create({ chat: chat._id, role: "assistant", content: answer, sources: usedSources(), incomplete: true });
      return;
    }
    const used = usedSources();
    send({ sources: used });
    await Message.create({ chat: chat._id, role: "assistant", content: answer, sources: used, incomplete: false });
    send({ done: true });
    res.end();
  } catch (err) {
    clearTimeout(idleTimer);
    log.error("chat answer failed", { chatId: String(chat._id), ...safeError(err) });
    try {
      await Message.create({ chat: chat._id, role: "assistant", content: answer, sources: usedSources(), incomplete: true });
    } catch {
      // the error event below still tells the client
    }
    send({ error: answerErrorText(err) });
    res.end();
  }
};
