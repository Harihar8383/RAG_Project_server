import mongoose from "mongoose";
import { LABELS } from "../services/examMap.js";

const itemSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  label: { type: String, enum: LABELS, required: true },
  override: { type: String, enum: [...LABELS, null] }, // the user's correction; the original label is kept
  terms: [String],
  matched: [String],
  score: Number,
  documentId: String,
  fileName: String,
  page: Number,
  passage: String,
});

const examMapSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [itemSchema],
    skippedFiles: [String], // files that were not ready, so they were not searched
  },
  { timestamps: true }
);
examMapSchema.index({ project: 1, createdAt: -1 });

const ExamMap = mongoose.model("ExamMap", examMapSchema);

export default ExamMap;
