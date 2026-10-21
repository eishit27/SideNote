# SideNote branch backend

This local backend turns the preview (not the unpacked extension) into a persistent, anchored-subchat prototype. It uses only Python's standard library and SQLite; there are no package installs. The API stores the anchor once and stores only the side-thread turns. Model credentials stay in the backend process, not in browser JavaScript or extension storage.

## Start

From the project root, run both the preview server and API together:

```sh
./start-demo.sh
```

Open `http://127.0.0.1:8765/preview.html`. The static preview and API bind to loopback only; the static server serves only the standalone preview page and demo video, never the workspace or backend files. The API listens on `127.0.0.1:8766` and creates `sidenote.sqlite3` beside the server. Do not open the HTML directly as `file://`; browsers block its API calls because that origin is not the configured local HTTP origin. Stop both servers with Ctrl+C.

The preview and anchored thread history work without provider configuration. To receive actual model replies, set environment variables before starting the server:

```sh
export SIDENOTE_API_KEY='your-provider-key'
export SIDENOTE_MODEL='your-model-name'
export SIDENOTE_API_URL='https://api.openai.com/v1/chat/completions'
./sidenote-extension/start-demo.sh
```

Run these commands from the project root. The startup script launches both local servers; it does not install or configure a provider key for you.

`SIDENOTE_API_URL` must be the final OpenAI-compatible streaming chat-completions endpoint; provider redirects are rejected so credentials are not forwarded to a redirect target. Set the URL and model supported by your provider. Keep the key in the server environment; do not put it in `preview.html` or commit it. The server rejects non-loopback bind addresses, verifies the Host and Origin headers, accepts JSON writes only, and avoids logging query strings or branch identifiers. Do not expose it publicly as-is: a deployed service still needs authentication, rate limits, quotas, tenant isolation, and managed secrets.

Optional settings: `SIDENOTE_HOST` (default `127.0.0.1`), `SIDENOTE_PORT` (default `8766`), `SIDENOTE_DB` (default this directory's SQLite file), and `SIDENOTE_CORS_ORIGIN` (default `http://127.0.0.1:8765`).

## API shape

- `GET /api/health` — backend/provider status.
- `POST /api/subchats/resolve` — find or create the branch anchored to `(conversation_id, parent_message_id, anchor_block_id, normalized quote hash)`; returns stored turns.
- `GET /api/subchats/{id}` — load branch metadata and turns.
- `POST /api/subchats/{id}/turns` — append a user question, stream provider deltas as server-sent events, then persist the completed assistant response.
- `DELETE /api/subchats/{id}/turns` — clear branch turns but keep the anchor.
- `DELETE /api/subchats/{id}` — delete the branch and its turns.
- `DELETE /api/conversations/{conversation_id}/subchats` — delete all branches when a native host deletes the parent conversation.

The preview uses stable sample conversation/message/block IDs. A native AI product should supply its own canonical IDs, authorization boundary, retention hooks, model session, and safe context retrieval. This local SQLite backend is an executable architecture prototype, not a production multi-tenant service.

## Memory and context

The database does not copy the parent transcript. It stores the selected passage, a bounded nearby context window, anchor IDs, and side-thread turns. On POSIX systems the database file is created with owner-only permissions. It retains at most 200 turns per branch and 500 branches per demo conversation; users can clear turns or delete a branch. Only the latest 24 turns are sent to the model. A native host must also call `DELETE /api/conversations/{conversation_id}/subchats` when its parent chat is deleted. This demo has no user accounts or tenant isolation and is intentionally loopback-only. SQLite WAL mode supports concurrent readers while the threaded HTTP server handles requests. Model KV cache is owned by the configured inference provider and is not retained or shared by this service.
