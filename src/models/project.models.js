import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // This creates a reference to the User model
    required: true,
  }
}, { timestamps: true });
projectSchema.index({ user: 1, createdAt: -1 });

const Project = mongoose.model('Project', projectSchema);

export default Project;