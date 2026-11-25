import mongoose from "mongoose";

// How much of the shared API quota one user spent on one UTC day.
const usageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // YYYY-MM-DD
    questions: { type: Number, default: 0 },
    chunks: { type: Number, default: 0 },
    mapItems: { type: Number, default: 0 },
    answers: { type: Number, default: 0 }, // used by the shared row only
  },
  { timestamps: true }
);
usageSchema.index({ user: 1, day: 1 }, { unique: true });

const Usage = mongoose.model("Usage", usageSchema);

export default Usage;
