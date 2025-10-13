import Chat from '../models/chat.models.js';
import User from '../models/user.models.js';

// @desc    Get all chats for a specific project
// @route   GET /api/projects/:projectId/chats
// @access  Private
export const getProjectChats = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.auth.userId });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const chats = await Chat.find({ 
      project: req.params.projectId, 
      user: user._id 
    }).sort({ createdAt: -1 });

    res.status(200).json(chats);
  } catch (error) {
    res.status(500).json({ error: "Server error while fetching chats." });
  }
};

// @desc    Create a new chat in a project
// @route   POST /api/projects/:projectId/chats
// @access  Private
export const createChat = async (req, res) => {
    try {
        const { title } = req.body;
        const { projectId } = req.params;

        if (!title) {
            return res.status(400).json({ error: "Chat title is required." });
        }

        const user = await User.findOne({ clerkId: req.auth.userId });
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        const newChat = await Chat.create({
            title,
            project: projectId,
            user: user._id
        });

        res.status(201).json(newChat);
    } catch (error) {
        res.status(500).json({ error: "Server error while creating chat." });
    }
};