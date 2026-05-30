import { playbackMoves } from "./replay.js";

const SPEEDS = [0.5, 1, 2];

function el(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setHidden(node, hidden) {
  node.classList.toggle("hidden", hidden);
}

function formatMoment(value) {
  if (Number.isInteger(value) && value >= 0) return "after " + value + " moves";
  return "not before solve";
}

function normalizeAnalysis(replay, frames, analysis) {
  return {
    moveCount: Number.isInteger(analysis.moveCount) ? analysis.moveCount : replay?.moves?.length ?? frames.length,
    par: Number.isInteger(analysis.par) ? analysis.par : "—",
    targetLegalMoment: analysis.targetLegalMoment,
    battle: analysis.battle === true,
    checkMoments: Array.isArray(analysis.checkMoments) ? analysis.checkMoments : [],
    missedDefenses: Array.isArray(analysis.missedDefenses) ? analysis.missedDefenses : [],
    zugzwangStates: Array.isArray(analysis.zugzwangStates) ? analysis.zugzwangStates : [],
  };
}

function formatBattleMoments(items) {
  if (!items.length) return "0";
  const moments = items
    .map((item) => Number.isInteger(item.moveNumber) ? item.moveNumber : null)
    .filter((value) => value !== null);
  return moments.length ? items.length + " · moves " + moments.join(", ") : String(items.length);
}

export function createReplayUI({
  mountEl,
  replay = null,
  frames = null,
  analysis = {},
  onFrame = () => {},
  onReplayStart = () => {},
  onReplayEnd = () => {},
  delayMs = 250,
  playback = playbackMoves,
} = {}) {
  if (!mountEl) throw new TypeError("createReplayUI requires mountEl");

  const root = el("section", "replay-ui hidden");
  root.setAttribute("aria-label", "Replay controls");

  const replayButton = el("button", "btn btn-secondary replay-open", "Replay solve");
  replayButton.type = "button";

  const controls = el("div", "replay-controls hidden");
  const playButton = el("button", "btn btn-primary", "Play");
  const pauseButton = el("button", "btn btn-secondary", "Pause");
  const stepButton = el("button", "btn btn-secondary", "Step");
  const speedLabel = el("label", "replay-speed-label", "Speed");
  const speedSelect = el("select", "replay-speed");
  const progress = el("div", "replay-progress", "0 / 0");
  const details = el("details", "replay-analysis");
  const summary = el("summary", "replay-analysis-summary", "Analysis");
  const analysisGrid = el("div", "replay-analysis-grid");

  playButton.type = "button";
  pauseButton.type = "button";
  stepButton.type = "button";

  for (const speed of SPEEDS) {
    const option = el("option", "", speed + "×");
    option.value = String(speed);
    if (speed === 1) option.selected = true;
    speedSelect.appendChild(option);
  }

  speedLabel.appendChild(speedSelect);
  controls.appendChild(playButton);
  controls.appendChild(pauseButton);
  controls.appendChild(stepButton);
  controls.appendChild(speedLabel);
  controls.appendChild(progress);
  details.appendChild(summary);
  details.appendChild(analysisGrid);
  root.appendChild(replayButton);
  root.appendChild(controls);
  root.appendChild(details);
  mountEl.appendChild(root);

  let currentReplay = replay;
  let currentFrames = Array.isArray(frames) ? frames.slice() : [];
  let currentAnalysis = analysis;
  let framesLoaded = Array.isArray(frames);
  let index = 0;
  let speed = 1;
  let timer = null;
  let playing = false;
  let destroyed = false;

  function renderAnalysis() {
    const data = normalizeAnalysis(currentReplay, currentFrames, currentAnalysis || {});
    analysisGrid.textContent = "";
    const rows = [
      ["Moves", String(data.moveCount)],
      ["Par", String(data.par)],
      ["Target legal", formatMoment(data.targetLegalMoment)],
    ];
    if (data.battle) {
      rows.splice(1, 2,
        ["Check moments", formatBattleMoments(data.checkMoments)],
        ["Missed defenses", formatBattleMoments(data.missedDefenses)],
        ["Zugzwang", formatBattleMoments(data.zugzwangStates)]
      );
    }
    for (const [label, value] of rows) {
      const row = el("div", "replay-analysis-row");
      row.appendChild(el("span", "replay-analysis-label", label));
      row.appendChild(el("span", "replay-analysis-value", value));
      analysisGrid.appendChild(row);
    }
  }

  function renderProgress() {
    progress.textContent = index + " / " + currentFrames.length;
    stepButton.disabled = index >= currentFrames.length;
    playButton.disabled = playing || index >= currentFrames.length;
    pauseButton.disabled = !playing;
  }

  async function loadFrames() {
    if (framesLoaded) return currentFrames;
    if (!currentReplay) return [];
    const collected = [];
    const result = await playback(currentReplay, (frame) => collected.push(frame), { delayMs: 0, speed });
    currentFrames = result ? collected : [];
    framesLoaded = true;
    renderAnalysis();
    renderProgress();
    return currentFrames;
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function pause() {
    playing = false;
    clearTimer();
    renderProgress();
  }

  async function step() {
    await loadFrames();
    if (index >= currentFrames.length) {
      pause();
      return null;
    }
    const frame = currentFrames[index];
    index++;
    onFrame(frame);
    if (index >= currentFrames.length) {
      playing = false;
      onReplayEnd(frame);
    }
    renderProgress();
    return frame;
  }

  function scheduleNext() {
    clearTimer();
    if (!playing) return;
    timer = setTimeout(async () => {
      timer = null;
      await step();
      if (playing) scheduleNext();
    }, delayMs / speed);
  }

  async function play() {
    await loadFrames();
    if (index >= currentFrames.length) return;
    playing = true;
    renderProgress();
    scheduleNext();
  }

  async function begin() {
    pause();
    await loadFrames();
    index = 0;
    setHidden(controls, false);
    onReplayStart();
    renderProgress();
  }

  function setSpeed(nextSpeed) {
    const parsed = Number(nextSpeed);
    speed = SPEEDS.includes(parsed) ? parsed : 1;
    speedSelect.value = String(speed);
    if (playing) scheduleNext();
  }

  function show(next = {}) {
    pause();
    currentReplay = next.replay || replay || currentReplay;
    currentFrames = Array.isArray(next.frames) ? next.frames.slice() : Array.isArray(frames) ? frames.slice() : [];
    framesLoaded = Array.isArray(next.frames) || Array.isArray(frames);
    currentAnalysis = next.analysis || analysis || {};
    index = 0;
    details.open = false;
    setHidden(root, false);
    setHidden(controls, true);
    renderAnalysis();
    renderProgress();
  }

  function hide() {
    pause();
    setHidden(root, true);
    setHidden(controls, true);
  }

  function destroy() {
    destroyed = true;
    pause();
    replayButton.removeEventListener("click", begin);
    playButton.removeEventListener("click", play);
    pauseButton.removeEventListener("click", pause);
    stepButton.removeEventListener("click", step);
    speedSelect.removeEventListener("change", onSpeedChange);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function onSpeedChange() {
    setSpeed(speedSelect.value);
  }

  replayButton.addEventListener("click", begin);
  playButton.addEventListener("click", play);
  pauseButton.addEventListener("click", pause);
  stepButton.addEventListener("click", step);
  speedSelect.addEventListener("change", onSpeedChange);

  renderAnalysis();
  renderProgress();

  return {
    show,
    hide,
    begin,
    play,
    pause,
    step,
    setSpeed,
    destroy,
    get speed() { return speed; },
    get visible() { return !root.classList.contains("hidden"); },
    get playing() { return playing && !destroyed; },
    get index() { return index; },
    get elements() { return { root, replayButton, controls, playButton, pauseButton, stepButton, speedSelect, details, progress }; },
  };
}
