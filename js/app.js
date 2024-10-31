let c = document.querySelector("canvas");
let ctx = c.getContext("2d");

// Configuration constants - minimal memory footprint
const CONFIG = Object.freeze({
  size: { w: 1600, h: 900 },
  maxParticles: 200000,
  maxSpeed: 15,
  spawnRate: 100,
  partSize: 2,
  baseMinRange: 15,
  massIncrement: 0.0002,
  blackHoleCount: 3,
  blackHoleMaxSpeed: 10,
  maxCenterForce: 1,
  baseForce: 5,
});

// Pre-calculated device pixel ratio
const dpr = window.devicePixelRatio || 1;

// High-performance typed arrays with less overhead
const particleData = {
  x: new Float32Array(CONFIG.maxParticles),
  y: new Float32Array(CONFIG.maxParticles),
  vx: new Float32Array(CONFIG.maxParticles),
  vy: new Float32Array(CONFIG.maxParticles),
  prevX: new Float32Array(CONFIG.maxParticles),
  prevY: new Float32Array(CONFIG.maxParticles),
  active: new Uint8Array(CONFIG.maxParticles),
};

// State variables - use const for unchanging references
let activeCount = 0;
let mouseIsPressed = false;
let mouseX = 0,
  mouseY = 0;
let lastTime = 0,
  deltaTime = 0;
const black_holes = [];

// Optimized canvas setup with less DOM manipulation
function setupCanvas() {
  const width = window.innerWidth * dpr;
  const height = window.innerHeight * dpr;

  c.width = width;
  c.height = height;

  Object.assign(c.style, {
    width: `${window.innerWidth}px`,
    height: `${window.innerHeight}px`,
    outline: "none",
  });

  ctx.scale(dpr, dpr);
  c.tabIndex = 1;
}

// Inlined and simplified intersection check
function checkLineCircleIntersection(p1x, p1y, p2x, p2y, cx, cy, rSquared) {
  const dx = p2x - p1x,
    dy = p2y - p1y;
  const a = dx * dx + dy * dy;

  if (a === 0) return false;

  const b = 2 * (dx * (p1x - cx) + dy * (p1y - cy));
  const c =
    cx * cx +
    cy * cy +
    p1x * p1x +
    p1y * p1y -
    2 * (cx * p1x + cy * p1y) -
    rSquared;

  return b * b - 4 * a * c >= 0;
}

// Particle creation with reduced random calls
function addParticle(x, y) {
  if (activeCount >= CONFIG.maxParticles) return null;

  const index = activeCount++;
  const spreadX = Math.random() * 4 - 2;
  const spreadY = Math.random() * 4 - 2;
  const velX = Math.random() * 4 - 2;
  const velY = Math.random() * 4 - 2;

  particleData.x[index] = x + spreadX;
  particleData.y[index] = y + spreadY;
  particleData.prevX[index] = particleData.x[index];
  particleData.prevY[index] = particleData.y[index];
  particleData.vx[index] = velX;
  particleData.vy[index] = velY;
  particleData.active[index] = 1;

  return index;
}

// Faster particle recycling
function recycleParticle(index, bh) {
  const lastIndex = --activeCount;

  if (index !== lastIndex && lastIndex > 0) {
    particleData.x[index] = particleData.x[lastIndex];
    particleData.y[index] = particleData.y[lastIndex];
    particleData.vx[index] = particleData.vx[lastIndex];
    particleData.vy[index] = particleData.vy[lastIndex];
    particleData.prevX[index] = particleData.prevX[lastIndex];
    particleData.prevY[index] = particleData.prevY[lastIndex];
    particleData.active[index] = particleData.active[lastIndex];
  }

  if (bh) bh.totalMass += CONFIG.massIncrement;
}

// Optimized draw and update function
function draw(timestamp) {
  deltaTime = Math.min((timestamp - lastTime) / 16.67, 2);
  lastTime = timestamp;

  // Trail effect with less alpha for cleaner look
  ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 0.1;
  ctx.beginPath();

  let empty = true;
  black_holes.forEach((bh, a) => {
    if (!bh.dead) {
      bh.minRange = CONFIG.baseMinRange * (1 + Math.log10(bh.totalMass) / 3);
      bh.MIN_RANGE_SQ = bh.minRange * bh.minRange;

      let i = 0;
      while (i < activeCount) {
        if (bh.isBlackHole) {
          particleData.prevX[i] = particleData.x[i];
          particleData.prevY[i] = particleData.y[i];

          const dx = bh.pos.x - particleData.x[i];
          const dy = bh.pos.y - particleData.y[i];
          const distSq = dx * dx + dy * dy;

          if (distSq <= bh.MIN_RANGE_SQ) {
            recycleParticle(i, bh);
            bh.mass++;
            continue;
          }

          const dist = Math.sqrt(distSq);
          const forceMagnitude = (bh.baseForce * bh.totalMass * 100) / distSq;
          const scale = forceMagnitude / dist;

          particleData.vx[i] = Math.max(
            -CONFIG.maxSpeed,
            Math.min(CONFIG.maxSpeed, particleData.vx[i] + dx * scale)
          );
          particleData.vy[i] = Math.max(
            -CONFIG.maxSpeed,
            Math.min(CONFIG.maxSpeed, particleData.vy[i] + dy * scale)
          );

          if (
            checkLineCircleIntersection(
              particleData.prevX[i],
              particleData.prevY[i],
              particleData.x[i],
              particleData.y[i],
              bh.x,
              bh.y,
              bh.MIN_RANGE_SQ
            )
          ) {
            recycleParticle(i, bh);
            continue;
          }
        } else {
          const dx = bh.pos.x - particleData.x[i];
          const dy = bh.pos.y - particleData.y[i];
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);

          if (dist >= 1000) recycleParticle(i, false);
        }
        i++;
      }

      // Black hole interactions
      black_holes.forEach((other, b) => {
        if (a !== b && other.isBlackHole) {
          const bh_dx = bh.pos.x - other.pos.x;
          const bh_dy = bh.pos.y - other.pos.y;
          let bh_distSq = bh_dx * bh_dx + bh_dy * bh_dy;

          bh_distSq = Math.max(bh_distSq, bh.MIN_RANGE_SQ);
          const bh_dist = Math.sqrt(bh_distSq);

          if (bh_dist > 1500 && !bh.isBlackHole) {
            other.dead = true;
          }

          const bh_forceMagnitude = bh.isBlackHole
            ? (bh.baseForce * other.baseForce) / bh_distSq
            : (bh.baseForce *
                bh.totalMass *
                other.totalMass *
                other.baseForce) /
              (Math.max(1, Math.abs(800 - bh_dist)) * 1500);

          let bh_scale = bh_forceMagnitude / bh_dist;

          if (!bh.isBlackHole && bh_scale > CONFIG.maxCenterForce) {
            bh_scale = CONFIG.maxCenterForce;
          }

          other.vel.x = Math.max(
            -CONFIG.blackHoleMaxSpeed,
            Math.min(CONFIG.blackHoleMaxSpeed, other.vel.x + bh_dx * bh_scale)
          );
          other.vel.y = Math.max(
            -CONFIG.blackHoleMaxSpeed,
            Math.min(CONFIG.blackHoleMaxSpeed, other.vel.y + bh_dy * bh_scale)
          );

          other.pos.x += other.vel.x;
          other.pos.y += other.vel.y;
        }
      });
      empty = false;
    }
  });

  let i = 0;
  while (i < activeCount) {
    particleData.x[i] += particleData.vx[i];
    particleData.y[i] += particleData.vy[i];
    ctx.moveTo(particleData.x[i], particleData.y[i]);
    ctx.lineTo(particleData.prevX[i], particleData.prevY[i]);
    i++;
  }

  if (empty) addBlackHoles();

  ctx.stroke();

  if (mouseIsPressed) {
    for (let n = 0; n < CONFIG.spawnRate; n++) {
      addParticle(mouseX, mouseY);
    }
  }

  requestAnimationFrame(draw);
}

// Simplified black hole generation
function addBlackHoles() {
  const center = {
    pos: { x: c.width / dpr / 2, y: c.height / dpr / 2 },
    baseForce: CONFIG.baseForce * 5,
    minRange: CONFIG.baseMinRange,
    mass: 0,
    totalMass: 1,
    isBlackHole: false,
    vel: { x: 0, y: 0 },
  };

  black_holes.push(center);

  for (let a = 1; a <= CONFIG.blackHoleCount; a++) {
    black_holes.push({
      pos: {
        x: (Math.random() * c.width) / dpr,
        y: (Math.random() * c.height) / dpr,
      },
      vel: {
        x: Math.random() * 0.5 - 0.25,
        y: Math.random() * 0.5 - 0.25,
      },
      baseForce: CONFIG.baseForce,
      minRange: CONFIG.baseMinRange,
      mass: 0,
      totalMass: 1,
      isBlackHole: true,
    });
  }
}

// Event listener consolidation
function setupEventListeners() {
  const updateMousePosition = (e) => {
    const rect = c.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  };

  c.addEventListener("mousedown", (e) => {
    mouseIsPressed = true;
    updateMousePosition(e);
    c.focus();
  });

  c.addEventListener("mouseup", () => (mouseIsPressed = false));
  c.addEventListener("mousemove", updateMousePosition);
}

// Consolidated initialization
function init() {
  setupCanvas();
  addBlackHoles();
  setupEventListeners();
  requestAnimationFrame(draw);
}

init();
