import path from "node:path";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".csv", ".txt"];

export class UnsupportedFileTypeError extends Error {
  constructor() {
    super("This file type is not supported.");
    this.name = "UnsupportedFileTypeError";
  }
}

export const isSupportedName = (name) => SUPPORTED_EXTENSIONS.includes(path.extname(String(name || "")).toLowerCase());

/**
 * Downloads a stored file and returns its text as [{ pageContent, page }].
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

      let docs;
      if (ext === ".pdf") {
        const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
        docs = await new PDFLoader(blob, { splitPages: true }).load();
      } else if (ext === ".docx") {
        const { DocxLoader } = await import("@langchain/community/document_loaders/fs/docx");
        docs = await new DocxLoader(blob).load();
      } else if (ext === ".csv") {
        const { CSVLoader } = await import("@langchain/community/document_loaders/fs/csv");
        docs = await new CSVLoader(blob).load();
      } else {
        const { TextLoader } = await import("langchain/document_loaders/fs/text");
        docs = await new TextLoader(blob).load();
      }
      return docs
        .map((d) => ({ pageContent: d.pageContent, page: d.metadata?.loc?.pageNumber ?? null }))
        .filter((d) => d.pageContent && d.pageContent.trim());
    },
  };
}
