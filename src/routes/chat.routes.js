import express from 'express';
import { requireAuth } from '@clerk/express';
import { getProjectChats, createChat } from '../controllers/chat.controllers.js';

// The `mergeParams: true` option allows us to access `projectId` from the parent router
const router = express.Router({ mergeParams: true });

router.use(requireAuth());

router.route('/')
  .get(getProjectChats)
  .post(createChat);

export default router;