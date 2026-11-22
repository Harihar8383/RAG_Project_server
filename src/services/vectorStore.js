import { Pinecone } from "@pinecone-database/pinecone";

const UPSERT_BATCH = 100;
const DELETE_BATCH = 1000;

/**
 * Pinecone adapter. A record is { id, values, metadata } and the chunk text is kept in metadata.text.
 * Vectors of one document are removed by id (documentId:index), which works on every index type.
 */
export function createPineconeStore({ apiKey, indexName = "rag-documents", indexHost }) {
  const pinecone = new Pinecone({ apiKey });
  const index = indexHost ? pinecone.index(indexName, indexHost) : pinecone.index(indexName);

  return {
    async upsert(records) {
      for (let i = 0; i < records.length; i += UPSERT_BATCH) {
        await index.upsert(records.slice(i, i + UPSERT_BATCH));
      }
    },

    /** Returns [{ id, score, metadata }] for the nearest vectors that match the filter. */
    async query({ vector, topK, filter }) {
      const result = await index.query({ vector, topK, filter, includeMetadata: true });
      return (result.matches || []).map((m) => ({ id: m.id, score: m.score, metadata: m.metadata || {} }));
    },

    async deleteByIds(ids) {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        await index.deleteMany(ids.slice(i, i + DELETE_BATCH));
      }
    },
  };
}
