import Chat from "../models/chat.models.js";
import Message from "../models/message.models.js";
import { assertObjectId, findOwnedProject } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";
import { log, safeError } from "../utils/log.js";
import { NOT_FOUND_TEXT } from "../services/rag.js";

const MAX_QUESTION = 4000;

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

  const { rag } = req.app.locals.services;
  await Message.create({ chat: chat._id, role: "user", content: question });

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

  let answer = "";
  let sources = [];
  try {
    send({ status: "retrieving" });
    const retrieved = await rag.retrieveContext({
      query: question,
      ownerId: req.localUser._id,
      projectId: project._id,
    });
    sources = retrieved.sources;

    send({ status: "generating" });
    if (sources.length === 0) {
      // Nothing in the project matches, so the model is not asked to answer from an empty context.
      answer = NOT_FOUND_TEXT;
      send({ chunk: answer });
    } else {
      for await (const piece of rag.streamAnswer({ context: retrieved.context, question, signal: controller.signal })) {
        if (clientLeft) break;
        answer += piece;
        send({ chunk: piece });
      }
    }

    if (clientLeft) {
      await Message.create({ chat: chat._id, role: "assistant", content: answer, sources, incomplete: true });
      return;
    }
    send({ sources });
    await Message.create({ chat: chat._id, role: "assistant", content: answer, sources, incomplete: false });
    send({ done: true });
    res.end();
  } catch (err) {
    log.error("chat answer failed", { chatId: String(chat._id), ...safeError(err) });
    try {
      await Message.create({ chat: chat._id, role: "assistant", content: answer, sources, incomplete: true });
    } catch {
      // the error event below still tells the client
    }
    send({ error: "The answer could not be completed." });
    res.end();
  }
};
