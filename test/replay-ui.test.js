import { test } from "node:test";
import assert from "node:assert/strict";

import { applyFlip, legalFlips } from "../src/engine.js";
import { createGame } from "../src/game.js";
import { TUTORIALS } from "../src/levels.js";
import { captureReplay, replayToState } from "../src/replay.js";
import { createReplayUI } from "../src/replayUI.js";

function fakeEl(tagName = "div") {
  const children = [];
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName,
    children,
    attrs,
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    textContent: "",
    value: "",
    selected: false,
    disabled: false,
    open: false,
    type: "",
    parentNode: null,
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
    get className() {
      return Array.from(classes).join(" ");
    },
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((part) => classes.add(part));
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === "class") el.className = value;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child.parentNode === el) child.parentNode = null;
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
    dispatch(type, ev = {}) {
      return Promise.all((listeners[type] || []).slice().map((fn) => fn(ev)));
    },
    click() {
      return el.dispatch("click", { target: el });
    },
    getBoundingClientRect() {
      return { width: 320, height: 480, top: 0, left: 0 };
    },
  };
  return el;
}

function findAll(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) findAll(child, predicate, found);
  return found;
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function findEdgeHit(svg, edgeId) {
  return findOne(svg, (el) => el.classList && el.classList.contains("edge-hit") && el.parentNode?.dataset?.edge === edgeId);
}

function replayMoves(seed, count) {
  let config = replayToState(captureReplay(seed, []));
  const moves = [];
  for (let i = 0; i < count; i++) {
    const move = legalFlips(config)[0];
    moves.push(move);
    config = applyFlip(config, move);
  }
  return moves;
}

async function withDom(fn) {
  const timers = [];
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: globalThis.localStorage,
    performance: globalThis.performance,
  };

  function setGlobal(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  setGlobal("document", {
    createElement: (tagName) => fakeEl(tagName),
    createElementNS: (_ns, tagName) => fakeEl(tagName),
  });
  setGlobal("window", { matchMedia: () => ({ matches: false }) });
  setGlobal("requestAnimationFrame", (cb) => { cb(1000); return 1; });
  setGlobal("setTimeout", (cb, delay) => {
    const timer = { id: timers.length + 1, cb, delay, active: true };
    timers.push(timer);
    return timer.id;
  });
  setGlobal("clearTimeout", (id) => {
    const timer = timers.find((entry) => entry.id === id);
    if (timer) timer.active = false;
  });
  setGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  setGlobal("performance", { now: () => 0 });

  async function flushNext() {
    const timer = timers.find((entry) => entry.active);
    if (!timer) return null;
    timer.active = false;
    await timer.cb();
    return timer;
  }

  async function flushAll() {
    while (timers.some((entry) => entry.active)) await flushNext();
  }

  try {
    return await fn({ timers, flushNext, flushAll });
  } finally {
    setGlobal("document", previous.document);
    setGlobal("window", previous.window);
    setGlobal("requestAnimationFrame", previous.requestAnimationFrame);
    setGlobal("setTimeout", previous.setTimeout);
    setGlobal("clearTimeout", previous.clearTimeout);
    setGlobal("localStorage", previous.localStorage);
    setGlobal("performance", previous.performance);
  }
}

function buildGameMount() {
  const ids = [
    "board", "move-count", "par-display", "result-card", "result-moves", "result-par",
    "result-stars", "result-score", "result-pb", "result-hash", "btn-share", "btn-undo",
    "btn-reset", "replay-ui",
  ];
  const map = new Map(ids.map((id) => ["#" + id, fakeEl(id === "board" ? "svg" : "div")]));
  map.get("#result-card").classList.add("hidden");
  return { mountEl: { querySelector: (selector) => map.get(selector) || null }, el: (selector) => map.get(selector) };
}

test("replay UI appears only after a tutorial solve and keeps analysis collapsed", async () => {
  await withDom(async ({ flushAll }) => {
    const level = TUTORIALS[0];
    const fixture = buildGameMount();
    createGame({ level, mountEl: fixture.mountEl, onWin() {} });

    assert.equal(fixture.el("#replay-ui").children[0].classList.contains("hidden"), true);

    await findEdgeHit(fixture.el("#board"), level.target).click();
    await flushAll();

    const replayRoot = fixture.el("#replay-ui").children[0];
    const analysis = findOne(replayRoot, (node) => node.tagName === "details");
    const controls = findOne(replayRoot, (node) => node.classList?.contains("replay-controls"));

    assert.equal(replayRoot.classList.contains("hidden"), false, "replay section appears after solve");
    assert.equal(controls.classList.contains("hidden"), true, "controls stay collapsed until Replay solve is pressed");
    assert.equal(analysis.open, false, "analysis is hidden by default");
  });
});

test("replay UI step, play, and pause controls advance frames on demand", async () => {
  await withDom(async ({ flushNext, timers }) => {
    const replay = captureReplay("ui-controls", replayMoves("ui-controls", 3));
    const seen = [];
    const mount = fakeEl("div");
    const ui = createReplayUI({ mountEl: mount, replay, onFrame: (frame) => seen.push(frame.moveId) });

    ui.show({ replay });
    await ui.begin();
    assert.equal(ui.elements.controls.classList.contains("hidden"), false);

    await ui.step();
    assert.deepEqual(seen, [replay.moves[0]]);
    assert.equal(ui.index, 1);

    await ui.play();
    assert.equal(ui.playing, true);
    assert.equal(timers.find((timer) => timer.active).delay, 250);

    await flushNext();
    assert.deepEqual(seen, [replay.moves[0], replay.moves[1]]);
    assert.equal(ui.index, 2);

    ui.pause();
    assert.equal(ui.playing, false);
    assert.equal(timers.some((timer) => timer.active), false);
  });
});

test("replay UI renders the required analysis but keeps it closed by default", async () => {
  await withDom(() => {
    const replay = captureReplay("ui-analysis", replayMoves("ui-analysis", 1));
    const mount = fakeEl("div");
    const ui = createReplayUI({ mountEl: mount, replay });

    ui.show({ replay, analysis: { moveCount: 7, par: 5, targetLegalMoment: 4 } });

    const text = findAll(ui.elements.details, () => true).map((node) => node.textContent).join(" ");
    assert.equal(ui.elements.details.open, false);
    assert.match(text, /Moves/);
    assert.match(text, /7/);
    assert.match(text, /Par/);
    assert.match(text, /5/);
    assert.match(text, /Target legal/);
    assert.match(text, /after 4 moves/);
  });
});

test("replay UI speed selector changes playback timer speed", async () => {
  await withDom(async ({ timers }) => {
    const replay = captureReplay("ui-speed", replayMoves("ui-speed", 2));
    const mount = fakeEl("div");
    const ui = createReplayUI({ mountEl: mount, replay });

    ui.show({ replay });
    await ui.begin();
    ui.elements.speedSelect.value = "2";
    await ui.elements.speedSelect.dispatch("change");
    assert.equal(ui.speed, 2);

    await ui.play();
    assert.equal(timers.find((timer) => timer.active).delay, 125);
  });
});
