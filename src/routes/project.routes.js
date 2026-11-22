import express from "express";
import { requireUser, loadUser } from "../middleware/auth.js";
import { getProjects, createProject, getProjectById, deleteProject } from "../controllers/project.controllers.js";

const router = express.Router();

// All routes in this file require a signed-in user and answer 401 as JSON otherwise
router.use(requireUser, loadUser);

router.route("/").get(getProjects).post(createProject);

router.route("/:projectId").get(getProjectById).delete(deleteProject);

export default router;
