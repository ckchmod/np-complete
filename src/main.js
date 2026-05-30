// THE LOCK — bootstrap. Intro -> tutorials -> mode selection -> Rush/Battle.

import { TUTORIALS } from "./levels.js";
import { createGame } from "./game.js";
import { createRush } from "./rush.js";
import { createBattle } from "./battle.js";

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
const battleIntro = document.getElementById("battle-intro");
const btnBattleClose = document.getElementById("btn-battle-close");
const modeSelect = document.getElementById("mode-select");
const btnRushMode = document.getElementById("rush-mode-button");
const btnBattleMode = document.getElementById("battle-mode-button");
const battleBoard = document.getElementById("battle-board");
const battleTurn = document.getElementById("battle-turn");
const battleStatus = document.getElementById("battle-status");
const battleResult = document.getElementById("battle-result");
const battleResultMessage = document.getElementById("battle-result-message");
const btnBattleAgain = document.getElementById("btn-battle-again");
const btnBattleMenu = document.getElementById("btn-battle-menu");

let currentIndex = 0;
let currentGame = null;
let rush = null;
let battle = null;
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

// True while any full-screen modal overlay is open — used to stop a second
// overlay (or an auto-advance) from appearing on top of an open one.
function anyOverlayOpen() {
  return [introEl, rushIntro, battleIntro, rushOver, modeSelect].some((el) => el && !el.classList.contains("hidden"));
}

// ── Tutorials ─────────────────────────────────────────────────────────────────
function goTo(index) {
  if (index < 0 || index >= TUTORIALS.length) return;
  currentIndex = index;
  loadTutorial(TUTORIALS[currentIndex]);
}

function loadTutorial(level) {
  clearHandoff();
  mountEl.classList.remove("mode-rush", "mode-battle");
  hideModeSelect();
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
        if (anyOverlayOpen()) return; // player opened a modal (e.g. "?") during the win — don't auto-advance behind it
        if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
        else showModeSelect(); // last tutorial cleared → player chooses Rush or Battle
      }, 1400);
    },
  });
}


// ── Mode selection ─────────────────────────────────────────────────────────────
function hideModeSelect() {
  if (modeSelect) modeSelect.classList.add("hidden");
}

function destroyRush() {
  if (rush) { rush.destroy(); rush = null; }
}

function destroyBattle() {
  if (battle) { battle.destroy(); battle = null; }
}

function showModeSelect() {
  clearHandoff();
  hideResultCard();
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  destroyRush();
  destroyBattle();
  if (rushIntro) rushIntro.classList.add("hidden");
  if (battleIntro) battleIntro.classList.add("hidden");
  if (rushOver) { rushOver.classList.remove("visible"); rushOver.classList.add("hidden"); }
  if (battleResultMessage) battleResultMessage.textContent = "";
  if (battleResult) battleResult.classList.add("hidden");
  mountEl.classList.remove("mode-rush", "mode-battle");
  if (titleEl) titleEl.textContent = "CHOOSE MODE";
  if (hintEl) hintEl.textContent = "Pick a way through the lock.";
  if (modeSelect) modeSelect.classList.remove("hidden");
  else showRushRules(true);
}

function enterBattle() {
  clearHandoff();
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  destroyRush();
  destroyBattle();
  markTutorialsDone();
  hideResultCard();
  hideModeSelect();
  if (rushIntro) rushIntro.classList.add("hidden");
  if (battleIntro) battleIntro.classList.add("hidden");
  if (rushOver) { rushOver.classList.remove("visible"); rushOver.classList.add("hidden"); }
  if (battleResultMessage) battleResultMessage.textContent = "";
  if (battleResult) battleResult.classList.add("hidden");
  mountEl.classList.remove("mode-rush");
  mountEl.classList.add("mode-battle");
  if (titleEl) titleEl.textContent = "BATTLE";
  if (hintEl) hintEl.textContent = "White moves first. Reverse your target before you run out of legal moves.";
  const seed = (Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  battle = createBattle({
    mountEl,
    refs: { boardEl: battleBoard, turnEl: battleTurn, statusEl: battleStatus },
    seed,
    onTerminal({ message }) {
      if (battleResultMessage) battleResultMessage.textContent = message;
      if (battleResult) battleResult.classList.remove("hidden");
    },
  });
  battle.start();
}

// ── Rush ──────────────────────────────────────────────────────────────────────
function enterRush() {
  clearHandoff();
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  destroyRush();
  destroyBattle();
  markTutorialsDone();
  hideResultCard();
  if (rushOver) { rushOver.classList.remove("visible"); rushOver.classList.add("hidden"); }
  if (battleIntro) battleIntro.classList.add("hidden");
  hideModeSelect();
  mountEl.classList.remove("mode-battle");
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

// ── Battle rules overlay ──────────────────────────────────────────────────────
function showBattleRules() {
  clearHandoff();
  hideResultCard();
  if (battleIntro) battleIntro.classList.remove("hidden");
}
if (btnBattleClose) btnBattleClose.addEventListener("click", () => {
  if (battleIntro) battleIntro.classList.add("hidden");
});

// ── Nav wiring ──────────────────────────────────────────────────────────────
if (navPrev) navPrev.addEventListener("click", () => goTo(currentIndex - 1));
if (navNext) navNext.addEventListener("click", () => {
  if (currentIndex < TUTORIALS.length - 1) goTo(currentIndex + 1);
  else showModeSelect();
});
if (navSkip) navSkip.addEventListener("click", showModeSelect);

// Reset / "Play again" cancels a pending auto-advance so a deliberate replay
// isn't yanked to the next level by the post-win handoff timer.
const btnReset = document.getElementById("btn-reset");
if (btnReset) btnReset.addEventListener("click", clearHandoff);

const btnRushAgain = document.getElementById("btn-rush-again");
const btnRushMenu = document.getElementById("btn-rush-menu");
const btnRushShare = document.getElementById("btn-rush-share");
if (btnRushAgain) btnRushAgain.addEventListener("click", enterRush);
if (btnRushMenu) btnRushMenu.addEventListener("click", showModeSelect);
if (btnBattleAgain) btnBattleAgain.addEventListener("click", enterBattle);
if (btnBattleMenu) btnBattleMenu.addEventListener("click", showModeSelect);
if (btnRushMode) btnRushMode.addEventListener("click", enterRush);
if (btnBattleMode) btnBattleMode.addEventListener("click", enterBattle);
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
  showModeSelect(); // skip the tutorials, but still choose a mode first
});
// Help is context-aware: the Rush rules during a run, the how-to-play intro
// during the tutorials.
if (btnHelp) btnHelp.addEventListener("click", () => {
  if (anyOverlayOpen()) return; // an overlay is already up — don't stack a second one
  if (mountEl.classList.contains("mode-rush")) showRushRules(false);
  else if (mountEl.classList.contains("mode-battle")) showBattleRules();
  else showIntro();
});
try { if (localStorage.getItem(STORAGE_INTRO_SEEN)) hideIntro(); } catch (_) {}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Always open on the tutorials (behind the intro). "Skip to Rush" jumps ahead.
goTo(0);
