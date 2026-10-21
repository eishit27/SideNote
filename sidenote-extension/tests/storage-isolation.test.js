const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const values = {
  endpoint: "https://provider.example/chat",
  apiKey: "private-key",
};
let messageListener;
let connectListener;
let accessLevel;
let sessionAccessLevel;
let fetchImplementation;
const sessionValues = {};

const chrome = {
  runtime: {
    id: "test-extension",
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      },
    },
    onConnect: {
      addListener(listener) {
        connectListener = listener;
      },
    },
  },
  storage: {
    local: {
      setAccessLevel(options) {
        accessLevel = options;
        return Promise.resolve();
      },
      async get(keys) {
        if (Array.isArray(keys)) {
          return Object.fromEntries(
            keys
              .filter((key) => key in values)
              .map((key) => [key, values[key]]),
          );
        }
        return { [keys]: values[keys] };
      },
      async set(update) {
        Object.assign(values, update);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete values[key];
        }
      },
    },
    session: {
      setAccessLevel(options) {
        sessionAccessLevel = options;
        return Promise.resolve();
      },
      async get(keys) {
        if (Array.isArray(keys)) {
          return Object.fromEntries(
            keys
              .filter((key) => key in sessionValues)
              .map((key) => [key, sessionValues[key]]),
          );
        }
        return { [keys]: sessionValues[keys] };
      },
      async set(update) {
        Object.assign(sessionValues, update);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete sessionValues[key];
        }
      },
    },
  },
  permissions: {
    async contains() {
      return true;
    },
  },
};

const vmContext = {
  chrome,
  URL,
  AbortController,
  TextDecoder,
  setTimeout,
  clearTimeout,
  fetch(...args) {
    if (!fetchImplementation) throw new Error("Unexpected network request");
    return fetchImplementation(...args);
  },
};

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"),
  vmContext,
);

function send(message, sender = { id: "test-extension", tab: { id: 1 } }) {
  return new Promise((resolve) => {
    const handled = messageListener(message, sender, resolve);
    if (handled !== true) resolve({ ignored: true });
  });
}

async function testStorageIsolation() {
  assert.equal(accessLevel.accessLevel, "TRUSTED_CONTEXTS");
  assert.equal(sessionAccessLevel.accessLevel, "TRUSTED_CONTEXTS");
  values["sidenote:v2:test-anchor"] = { messages: [] };

  const thread = await send({
    type: "sidenote:storage:get",
    key: "sidenote:v2:test-anchor",
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(thread["sidenote:v2:test-anchor"])),
    { messages: [] },
  );
  assert.equal(sessionValues.apiKey, "private-key");
  assert.equal(values.apiKey, undefined);

  const secretRead = await send({
    type: "sidenote:storage:get",
    key: "apiKey",
  });
  assert.match(secretRead.error, /Invalid SideNote storage request/);

  const secretWrite = await send({
    type: "sidenote:storage:set",
    values: { apiKey: "stolen" },
  });
  assert.match(secretWrite.error, /Invalid SideNote storage request/);
  assert.equal(sessionValues.apiKey, "private-key");
  assert.equal(values.apiKey, undefined);

  values["sidenote:v1:old-anchor"] = { messages: [] };
  const legacyRead = await send({
    type: "sidenote:storage:get",
    key: "sidenote:v1:old-anchor",
  });
  assert.match(legacyRead.error, /Invalid SideNote storage request/);
  await send({
    type: "sidenote:storage:remove",
    keys: ["sidenote:v1:old-anchor"],
  });
  assert.equal(values["sidenote:v1:old-anchor"], undefined);

  const pageRequest = await send(
    { type: "sidenote:storage:get", key: "sidenote:v2:test-anchor" },
    { id: "host-page", tab: { id: 1 } },
  );
  assert.equal(pageRequest.ignored, true);
}

async function testStreamingParser() {
  values.model = "test-model";
  const chunks = [
    new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"A focused ',
    ),
    new TextEncoder().encode('reply."}}]}\r\n\r\ndata: [DONE]'),
  ];
  let nextChunk = 0;
  let requestBody;
  fetchImplementation = async (_endpoint, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      headers: { get: () => "text/event-stream; charset=utf-8" },
      body: {
        getReader() {
          return {
            async read() {
              if (nextChunk < chunks.length) {
                return { value: chunks[nextChunk++], done: false };
              }
              return { value: undefined, done: true };
            },
            async cancel() {},
            releaseLock() {},
          };
        },
      },
    };
  };

  const posted = [];
  let portMessageListener;
  const port = {
    name: "sidenote-chat-v1",
    sender: { id: "test-extension", tab: { id: 1 } },
    onMessage: {
      addListener(listener) {
        portMessageListener = listener;
      },
    },
    onDisconnect: { addListener() {} },
    postMessage(message) {
      posted.push(message);
    },
    disconnect() {},
  };

  connectListener(port);
  await portMessageListener({
    type: "chat",
    context: { selectedText: "A passage.", nearbyText: "Nearby context." },
    history: [{ role: "user", content: "Explain this." }],
  });

  assert.deepEqual(
    posted.map((message) => message.type),
    ["delta", "done"],
  );
  assert.equal(posted[0].text, "A focused reply.");
  assert.match(requestBody.messages[1].content, /untrusted_source_context/);
  assert.match(requestBody.messages[1].content, /A passage\./);
}

async function testRejectsNonContentScriptPort() {
  let disconnected = false;
  const port = {
    name: "sidenote-chat-v1",
    sender: { id: "test-extension" },
    disconnect() {
      disconnected = true;
    },
  };
  connectListener(port);
  assert.equal(disconnected, true);
}

(async () => {
  await testStorageIsolation();
  await testStreamingParser();
  await testRejectsNonContentScriptPort();
  console.log("Storage isolation and background streaming checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
