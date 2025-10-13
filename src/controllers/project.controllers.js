import Project from '../models/project.models.js';
import User from '../models/user.models.js';
import { getAuth } from '@clerk/express';

// @desc    Get all projects for the logged-in user
// @route   GET /api/projects
// @access  Private

export const getProjects = async (req, res) => {
  try {
    // ✅ Use getAuth(req)
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: No user ID found." });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const projects = await Project.find({ user: user._id }).sort({ createdAt: -1 });
    res.status(200).json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Server error while fetching projects." });
  }
};



// @desc    Create a new project
// @route   POST /api/projects
// @access  Private
export const createProject = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Project name is required." });
    }

    // ✅ Use getAuth(req)
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: No user ID found." });
    }

    let user = await User.findOne({ clerkId: userId });
    if (!user) {
      user = await User.create({
        clerkId: userId,
        email: `${userId}@example.com`,
      });
    }

    const project = await Project.create({
      name,
      description,
      user: user._id,
    });

    res.status(201).json(project);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Server error while creating project." });
  }
};

export const getProjectById = async (req, res) => {
  try {
    // ✅ Use getAuth(req) instead of req.auth.userId
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: No user ID found." });
    }

    // Find the user in your DB using Clerk's userId
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Find the project owned by that user
    const project = await Project.findOne({
      _id: req.params.id,
      user: user._id,
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    res.status(200).json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Server error." });
  }
};