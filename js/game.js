'use strict';

/* ============================================================
   Cartman's Water — a Where's My Water?-style digging & fluid
   puzzle. Grid-based cellular-automaton liquid simulation
   (falling-sand style), dig tunnels through dirt to guide
   blue water into Cartman's mouth and purple water into the cup.
   ============================================================ */

// ---- Grid configuration -------------------------------------------------
const CELL = 4;                 // background px per grid cell
const GRID_W = 175;
const GRID_H = 125;
const BG_W = GRID_W * CELL;     // 700
const BG_H = GRID_H * CELL;     // 500

const EMPTY = 0, DIRT = 1, ROCK = 2, WATER = 3, PURPLE = 4;

// ---- Level geometry (grid coordinates) ------------------------------------
// The level is split into two independent corridors so the two liquids never
// have to cross paths: blue stays left of x~90, purple stays right of it.
const BLUE_GAP = [18, 26];      // spout opening columns [x0, x1)
const PURPLE_GAP = [148, 155];
const DIRT_TOP = 1, DIRT_BOTTOM = 123;
const FUNNEL_DEPTH = 3; // rows of pre-cleared shaft directly beneath each spout

// Both goals are enclosed rock basins dug into the ground (like Swampy's tub
// in the original game) so water collects right there instead of spreading
// across one big open floor.
const MOUTH_WALL = { x0: 46, x1: 88, y0: 97, y1: 122 };
const MOUTH_INTERIOR = { x0: MOUTH_WALL.x0 + 1, x1: MOUTH_WALL.x1 - 1, y0: MOUTH_WALL.y0 + 1, y1: MOUTH_WALL.y1 };
// Collection band sits lower in the basin so water visibly falls past
// Cartman's face and disappears roughly where his mouth is drawn.
const MOUTH_ZONE = { x0: MOUTH_INTERIOR.x0, x1: MOUTH_INTERIOR.x1, y0: 108, y1: 119 };
const CUP_WALL = { x0: 98, x1: 134, y0: 95, y1: 123 };
const CUP_INTERIOR = { x0: CUP_WALL.x0 + 1, x1: CUP_WALL.x1 - 1, y0: CUP_WALL.y0 + 1, y1: CUP_WALL.y1 };
// Collection band sits lower in the basin so purple water visibly falls
// past Butters' face and disappears roughly where his mouth is drawn.
const CUP_ZONE = { x0: CUP_INTERIOR.x0, x1: CUP_INTERIOR.x1, y0: 108, y1: 119 };

const CARTMAN_BOX = { x0: 42, y0: 84, x1: 92, y1: 123 };
const BUTTERS_BOX = { x0: 94, y0: 82, x1: 138, y1: 122 };

// Full-width rock bands, each with a separate diggable gap for blue and for
// purple, so a tunnel dug for one liquid never opens a shortcut for the other.
const LEDGES = [
  { x0: 10, x1: 165, y0: 28, y1: 32, gaps: [[58, 66], [140, 150]] },
  { x0: 10, x1: 165, y0: 55, y1: 59, gaps: [[66, 76], [108, 118]] },
];

const BLUE_BUDGET = 2600;
const PURPLE_BUDGET = 1000;
const WIN_BLUE_PCT = 80;
const SETTLE_FRAMES = 300; // ~5s at 60fps after budgets run out

// ---- State ---------------------------------------------------------------
let grid, flow, processed;
let blueRemaining, purpleRemaining, blueCollected, purpleCollected;
let settleCounter = -1;
let ended = false;
let frameCount = 0;
let particles = [];
let celebrated50 = false;   // one-shot "Cartman is happy" trigger at 50% blue collected
let celebrateFrame = -1;    // frame the celebration burst started, -1 = inactive
let currentBluePct = 0;

const bgCanvas = document.getElementById('bgCanvas');
const sandCanvas = document.getElementById('sandCanvas');
const waterCanvas = document.getElementById('waterCanvas');
const simCanvas = document.getElementById('simCanvas');
const fxCanvas = document.getElementById('fxCanvas');
const bgCtx = bgCanvas.getContext('2d');
const sandCtx = sandCanvas.getContext('2d', { alpha: true });
const waterCtx = waterCanvas.getContext('2d', { alpha: true });
const simCtx = simCanvas.getContext('2d', { alpha: true });
const fxCtx = fxCanvas.getContext('2d');

bgCanvas.width = BG_W; bgCanvas.height = BG_H;
sandCanvas.width = BG_W; sandCanvas.height = BG_H;
waterCanvas.width = BG_W; waterCanvas.height = BG_H;
simCanvas.width = GRID_W; simCanvas.height = GRID_H;
fxCanvas.width = BG_W; fxCanvas.height = BG_H;
simCtx.imageSmoothingEnabled = false;
sandCtx.imageSmoothingEnabled = true;
waterCtx.imageSmoothingEnabled = true;

const bluePctEl = document.getElementById('bluePct');
const purplePctEl = document.getElementById('purplePct');
const blueFillEl = document.getElementById('blueFill');
const purpleFillEl = document.getElementById('purpleFill');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayStars = document.getElementById('overlayStars');
const overlayText = document.getElementById('overlayText');
const overlayBtn = document.getElementById('overlayBtn');
const resetBtn = document.getElementById('resetBtn');
const stage = document.getElementById('stage');

const cartmanImg = new Image();
let cartmanLoaded = false;
cartmanImg.onload = () => { cartmanLoaded = true; drawBackground(); };
cartmanImg.src = 'assets/cartman.jpg';

const buttersImg = new Image();
let buttersLoaded = false;
buttersImg.onload = () => { buttersLoaded = true; drawBackground(); };
buttersImg.src = 'assets/butters.jpg';

// ---- Water texture (real photo, recolored for the purple liquid) --------
let blueTexCanvas = null, purpleTexCanvas = null, texReady = false;
const waterTexImg = new Image();
waterTexImg.onload = () => {
  blueTexCanvas = document.createElement('canvas');
  blueTexCanvas.width = waterTexImg.naturalWidth;
  blueTexCanvas.height = waterTexImg.naturalHeight;
  blueTexCanvas.getContext('2d').drawImage(waterTexImg, 0, 0);

  purpleTexCanvas = document.createElement('canvas');
  purpleTexCanvas.width = waterTexImg.naturalWidth;
  purpleTexCanvas.height = waterTexImg.naturalHeight;
  const pctx = purpleTexCanvas.getContext('2d');
  // shift the same caustics photo from blue toward purple/magenta
  pctx.filter = 'hue-rotate(95deg) saturate(1.4) brightness(1.02)';
  pctx.drawImage(waterTexImg, 0, 0);
  pctx.filter = 'none';

  texReady = true;
};
waterTexImg.src = 'assets/water_texture.jpg';

// ---- Faucet decoration (real photo, recolored for the purple spout) -----
let blueFaucetCanvas = null, purpleFaucetCanvas = null, faucetReady = false;
const faucetImg = new Image();
faucetImg.onload = () => {
  blueFaucetCanvas = document.createElement('canvas');
  blueFaucetCanvas.width = faucetImg.naturalWidth;
  blueFaucetCanvas.height = faucetImg.naturalHeight;
  blueFaucetCanvas.getContext('2d').drawImage(faucetImg, 0, 0);

  purpleFaucetCanvas = document.createElement('canvas');
  purpleFaucetCanvas.width = faucetImg.naturalWidth;
  purpleFaucetCanvas.height = faucetImg.naturalHeight;
  const pctx = purpleFaucetCanvas.getContext('2d');
  pctx.filter = 'hue-rotate(95deg) saturate(1.4) brightness(1.02)';
  pctx.drawImage(faucetImg, 0, 0);
  pctx.filter = 'none';

  faucetReady = true;
  drawBackground();
};
faucetImg.src = 'assets/faucet.webp';

// ---- Sand texture (real photo, replaces the flat pixel dirt color) ------
let sandTexCanvas = null, sandTexReady = false;
const sandTexImg = new Image();
sandTexImg.onload = () => {
  sandTexCanvas = document.createElement('canvas');
  sandTexCanvas.width = sandTexImg.naturalWidth;
  sandTexCanvas.height = sandTexImg.naturalHeight;
  sandTexCanvas.getContext('2d').drawImage(sandTexImg, 0, 0);
  sandTexReady = true;
};
sandTexImg.src = 'assets/sand_texture.jpg';

// ---- Level construction ---------------------------------------------------
function idx(x, y) { return y * GRID_W + x; }

function buildLevel() {
  grid = new Uint8Array(GRID_W * GRID_H);
  flow = new Int8Array(GRID_W * GRID_H);
  processed = new Uint8Array(GRID_W * GRID_H);

  // outer rock border
  for (let x = 0; x < GRID_W; x++) { grid[idx(x, 0)] = ROCK; grid[idx(x, GRID_H - 1)] = ROCK; }
  for (let y = 0; y < GRID_H; y++) { grid[idx(0, y)] = ROCK; grid[idx(GRID_W - 1, y)] = ROCK; }

  // spout gaps in the top border
  for (let x = BLUE_GAP[0]; x < BLUE_GAP[1]; x++) grid[idx(x, 0)] = EMPTY;
  for (let x = PURPLE_GAP[0]; x < PURPLE_GAP[1]; x++) grid[idx(x, 0)] = EMPTY;

  // dirt fill
  for (let y = DIRT_TOP; y <= DIRT_BOTTOM; y++) {
    for (let x = 1; x < GRID_W - 1; x++) grid[idx(x, y)] = DIRT;
  }

  // narrow pre-cleared shafts directly under each spout, so water/purple
  // only pools right at the pipe mouth until the player digs further
  for (const gap of [BLUE_GAP, PURPLE_GAP]) {
    for (let y = DIRT_TOP; y < DIRT_TOP + FUNNEL_DEPTH; y++) {
      for (let x = gap[0]; x < gap[1]; x++) grid[idx(x, y)] = EMPTY;
    }
  }

  // rock ledges with diggable gaps
  for (const l of LEDGES) {
    for (let y = l.y0; y < l.y1; y++) {
      for (let x = l.x0; x < l.x1; x++) {
        const inGap = l.gaps.some(([g0, g1]) => x >= g0 && x < g1);
        if (inGap) continue; // leave as dirt (diggable)
        grid[idx(x, y)] = ROCK;
      }
    }
  }

  // purple cup basin: rock walls on 3 sides, open top, dug into the dirt
  for (let y = CUP_WALL.y0; y < CUP_WALL.y1; y++) {
    grid[idx(CUP_WALL.x0, y)] = ROCK;
    grid[idx(CUP_WALL.x1 - 1, y)] = ROCK;
  }
  for (let x = CUP_WALL.x0; x < CUP_WALL.x1; x++) grid[idx(x, CUP_WALL.y1 - 1)] = ROCK;
  for (let y = CUP_INTERIOR.y0; y < CUP_INTERIOR.y1; y++) {
    for (let x = CUP_INTERIOR.x0; x < CUP_INTERIOR.x1; x++) grid[idx(x, y)] = EMPTY;
  }

  // Cartman's mouth basin: same idea, positioned under his face
  for (let y = MOUTH_WALL.y0; y < MOUTH_WALL.y1; y++) {
    grid[idx(MOUTH_WALL.x0, y)] = ROCK;
    grid[idx(MOUTH_WALL.x1 - 1, y)] = ROCK;
  }
  for (let x = MOUTH_WALL.x0; x < MOUTH_WALL.x1; x++) grid[idx(x, MOUTH_WALL.y1 - 1)] = ROCK;
  for (let y = MOUTH_INTERIOR.y0; y < MOUTH_INTERIOR.y1; y++) {
    for (let x = MOUTH_INTERIOR.x0; x < MOUTH_INTERIOR.x1; x++) grid[idx(x, y)] = EMPTY;
  }

  // Clear the dirt directly above each basin too, matching the portrait's
  // own box — otherwise undug dirt renders over the top of their faces.
  clearBoxAboveWall(CARTMAN_BOX, MOUTH_WALL);
  clearBoxAboveWall(BUTTERS_BOX, CUP_WALL);

  blueRemaining = BLUE_BUDGET;
  purpleRemaining = PURPLE_BUDGET;
  blueCollected = 0;
  purpleCollected = 0;
  settleCounter = -1;
  ended = false;
  frameCount = 0;
  particles = [];
  overlay.classList.add('hidden');
  stopDigSound();
  celebrated50 = false;
  celebrateFrame = -1;
  updateHud();
}

function clearBoxAboveWall(box, wall) {
  for (let y = box.y0; y < wall.y0; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (x <= 0 || y <= 0 || x >= GRID_W - 1 || y >= GRID_H - 1) continue;
      grid[idx(x, y)] = EMPTY;
    }
  }
}

// ---- Digging ---------------------------------------------------------------
let dragging = false;
const DIG_R = 3;

function stageToGrid(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const gx = Math.floor((clientX - rect.left) / rect.width * GRID_W);
  const gy = Math.floor((clientY - rect.top) / rect.height * GRID_H);
  return [gx, gy];
}

function digAt(gx, gy) {
  let dugAny = false;
  for (let dy = -DIG_R; dy <= DIG_R; dy++) {
    for (let dx = -DIG_R; dx <= DIG_R; dx++) {
      if (dx * dx + dy * dy > DIG_R * DIG_R) continue;
      const x = gx + dx, y = gy + dy;
      if (x <= 0 || y <= 0 || x >= GRID_W - 1 || y >= GRID_H - 1) continue;
      const i = idx(x, y);
      if (grid[i] === DIRT) { grid[i] = EMPTY; dugAny = true; }
    }
  }
  return dugAny;
}

// ---- Digging sound ---------------------------------------------------------
const digSound = new Audio('assets/dig_sand.mp3');
digSound.loop = true;
digSound.volume = 0.55;
function startDigSound() {
  if (digSound.paused) {
    digSound.currentTime = 0;
    digSound.play().catch(() => {});
  }
}
function stopDigSound() {
  if (!digSound.paused) digSound.pause();
}

function pointerPos(e) {
  if (e.touches && e.touches.length) return [e.touches[0].clientX, e.touches[0].clientY];
  return [e.clientX, e.clientY];
}

function onPointerDown(e) {
  if (ended) return;
  dragging = true;
  const [cx, cy] = pointerPos(e);
  const [gx, gy] = stageToGrid(cx, cy);
  const dug = digAt(gx, gy);
  if (dug) startDigSound(); else stopDigSound();
  e.preventDefault();
}
function onPointerMove(e) {
  if (!dragging || ended) return;
  const [cx, cy] = pointerPos(e);
  const [gx, gy] = stageToGrid(cx, cy);
  const dug = digAt(gx, gy);
  if (dug) startDigSound(); else stopDigSound();
  e.preventDefault();
}
function onPointerUp() { dragging = false; stopDigSound(); }

stage.addEventListener('mousedown', onPointerDown);
stage.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
stage.addEventListener('mouseleave', stopDigSound);
stage.addEventListener('touchstart', onPointerDown, { passive: false });
stage.addEventListener('touchmove', onPointerMove, { passive: false });
window.addEventListener('touchend', onPointerUp);
window.addEventListener('touchcancel', onPointerUp);
window.addEventListener('blur', stopDigSound);

// ---- Fluid simulation --------------------------------------------------
function moveCell(x, y, val) {
  const i = idx(x, y);
  const below = idx(x, y + 1);

  if (grid[below] === EMPTY) {
    grid[below] = val; grid[i] = EMPTY;
    flow[below] = flow[i]; flow[i] = 0;
    processed[below] = 1;
    return;
  }

  const leftDown = x > 0 ? idx(x - 1, y + 1) : -1;
  const rightDown = x < GRID_W - 1 ? idx(x + 1, y + 1) : -1;
  const canLD = leftDown >= 0 && grid[leftDown] === EMPTY;
  const canRD = rightDown >= 0 && grid[rightDown] === EMPTY;
  if (canLD || canRD) {
    let target;
    if (canLD && canRD) target = Math.random() < 0.5 ? leftDown : rightDown;
    else target = canLD ? leftDown : rightDown;
    grid[target] = val; grid[i] = EMPTY;
    flow[target] = 0; flow[i] = 0;
    processed[target] = 1;
    return;
  }

  const leftI = x > 0 ? idx(x - 1, y) : -1;
  const rightI = x < GRID_W - 1 ? idx(x + 1, y) : -1;
  const canL = leftI >= 0 && grid[leftI] === EMPTY;
  const canR = rightI >= 0 && grid[rightI] === EMPTY;
  if (!canL && !canR) return; // resting

  let dir = flow[i];
  if (dir === 1 && !canR) dir = 0;
  if (dir === -1 && !canL) dir = 0;
  if (dir === 0) dir = (canL && canR) ? (Math.random() < 0.5 ? -1 : 1) : (canL ? -1 : 1);

  const targetI = dir === 1 ? rightI : leftI;
  grid[targetI] = val; grid[i] = EMPTY;
  flow[targetI] = dir; flow[i] = 0;
  processed[targetI] = 1;
}

function stepSimulation() {
  processed.fill(0);
  const leftToRight = frameCount % 2 === 0;
  for (let y = GRID_H - 2; y >= 1; y--) {
    if (leftToRight) {
      for (let x = 1; x < GRID_W - 1; x++) stepCell(x, y);
    } else {
      for (let x = GRID_W - 2; x >= 1; x--) stepCell(x, y);
    }
  }
}
function stepCell(x, y) {
  const i = idx(x, y);
  if (processed[i]) return;
  const v = grid[i];
  if (v === WATER || v === PURPLE) moveCell(x, y, v);
}

function spawnSources() {
  if (blueRemaining > 0) {
    for (let n = 0; n < 2 && blueRemaining > 0; n++) {
      const x = BLUE_GAP[0] + Math.floor(Math.random() * (BLUE_GAP[1] - BLUE_GAP[0]));
      const i = idx(x, 1);
      if (grid[i] === EMPTY) { grid[i] = WATER; blueRemaining--; }
    }
  }
  if (purpleRemaining > 0) {
    const x = PURPLE_GAP[0] + Math.floor(Math.random() * (PURPLE_GAP[1] - PURPLE_GAP[0]));
    const i = idx(x, 1);
    if (grid[i] === EMPTY) { grid[i] = PURPLE; purpleRemaining--; }
  }
}

function collectZones() {
  for (let y = MOUTH_ZONE.y0; y < MOUTH_ZONE.y1; y++) {
    for (let x = MOUTH_ZONE.x0; x < MOUTH_ZONE.x1; x++) {
      const i = idx(x, y);
      if (grid[i] === WATER) {
        grid[i] = EMPTY; blueCollected++;
        spawnParticle(x, y, '#35b6ff');
      }
    }
  }
  for (let y = CUP_ZONE.y0; y < CUP_ZONE.y1; y++) {
    for (let x = CUP_ZONE.x0; x < CUP_ZONE.x1; x++) {
      const i = idx(x, y);
      if (grid[i] === PURPLE) {
        grid[i] = EMPTY; purpleCollected++;
        spawnParticle(x, y, '#a24fe0');
      }
    }
  }
}

function spawnParticle(gx, gy, color) {
  if (particles.length > 160) return;
  for (let k = 0; k < 3; k++) {
    particles.push({
      x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2,
      vx: (Math.random() - 0.5) * 2.2, vy: -Math.random() * 2.2 - 0.5,
      life: 24, maxLife: 24, size: 2.2, color
    });
  }
}

// Golden confetti burst for the "Cartman is happy" celebration
function spawnCelebrationBurst() {
  const cx = (CARTMAN_BOX.x0 + CARTMAN_BOX.x1) / 2 * CELL;
  const cy = (CARTMAN_BOX.y0 + CARTMAN_BOX.y1) / 2 * CELL;
  const colors = ['#ffd23f', '#ffef9f', '#ff9f43', '#fff6d9'];
  for (let k = 0; k < 36; k++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.5;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5,
      life: 55, maxLife: 55, size: 2.5 + Math.random() * 2,
      color: colors[k % colors.length]
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ---- HUD / win state --------------------------------------------------
function updateHud() {
  const bluePct = Math.min(100, Math.round(blueCollected / BLUE_BUDGET * 100));
  const purplePct = Math.min(100, Math.round(purpleCollected / PURPLE_BUDGET * 100));
  bluePctEl.textContent = bluePct + '%';
  purplePctEl.textContent = purplePct + '%';
  blueFillEl.style.width = bluePct + '%';
  purpleFillEl.style.width = purplePct + '%';
  return { bluePct, purplePct };
}

function checkEnd() {
  if (ended) return;
  if (blueRemaining <= 0 && purpleRemaining <= 0) {
    if (settleCounter < 0) settleCounter = SETTLE_FRAMES;
    settleCounter--;
    if (settleCounter <= 0) finishLevel();
  }
}

function finishLevel() {
  ended = true;
  stopDigSound();
  const { bluePct, purplePct } = updateHud();
  const win = bluePct >= WIN_BLUE_PCT;
  let stars = 0;
  if (win) {
    stars = 1;
    if (bluePct >= 95) stars++;
    if (purplePct >= 50) stars++;
  }
  overlayTitle.textContent = win ? 'Уровень пройден!' : 'Картман остался без воды!';
  overlayStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  overlayText.textContent = `Синей воды собрано: ${bluePct}% · Фиолетовой у Баттерса: ${purplePct}%`;
  overlayBtn.textContent = win ? 'Играть снова' : 'Попробовать снова';
  overlay.classList.remove('hidden');
}

resetBtn.addEventListener('click', buildLevel);
overlayBtn.addEventListener('click', buildLevel);

// ---- Rendering -----------------------------------------------------------
function drawBackground() {
  const g = bgCtx.createLinearGradient(0, 0, 0, BG_H);
  g.addColorStop(0, '#2f4d63');
  g.addColorStop(0.55, '#25404f');
  g.addColorStop(1, '#16262f');
  bgCtx.fillStyle = g;
  bgCtx.fillRect(0, 0, BG_W, BG_H);


  if (buttersLoaded) {
    const bx = BUTTERS_BOX.x0 * CELL, by = BUTTERS_BOX.y0 * CELL;
    const bw = (BUTTERS_BOX.x1 - BUTTERS_BOX.x0) * CELL, bh = (BUTTERS_BOX.y1 - BUTTERS_BOX.y0) * CELL;
    bgCtx.save();
    bgCtx.beginPath();
    roundRect(bgCtx, bx - 4, by - 4, bw + 8, bh + 8, 10);
    bgCtx.clip();
    bgCtx.drawImage(buttersImg, bx, by - 6, bw, bh + 12);
    bgCtx.restore();
    bgCtx.strokeStyle = '#c7a4e8';
    bgCtx.lineWidth = 3;
    roundRect(bgCtx, bx - 4, by - 4, bw + 8, bh + 8, 10);
    bgCtx.stroke();
  }

  if (cartmanLoaded) {
    const bx = CARTMAN_BOX.x0 * CELL, by = CARTMAN_BOX.y0 * CELL;
    const bw = (CARTMAN_BOX.x1 - CARTMAN_BOX.x0) * CELL, bh = (CARTMAN_BOX.y1 - CARTMAN_BOX.y0) * CELL;
    const cx = bx + bw / 2, cy = by + bh / 2;
    const happy = currentBluePct >= 50;

    // soft golden glow once more than half the water has reached him
    if (happy) {
      const pulse = 0.55 + 0.25 * Math.sin(frameCount * 0.08);
      const glowR = Math.max(bw, bh) * 0.75;
      const glow = bgCtx.createRadialGradient(cx, cy, glowR * 0.2, cx, cy, glowR);
      glow.addColorStop(0, `rgba(255,214,90,${0.55 * pulse})`);
      glow.addColorStop(1, 'rgba(255,214,90,0)');
      bgCtx.fillStyle = glow;
      bgCtx.beginPath();
      bgCtx.arc(cx, cy, glowR, 0, Math.PI * 2);
      bgCtx.fill();
    }

    // one-shot elastic bounce/wiggle the instant the 50% mark is crossed
    let scale = 1, rotate = 0;
    if (celebrateFrame >= 0) {
      const t = frameCount - celebrateFrame;
      const decay = Math.exp(-t * 0.05);
      if (decay > 0.02) {
        scale = 1 + 0.22 * Math.sin(t * 0.4) * decay;
        rotate = Math.sin(t * 0.55) * 0.1 * decay;
      }
    }

    bgCtx.save();
    bgCtx.translate(cx, cy);
    bgCtx.rotate(rotate);
    bgCtx.scale(scale, scale);
    bgCtx.translate(-cx, -cy);

    bgCtx.save();
    bgCtx.beginPath();
    roundRect(bgCtx, bx - 4, by - 4, bw + 8, bh + 8, 10);
    bgCtx.clip();
    bgCtx.drawImage(cartmanImg, bx, by - 6, bw, bh + 12);
    bgCtx.restore();

    bgCtx.strokeStyle = happy ? '#fff2b0' : '#ffcc33';
    bgCtx.lineWidth = happy ? 4 : 3;
    roundRect(bgCtx, bx - 4, by - 4, bw + 8, bh + 8, 10);
    bgCtx.stroke();

    bgCtx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws the faucet photo sitting just above the spout gap, its nozzle
// (the image's left end) lined up over the opening. Drawn on the topmost
// layer (with the particles) so the dirt underneath never covers it.
function drawFaucet(ctx, gap, texCanvas) {
  const cx = (gap[0] + gap[1]) / 2 * CELL;
  const w = 84;
  const h = w * (texCanvas.height / texCanvas.width);
  const nozzleInset = w * 0.1; // the nozzle sits slightly inside the image's left edge
  ctx.drawImage(texCanvas, cx - nozzleInset, 1, w, h);
}

let simImageData = simCtx.createImageData(GRID_W, GRID_H);
function renderSim() {
  // rock only — dirt/water/purple are rendered separately as real photo
  // textures (see renderSand / renderWater), clipped to their grid cells
  const data = simImageData.data;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = idx(x, y);
      const p = i * 4;
      let r = 0, gC = 0, b = 0, a = 0;
      if (grid[i] === ROCK) {
        const shade = (x * 3 + y) % 7 === 0;
        r = gC = b = shade ? 0x60 : 0x4a; a = 255;
        b += 6;
      }
      data[p] = r; data[p + 1] = gC; data[p + 2] = b; data[p + 3] = a;
    }
  }
  simCtx.putImageData(simImageData, 0, 0);
}

// Low-res binary masks (one per liquid/material) rasterized from the grid,
// then scaled up with smoothing so tunnel edges look soft instead of blocky.
function createMask() {
  const c = document.createElement('canvas');
  c.width = GRID_W; c.height = GRID_H;
  const ctx = c.getContext('2d');
  return { canvas: c, ctx, data: ctx.createImageData(GRID_W, GRID_H) };
}
const blueMask = createMask();
const purpleMask = createMask();
const sandMask = createMask();

// scratch canvases shared by every masked-texture paint this frame (safe
// since each paint finishes synchronously before the next one starts)
const maskedTempCanvas = document.createElement('canvas');
maskedTempCanvas.width = BG_W; maskedTempCanvas.height = BG_H;
const maskedTempCtx = maskedTempCanvas.getContext('2d');

// scratch canvas for the fully-tiled texture, built fresh per material per
// frame, then stamped onto the mask with a *single* source-in draw
// (several source-in draws in a row would AND their coverage together
// instead of OR-ing it, erasing everything outside the last tile)
const tiledTexCanvas = document.createElement('canvas');
tiledTexCanvas.width = BG_W; tiledTexCanvas.height = BG_H;
const tiledTexCtx = tiledTexCanvas.getContext('2d');

function renderWater() {
  waterCtx.clearRect(0, 0, BG_W, BG_H);
  if (!texReady) return;

  const bData = blueMask.data.data, pData = purpleMask.data.data;
  for (let i = 0; i < grid.length; i++) {
    const p = i * 4;
    bData[p + 3] = grid[i] === WATER ? 255 : 0;
    pData[p + 3] = grid[i] === PURPLE ? 255 : 0;
  }
  blueMask.ctx.putImageData(blueMask.data, 0, 0);
  purpleMask.ctx.putImageData(purpleMask.data, 0, 0);

  paintMaskedTexture(waterCtx, blueMask.canvas, blueTexCanvas, 100, frameCount * 0.15, frameCount * 0.05);
  paintMaskedTexture(waterCtx, purpleMask.canvas, purpleTexCanvas, 100, frameCount * 0.12, -frameCount * 0.04);
}

function renderSand() {
  sandCtx.clearRect(0, 0, BG_W, BG_H);
  if (!sandTexReady) return;

  const sData = sandMask.data.data;
  for (let i = 0; i < grid.length; i++) {
    sData[i * 4 + 3] = grid[i] === DIRT ? 255 : 0;
  }
  sandMask.ctx.putImageData(sandMask.data, 0, 0);

  paintMaskedTexture(sandCtx, sandMask.canvas, sandTexCanvas, 170, 0, 0);
}

function buildTiledTexture(texCanvas, tileW, driftX, driftY) {
  tiledTexCtx.globalCompositeOperation = 'source-over';
  tiledTexCtx.clearRect(0, 0, BG_W, BG_H);
  const tw = tileW;
  const th = tileW * (texCanvas.height / texCanvas.width);
  const startX = -(driftX % tw) - tw;
  const startY = -(driftY % th) - th;
  for (let y = startY; y < BG_H; y += th) {
    for (let x = startX; x < BG_W; x += tw) {
      tiledTexCtx.drawImage(texCanvas, x, y, tw, th);
    }
  }
}

function paintMaskedTexture(targetCtx, maskCanvas, texCanvas, tileW, driftX, driftY) {
  maskedTempCtx.globalCompositeOperation = 'source-over';
  maskedTempCtx.clearRect(0, 0, BG_W, BG_H);
  maskedTempCtx.imageSmoothingEnabled = true;
  maskedTempCtx.drawImage(maskCanvas, 0, 0, BG_W, BG_H);

  buildTiledTexture(texCanvas, tileW, driftX, driftY);
  maskedTempCtx.globalCompositeOperation = 'source-in';
  maskedTempCtx.drawImage(tiledTexCanvas, 0, 0);
  maskedTempCtx.globalCompositeOperation = 'source-over';

  targetCtx.drawImage(maskedTempCanvas, 0, 0);
}

function renderFx() {
  fxCtx.clearRect(0, 0, BG_W, BG_H);
  if (faucetReady) {
    drawFaucet(fxCtx, BLUE_GAP, blueFaucetCanvas);
    drawFaucet(fxCtx, PURPLE_GAP, purpleFaucetCanvas);
  }
  for (const p of particles) {
    fxCtx.globalAlpha = Math.max(0, p.life / p.maxLife);
    fxCtx.fillStyle = p.color;
    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    fxCtx.fill();
  }
  fxCtx.globalAlpha = 1;
}

// ---- Main loop -------------------------------------------------------
function checkCelebration(bluePct) {
  if (!celebrated50 && bluePct >= 50) {
    celebrated50 = true;
    celebrateFrame = frameCount;
    spawnCelebrationBurst();
  }
}

function tick() {
  if (!ended) {
    spawnSources();
    stepSimulation();
    collectZones();
    const { bluePct } = updateHud();
    currentBluePct = bluePct;
    checkCelebration(bluePct);
    checkEnd();
    frameCount++;
  }
  renderSim();
  renderSand();
  renderWater();
  drawBackground();
  updateParticles();
  renderFx();
  requestAnimationFrame(tick);
}

buildLevel();
drawBackground();
requestAnimationFrame(tick);
