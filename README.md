# Second Brain server

Express API for Second Brain (the Verix interface). It stores projects, documents and conversations in MongoDB, indexes documents in Pinecone with Gemini embeddings, and answers questions with streamed, source-labelled responses.

## Setup

1. Install Node 20 or newer, then run `npm install --legacy-peer-deps`.
2. Copy `.env.example` to `.env` and fill in every value.
3. In Pinecone, create the index named in `PINECONE_INDEX` with 768 dimensions and the cosine metric.
4. Run `npm run dev`. The server listens on `PORT` (default 8000). `GET /api/health` answers 200. On a local machine use `npm run dev`, which sets `NODE_ENV=development`. In that mode the server forwards the UploadThing completion callback itself. With `npm start` and no `NODE_ENV`, UploadThing tries to call `localhost` from its own servers and the document never leaves the queued state.

### Quota settings (optional)

| Variable | Default | Meaning |
|---|---|---|
| `DAILY_QUESTION_LIMIT` | 100 | Questions per user per UTC day. More get a 429 reply |
| `DAILY_CHUNK_LIMIT` | 2000 | Chunks one user may embed per UTC day |
| `EMBEDDING_TOKENS_PER_MINUTE` | 30000 | Document batches are paced to stay under this. Set it to your real limit from AI Studio |

A file may have at most 2000 chunks. Files are indexed one at a time. On the free Gemini tier, Google may use and review what is sent, so do not upload sensitive files there, and use the paid tier before you offer the app in the EEA, Switzerland or the UK.

## API

All routes except `/api/health` need a Clerk session token in the `Authorization: Bearer` header. A missing or invalid token gets a 401 JSON reply.

| Method and path | Purpose |
|---|---|
| `GET /api/projects`, `POST /api/projects` | List and create projects |
| `GET /api/projects/:projectId`, `DELETE /api/projects/:projectId` | Read a project, or delete it with its documents, vectors, files, chats and messages |
| `GET /api/projects/:projectId/documents` | List documents with `status`, `failureReason` and `chunkCount` |
| `DELETE /api/projects/:projectId/documents/:documentId` | Delete the vectors, the stored file and the record |
| `POST /api/projects/:projectId/documents/:documentId/retry` | Index a failed document again |
| `GET`, `POST /api/projects/:projectId/chats` | List and create conversations |
| `DELETE /api/projects/:projectId/chats/:chatId` | Delete a conversation and its messages |
| `GET /api/projects/:projectId/chats/:chatId/messages` | Stored history, including sources |
| `POST /api/projects/:projectId/chats/:chatId/messages` | Ask a question. The reply is a server-sent event stream |
| `/api/uploadthing` | File upload (PDF 32 MB, DOCX 16 MB, text and CSV 4 MB, up to 5 files) |

The question stream sends `status` (`retrieving`, then `generating`), `chunk`, `sources`, `done` and `error` events.

## Document states

`uploaded`, then `processing`, then `indexed`. A failure sets `failed` with a short reason, and only a failed document can be retried. Chunks are stored in batches of 100, and a retry resumes after the last stored batch. Chunk ids are `documentId:index`, so vectors are never duplicated. Only `indexed` documents can answer questions. When the server starts, documents left `uploaded` or `processing` by a stopped server become `failed` with "Indexing was interrupted". A file whose bytes are already in the project fails with "The same file is already in this project" and is not embedded again. The document list never returns the storage `url` or `key`.

The server starts with a warning when `NODE_ENV` is not set. Set `NODE_ENV=production` on a live server.

## Tests

`npm test` runs the whole suite offline. It uses the real Express app, routers, controllers and Mongoose validation with in-memory stand-ins for MongoDB, Pinecone, Gemini, UploadThing and Clerk, so it needs no keys or network.

`npm run test:live` runs the same journey against the real services. Start the server first with a complete `.env`. The script creates two throwaway Clerk users through the Clerk Backend API, uploads a sample text file plus a real PDF, DOCX and CSV from `scripts/fixtures/`, waits for indexing, asks questions, checks source labels and cross-user isolation, deletes the document and the project, and removes the users. It prints one PASS or FAIL line per step.

## Manual check in the browser

1. Sign up, create a project, and open it.
2. Upload a PDF. The row shows Queued, Processing, then Ready.
3. Start a conversation and ask about the file. The answer streams with citations like `[S1]`, and a Sources list shows the file and page.
4. Ask about something not in the file. The reply says the documents do not contain it.
5. Reload the page. The conversation and its sources are still there.
6. Delete the document, then ask the same question. No source appears.
7. Sign in as a second user. Neither the project nor its data is visible.
