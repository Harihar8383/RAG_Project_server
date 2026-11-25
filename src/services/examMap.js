// The Exam Map compares syllabus lines with the notes. It reports how well a passage matches, never that a topic is
// covered: similar text can come from a contents page or a passing mention, so the user checks the shown passage.

export const MAX_TOPICS = 50;
export const MAX_TEXT = 10000;
export const LABELS = ["strong", "check", "none"];
const MAX_TOPIC_CHARS = 300;
const WORD_SHARE = 0.6;

const STOP_WORDS = new Set(
  ("a an and are as at be between brief briefly by can compare define describe differentiate discuss do does explain for " +
    "from give how in is it its list note notes of on or short state that the their them these this to what when where " +
    "which why with write").split(" ")
);
const LIST_MARKER = /^\s*(?:[-*•]+\s*|(?:q\s*)?\(?\d{1,3}[.):]\s+|\d+(?:\.\d+)+\.?\s+|\(?[a-z]\)\s+)/i;

/** One topic per line, without bullets or numbering, and without repeats. */
export function parseTopics(text) {
  const seen = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const topic = line.replace(LIST_MARKER, "").trim().slice(0, MAX_TOPIC_CHARS);
    if (topic.length >= 2 && !seen.has(topic.toLowerCase())) seen.set(topic.toLowerCase(), topic);
  }
  return [...seen.values()];
}

// Drops a plural "s", so "processes" and "process" or "threads" and "thread" count as the same word.
const singular = (word) => {
  if (word.length > 4 && /(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
};

export function keyTerms(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  return [...new Set(words.filter((w) => w.length >= 2 && !STOP_WORDS.has(w)).map(singular))];
}

/**
 * Picks the best candidate passage. "strong" needs both signals in one passage (similarity and most key words),
 * "check" needs one of them, otherwise "none".
 */
export function judge(terms, candidates, minScore) {
  const rated = candidates.map((c) => {
    const words = new Set(keyTerms(c.metadata.text));
    const matched = terms.filter((t) => words.has(t));
    const signals = Number(c.score >= minScore) + Number(terms.length > 0 && matched.length / terms.length >= WORD_SHARE);
    return { candidate: c, matched, signals, score: c.score };
  });
  rated.sort((a, b) => b.signals - a.signals || b.matched.length - a.matched.length || b.score - a.score);
  const best = rated[0];
  if (!best || best.signals === 0) return { label: "none", matched: best?.matched || [], score: best?.score ?? 0 };
  const { metadata } = best.candidate;
  return {
    label: best.signals === 2 ? "strong" : "check",
    matched: best.matched,
    score: best.score,
    documentId: metadata.documentId,
    fileName: metadata.fileName,
    page: metadata.page ?? null,
    passage: metadata.text,
  };
}
