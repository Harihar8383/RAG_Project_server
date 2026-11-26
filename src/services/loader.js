import path from "node:path";
import { createHash } from "node:crypto";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".csv", ".txt"];

export class UnsupportedFileTypeError extends Error {
  constructor() {
    super("This file type is not supported.");
    this.name = "UnsupportedFileTypeError";
  }
}

export const isSupportedName = (name) => SUPPORTED_EXTENSIONS.includes(path.extname(String(name || "")).toLowerCase());

/**
 * Downloads a stored file and returns { pages: [{ pageContent, page }], hash }. The hash is the SHA-256 of the bytes.
 * The PDF loader returns one entry per page. The other loaders return the whole text with page null.
 */
export function createDocumentLoader({ fetchImpl = fetch } = {}) {
  return {
    async load({ url, name }) {
      const ext = path.extname(String(name || "")).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) throw new UnsupportedFileTypeError();

      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`The stored file could not be downloaded (status ${res.status}).`);
      const blob = await res.blob();
      const hash = createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");

      let docs;
      if (ext === ".pdf") {
        const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
        docs = await new PDFLoader(blob, { splitPages: true }).load();
      } else if (ext === ".docx") {
        const { DocxLoader } = await import("@langchain/community/document_loaders/fs/docx");
        docs = await new DocxLoader(blob).load();
      } else if (ext === ".csv") {
        const { CSVLoader } = await import("@langchain/community/document_loaders/fs/csv");
        // One entry per row would make one chunk per row, so the rows are joined and split like any other text.
        const rows = await new CSVLoader(blob).load();
        docs = [{ pageContent: rows.map((r) => r.pageContent).join("\n\n"), metadata: {} }];
      } else {
        const { TextLoader } = await import("langchain/document_loaders/fs/text");
        docs = await new TextLoader(blob).load();
      }
      const pages = docs
        .map((d) => ({ pageContent: d.pageContent, page: d.metadata?.loc?.pageNumber ?? null }))
        .filter((d) => d.pageContent && d.pageContent.trim());
      return { pages, hash };
    },
  };
}
