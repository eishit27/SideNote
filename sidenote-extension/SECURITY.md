# SideNote security model

## Scope

This document describes the current browser extension and the loopback-only demo backend. It is a project-level threat model, not a security certification or penetration-test report.

## Data and trust boundaries

- The extension reads rendered assistant-answer text only when the user opens a subchat. It sends the selected passage, bounded nearby text, and that subchat's turns to the configured model endpoint.
- The model provider receives the submitted text and the API key in an HTTPS authorization header. SideNote does not operate a relay for extension requests.
- The extension API key is held in Chrome session storage memory. It is cleared when the browser or extension session restarts. Older local-storage keys are migrated to session storage and removed from local storage.
- Extension branch history is stored locally in Chrome extension storage and is not encrypted at rest. It is limited to 80 indexed threads, 12 messages per thread, and 2,000 characters per stored message.
- In incognito tabs, branch history remains in the content script's in-memory map and disappears when the tab closes. Text is still sent to the configured provider when the user submits a question.
- The preview backend stores branch text in SQLite. On POSIX systems, its database file is created with owner-only permissions. The backend binds to loopback and is intended for a local demo only.

## Protections in this prototype

- Manifest V3; content scripts are limited to named AI sites, and provider network access is requested for the configured origin.
- Extension local and session storage are restricted to trusted extension contexts. Content scripts can request only bounded branch reads and serialized saves; they cannot request provider credentials.
- Provider URLs require HTTPS, except for loopback development. Redirects are rejected to avoid forwarding credentials to another URL.
- Provider requests and streamed responses have time, size, and context limits. Rendered model output is inserted as text, not interpreted as HTML.
- The demo API binds to loopback, checks Host and Origin/fetch metadata, accepts JSON writes, bounds request/context sizes, and avoids logging query strings and branch identifiers.
- The static demo server serves an explicit file allowlist and supports byte-range requests for the video.

## Known limitations

- Chrome extension storage does not encrypt saved branch history at rest. A person or process with access to the browser profile may inspect it.
- The loopback API has no user authentication or tenant isolation. Localhost and request-header checks do not protect against malicious software already running as the same user. Do not expose the demo backend on a network.
- Prompt-injection wording does not enforce a security boundary. Page text can still influence model output; this extension does not grant the model tools or execute its response.
- Site adapters depend on third-party DOM markup and can break when those products change. The extension is not an official integration with those providers.
- The project has not received an independent security review. Automated checks cover selected behavior and do not establish security.

## Before production use

A native deployment should use the host product's authentication, conversation IDs, data-retention/deletion controls, credential management, model session, quotas, abuse controls, and tested UI integration. Reassess permissions and data flows for every additional provider or host.
