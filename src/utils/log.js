// Logging helpers. Messages carry identifiers and counts only. File names, storage URLs, document text and
// credentials never appear in a log line.

const URL_PATTERN = /https?:\/\/\S+/gi;

export function redact(text) {
  return String(text ?? "").replace(URL_PATTERN, "[url]");
}

/** A short, safe description of an error for logs and for the document failure reason. */
export function safeError(err) {
  return {
    name: err?.name || "Error",
    code: err?.code,
    message: redact(err?.message).slice(0, 160),
  };
}

const write = (level, message, meta) => {
  const line = meta ? `${message} ${JSON.stringify(meta)}` : message;
  // eslint-disable-next-line no-console
  console[level](`[server] ${line}`);
};

export const log = {
  info: (message, meta) => write("log", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
