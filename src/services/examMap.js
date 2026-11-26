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

/** Edit distance, stopping early once it exceeds max. */
function withinEdits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

// Tolerates typos in longer words ("inheritence" finds "inheritance"); short words must match exactly.
const allowedEdits = (term) => (term.length >= 9 ? 2 : term.length >= 6 ? 1 : 0);

/** The passage word that matches each term, exactly or with a small typo, so the user sees the real spelling. */
export function matchTerms(terms, passageWords) {
  const words = [...new Set(passageWords)];
  const exact = new Set(words);
  return terms
    .map((t) => (exact.has(t) ? t : allowedEdits(t) && words.find((w) => withinEdits(t, w, allowedEdits(t)))))
    .filter(Boolean);
}

/**
 * Picks the best candidate passage. "strong": most key words appear in a passage that is also similar enough
 * (wordScore). "check": the key words alone, or a high similarity alone (minScore). Otherwise "none".
 */
export function judge(terms, candidates, minScore, wordScore = minScore) {
  const rank = { none: 0, check: 1, strong: 2 };
  const rated = candidates.map((c) => {
    const matched = matchTerms(terms, keyTerms(c.metadata.text));
    const hasWords = terms.length > 0 && matched.length / terms.length >= WORD_SHARE;
    const label = hasWords && c.score >= wordScore ? "strong" : hasWords || c.score >= minScore ? "check" : "none";
    return { candidate: c, matched, label, score: c.score };
  });
  rated.sort((a, b) => rank[b.label] - rank[a.label] || b.matched.length - a.matched.length || b.score - a.score);
  const best = rated[0];
  if (!best || best.label === "none") return { label: "none", matched: best?.matched || [], score: best?.score ?? 0 };
  const { metadata } = best.candidate;
  return {
    label: best.label,
    matched: best.matched,
    score: best.score,
    documentId: metadata.documentId,
    fileName: metadata.fileName,
    page: metadata.page ?? null,
    passage: metadata.text,
  };
}
