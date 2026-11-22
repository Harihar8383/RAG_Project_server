import { HttpError } from "../utils/httpError.js";
import { log, safeError } from "../utils/log.js";

export function notFound(_req, res) {
  res.status(404).json({ error: "Route not found." });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (res.headersSent) return res.end();
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body." });
  if (err?.name === "CastError" || err?.name === "ValidationError") {
    return res.status(400).json({ error: "The request contains an invalid value." });
  }
  log.error("unhandled error", safeError(err));
  res.status(500).json({ error: "Server error." });
}
