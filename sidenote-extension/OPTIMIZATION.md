# SideNote optimization notes

This document separates changes the extension can make on its own from improvements that require an AI product's first-party model and conversation services.

## Implemented in this version

- **Trusted storage boundary:** the MV3 service worker restricts `chrome.storage.local` to trusted extension contexts. The content script reads and writes only bounded `sidenote:v2:` branch keys through a narrow message handler; it cannot request provider credentials. Chrome documents that extension local storage is exposed to content scripts by default unless its access level is restricted ([Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)).
- **Serialized, bounded history:** the service worker serializes branch saves, updates the index in the same operation, and prunes old threads at the 80-thread cap. This avoids cross-tab read/modify/write races. Incognito threads remain in the tab's memory only.
- **Credential hygiene:** the settings page does not display a previously saved key. The key is held in session storage memory rather than persisted to disk, so users re-enter it after browser or extension restart. Changing provider origins requires entering the key again, and users can delete the key, endpoint permission, and saved branches from settings. A native enterprise integration should use the host's credential system.
- **Lower repeated DOM work:** assistant and fallback block ordinals are assigned as messages are scanned and held in `WeakMap`s. Opening a passage no longer queries and indexes all assistant messages on the page. Gathering nearby blocks in the source answer still scales with the number of blocks in that answer.
- **Keyboard access without a tab stop on every passage:** each assistant response has a roving action. Tab reaches the first passage action; Alt+Up/Down moves it among passages; Enter, Space, or Up/Down opens the action. Escape closes it and returns focus. The menu follows the WAI-ARIA menu button interaction pattern ([WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)).
- **Quality and security regression set:** [evaluation/cases.jsonl](evaluation/cases.jsonl) covers the original example request, bounded context, missing context, concise explanations, and injected instructions in source text. [evaluation/README.md](evaluation/README.md) explains how to compare providers locally without saving passage text in result files.

## Model quality

The extension cannot change the provider's model weights. It can improve answer quality by retrieving the right small amount of context, keeping the question and source passage distinct, and measuring outputs against realistic cases. The current passage window is intentionally bounded; for a first-party integration, use stable message IDs to retrieve a few relevant earlier messages only when the local passage is insufficient.

Source text remains untrusted even when wrapped in JSON or labeled as a quote. OWASP explicitly warns that delimiters and prompt language are not enforcement boundaries. SideNote sends no tools to the model in this extension; a first-party host should also enforce permissions and safety in application code, then test direct and indirect injection cases ([OWASP guidance](https://cheatsheet.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)).

## Inference, memory, and cost

The extension does not hold model KV cache state and cannot reuse a provider's private cache. Provider prompt caches typically require an exact shared prefix and a provider/model-specific minimum prompt length ([OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)). These short passage requests may not cross that threshold, so do not add irrelevant text to force cache eligibility. For an owned serving stack, vLLM automatic prefix caching can reuse KV state for requests that share a prefix ([vLLM documentation](https://docs.vllm.ai/en/v0.10.1/features/automatic_prefix_caching.html)).

Conversation continuation APIs are not a promise of free context: OpenAI documents that previous input tokens remain billable when chaining with `previous_response_id` ([conversation state](https://developers.openai.com/api/docs/guides/conversation-state)). A native integration should compare quality, latency, and token usage against bounded retrieval before choosing continuation or retained KV state.

## Next product-level step

An AI company can provide the strongest version by connecting the UI to its canonical conversation tree, stable answer-block IDs, existing safety configuration, account-aware retention/deletion, and inference session. The external extension cannot implement or benchmark access to those private systems. See [INTEGRATION.md](INTEGRATION.md) for the proposed host adapter.
