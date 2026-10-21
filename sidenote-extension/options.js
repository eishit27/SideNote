const endpointInput = document.querySelector("#endpoint");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#apiKey");
const saveButton = document.querySelector("#save");
const forgetButton = document.querySelector("#forget");
const status = document.querySelector("#status");

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 160;
const MAX_API_KEY_LENGTH = 4_096;
let savedEndpoint = "";
let hasSavedApiKey = false;
saveButton.disabled = true;
forgetButton.disabled = true;

async function loadSettings() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  const [values, session] = await Promise.all([
    chrome.storage.local.get(["endpoint", "model", "apiKey"]),
    chrome.storage.session.get("apiKey"),
  ]);
  const apiKey =
    (typeof session.apiKey === "string" && session.apiKey) ||
    (typeof values.apiKey === "string" && values.apiKey) ||
    "";
  if (apiKey && !session.apiKey) {
    await chrome.storage.session.set({ apiKey });
  }
  if (values.apiKey) {
    await chrome.storage.local.remove("apiKey");
  }
  savedEndpoint = values.endpoint || "";
  hasSavedApiKey = typeof apiKey === "string" && Boolean(apiKey);
  endpointInput.value = savedEndpoint;
  modelInput.value = values.model || "";
  apiKeyInput.value = "";
  apiKeyInput.placeholder = hasSavedApiKey
    ? "Available for this browser session — enter a new key to replace"
    : "Enter your provider API key (required after restart)";
}

loadSettings()
  .catch(() => {
    status.textContent =
      "Could not load saved settings. Reload this page and try again.";
  })
  .finally(() => {
    saveButton.disabled = false;
    forgetButton.disabled = false;
  });

function parseEndpoint(value) {
  const text = value.trim();
  if (!text || text.length > MAX_ENDPOINT_LENGTH) {
    throw new Error("Enter a valid endpoint URL under 2,048 characters.");
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Enter a valid endpoint URL.");
  }

  if (!url.hostname || url.username || url.password || url.hash) {
    throw new Error(
      "The endpoint URL cannot contain credentials or a fragment.",
    );
  }
  for (const name of url.searchParams.keys()) {
    if (
      /^(api[-_]?key|key|token|access[-_]?token|secret|authorization)$/i.test(
        name,
      )
    ) {
      throw new Error(
        "Put the API key in the API key field, not in the endpoint URL.",
      );
    }
  }
  if (url.protocol === "https:") return url;
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  )
    return url;
  throw new Error(
    "Use HTTPS for remote endpoints. HTTP is allowed only for localhost development.",
  );
}

function permissionPattern(endpoint) {
  return `${endpoint.origin}/*`;
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  status.textContent = "";
  let newlyGrantedPattern = "";
  let hadPermission = false;

  try {
    const endpoint = parseEndpoint(endpointInput.value);
    const model = modelInput.value.trim();
    const enteredApiKey = apiKeyInput.value.trim();
    let apiKey = enteredApiKey;
    if (!apiKey && hasSavedApiKey) {
      const previousOrigin = savedEndpoint ? new URL(savedEndpoint).origin : "";
      if (previousOrigin !== endpoint.origin) {
        throw new Error(
          "Enter the API key again when changing to a different endpoint origin.",
        );
      }
      apiKey = (await chrome.storage.session.get("apiKey")).apiKey || "";
    }
    if (!model || model.length > MAX_MODEL_LENGTH || /[\r\n]/.test(model)) {
      throw new Error("Enter a model name under 160 characters on one line.");
    }
    if (
      !apiKey ||
      apiKey.length > MAX_API_KEY_LENGTH ||
      /[\r\n]/.test(apiKey)
    ) {
      throw new Error("Enter an API key under 4,096 characters on one line.");
    }

    const pattern = permissionPattern(endpoint);
    hadPermission = await chrome.permissions.contains({ origins: [pattern] });
    if (!hadPermission) {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("Network permission was not granted.");
      newlyGrantedPattern = pattern;
    }

    const previousSettings = await chrome.storage.local.get([
      "endpoint",
      "model",
    ]);
    await chrome.storage.local.set({ endpoint: endpoint.href, model });
    try {
      await chrome.storage.session.set({ apiKey });
    } catch (error) {
      await chrome.storage.local.set(previousSettings).catch(() => {});
      await chrome.storage.session.remove("apiKey").catch(() => {});
      throw error;
    }

    let previousOrigin = "";
    try {
      previousOrigin = savedEndpoint ? new URL(savedEndpoint).origin : "";
    } catch {
      // Older malformed settings should not prevent saving a corrected connection.
    }
    if (previousOrigin && previousOrigin !== endpoint.origin) {
      await chrome.permissions
        .remove({ origins: [`${previousOrigin}/*`] })
        .catch(() => false);
    }
    savedEndpoint = endpoint.href;
    hasSavedApiKey = true;
    apiKeyInput.value = "";
    apiKeyInput.placeholder =
      "Available for this browser session — enter a new key to replace";
    status.textContent =
      "Connection saved. The key is available for this browser session.";
  } catch (error) {
    if (newlyGrantedPattern && !hadPermission) {
      await chrome.permissions
        .remove({ origins: [newlyGrantedPattern] })
        .catch(() => false);
    }
    status.textContent =
      error?.message || "Could not save the model connection.";
  } finally {
    saveButton.disabled = false;
  }
});

forgetButton.addEventListener("click", async () => {
  forgetButton.disabled = true;
  status.textContent = "";
  try {
    if (
      !window.confirm(
        "Delete the API key, connection settings, and all saved SideNote subchats from this browser profile?",
      )
    ) {
      return;
    }
    await chrome.runtime
      .sendMessage({ type: "sidenote:forget-all" })
      .catch(() => undefined);
    const values = await chrome.storage.local.get(null);
    const keys = Object.keys(values).filter(
      (key) =>
        ["endpoint", "model", "apiKey", "sidenote:index"].includes(key) ||
        key.startsWith("sidenote:v1:") ||
        key.startsWith("sidenote:v2:"),
    );
    await Promise.all([
      chrome.storage.local.remove(keys),
      chrome.storage.session.remove("apiKey"),
    ]);
    try {
      const endpointToRevoke = values.endpoint || savedEndpoint;
      const oldEndpoint = endpointToRevoke ? new URL(endpointToRevoke) : null;
      if (oldEndpoint) {
        await chrome.permissions.remove({
          origins: [`${oldEndpoint.origin}/*`],
        });
      }
    } catch {
      // Data removal succeeds even if the browser cannot revoke the old origin permission.
    }
    endpointInput.value = "";
    modelInput.value = "";
    apiKeyInput.value = "";
    apiKeyInput.placeholder =
      "Enter your provider API key (required after restart)";
    savedEndpoint = "";
    hasSavedApiKey = false;
    status.textContent =
      "Data deleted. Reload open chat tabs before starting a new saved thread.";
  } catch (error) {
    status.textContent =
      error?.message || "Could not delete saved SideNote data.";
  } finally {
    forgetButton.disabled = false;
  }
});
