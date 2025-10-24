/* BossRiseX 2048 - Upgraded
   Features:
   - Undo (single step)
   - Timer
   - Move counter
   - Sound effects (merge, move, win, lose)
   - Mute toggle (no external files)
   - Keyboard + swipe support
   - English-only UI
*/

const SIZE = 4;
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const timerEl = document.getElementById('timer');
const movesEl = document.getElementById('moves');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const continueBtn = document.getElementById('continue-btn');
const playAgainBtn = document.getElementById('play-again');
const newGameBtn = document.getElementById('new-game');
const undoBtn = document.getElementById('undo');
const muteBtn = document.getElementById('mute');

let grid = [];
let score = 0;
let best = Number(localStorage.getItem('boss2048_best') || 0);
bestEl.textContent = best;

let moveCount = 0;
let timerSeconds = 0;
let timerInterval = null;
let gameRunning = true;

let historyStack = []; // store last state for undo (one-step)
let isMuted = false;

// audio context
let audioCtx = null;
function initAudio() {
  if (audioCtx === null) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
}
function playTone(freq = 440, duration = 0.08, type = 'sine') {
  if (isMuted) return;
  initAudio();
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0.08;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  o.stop(audioCtx.currentTime + duration + 0.02);
}
function playMergeSound(){ playTone(520, 0.06, 'sawtooth'); }
function playMoveSound(){ playTone(320, 0.04, 'sine'); }
function playWinSound(){
  playTone(800, 0.12, 'triangle');
  setTimeout(()=> playTone(640, 0.12, 'triangle'), 120);
}
function playLoseSound(){ playTone(180, 0.18, 'sine'); }

// helpers for layout
const CELL_GAP = 12;
const PADDING = 18;

function init() {
  // setup grid and UI
  grid = Array.from({length: SIZE}, () => Array(SIZE).fill(0));
  score = 0;
  moveCount = 0;
  timerSeconds = 0;
  gameRunning = true;
  historyStack = [];
  scoreEl.textContent = score;
  movesEl.textContent = moveCount;
  timerEl.textContent = formatTime(timerSeconds);
  overlay.classList.add('hidden');
  renderSlots();
  addRandom(); addRandom();
  renderTiles(true);
  clearInterval(timerInterval);
  timerInterval = setInterval(()=> {
    timerSeconds++;
    timerEl.textContent = formatTime(timerSeconds);
  }, 1000);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2,'0');
  const s = (sec % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function renderSlots(){
  boardEl.innerHTML = '';
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const slot = document.createElement('div');
      slot.className = 'slot';
      boardEl.appendChild(slot);
    }
  }
}

function boardRect() { return boardEl.getBoundingClientRect(); }
function cellSize(){
  const rect = boardRect();
  const totalGap = (SIZE - 1) * CELL_GAP;
  const totalPad = PADDING * 2;
  const size = (rect.width - totalGap - totalPad) / SIZE;
  return size;
}

function addRandom(){
  let empties = [];
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (grid[r][c] === 0) empties.push([r,c]);
  if (empties.length === 0) return false;
  const [r,c] = empties[Math.floor(Math.random() * empties.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
}

function renderTiles(instant=false){
  // remove old tiles
  const existing = boardEl.querySelectorAll('.tile');
  existing.forEach(t => t.remove());
  const size = cellSize();
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const val = grid[r][c];
      if (val === 0) continue;
      const tile = document.createElement('div');
      tile.className = 'tile';
      // classes for styling size and color
      if (val <= 8) tile.classList.add('small');
      else if (val <= 128) tile.classList.add('medium');
      else tile.classList.add('large');

      tile.classList.add(val <= 2048 ? `v${val}` : 'vbig');
      tile.textContent = val;
      tile.style.width = `${size}px`;
      tile.style.height = `${size}px`;
      const top = PADDING + r * (size + CELL_GAP);
      const left = PADDING + c * (size + CELL_GAP);
      tile.style.top = `${top}px`;
      tile.style.left = `${left}px`;

      if (!instant) {
        tile.style.transform = 'scale(0.12)';
        requestAnimationFrame(()=> {
          tile.style.transition = 'transform 140ms ease';
          tile.style.transform = 'scale(1)';
        });
      }
      boardEl.appendChild(tile);
    }
  }
}

/* Move & merge logic
   We'll use rotation trick: normalize direction to 'left' then rotate back.
   Maintain history: push a deep copy of grid + score so we can undo.
*/
function cloneGrid(g){ return g.map(row => row.slice()); }

function pushHistory() {
  // keep only last state
  historyStack = [{ grid: cloneGrid(grid), score, moveCount, timerSeconds }];
}

function rotateGrid(times=1){
  for (let t=0;t<times;t++){
    const newG = Array.from({length: SIZE}, () => Array(SIZE).fill(0));
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) newG[c][SIZE-1-r] = grid[r][c];
    grid = newG;
  }
}

function slideLeftRow(row){
  let arr = row.filter(v => v !== 0);
  let merged = Array(arr.length).fill(false);
  let changed = false;
  for (let i=0;i<arr.length-1;i++){
    if (!merged[i] && !merged[i+1] && arr[i] === arr[i+1]){
      arr[i] *= 2;
      arr[i+1] = 0;
      score += arr[i];
      merged[i] = true;
      merged[i+1] = false;
      changed = true;
    }
  }
  arr = arr.filter(v => v !== 0);
  while (arr.length < SIZE) arr.push(0);
  if (!changed) {
    for (let i=0;i<SIZE;i++) if (row[i] !== arr[i]) { changed = true; break; }
  }
  return { newRow: arr, changed };
}

function moveLeft(){
  let moved = false;
  let mergedHappened = false;
  for (let r=0;r<SIZE;r++){
    const { newRow, changed } = slideLeftRow(grid[r]);
    if (changed) {
      moved = true;
      grid[r] = newRow;
      // detect merge to play sound (approx)
      // merged detection done by comparing sums
      mergedHappened = true;
    }
  }
  return { moved, mergedHappened };
}

function move(direction){ // left, right, up, down
  if (!gameRunning) return;
  // store pre-move state to history only when a real move happens
  // We'll push history just before we change grid, but only keep last.
  let rotated = 0;
  if (direction === 'up'){ rotateGrid(1); rotated = 1; }
  else if (direction === 'right'){ rotateGrid(2); rotated = 2; }
  else if (direction === 'down'){ rotateGrid(3); rotated = 3; }

  // Keep a snapshot for undo
  const beforeGrid = cloneGrid(grid);
  const beforeScore = score;

  const { moved } = moveLeft();

  if (rotated) rotateGrid((4-rotated)%4);

  if (moved) {
    // push history (only last)
    historyStack = [{ grid: beforeGrid, score: beforeScore, moveCount, timerSeconds }];
    addRandom();
    renderTiles();
    moveCount++;
    movesEl.textContent = moveCount;
    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      localStorage.setItem('boss2048_best', best);
      bestEl.textContent = best;
    }
    // play sounds: simple heuristic - if score increased play merge else move
    if (score > beforeScore) playMergeSound(); else playMoveSound();

    if (checkWin()) {
      showOverlay('You win!', 'Congratulations — you reached 2048.');
      playWinSound();
      // allow continue or new game via overlay controls
    } else if (!canMove()) {
      showOverlay('Game Over', 'No more moves available.');
      playLoseSound();
      gameRunning = false;
    }
  }
}

function canMove(){
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      if (grid[r][c] === 0) return true;
      const v = grid[r][c];
      if (r+1<SIZE && grid[r+1][c] === v) return true;
      if (c+1<SIZE && grid[r][c+1] === v) return true;
    }
  }
  return false;
}

function checkWin(){
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (grid[r][c] === 2048) return true;
  return false;
}

/* Undo */
function undo(){
  if (historyStack.length === 0) return;
  const last = historyStack.pop();
  grid = cloneGrid(last.grid);
  score = last.score;
  moveCount = last.moveCount || 0;
  timerSeconds = last.timerSeconds || 0;
  // update UI
  scoreEl.textContent = score;
  movesEl.textContent = moveCount;
  timerEl.textContent = formatTime(timerSeconds);
  renderTiles(true);
  playMoveSound();
}

/* Input handlers */
document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('hidden')) return;
  const key = e.key;
  if (key === 'ArrowLeft') move('left');
  else if (key === 'ArrowRight') move('right');
  else if (key === 'ArrowUp') move('up');
  else if (key === 'ArrowDown') move('down');
});

let touchStartX = 0, touchStartY = 0;
boardEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, {passive:true});

boardEl.addEventListener('touchend', (e) => {
  if (!gameRunning) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) move('right'); else move('left');
  } else {
    if (dy > 0) move('down'); else move('up');
  }
});

/* UI & overlay controls */
function showOverlay(title, sub){
  overlayTitle.textContent = title;
  overlaySub.textContent = sub || '';
  overlay.classList.remove('hidden');
}
continueBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
});
playAgainBtn.addEventListener('click', () => {
  init();
});
newGameBtn.addEventListener('click', () => {
  init();
});
undoBtn.addEventListener('click', () => {
  undo();
});
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
});

/* on resize re-render */
window.addEventListener('resize', ()=> renderTiles(true));

/* initialize and start */
function start() {
  // create default slots then init game
  renderSlots();
  // ensure initial best shown
  bestEl.textContent = best;
  init();
}
start();