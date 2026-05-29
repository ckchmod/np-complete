// THE LOCK — bootstrap. Intro -> tutorials -> Rush (Survival).

import { TUTORIALS } from "./levels.js";
import { createGame } from "./game.js";
import { createRush } from "./rush.js";

const STORAGE_TUT_DONE = "the-lock:tutorials-done";
function markTutorialsDone() {
  try { localStorage.setItem(STORAGE_TUT_DONE, "1"); } catch (_) {}
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const mountEl  = document.getElementById("app");
const titleEl  = document.getElementById("level-title");
const hintEl   = document.getElementById("level-hint");
const navPrev  = document.getElementById("nav-prev");
const navNext  = document.getElementById("nav-next");
const navSkip  = document.getElementById("nav-skip");
const navLabel = document.getElementById("nav-label");
const introEl  = document.getElementById("intro");
const btnStart = document.getElementById("btn-start");
const btnSkipTutorial = document.getElementById("btn-skip-tutorial");
const btnHelp  = document.getElementById("btn-help");
const rushOver = document.getElementById("rush-over");

let currentIndex = 0;
let currentGame = null;
let rush = null;
let lastShare = "";

function hideResultCard() {
  const card = document.getElementById("result-card");
  if (card) { card.classList.remove("visible"); card.classList.add("hidden"); }
}

// ── Tutorials ─────────────────────────────────────────────────────────────────
function goTo(index) {
  if (index < 0 || index >= TUTORIALS.length) return;
  currentIndex = index;
  loadTutorial(TUTORIALS[currentIndex]);
}

function loadTutorial(level) {
  mountEl.classList.remove("mode-rush");
  if (titleEl) titleEl.textContent = level.name;
  if (hintEl) hintEl.textContent = level.hint || "";
  if (navPrev) navPrev.disabled = currentIndex === 0;
  if (navLabel) navLabel.textContent = currentIndex + 1 + " / " + TUTORIALS.length;
  hideResultCard();
  if (currentGame) currentGame.destroy();
  currentGame = createGame({
    level,
    mountEl,
    onWin() {
      setTimeout(() => {
        if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
        else enterRush();
      }, 1400);
    },
  });
}

// ── Rush ──────────────────────────────────────────────────────────────────────
function enterRush() {
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  if (rush) { rush.destroy(); rush = null; }
  markTutorialsDone();
  hideResultCard();
  if (rushOver) { rushOver.classList.remove("visible"); rushOver.classList.add("hidden"); }
  mountEl.classList.add("mode-rush");
  if (titleEl) titleEl.textContent = "RUSH";
  if (hintEl) hintEl.innerHTML = 'Reverse the <span class="intro-red">red</span> arrow · every node needs <b>2</b> pointing in';
  const seed = (Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  rush = createRush({ mountEl, seed, onGameOver: showRushOver });
}

function showRushOver({ solved, best, prevBest, isBest, totalMoves, shareText }) {
  lastShare = shareText;
  const fs = document.getElementById("rush-final-score");
  const bestEl = document.getElementById("rush-best");
  const statsEl = document.getElementById("rush-stats");
  if (statsEl) statsEl.textContent = (totalMoves || 0) + " move" + (totalMoves === 1 ? "" : "s") + " total";
  if (bestEl) {
    bestEl.textContent = isBest ? "★ new best!"
      : prevBest > 0 ? (solved === prevBest ? "matched your best" : (prevBest - solved) + " from your best")
      : "best " + best;
  }
  if (rushOver) { rushOver.classList.remove("hidden"); rushOver.classList.add("visible"); }
  if (fs) countUp(fs, solved);
}

// Count a number up to `to` (skipped under reduced motion).
function countUp(el, to) {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || to <= 0) { el.textContent = String(to); return; }
  const dur = Math.min(800, 150 + to * 55);
  const t0 = performance.now();
  (function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 2))));
    if (k < 1) requestAnimationFrame(step);
  })(performance.now());
}

// ── Nav wiring ──────────────────────────────────────────────────────────────
if (navPrev) navPrev.addEventListener("click", () => goTo(currentIndex - 1));
if (navNext) navNext.addEventListener("click", () => {
  if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
  else enterRush();
});
if (navSkip) navSkip.addEventListener("click", enterRush);

const btnRushAgain = document.getElementById("btn-rush-again");
const btnRushShare = document.getElementById("btn-rush-share");
if (btnRushAgain) btnRushAgain.addEventListener("click", enterRush);
if (btnRushShare) btnRushShare.addEventListener("click", () => {
  if (navigator.clipboard && lastShare) navigator.clipboard.writeText(lastShare).catch(() => {});
  const o = btnRushShare.textContent;
  btnRushShare.textContent = "Copied!";
  setTimeout(() => (btnRushShare.textContent = o), 1500);
});

// ── Intro / objective overlay ──────────────────────────────────────────────────
const STORAGE_INTRO_SEEN = "the-lock:intro-seen";
function hideIntro() { if (introEl) introEl.classList.add("hidden"); }
function showIntro() { if (introEl) introEl.classList.remove("hidden"); }
if (btnStart) btnStart.addEventListener("click", () => {
  try { localStorage.setItem(STORAGE_INTRO_SEEN, "1"); } catch (_) {}
  hideIntro();
});
if (btnSkipTutorial) btnSkipTutorial.addEventListener("click", () => {
  try { localStorage.setItem(STORAGE_INTRO_SEEN, "1"); } catch (_) {}
  hideIntro();
  enterRush(); // jump straight into Rush, skipping the tutorials
});
if (btnHelp) btnHelp.addEventListener("click", showIntro);
try { if (localStorage.getItem(STORAGE_INTRO_SEEN)) hideIntro(); } catch (_) {}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Always open on the tutorials (behind the intro). "Skip to Rush" jumps ahead.
goTo(0);
