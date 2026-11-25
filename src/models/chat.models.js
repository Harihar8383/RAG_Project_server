import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  }
}, { timestamps: true });
chatSchema.index({ project: 1, user: 1, createdAt: -1 });

const Chat = mongoose.model('Chat', chatSchema);

export default Chat;