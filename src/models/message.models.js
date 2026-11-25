import mongoose from "mongoose";

const sourceSchema = new mongoose.Schema(
  {
    label: { type: String }, // S1 to S5
    fileName: { type: String },
    page: { type: Number },
    text: { type: String }, // the cited passage, shown when the user opens the source
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant"], // The role can only be 'user' or 'assistant'
      required: true,
    },
    content: {
      type: String,
      // An interrupted answer can be empty, a user question cannot
      required: [function requiredForUser() { return this.role === "user"; }, "Message content is required."],
      default: "",
    },
    // The source chunks that an assistant answer was built from
    sources: {
      type: [sourceSchema],
      default: undefined,
    },
    // True when the stream ended before the answer was complete
    incomplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);
messageSchema.index({ chat: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
