# Native integration contract

The extension demonstrates the interaction across existing AI sites. An AI product should integrate the same capability with its own message IDs, rendering lifecycle, model session, and storage. This keeps the user experience consistent and avoids scraping the product's own page DOM.

## User experience

1. Every assistant content block reveals a compact three-dot action on hover or touch. Its menu contains **Ask subchat**. Keep one roving Tab stop per assistant response; keyboard users can move the action between passages with Alt+Up/Down and open it with Enter, Space, or Up/Down.
2. Selecting a phrase opens the same action with the selection pre-filled.
3. The contextual panel shows the source passage, accepts follow-up questions, and streams answers.
4. Side-thread messages remain separate from the main conversation. A browser extension can offer **Copy subchat summary**; inserting content into the parent chat requires a first-party host API.
5. Closing the panel preserves the thread; opening the action on another passage opens that passage's own thread.

## Minimal host API

A product's frontend supplies stable references and narrow context retrieval. The UI package should not know how the host stores conversations or calls its models.

```ts
export type SourceRef = {
  conversationId: string;
  messageId: string;
  blockId?: string;
};

export type PassageContext = {
  selectedText: string;
  nearbyText: string; // relevant block plus bounded adjacent context
};

export type SideTurn = {
  role: "user" | "assistant";
  content: string;
};

export type SubchatAdapter = {
  readContext(source: SourceRef, selection?: Range): PassageContext;
  loadThread(anchorKey: string): Promise<SideTurn[]>;
  saveThread(anchorKey: string, turns: SideTurn[]): Promise<void>;
  streamAnswer(input: {
    source: SourceRef;
    context: PassageContext;
    turns: SideTurn[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
};

export function attachSubchat(options: {
  root: HTMLElement;
  getSourceForBlock(block: HTMLElement): SourceRef | null;
  adapter: SubchatAdapter;
}): { dispose(): void };
```

## Anchor and state model

Use the host's stable `(conversationId, messageId, blockId)` tuple as the primary anchor. For passage-level threads, add a normalized quote hash and selection offsets when stable text offsets are available. If a message is edited, retain the side thread but indicate that its quoted passage changed. Never identify an anchor by visible text alone when a stable host ID exists.

Store only the side-thread turns and anchor metadata. Do not copy the main transcript into each side thread. Keep a bounded retention policy and delete data with the parent conversation when the host's retention policy requires it.

## Context and model cost

Context is fetched lazily when the reader opens the side chat. Include the exact selection, its containing block, the closest topic heading, and at most one adjacent block on either side. A product can retrieve more context only when the user asks or when the first answer indicates it is needed. A side request is therefore O(local passage context + side-thread history), not O(full conversation length).

Use the host's existing model session where possible. If a dedicated call is used, retain the current model and safety settings. The selected passage is untrusted source content; delimit it as quoted context and do not promote it to instructions. Keep citations and source links attached when relevant.

## Performance, accessibility, and controls

- Render actions only for assistant content, not user messages.
- Use event delegation or block lifecycle hooks; do not install one permanent observer per block.
- Keep closed panels out of the tab order. Give each assistant response one roving action stop, support the documented arrow-key behavior, screen-reader labels, Escape-to-close, and touch targets.
- Stream output and support cancellation when the reader closes the panel or changes source.
- Do not reflow the answer when controls appear. On narrow screens, use a bottom sheet while preserving scroll position.
- Provide **Copy subchat summary**, **Clear subchat**, and a close action. A host-native product may additionally provide a first-party “continue in main chat” action.

## Proposed evaluation

Measure whether readers can resolve a question without losing their reading position. Useful product measures include action-open rate, follow-up completion, return-to-source rate, panel dismissal, promotion into the main chat, and latency/token usage. Compare with the existing workflow where users scroll to the main composer. Do not use passage text as analytics telemetry.

## Adoption path

1. Validate this browser extension on the target products and refine the interaction.
2. Extract the side panel and anchor state into a small product-owned UI module.
3. Connect it to the host's stable message/block IDs and model session through `SubchatAdapter`.
4. Roll out behind a feature flag and evaluate usefulness, latency, accessibility, and context/token cost.

The extension is a portfolio and usability bridge. Each AI company would need to use its own internal product APIs for a robust native release; external browser code cannot safely or reliably alter those products' internal conversation model.
