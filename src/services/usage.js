import Usage from "../models/usage.models.js";

// Daily counters, so one user cannot spend the API quota that every user shares.
export const SHARED_USER = "000000000000000000000000"; // the row that counts calls of all users together

// Google resets daily quotas at midnight Pacific time, so the counters use the same day.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

/** Adds `amount` to today's counter. Answers false, and undoes the add, when the total would pass `limit`. */
export async function takeUsage(userId, field, amount, limit) {
  const filter = { user: userId, day: today() };
  const row = await Usage.findOneAndUpdate(filter, { $inc: { [field]: amount } }, { upsert: true, new: true });
  if (row[field] <= limit) return true;
  await Usage.updateOne(filter, { $inc: { [field]: -amount } });
  return false;
}

/** Gives back what a failed job took but did not use. */
export async function refundUsage(userId, field, amount) {
  if (!userId || amount <= 0) return;
  await Usage.updateOne({ user: userId, day: today() }, { $inc: { [field]: -amount } });
}

/** Charges one answer-model call to the user and to the shared limit. Returns a message when a limit is reached. */
export async function takeModelCall(userId, limits) {
  if (!(await takeUsage(userId, "questions", 1, limits.questions))) {
    return "You reached today's question limit. Try again tomorrow.";
  }
  if (!(await takeUsage(SHARED_USER, "answers", 1, limits.sharedAnswers))) {
    await refundUsage(userId, "questions", 1);
    return "The app reached today's shared answer limit. Try again tomorrow.";
  }
  return null;
}
