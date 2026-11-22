import express from "express";
import { requireUser, loadUser } from "../middleware/auth.js";
import {
  getProjectChats,
  createChat,
  deleteChat,
  getChatMessages,
  createChatMessage,
} from "../controllers/chat.controllers.js";

// The `mergeParams: true` option allows us to access `projectId` from the parent router
const router = express.Router({ mergeParams: true });

router.use(requireUser, loadUser);

router.route("/").get(getProjectChats).post(createChat);
router.route("/:chatId").delete(deleteChat);
router.route("/:chatId/messages").get(getChatMessages).post(createChatMessage);

export default router;
