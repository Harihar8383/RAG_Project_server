import Usage from "../models/usage.models.js";

// Per-user daily counters, so one user cannot spend the API quota that every user shares. Days are UTC dates.
const today = () => new Date().toISOString().slice(0, 10);

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
