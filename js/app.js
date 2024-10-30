let c = document.querySelector("canvas");
let ctx = c.getContext("2d");
const size = { w: 1600, h: 900 };
const maxParticles = 200000;
const maxSpeed = 15;
const spawn = 300;
const partSize = 2;
const baseMinRange =15;
const incr = 0.00002;
let minRange = baseMinRange;
let trou_noir;
let mode = false;
let mass = 0;
let baseForce = 15;
let totalMass = 1; // Add this to track total absorbed mass
let mouseIsPressed = false;
let mouseX, mouseY;
let lastTime = 0;
let deltaTime = 0;
let MIN_RANGE_SQ;

// Use TypedArrays for better performance with large datasets
const particleData = {
  x: new Float32Array(maxParticles),
  y: new Float32Array(maxParticles),
  vx: new Float32Array(maxParticles),
  vy: new Float32Array(maxParticles),
  prevX: new Float32Array(maxParticles),
  prevY: new Float32Array(maxParticles),
  active: new Uint8Array(maxParticles),
};

let activeCount = 0;

// Initialize canvas with device pixel ratio for better performance
const dpr = window.devicePixelRatio || 1;
c.width = window.innerWidth * dpr;
c.height = window.innerHeight * dpr;
c.style.width = window.innerWidth + "px";
c.style.height = window.innerHeight + "px";
ctx.scale(dpr, dpr);
c.tabIndex = 1;
c.style.outline = "none";

// Pre-calculate values
let halfWidth = c.width / 2;
let halfHeight = c.height / 2;
trou_noir = { x: halfWidth, y: halfHeight };

// Optimized updateMinRange function
function updateMinRange() {
 // minRange = baseMinRange * (1 + Math.log10(totalMass/1.002)); // Scale with total mass
  MIN_RANGE_SQ = minRange * minRange;
  return minRange;
}

// Optimized line-circle intersection
function checkLineCircleIntersection(p1x, p1y, p2x, p2y, cx, cy, rSquared) {
  const dx = p2x - p1x;
  const dy = p2y - p1y;
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
  const bb4ac = b * b - 4 * a * c;

  return bb4ac >= 0;
}

// Modified particle creation with slight spread
function addParticle(x, y) {
  if (activeCount >= maxParticles) return null;

  const index = activeCount++;
  // Add a small random offset for more natural spawning
  const spread = 2;
  particleData.x[index] = x + (Math.random() * 2 - 1) * spread;
  particleData.y[index] = y + (Math.random() * 2 - 1) * spread;
  particleData.prevX[index] = particleData.x[index];
  particleData.prevY[index] = particleData.y[index];
  particleData.vx[index] = (Math.random() * 2 - 1) * 3;
  particleData.vy[index] = (Math.random() * 2 - 1) * 3;
  particleData.active[index] = 1;

  return index;
}

// Optimized particle recycling
function recycleParticle(index) {
  const lastIndex = --activeCount;
  if (index !== lastIndex && lastIndex > 0) {
    // Swap with last active particle
    particleData.x[index] = particleData.x[lastIndex];
    particleData.y[index] = particleData.y[lastIndex];
    particleData.vx[index] = particleData.vx[lastIndex];
    particleData.vy[index] = particleData.vy[lastIndex];
    particleData.prevX[index] = particleData.prevX[lastIndex];
    particleData.prevY[index] = particleData.prevY[lastIndex];
    particleData.active[index] = particleData.active[lastIndex];
  }
  // Increment total mass when particle is absorbed
  totalMass += incr; // Adjust this value to control how quickly the black hole grows
}

// Batch rendering using path2D
function batchRenderParticles() {
  const path = new Path2D();
  for (let i = 0; i < activeCount; i++) {
    path.moveTo(particleData.x[i], particleData.y[i]);
    path.lineTo(particleData.prevX[i], particleData.prevY[i]);
  }
  ctx.stroke(path);
}

// Main draw loop with optimized rendering
function draw(timestamp) {
  deltaTime = Math.min((timestamp - lastTime) / 16.67, 2);
  lastTime = timestamp;

  // Clear screen with alpha for trail effect
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
  ctx.fillRect(0, 0, c.width, c.height);

  // Update minRange
  updateMinRange();

  // Prepare batch rendering
  ctx.strokeStyle = "white";
  ctx.lineWidth = 0.075;
  ctx.beginPath();

  // Update particles in bulk
  let i = 0;
  while (i < activeCount) {
    particleData.prevX[i] = particleData.x[i];
    particleData.prevY[i] = particleData.y[i];

    const dx = trou_noir.x - particleData.x[i];
    const dy = trou_noir.y - particleData.y[i];
    const distSq = dx * dx + dy * dy;

    if (distSq <= MIN_RANGE_SQ) {
      recycleParticle(i);
      mass++;
      continue;
    }

    const dist = Math.sqrt(distSq);
    // Modified force calculation incorporating total mass
    const forceMagnitude = (baseForce * totalMass * 100) / distSq;
    const scale = forceMagnitude / dist;

    particleData.vx[i] += dx * scale;
    particleData.vy[i] += dy * scale;

    // Clamp velocities
    particleData.vx[i] = Math.max(
      -maxSpeed,
      Math.min(maxSpeed, particleData.vx[i])
    );
    particleData.vy[i] = Math.max(
      -maxSpeed,
      Math.min(maxSpeed, particleData.vy[i])
    );

    particleData.x[i] += particleData.vx[i];
    particleData.y[i] += particleData.vy[i];

    // Check bounds and intersection in one pass
    if (
      particleData.x[i] > c.width * 1.2 ||
      particleData.x[i] < -c.width * 0.2 ||
      particleData.y[i] > c.height * 1.12 ||
      particleData.y[i] < -c.height * 0.2 ||
      checkLineCircleIntersection(
        particleData.prevX[i],
        particleData.prevY[i],
        particleData.x[i],
        particleData.y[i],
        trou_noir.x,
        trou_noir.y,
        MIN_RANGE_SQ
      )
    ) {
      recycleParticle(i);
      continue;
    }

    ctx.moveTo(particleData.x[i], particleData.y[i]);
    ctx.lineTo(particleData.prevX[i], particleData.prevY[i]);
    i++;
  }

  // Batch render all particles
  ctx.stroke();

  if (mouseIsPressed) {
    for (let n = 0; n < spawn; n++) {
      addParticle(mouseX, mouseY);
    }
  }

  requestAnimationFrame(draw);
}

c.addEventListener("mousedown", (e) => {
  mouseIsPressed = true;
  // Get correct mouse position relative to canvas
  const rect = c.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  c.focus();
});

c.addEventListener("mouseup", () => (mouseIsPressed = false));

c.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    mode = !mode;
    if (mode) {
      trou_noir = { x: mouseX, y: mouseY };
    }
  }
});

c.addEventListener("mousemove", (e) => {
  // Get correct mouse position relative to canvas
  const rect = c.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

requestAnimationFrame(draw);
