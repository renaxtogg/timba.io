'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.get('/', (_req, res) => res.json({ status: 'Timba.io server running' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===================== CONFIG =====================
let cfg = {
  mapSize: 3000,
  foodCount: 150,
  virusCount: 12,
  startMass: 20,
  massPerPellet: 10,
  botCount: 5,
  botBehavior: 'HUNTER'
};

// ===================== CONSTANTS =====================
const TICK_MS = 50;
const MERGE_TIME = 15000;
const MAX_CELLS = 16;
const MIN_SPLIT_MASS = 26;
const VIRUS_SPLIT_MASS = 130;
const EAT_RATIO = 1.25;
const VIRUS_PELLETS_NEEDED = 7;
const SPLIT_SPEED = 22;
const EJECT_MASS = 10;
const MIN_EJECT_MASS = 20;

// ===================== STATE =====================
const players = new Map();
const bots = new Map();
const food = new Map();
const viruses = new Map();
let _seq = 0;
const uid = (p) => `${p}${++_seq}`;

const FOOD_COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#f06595','#cc5de8','#74c0fc','#63e6be','#ffa94d'];
const BOT_NAMES = ['Globulus','Amoeba','Zorbak','Splorch','Nubbin','Blarg','Flick','Ooz','Gloppy','Blobius','Fuzz','Squib','Plonk','Wurm','Crud','Zap','Grub','Gunk','Slime','Muck'];
const ENTITY_COLORS = ['#e63946','#2a9d8f','#e9c46a','#f4a261','#264653','#a8dadc','#457b9d','#e76f51','#52b788','#d62828','#f77f00','#7209b7','#3a86ff','#fb5607'];
let _ci = 0;
const nextColor = () => ENTITY_COLORS[_ci++ % ENTITY_COLORS.length];

// ===================== MATH =====================
const m2r = (m) => Math.sqrt(m) * 4;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const rndPos = () => ({ x: Math.random() * cfg.mapSize, y: Math.random() * cfg.mapSize });

function centerOfMass(cells) {
  let tm = 0, cx = 0, cy = 0;
  for (const c of cells) { cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass; }
  return { x: cx / tm, y: cy / tm, mass: tm };
}

function speed(mass) {
  return Math.max(1.5, 6.25 * Math.pow(mass, -0.439));
}

// ===================== ENTITY FACTORIES =====================
function mkCell(x, y, mass, vx = 0, vy = 0) {
  return { x, y, mass, r: m2r(mass), vx, vy, splitAt: 0 };
}

function mkPlayer(id, name) {
  const { x, y } = rndPos();
  return {
    id, name: (name || 'Player').slice(0, 16),
    color: nextColor(),
    cells: [mkCell(x, y, cfg.startMass)],
    score: 0,
    input: { x, y },
    isBot: false
  };
}

function mkBot(behavior, targetId) {
  const id = uid('bot');
  const { x, y } = rndPos();
  return {
    id,
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    color: nextColor(),
    cells: [mkCell(x, y, cfg.startMass)],
    score: 0,
    input: { x, y },
    isBot: true,
    behavior: behavior || cfg.botBehavior,
    targetId: targetId || null,
    wanderPt: rndPos(),
    ejectCd: 0
  };
}

// ===================== SPAWN =====================
function spawnFood() {
  while (food.size < cfg.foodCount) {
    const id = uid('f');
    const { x, y } = rndPos();
    food.set(id, { id, x, y, mass: cfg.massPerPellet, color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)] });
  }
}

function spawnViruses() {
  while (viruses.size < cfg.virusCount) {
    const id = uid('v');
    const { x, y } = rndPos();
    viruses.set(id, { id, x, y, mass: 100, r: m2r(100), pellets: 0 });
  }
}

function spawnBots() {
  while (bots.size < cfg.botCount) {
    const b = mkBot(cfg.botBehavior, null);
    bots.set(b.id, b);
  }
}

// ===================== PHYSICS =====================
function moveEntity(e) {
  const { x: tx, y: ty } = e.input;
  const ms = cfg.mapSize;

  for (const c of e.cells) {
    c.vx *= 0.82;
    c.vy *= 0.82;
    if (Math.abs(c.vx) < 0.05) c.vx = 0;
    if (Math.abs(c.vy) < 0.05) c.vy = 0;
    c.x += c.vx;
    c.y += c.vy;

    const sp = speed(c.mass);
    const dx = tx - c.x, dy = ty - c.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      c.x += (dx / d) * Math.min(sp, d);
      c.y += (dy / d) * Math.min(sp, d);
    }

    c.x = clamp(c.x, c.r, ms - c.r);
    c.y = clamp(c.y, c.r, ms - c.r);
  }

  // Separate own cells
  for (let i = 0; i < e.cells.length; i++) {
    for (let j = i + 1; j < e.cells.length; j++) {
      const a = e.cells[i], b = e.cells[j];
      const d = dist(a.x, a.y, b.x, b.y);
      const minD = a.r + b.r;
      if (d < minD && d > 0.01) {
        const ov = (minD - d) / 2;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        a.x -= Math.cos(ang) * ov;
        a.y -= Math.sin(ang) * ov;
        b.x += Math.cos(ang) * ov;
        b.y += Math.sin(ang) * ov;
      }
    }
  }
}

function eatFood(e) {
  for (const c of e.cells) {
    for (const [fid, f] of food) {
      if (dist2(c.x, c.y, f.x, f.y) < c.r * c.r) {
        c.mass += f.mass;
        c.r = m2r(c.mass);
        e.score += f.mass;
        food.delete(fid);
      }
    }
  }
}

function checkViruses(e, now) {
  for (let i = e.cells.length - 1; i >= 0; i--) {
    const c = e.cells[i];
    if (c.mass <= VIRUS_SPLIT_MASS) continue;

    for (const v of viruses.values()) {
      const d = dist(c.x, c.y, v.x, v.y);
      if (d < c.r + v.r - c.r * 0.5) {
        const slots = MAX_CELLS - e.cells.length + 1;
        const numFrag = Math.min(slots, Math.max(2, Math.floor(c.mass / 13)));
        const mPerFrag = c.mass / numFrag;

        e.cells.splice(i, 1);
        for (let k = 0; k < numFrag; k++) {
          const ang = (k / numFrag) * Math.PI * 2;
          const nc = mkCell(
            c.x + Math.cos(ang) * c.r * 0.3,
            c.y + Math.sin(ang) * c.r * 0.3,
            mPerFrag,
            Math.cos(ang) * 10,
            Math.sin(ang) * 10
          );
          nc.splitAt = now;
          e.cells.push(nc);
        }
        break;
      }
    }
  }
}

function eatEntities(all) {
  for (let i = 0; i < all.length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue;
      const a = all[i], b = all[j];
      if (b.cells.length === 0) continue;

      for (const ac of a.cells) {
        for (let k = b.cells.length - 1; k >= 0; k--) {
          const bc = b.cells[k];
          if (ac.mass < bc.mass * EAT_RATIO) continue;
          const d = dist(ac.x, ac.y, bc.x, bc.y);
          if (d < ac.r - bc.r * 0.4) {
            ac.mass += bc.mass;
            ac.r = m2r(ac.mass);
            a.score += bc.mass;
            b.cells.splice(k, 1);
          }
        }
      }
    }
  }
}

function checkMerge(e, now) {
  for (let i = 0; i < e.cells.length; i++) {
    for (let j = i + 1; j < e.cells.length; j++) {
      const a = e.cells[i], b = e.cells[j];
      if (now - a.splitAt < MERGE_TIME || now - b.splitAt < MERGE_TIME) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d < a.r + b.r) {
        a.mass += b.mass;
        a.r = m2r(a.mass);
        e.cells.splice(j, 1);
        j--;
      }
    }
  }
}

// ===================== ACTIONS =====================
function doSplit(e, now) {
  const { x: tx, y: ty } = e.input;
  const toSplit = e.cells.filter(c => c.mass >= MIN_SPLIT_MASS);
  for (const c of toSplit) {
    if (e.cells.length >= MAX_CELLS) break;
    const hm = c.mass / 2;
    c.mass = hm; c.r = m2r(hm); c.splitAt = now;
    const dx = tx - c.x, dy = ty - c.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const nc = mkCell(c.x, c.y, hm, (dx / d) * SPLIT_SPEED, (dy / d) * SPLIT_SPEED);
    nc.splitAt = now;
    e.cells.push(nc);
  }
}

function doMaxSplit(e, now) {
  for (let i = 0; i < 5 && e.cells.length < MAX_CELLS; i++) {
    const prev = e.cells.length;
    doSplit(e, now);
    if (e.cells.length === prev) break;
  }
}

function doEject(e, fast) {
  const { x: tx, y: ty } = e.input;
  const count = fast ? 3 : 1;
  for (let k = 0; k < count; k++) {
    for (const c of e.cells) {
      if (c.mass <= MIN_EJECT_MASS) continue;
      c.mass -= EJECT_MASS;
      c.r = m2r(c.mass);

      const dx = tx - c.x, dy = ty - c.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const ex = clamp(c.x + (dx / d) * (c.r + 8), 0, cfg.mapSize);
      const ey = clamp(c.y + (dy / d) * (c.r + 8), 0, cfg.mapSize);

      let fedVirus = false;
      for (const v of viruses.values()) {
        if (dist2(ex, ey, v.x, v.y) < (v.r + 40) ** 2) {
          v.pellets++;
          if (v.pellets >= VIRUS_PELLETS_NEEDED) {
            v.pellets = 0;
            if (viruses.size < cfg.virusCount * 2) {
              const nv = { id: uid('v'), x: clamp(v.x + (dx / d) * 120, 0, cfg.mapSize), y: clamp(v.y + (dy / d) * 120, 0, cfg.mapSize), mass: 100, r: m2r(100), pellets: 0 };
              viruses.set(nv.id, nv);
            }
          }
          fedVirus = true;
          break;
        }
      }

      if (!fedVirus) {
        const fid = uid('f');
        food.set(fid, { id: fid, x: ex, y: ey, mass: EJECT_MASS, color: e.color });
      }
    }
  }
}

// ===================== BOT AI =====================
function updateBotAI(bot, all, now) {
  const me = centerOfMass(bot.cells);

  switch (bot.behavior) {
    case 'FEEDER': {
      const target = all.find(e => e.id === bot.targetId && !e.isBot) || all.find(e => !e.isBot);
      if (target) {
        const tc = centerOfMass(target.cells);
        bot.input = { x: tc.x, y: tc.y };
        bot.ejectCd--;
        if (bot.ejectCd <= 0) { doEject(bot, false); bot.ejectCd = 10; }
      }
      break;
    }
    case 'TEAM': {
      const target = all.find(e => e.id === bot.targetId && !e.isBot) || all.find(e => !e.isBot);
      if (!target) break;
      const tc = centerOfMass(target.cells);

      let threat = null;
      for (const e of all) {
        if (e === bot || e === target) continue;
        const ec = centerOfMass(e.cells);
        if (ec.mass > tc.mass * 1.25 && dist2(ec.x, ec.y, tc.x, tc.y) < 700 ** 2) { threat = ec; break; }
      }

      if (threat) {
        bot.input = { x: (threat.x + tc.x) / 2, y: (threat.y + tc.y) / 2 };
      } else {
        const ang = Math.atan2(me.y - tc.y, me.x - tc.x) + 0.05;
        bot.input = { x: tc.x + Math.cos(ang) * 130, y: tc.y + Math.sin(ang) * 130 };
      }
      break;
    }
    case 'HUNTER': {
      let prey = null, predator = null;
      let bestPD = Infinity;

      for (const e of all) {
        if (e === bot) continue;
        const ec = centerOfMass(e.cells);
        const d = dist2(me.x, me.y, ec.x, ec.y);
        if (me.mass >= ec.mass * EAT_RATIO && d < bestPD) { bestPD = d; prey = ec; }
        if (ec.mass >= me.mass * EAT_RATIO && d < 500 ** 2) predator = ec;
      }

      if (predator) {
        bot.input = { x: me.x * 2 - predator.x, y: me.y * 2 - predator.y };
      } else if (prey) {
        bot.input = { x: prey.x, y: prey.y };
      } else {
        let nf = null, nd = Infinity;
        for (const f of food.values()) {
          const d = dist2(me.x, me.y, f.x, f.y);
          if (d < nd) { nd = d; nf = f; }
        }
        if (nf) bot.input = { x: nf.x, y: nf.y };
      }
      break;
    }
    default: {
      if (!bot.wanderPt || dist2(me.x, me.y, bot.wanderPt.x, bot.wanderPt.y) < 80 ** 2) {
        bot.wanderPt = rndPos();
      }
      let nf = null, nd = Infinity;
      for (const f of food.values()) {
        const d = dist2(me.x, me.y, f.x, f.y);
        if (d < nd && d < 300 ** 2) { nd = d; nf = f; }
      }
      bot.input = nf ? { x: nf.x, y: nf.y } : { x: bot.wanderPt.x, y: bot.wanderPt.y };
      break;
    }
  }
}

// ===================== TICK =====================
function tick() {
  const now = Date.now();
  const all = [...players.values(), ...bots.values()];

  for (const b of bots.values()) updateBotAI(b, all, now);
  for (const e of all) moveEntity(e);
  for (const e of all) eatFood(e);
  for (const e of all) checkViruses(e, now);
  eatEntities(all);
  for (const e of all) checkMerge(e, now);

  for (const [id, e] of players) {
    if (e.cells.length === 0) {
      const sock = io.sockets.sockets.get(id);
      if (sock) sock.emit('player:died', { score: e.score, name: e.name });
      players.delete(id);
    }
  }
  for (const [id] of bots) {
    if (bots.get(id) && bots.get(id).cells.length === 0) bots.delete(id);
  }

  spawnBots();
  spawnFood();
  spawnViruses();

  const leaderboard = [...players.values(), ...bots.values()]
    .map(e => ({ name: e.name, score: e.score, color: e.color }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const state = {
    players: [...players.values()].map(e => ({
      id: e.id, name: e.name, color: e.color,
      cells: e.cells.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r), mass: Math.round(c.mass) })),
      score: e.score
    })),
    bots: [...bots.values()].map(e => ({
      id: e.id, name: e.name, color: e.color,
      cells: e.cells.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r), mass: Math.round(c.mass) })),
      score: e.score
    })),
    food: [...food.values()],
    viruses: [...viruses.values()].map(v => ({ id: v.id, x: Math.round(v.x), y: Math.round(v.y), r: Math.round(v.r) })),
    mapSize: cfg.mapSize,
    leaderboard
  };

  io.emit('game:state', state);
}

// ===================== SOCKETS =====================
io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('player:join', ({ name }) => {
    const p = mkPlayer(socket.id, name);
    players.set(socket.id, p);
    socket.emit('player:joined', { id: socket.id, color: p.color });
    console.log(`Player joined: ${p.name}`);
  });

  socket.on('player:input', ({ x, y }) => {
    const p = players.get(socket.id);
    if (p) p.input = { x, y };
  });

  socket.on('player:action', ({ action }) => {
    const now = Date.now();
    const p = players.get(socket.id);
    if (!p) return;
    if (action === 'split') doSplit(p, now);
    else if (action === 'eject') doEject(p, false);
    else if (action === 'ejectFast') doEject(p, true);
    else if (action === 'maxSplit') doMaxSplit(p, now);
  });

  socket.on('admin:config', (patch) => {
    const prev = { botCount: cfg.botCount, foodCount: cfg.foodCount, virusCount: cfg.virusCount };
    Object.assign(cfg, patch);

    if (bots.size > cfg.botCount) {
      for (const k of [...bots.keys()].slice(cfg.botCount)) bots.delete(k);
    }
    if (food.size > cfg.foodCount) {
      for (const k of [...food.keys()].slice(cfg.foodCount)) food.delete(k);
    }
    if (viruses.size > cfg.virusCount) {
      for (const k of [...viruses.keys()].slice(cfg.virusCount)) viruses.delete(k);
    }
    console.log('Config updated:', cfg);
  });

  socket.on('admin:assign_bot', ({ targetId, behavior, count }) => {
    let added = 0;
    for (const b of bots.values()) {
      if (b.targetId === targetId) {
        b.behavior = behavior || b.behavior;
      }
    }
    // Add extra bots if needed
    const existing = [...bots.values()].filter(b => b.targetId === targetId).length;
    for (let i = existing; i < (count || 1); i++) {
      const b = mkBot(behavior || cfg.botBehavior, targetId);
      bots.set(b.id, b);
    }
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    console.log('disconnect', socket.id);
  });
});

// ===================== INIT =====================
spawnFood();
spawnViruses();
spawnBots();
setInterval(tick, TICK_MS);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Timba.io server on :${PORT}`));
