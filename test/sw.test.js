import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const swPath = new URL("../sw.js", import.meta.url);

const appShellStaticUrls = [
  "/",
  "/index.html",
  "/styles.css",
];

const runtimeEntryUrls = ["/src/main.js"];

const criticalRuntimeUrls = [
  "/src/main.js",
  "/src/rush.js",
  "/src/battle.js",
  "/src/aiBattle.js",
  "/src/battleGenerator.js",
  "/src/battleSolver.js",
  "/src/generator.js",
  "/src/gadgetBuilders.js",
];

const staticImportPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.\/[^"']+\.js)["']/gs;

function sourceUrlToFileUrl(sourceUrl) {
  return new URL(".." + sourceUrl, import.meta.url);
}

function fileUrlToSourceUrl(fileUrl) {
  const rootUrl = new URL("../", import.meta.url);
  if (!fileUrl.pathname.startsWith(rootUrl.pathname)) {
    throw new Error(`Import escapes project root: ${fileUrl.pathname}`);
  }
  return "/" + fileUrl.pathname.slice(rootUrl.pathname.length);
}

async function runtimeSourceUrls(entryUrls = runtimeEntryUrls) {
  const urls = [];
  const seen = new Set();

  async function visit(sourceUrl) {
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    urls.push(sourceUrl);

    const fileUrl = sourceUrlToFileUrl(sourceUrl);
    const source = await readFile(fileUrl, "utf8");
    staticImportPattern.lastIndex = 0;
    const importSpecifiers = [...source.matchAll(staticImportPattern)].map((match) => match[1]);
    for (const specifier of importSpecifiers) {
      await visit(fileUrlToSourceUrl(new URL(specifier, fileUrl)));
    }
  }

  for (const entryUrl of entryUrls) await visit(entryUrl);
  return urls;
}

async function expectedCacheUrls() {
  return [
    ...appShellStaticUrls,
    ...(await runtimeSourceUrls()),
    "/manifest.json",
  ];
}

async function readServiceWorker() {
  return readFile(swPath, "utf8");
}

async function loadServiceWorker(caches = {}, fetch = () => {}) {
  const listeners = {};
  const self = {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  const source = await readServiceWorker();
  const exports = new Function("self", "caches", "fetch", `${source}\nreturn { CACHE_NAME, urlsToCache };`)(self, caches, fetch);
  return { ...exports, listeners };
}

function fakeEl(id = "") {
  const children = [];
  const listeners = {};
  const classes = new Set();
  return {
    id,
    children,
    parentNode: null,
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    attributes: {},
    textContent: "",
    innerHTML: "",
    disabled: false,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : Boolean(on);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") String(value).split(/\s+/).filter(Boolean).forEach((cls) => classes.add(cls));
    },
    appendChild(child) {
      child.parentNode = this;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event = {}) {
      (listeners[type] || []).slice().forEach((fn) => fn(event));
    },
    querySelector(selector) {
      if (selector.startsWith("#")) return elementsForQuery.get(selector.slice(1)) || null;
      return null;
    },
    click() {
      this.dispatch("click", { target: this });
    },
    getBoundingClientRect() {
      return { width: 320, height: 480, top: 0, left: 0 };
    },
  };
}

const elementsForQuery = new Map();

function installMainEnv() {
  const elements = new Map();
  elementsForQuery.clear();
  const ids = [
    "app", "level-title", "level-hint", "nav-prev", "nav-next", "nav-skip", "nav-label",
    "intro", "btn-start", "btn-skip-tutorial", "btn-help", "rush-over", "rush-intro",
    "btn-rush-start", "battle-intro", "btn-battle-close", "mode-select", "rush-mode-button", "battle-mode-button", "battle-ai-mode-button", "battle-board",
    "battle-turn", "battle-status", "battle-result", "board", "rush-score", "rush-strikes",
    "rush-moves", "btn-skip", "rush-toast", "move-count", "par-display", "result-card",
    "result-moves", "result-par", "result-stars", "result-score", "result-pb", "result-hash",
    "btn-share", "btn-undo", "btn-reset", "rush-final-score", "rush-best", "rush-stats",
    "btn-rush-again", "btn-rush-share", "btn-rush-menu", "battle-result-message", "btn-battle-again", "btn-battle-menu",
  ];
  for (const id of ids) {
    const el = fakeEl(id);
    elements.set(id, el);
    elementsForQuery.set(id, el);
  }
  for (const id of ["rush-over", "rush-intro", "battle-intro", "mode-select", "battle-result", "result-card"]) {
    elements.get(id).classList.add("hidden");
  }

  const previous = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    random: Math.random,
  };
  globalThis.document = {
    body: fakeEl("body"),
    getElementById: (id) => elements.get(id) || null,
    createElement: (tagName) => fakeEl(tagName),
    createElementNS: () => fakeEl(),
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = () => 0;
  Math.random = () => 0.25;

  return {
    restore() {
      globalThis.document = previous.document;
      globalThis.localStorage = previous.localStorage;
      globalThis.window = previous.window;
      globalThis.performance = previous.performance;
      globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      Math.random = previous.random;
      elementsForQuery.clear();
    },
  };
}

function eventTarget() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
}

test("sw: file exists and parses as JavaScript", async () => {
  const source = await readServiceWorker();

  assert.doesNotThrow(() => new Function(source));
});

test("sw: cache name is versioned", async () => {
  const { CACHE_NAME } = await loadServiceWorker();

  assert.equal(CACHE_NAME, "the-lock-v4");
  assert.match(CACHE_NAME, /^the-lock-v\d+$/);
});

test("sw: urlsToCache includes the core static app shell", async () => {
  const { urlsToCache } = await loadServiceWorker();
  const expectedUrls = await expectedCacheUrls();

  assert.deepEqual(urlsToCache, expectedUrls);
  for (const url of criticalRuntimeUrls) {
    assert.ok(urlsToCache.includes(url), `${url} must be precached for offline mode flows`);
  }
});

test("sw: install, fetch, and activate handlers use a cache-first app shell", async () => {
  const added = [];
  const deleted = [];
  const networkResponse = { source: "network" };
  const cachedResponse = { source: "cache" };
  const caches = {
    open: async (name) => ({ addAll: async (urls) => added.push({ name, urls }) }),
    match: async (request) => (request.url.endsWith("styles.css") ? cachedResponse : undefined),
    keys: async () => ["the-lock-v0", "the-lock-v1", "the-lock-v2", "the-lock-v3", "the-lock-v4", "other-cache"],
    delete: async (name) => deleted.push(name),
  };
  const fetched = [];
  const { listeners } = await loadServiceWorker(caches, async (request) => {
    fetched.push(request.url);
    return networkResponse;
  });
  const expectedUrls = await expectedCacheUrls();

  let installPromise;
  listeners.install({ waitUntil: (promise) => { installPromise = promise; } });
  await Promise.resolve(installPromise);
  assert.deepEqual(added, [{ name: "the-lock-v4", urls: expectedUrls }]);

  let cachedPromise;
  listeners.fetch({ request: { method: "GET", url: "/styles.css" }, respondWith: (promise) => { cachedPromise = promise; } });
  assert.equal(await Promise.resolve(cachedPromise), cachedResponse);
  assert.deepEqual(fetched, []);

  let networkPromise;
  listeners.fetch({ request: { method: "GET", url: "/missing.png" }, respondWith: (promise) => { networkPromise = promise; } });
  assert.equal(await Promise.resolve(networkPromise), networkResponse);
  assert.deepEqual(fetched, ["/missing.png"]);

  let activatePromise;
  listeners.activate({ waitUntil: (promise) => { activatePromise = promise; } });
  await Promise.resolve(activatePromise);
  assert.deepEqual(deleted, ["the-lock-v0", "the-lock-v1", "the-lock-v2", "the-lock-v3", "other-cache"]);
});

test("main: service worker registration is optional and surfaces updates", async () => {
  const env = installMainEnv();
  try {
    const { registerServiceWorker } = await import(`../src/main.js?sw-registration-${Date.now()}`);
    const worker = { ...eventTarget(), state: "installing" };
    const registration = { ...eventTarget(), installing: worker };
    const registered = [];
    const nav = {
      serviceWorker: {
        controller: {},
        register: async (url) => {
          registered.push(url);
          return registration;
        },
      },
    };
    const doc = {
      body: fakeEl("body"),
      getElementById: () => null,
      createElement: (tagName) => fakeEl(tagName),
    };

    assert.equal(await registerServiceWorker({}, doc), null);
    assert.equal(await registerServiceWorker(nav, doc), registration);
    assert.deepEqual(registered, ["sw.js"]);

    registration.listeners.updatefound();
    worker.state = "installed";
    worker.listeners.statechange();

    assert.equal(doc.body.children.length, 1);
    assert.equal(doc.body.children[0].id, "sw-update");
    assert.equal(doc.body.children[0].attributes.role, "status");
    assert.equal(doc.body.children[0].textContent, "Update available. Reload to update.");
  } finally {
    env.restore();
  }
});
