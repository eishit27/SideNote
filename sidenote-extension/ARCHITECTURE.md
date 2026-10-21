# SideNote native architecture

## Core idea

Treat a contextual follow-up as a **branch from an existing answer**, not as another message appended to the main transcript and not as a copied transcript. The branch stores a pointer to its source and only its own new turns. The main conversation stays unchanged; an extension can copy a branch summary, while a native host can promote it through its own conversation API.

The browser extension in this folder is an adoption bridge. It approximates anchors from visible page content because third-party pages do not expose stable internal IDs. A first-party product should use the branch model below.

## Data model

```text
Conversation
  id
  root_node_id

MessageNode
  id
  parent_node_id        // previous node in the main branch
  role
  content_ref           // content already stored by the host
  rendered_blocks[]     // stable block IDs from the answer AST

Subchat
  id
  conversation_id
  parent_message_id     // shared history stops here
  anchor_block_id       // the selected topic or message block
  quote_start, quote_end // optional canonical text offsets
  quote_hash             // detect edits and re-anchor safely
  turns[]                // only user/assistant turns created in this subchat
```

A subchat is a child branch of the parent message. Several subchats can point to the same message or different blocks within it. They do not copy any parent message. Use the host's canonical IDs as the primary keys; text hashes and offsets are fallbacks for edited or imported content.

## Opening and answering a subchat

1. Render **Ask subchat** on assistant blocks. A selection action can narrow the anchor to a phrase or code range.
2. On open, create or load the `Subchat` row by `(parent_message_id, anchor_block_id, quote_hash)`. Opening alone does not call a model.
3. On submit, assemble a bounded context lazily: selected passage, containing block, nearest heading, and nearby blocks. Add the subchat's own turns.
4. If the question needs earlier information, retrieve a few relevant parent turns by message ID or a host-maintained conversation index. Add only those snippets. Do not silently clone the whole transcript into the side thread.
5. Stream the answer into the subchat branch. Closing the panel does not close the branch. A browser extension can copy a summary for pasting; a native host can explicitly promote or reference chosen turns in the main branch.

A first-party host can also branch from the model state at the source response. If the serving system retained that state, use a shared prefix KV cache with copy-on-write for new branch tokens. This can avoid re-prefilling the common prefix. It does not make answer generation free: each new token still attends to the existing prefix, and a cache consumes accelerator memory. Use normal cache eviction and fall back to compact text context when the prefix cache is absent or evicted.

## Cost model

Let:

- `N` be the token count in the existing conversation,
- `Q` be the number of side branches,
- `K` be the selected passage plus its local context,
- `S_i` be the stored side-thread tokens for branch `i`.

A naive design that duplicates the parent transcript into every side branch stores `O(QN + sum(S_i))` conversation text. If each branch call reprocesses the full `N`-token prompt, the prompt prefill work is roughly `O(QN^2)` for standard dense self-attention. Dense self-attention prefill has quadratic sequence-length work; optimized kernels improve constants and memory movement, but reducing the repeated prompt length remains valuable. [Attention Is All You Need](https://doi.org/10.48550/arXiv.1706.03762)

With references, the host stores the parent once and adds only branch metadata and new turns: `O(N + Q + sum(S_i))`. If a local context window is enough, each branch prefill is based on `K + S_i`, approximately `O((K + S_i)^2)` under standard dense self-attention. If a retained shared KV prefix is available, the server can skip recomputing the common prefix during prefill. KV cache size and decode attention over the prefix still matter. [Efficiently Scaling Transformer Inference](https://proceedings.mlsys.org/paper_files/paper/2023/file/c4be71ab8d24cdfb45e3d06dbfca2780-Paper-mlsys2023.pdf)

Anchor lookup by stable ID is average `O(1)` with a hash index, or `O(log N)` with a database index. Selecting a fixed-size local window is `O(K)` in the returned context size. If broader retrieval is needed, an indexed conversation search adds index and ranking costs; do it only when local context is insufficient.

These are engineering estimates, not end-to-end latency guarantees. Model size, tokenization, batching, cache hits, network time, and answer length dominate observed latency.

## Why this is a better company integration

- **No transcript duplication:** the conversation remains a shared immutable history with small branch deltas.
- **Lower token use:** only anchor context, needed parent snippets, and side turns enter a new request.
- **Good fidelity:** the host can reuse its own message and model state instead of scraping rendered DOM.
- **Independent UX:** side branches can be opened, resumed, cleared, or promoted without polluting the main thread.
- **Vendor-neutral UI:** one panel and branch contract can sit over each host's model/session adapter.
- **Governable retention:** branches inherit the parent conversation's deletion and retention rules.

## Trade-offs and safeguards

- **Context relevance:** a narrow window can omit a fact from earlier in the conversation. Retrieve relevant parent snippets or branch from retained model state; do not assume the selected sentence is always sufficient.
- **Cache pressure:** copying the entire KV cache per branch wastes accelerator memory. Share immutable parent prefixes and copy on write; evict branches under pressure.
- **Edits and regeneration:** stable block IDs should be versioned with message content. If the selected text disappears, show that the anchor changed and offer to reattach it.
- **Safety and trust:** selected answer text is source material, never elevated to instructions. Apply the host's normal policy and safety checks to subchat requests.
- **Privacy:** side turns follow the same account boundary, export, deletion, and retention controls as their parent conversation.
- **Accessibility:** controls need keyboard, screen-reader, and touch support. On phones, open a bottom sheet without losing scroll position.

## Prototype boundary

The browser extension uses DOM selectors, a local provider setting, and compact passage context. It demonstrates the interaction and provider adapter; it cannot reuse a product's private model KV cache or stable internal message IDs. The native data model is the production path, not an API exposed by the current extension.

## Runnable local implementation

The `backend/` directory implements the storage and request path in Python's standard library with SQLite. Its unique anchor tuple resolves repeated opens to the same branch; turn rows refer to a branch ID, and no parent transcript is duplicated. It streams OpenAI-compatible deltas and stores the completed answer. The preview supplies stable demo IDs and a bounded five-block local context. Provider keys are read from backend environment variables. This makes the data flow concrete, while leaving account auth, provider-specific safety hooks, parent-chat deletion callbacks, and actual host KV-cache integration to a first-party product.
