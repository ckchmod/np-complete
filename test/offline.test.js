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

const elements = new Map();

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
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
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
      if (selector.startsWith("#")) return elements.get(selector.slice(1)) || null;
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

function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function installBrowserEnv() {
  elements.clear();
  const ids = [
    "app", "level-title", "level-hint", "nav-prev", "nav-next", "nav-skip", "nav-label",
    "intro", "btn-start", "btn-skip-tutorial", "btn-help", "rush-over", "rush-intro",
    "btn-rush-start", "battle-intro", "btn-battle-close", "mode-select", "tutorial-mode-button", "rush-mode-button", "battle-mode-button", "battle-ai-mode-button", "battle-board",
    "battle-turn", "battle-status", "battle-result", "board", "rush-score", "rush-strikes",
    "rush-moves", "btn-skip", "btn-rush-abandon", "rush-toast", "move-count", "par-display", "result-card",
    "result-moves", "result-par", "result-stars", "result-score", "result-pb", "result-hash",
    "btn-share", "btn-undo", "btn-reset", "btn-tutorial-menu", "rush-final-score", "rush-best", "rush-stats",
    "btn-rush-again", "btn-rush-share", "btn-rush-menu", "battle-result-message", "btn-battle-again", "btn-battle-menu", "btn-battle-abandon",
  ];
  for (const id of ids) elements.set(id, fakeEl(id));
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
  globalThis.localStorage = fakeLocalStorage();
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = () => 0;
  Math.random = () => 0.25;

  return {
    el: (id) => elements.get(id),
    restore() {
      globalThis.document = previous.document;
      globalThis.localStorage = previous.localStorage;
      globalThis.window = previous.window;
      globalThis.performance = previous.performance;
      globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      Math.random = previous.random;
      elements.clear();
    },
  };
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

test("offline: service worker caches the core app shell", async () => {
  const added = [];
  const { CACHE_NAME, urlsToCache, listeners } = await loadServiceWorker({
    open: async (name) => ({ addAll: async (urls) => added.push({ name, urls }) }),
  });
  const expectedUrls = await expectedCacheUrls();

  let installPromise;
  listeners.install({ waitUntil: (promise) => { installPromise = promise; } });
  await Promise.resolve(installPromise);

  assert.equal(CACHE_NAME, "the-lock-v1");
  assert.match(CACHE_NAME, /^the-lock-v\d+$/);
  assert.deepEqual(urlsToCache, expectedUrls);
  for (const url of criticalRuntimeUrls) {
    assert.ok(urlsToCache.includes(url), `${url} must be precached for offline mode flows`);
  }
  assert.deepEqual(added, [{ name: "the-lock-v1", urls: expectedUrls }]);
});

test("offline: cached assets are served when fetch is offline", async () => {
  const cachedResponse = { source: "cache" };
  const fetched = [];
  const { listeners } = await loadServiceWorker({
    match: async (request) => (request.url.endsWith("/index.html") ? cachedResponse : undefined),
  }, async (request) => {
    fetched.push(request.url);
    return { source: "network" };
  });

  let cachedPromise;
  listeners.fetch({ request: { method: "GET", url: "/index.html" }, respondWith: (promise) => { cachedPromise = promise; } });
  assert.equal(await Promise.resolve(cachedPromise), cachedResponse);
  assert.deepEqual(fetched, []);

  let networkPromise;
  listeners.fetch({ request: { method: "GET", url: "/missing.png" }, respondWith: (promise) => { networkPromise = promise; } });
  assert.deepEqual(await Promise.resolve(networkPromise), { source: "network" });
  assert.deepEqual(fetched, ["/missing.png"]);
});

test("offline: older cache versions are cleaned up on activate", async () => {
  const deleted = [];
  const { listeners } = await loadServiceWorker({
    keys: async () => ["the-lock-v0", "the-lock-v1", "other-cache"],
    delete: async (name) => deleted.push(name),
  });

  let activatePromise;
  listeners.activate({ waitUntil: (promise) => { activatePromise = promise; } });
  await Promise.resolve(activatePromise);

  assert.deepEqual(deleted, ["the-lock-v0", "other-cache"]);
});

test("offline: the app boots in a mocked browser environment", async () => {
  const env = installBrowserEnv();
  try {
    const { TUTORIALS } = await import("../src/levels.js");
    const { registerServiceWorker } = await import(`../src/main.js?offline-${Date.now()}`);

    assert.equal(env.el("level-title").textContent, "CHOOSE MODE");
    assert.equal(env.el("mode-select").classList.contains("hidden"), false);
    assert.equal(env.el("board").children.length, 0);

    env.el("tutorial-mode-button").click();
    assert.equal(env.el("level-title").textContent, TUTORIALS[0].name);
    assert.equal(env.el("nav-label").textContent, `1 / ${TUTORIALS.length}`);
    assert.ok(env.el("board").children.length > 0);

    const registered = [];
    const registration = { addEventListener() {}, waiting: null };
    const nav = {
      serviceWorker: {
        controller: {},
        register: async (url) => {
          registered.push(url);
          return registration;
        },
      },
    };

    assert.equal(await registerServiceWorker(nav, globalThis.document), registration);
    assert.deepEqual(registered, ["sw.js"]);
  } finally {
    env.restore();
  }
});
