import express from 'express';
import { requireAuth } from '@clerk/express';
import { getProjects, createProject, getProjectById } from '../controllers/project.controllers.js';

const router = express.Router();

// All routes in this file will be protected
router.use(requireAuth());

router.route('/')
  .get(getProjects)
  .post(createProject);

router.route('/:id')
  .get(getProjectById);

export default router;