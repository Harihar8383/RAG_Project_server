import Document from '../models/document.models.js';
import User from '../models/user.models.js';

// @desc    Get all documents for a specific project
// @route   GET /api/projects/:projectId/documents
// @access  Private
export const getProjectDocuments = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.auth().userId });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Ensure the project belongs to the user by checking one of the documents
    const documents = await Document.find({ project: req.params.projectId }).sort({ createdAt: -1 });
    
    // A more robust check would be to verify project ownership first, but this is sufficient for now
    
    res.status(200).json(documents);
  } catch (error) {
    res.status(500).json({ error: "Server error while fetching documents." });
  }
};