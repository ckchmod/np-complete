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
const rushIntro = document.getElementById("rush-intro");
const btnRushStart = document.getElementById("btn-rush-start");

let currentIndex = 0;
let currentGame = null;
let rush = null;
let lastShare = "";
let handoffTimer = null; // the 1400ms post-win handoff timer (cleared on any navigation)

function hideResultCard() {
  const card = document.getElementById("result-card");
  if (card) { card.classList.remove("visible"); card.classList.add("hidden"); }
}

// Cancel a pending post-win handoff so it can't fire after the player already
// navigated (e.g. tapped "Skip to Rush" within the 1400ms savour delay).
function clearHandoff() {
  if (handoffTimer) { clearTimeout(handoffTimer); handoffTimer = null; }
}

// ── Tutorials ─────────────────────────────────────────────────────────────────
function goTo(index) {
  if (index < 0 || index >= TUTORIALS.length) return;
  currentIndex = index;
  loadTutorial(TUTORIALS[currentIndex]);
}

function loadTutorial(level) {
  clearHandoff();
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
      handoffTimer = setTimeout(() => {
        handoffTimer = null;
        if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
        else showRushRules(true); // last tutorial cleared → Rush rules, then Rush
      }, 1400);
    },
  });
}

// ── Rush ──────────────────────────────────────────────────────────────────────
function enterRush() {
  clearHandoff();
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

// ── Rush-rules interstitial ───────────────────────────────────────────────────
// One overlay, two roles. As a GATE (tutorial→Rush handoff) its button starts a
// fresh run; opened from "?" during a run it freezes the run and its button just
// resumes. The role is the current screen (mode-rush), so the button derives it
// at click time — no separate flag to keep in sync.
function showRushRules(asGate) {
  clearHandoff();
  if (btnRushStart) btnRushStart.textContent = asGate ? "Start picking" : "Resume";
  hideResultCard();                  // clear any leftover tutorial result-card (gate after a win)
  if (!asGate && rush) rush.pause(); // help mid-run: freeze the in-flight transition so it can't fire behind the modal
  if (rushIntro) rushIntro.classList.remove("hidden");
}
if (btnRushStart) btnRushStart.addEventListener("click", () => {
  if (rushIntro) rushIntro.classList.add("hidden");
  if (mountEl.classList.contains("mode-rush")) { if (rush) rush.resume(); } // resume the frozen run
  else enterRush();                                                         // gate: start a fresh run
});

// ── Nav wiring ──────────────────────────────────────────────────────────────
if (navPrev) navPrev.addEventListener("click", () => goTo(currentIndex - 1));
if (navNext) navNext.addEventListener("click", () => {
  if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
  else showRushRules(true);
});
if (navSkip) navSkip.addEventListener("click", () => showRushRules(true));

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
  showRushRules(true); // skip the tutorials, but still show the Rush rules first
});
// Help is context-aware: the Rush rules during a run, the how-to-play intro
// during the tutorials.
if (btnHelp) btnHelp.addEventListener("click", () => {
  if (mountEl.classList.contains("mode-rush")) showRushRules(false);
  else showIntro();
});
try { if (localStorage.getItem(STORAGE_INTRO_SEEN)) hideIntro(); } catch (_) {}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Always open on the tutorials (behind the intro). "Skip to Rush" jumps ahead.
goTo(0);
