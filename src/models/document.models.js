import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  key: { // The key from UploadThing, for potential future operations like deletion
    type: String,
    required: true,
    unique: true,
  },
  // We will add processing status later
}, { timestamps: true });

const Document = mongoose.model('Document', documentSchema);

export default Document;