import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    required: true,
    unique: true,
  },
  email: { // We can store other user details if needed
    type: String,
    required: true,
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;