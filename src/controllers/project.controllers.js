import Project from "../models/project.models.js";
import { findOwnedProject } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";

const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// @route GET /api/projects
export const getProjects = async (req, res) => {
  const projects = await Project.find({ user: req.localUser._id }).sort({ createdAt: -1 });
  res.status(200).json(projects);
};

// @route POST /api/projects
export const createProject = async (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) throw new HttpError(400, "Project name is required.");
  const description = clean(req.body?.description, 500);
  const project = await Project.create({ name, description, user: req.localUser._id });
  res.status(201).json(project);
};

// @route GET /api/projects/:projectId
export const getProjectById = async (req, res) => {
  res.status(200).json(await findOwnedProject(req));
};

// @route DELETE /api/projects/:projectId
// Removes the vectors, the files and every record of the project.
export const deleteProject = async (req, res) => {
  const project = await findOwnedProject(req);
  await req.app.locals.services.rag.deleteProject(project);
  res.status(200).json({ message: "Project deleted successfully." });
};
