import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
  },
  role: {
    type: String,
    enum: ['user', 'assistant'], // The role can only be 'user' or 'assistant'
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  // We will add citations later
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

export default Message;