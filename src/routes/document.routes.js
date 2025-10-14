import express from 'express';
import { requireAuth } from '@clerk/express';
import { getProjectDocuments } from '../controllers/document.controllers.js';

const router = express.Router({ mergeParams: true });

router.use(requireAuth());

router.route('/').get(getProjectDocuments);

export default router;