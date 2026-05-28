// THE LOCK — bootstrap. Tutorial flow then THE LOCK.

import { TUTORIALS, THE_LOCK } from "./levels.js";
import { createGame } from "./game.js";

// ── State ─────────────────────────────────────────────────────────────────────

const STORAGE_TUT_DONE = "the-lock:tutorials-done";

function tutorialsDone() {
  try { return !!localStorage.getItem(STORAGE_TUT_DONE); } catch (_) { return false; }
}
function markTutorialsDone() {
  try { localStorage.setItem(STORAGE_TUT_DONE, "1"); } catch (_) {}
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const mountEl   = document.getElementById("app");
const titleEl   = document.getElementById("level-title");
const hintEl    = document.getElementById("level-hint");
const navPrev   = document.getElementById("nav-prev");
const navNext   = document.getElementById("nav-next");
const navSkip   = document.getElementById("nav-skip");
const navLabel  = document.getElementById("nav-label");

// ── Level sequence ────────────────────────────────────────────────────────────

// Full sequence: 5 tutorials then THE LOCK.
const LEVELS = [...TUTORIALS, THE_LOCK];
let currentIndex = 0;
let currentGame  = null;

function isTheLock(level) {
  return level.id === "the-lock";
}

// ── Navigation ────────────────────────────────────────────────────────────────

function goTo(index) {
  if (index < 0 || index >= LEVELS.length) return;
  currentIndex = index;
  loadLevel(LEVELS[currentIndex]);
}

function loadLevel(level) {
  // Update title and hint
  if (titleEl)  titleEl.textContent  = level.name;
  if (hintEl)   hintEl.textContent   = isTheLock(level) ? level.hint : level.hint;

  // Nav buttons
  if (navPrev)  navPrev.disabled     = currentIndex === 0;
  if (navNext)  navNext.hidden       = isTheLock(level);
  if (navSkip)  navSkip.hidden       = isTheLock(level);
  if (navLabel) navLabel.textContent = isTheLock(level)
    ? "THE LOCK"
    : (currentIndex + 1) + " / " + TUTORIALS.length;

  // Hide result card from previous level
  const resultCard = document.getElementById("result-card");
  if (resultCard) {
    resultCard.classList.remove("visible");
    resultCard.classList.add("hidden");
  }

  // Tear down the previous session's control-button listeners before making a new one.
  if (currentGame) currentGame.destroy();

  // Create game session
  currentGame = createGame({
    level,
    mountEl,
    onWin() {
      if (isTheLock(level)) return; // result card handles it
      // For tutorials, auto-advance after a short delay
      setTimeout(() => {
        if (currentIndex < TUTORIALS.length - 1) {
          goTo(currentIndex + 1);
        } else {
          // All tutorials done: go to THE LOCK
          markTutorialsDone();
          goTo(TUTORIALS.length);
        }
      }, 1400);
    },
  });
}

// ── Wire nav buttons ──────────────────────────────────────────────────────────

if (navPrev) navPrev.addEventListener("click", () => goTo(currentIndex - 1));
if (navNext) navNext.addEventListener("click", () => goTo(currentIndex + 1));
if (navSkip) navSkip.addEventListener("click", () => {
  markTutorialsDone();
  goTo(TUTORIALS.length); // jump straight to THE LOCK
});

// ── Boot ──────────────────────────────────────────────────────────────────────

// If tutorials already completed, start at THE LOCK directly.
// Otherwise start from tutorial 1 (or resume at last incomplete).
if (tutorialsDone()) {
  currentIndex = TUTORIALS.length;
} else {
  currentIndex = 0;
}

loadLevel(LEVELS[currentIndex]);
