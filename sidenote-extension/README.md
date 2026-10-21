# SideNote

**Contextual subchat for AI answers.** SideNote lets a reader ask about one answer block or selected phrase while the main conversation stays exactly where it is.

## Preview and local backend

Run `./start-demo.sh` from this directory and open [http://127.0.0.1:8765/preview.html](http://127.0.0.1:8765/preview.html). The Python + SQLite backend in [backend/README.md](backend/README.md) serves the standalone preview and demo video only. The installable extension is a separate browser-local MVP: it stores bounded subchat history in Chrome storage and calls the provider configured in extension options. This split is deliberate and documented; the local backend demonstrates a native branch-storage contract, not the extension’s persistence layer. The preview needs provider settings for real answers; see the backend README.

## What is implemented

- A compact **three-dot passage menu** on hover or touch; **Ask subchat** appears inside it for assistant paragraphs, headings, list items, code blocks, and quotes on supported sites.
- A selection action for asking about just a word or phrase inside a block.
- One roving keyboard action per assistant response. Focus its first passage action, use Alt+Up/Down to move between passages, and Enter, Space, or Up/Down to open the action.
- A side panel that remains attached to its source passage and keeps a separate thread per passage.
- Streaming replies through an OpenAI-compatible chat completions endpoint.
- Local persistence bounded to 80 passage threads and 12 messages per thread.
- Provider credentials and branch storage are available only to trusted extension contexts; the page-facing content script requests branch operations through the service worker.
- A small provider-neutral evaluation set for relevance, grounding, missing context, concise answers, and source-text injection attempts.
- Context packing limited to the selected block, adjacent blocks, and nearest preceding heading (up to 3,000 characters).
- A configurable provider endpoint and model, so the UI does not depend on one model vendor.
- A separate local Python + SQLite backend for the preview, with persistent branches and server-side provider credentials.

## Install in Chrome or Chromium

1. Use a current stable Chrome or Chromium release, open the browser's extensions page, and enable **Developer mode**. The APIs used require Chrome 102 or newer, but the project is not qualified against outdated browser releases.
2. Choose **Load unpacked** and select this `sidenote-extension` folder.
3. Open the extension's **Details → Extension options** and enter an HTTPS OpenAI-compatible streaming chat completions URL, model name, and API key.
4. Approve the endpoint-origin permission requested on save.
5. Refresh an open AI chat tab. Hover a response passage and click its **··· → Ask subchat** menu, or select a phrase and use the floating action.

Use HTTPS for remote model endpoints. HTTP is permitted only for localhost development. The endpoint must accept `Authorization: Bearer …`, stream OpenAI-compatible SSE chunks (`choices[0].delta.content`), and not redirect the request.

## Supported page adapters

The manifest currently targets ChatGPT, Claude, Gemini, Perplexity, and Copilot. The extension uses known assistant-message selectors and a semantic block fallback. AI products change their page markup, so the extension is a practical bridge and will need adapter maintenance. The native integration contract in [INTEGRATION.md](INTEGRATION.md) is the stable route for product teams.

## Privacy and data flow

SideNote does not read or send the full conversation. On demand it sends the selected passage, a compact local window around that passage, and the relevant side-thread turns to the model endpoint configured by the user. The extension stores bounded branch history in Chrome extension local storage; this history is not encrypted at rest. The provider key is kept in Chrome session storage, which is in-memory and cleared when the extension is reloaded or updated or the browser restarts; re-enter it for each new session. The key is never displayed in the settings page after it is saved. Storage is restricted to trusted extension contexts, and the page-facing content script uses the service worker for branch reads and writes. The options page can delete credentials, endpoint settings, and saved subchats; reload open chat tabs after deleting data to clear their in-memory copy and resume normal saving. In incognito, branch history is held only in that tab's content-script memory and disappears when the tab closes. The separate preview backend keeps its provider key in the server environment and branch history in SQLite. No SideNote analytics service is involved. The configured model provider receives submitted context.

## Efficiency

- Initial page scan: O(number of rendered assistant blocks), once per page load.
- Incremental updates: O(changed answer block), debounced while a response streams.
- Each model request payload is bounded by passage context and side-thread history, independent of main-chat length. Fallback anchor IDs are assigned as messages are scanned, so opening a passage does not rescan every answer on the page. Gathering the local passage window still takes O(B) work for B blocks in that answer.
- Saved state: at most 80 passage threads × 12 messages; each stored message is capped at 2,000 characters.

These bounds keep the add-on light enough for repeated daily use. The preview backend caps request context, retains at most 200 turns per branch and 500 branches per demo conversation, and sends only the latest 24 side turns. The cost of the model call still depends on the selected provider and the size of the bounded context.

## Developer checks

From this directory, run `node tests/storage-isolation.test.js` and `(cd backend && python3 -m unittest discover -s tests -v)`. To compare answer quality with a configured provider, follow [evaluation/README.md](evaluation/README.md).

## Scope

This is an installable engineering MVP, not an official integration with those AI companies. DOM adapters are best-effort; native product integrations can use stable message IDs, first-party storage, authentication, accessibility hooks, and each vendor's existing model session. See [SECURITY.md](SECURITY.md) for the threat model and known limits, [INTEGRATION.md](INTEGRATION.md) for the host adapter contract, [ARCHITECTURE.md](ARCHITECTURE.md) for the branch data model, [OPTIMIZATION.md](OPTIMIZATION.md) for the current optimization choices and boundaries, and [evaluation/README.md](evaluation/README.md) for the quality checks.
