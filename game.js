/* Sea Battle — a naval grid duel against the computer.
 * Plain JavaScript, no dependencies. Everything is drawn on one canvas;
 * menus and buttons are HTML overlays.
 */
(function () {
  'use strict';

  var GAME_ID = 'sea-battle';
  var N = 10;
  var FLEET = [
    { name: 'Carrier', len: 5 },
    { name: 'Cruiser', len: 4 },
    { name: 'Frigate', len: 3 },
    { name: 'Submarine', len: 3 },
    { name: 'Patrol Boat', len: 2 }
  ];
  var LETTERS = 'ABCDEFGHIJ';
  var DIFF_INFO = {
    easy: 'Fires mostly at random. A relaxed cruise.',
    normal: 'Hunts in a pattern and closes in on every hit.',
    hard: 'Calculates where your ships are most likely hiding.'
  };

  /* ------------------------------------------------------------------ */
  /* Storage (all keys prefixed with the game id)                        */
  /* ------------------------------------------------------------------ */
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(GAME_ID + ':' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(GAME_ID + ':' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    }
  };

  function rnd(n) { return Math.floor(Math.random() * n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ */
  /* Sound: everything synthesised with Web Audio                        */
  /* ------------------------------------------------------------------ */
  var Sound = (function () {
    var ac = null, master = null, noiseBuf = null, ambGain = null;
    var muted = !!store.get('muted', false);

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC(); } catch (e) { ac = null; return; }
      var comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(comp); comp.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startAmbient();
    }

    // Soft rolling sea in the background: filtered noise with a slow swell.
    function startAmbient() {
      var src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      ambGain = ac.createGain(); ambGain.gain.value = 0.035;
      var lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
      var lfoG = ac.createGain(); lfoG.gain.value = 0.022;
      lfo.connect(lfoG); lfoG.connect(ambGain.gain);
      src.connect(f); f.connect(ambGain); ambGain.connect(master);
      src.start(); lfo.start();
    }

    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function tone(type, f0, f1, dur, vol, delay, attack) {
      if (!ac || muted) return;
      var t = ac.currentTime + (delay || 0), at = attack || 0.005;
      var o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      var g = ac.createGain(); env(g, t, at, vol, dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + at + dur + 0.05);
    }
    function noise(dur, vol, ftype, f0, f1, q, delay, attack) {
      if (!ac || muted) return;
      var t = ac.currentTime + (delay || 0), at = attack || 0.005;
      var s = ac.createBufferSource(); s.buffer = noiseBuf;
      var f = ac.createBiquadFilter(); f.type = ftype; f.Q.value = q || 0.7;
      f.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      var g = ac.createGain(); env(g, t, at, vol, dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random()); s.stop(t + at + dur + 0.05);
    }

    var fx = {
      click: function () { tone('triangle', 720, 520, 0.05, 0.12); },
      pick: function () { tone('triangle', 330, 460, 0.06, 0.16); },
      place: function () { tone('triangle', 230, 110, 0.1, 0.32); noise(0.05, 0.22, 'bandpass', 2400, 1400, 2); },
      rotate: function () { tone('triangle', 300, 540, 0.08, 0.2); noise(0.04, 0.12, 'highpass', 3000, 2000); },
      bad: function () { tone('square', 150, 140, 0.07, 0.08); tone('square', 120, 115, 0.08, 0.08, 0.1); },
      launch: function () {
        noise(0.14, 0.35, 'lowpass', 1800, 300);
        tone('sine', 130, 48, 0.18, 0.45);
        tone('sine', 1500, 520, 0.38, 0.045, 0.06, 0.04);
      },
      splash: function () {
        noise(0.55, 0.5, 'bandpass', 1500, 450, 0.8, 0, 0.01);
        noise(0.22, 0.2, 'highpass', 3500, 1800);
        tone('sine', 460, 150, 0.16, 0.14, 0.02);
      },
      boom: function () {
        noise(0.9, 0.9, 'lowpass', 2600, 90, 0.7);
        tone('sine', 115, 36, 0.6, 0.8);
        tone('triangle', 70, 30, 0.8, 0.3, 0.02);
      },
      sunk: function () {
        fx.boom();
        noise(1.8, 0.55, 'lowpass', 500, 55, 0.7, 0.2, 0.08);
        tone('sawtooth', 92, 52, 1.3, 0.05, 0.3, 0.15);
        tone('sine', 60, 30, 1.4, 0.4, 0.25, 0.1);
      },
      turn: function () { tone('sine', 880, 880, 0.12, 0.06); tone('sine', 1320, 1320, 0.14, 0.04, 0.08); },
      start: function () {
        [392, 523, 659].forEach(function (f, i) { tone('triangle', f, f, 0.16, 0.16, i * 0.11); });
      },
      win: function () {
        [523, 659, 784, 1047].forEach(function (f, i) { tone('triangle', f, f, 0.2, 0.2, i * 0.14); });
        [523, 659, 784].forEach(function (f) { tone('sine', f, f, 0.9, 0.12, 0.6, 0.02); });
      },
      lose: function () {
        [392, 330, 277, 196].forEach(function (f, i) { tone('triangle', f, f * 0.98, 0.32, 0.16, i * 0.26); });
      }
    };

    return {
      init: init,
      play: function (name) { if (ac && !muted && fx[name]) fx[name](); },
      get muted() { return muted; },
      toggle: function () {
        muted = !muted; store.set('muted', muted);
        if (master) master.gain.value = muted ? 0 : 0.8;
        return muted;
      },
      suspend: function () { if (ac && ac.state === 'running') ac.suspend(); },
      resume: function () { if (ac && ac.state === 'suspended') ac.resume(); }
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Board model                                                          */
  /* ------------------------------------------------------------------ */
  // shots[i]: 0 = unknown, 1 = miss, 2 = hit, 3 = clear water (next to a sunk ship)
  function makeBoard() {
    return {
      ships: FLEET.map(function (f, i) {
        return { id: i, name: f.name, len: f.len, x: 0, y: 0, dir: 0, placed: false, hits: 0, sunk: false, sunkT: 0 };
      }),
      shots: new Uint8Array(N * N),
      shotT: new Float32Array(N * N),
      occ: null
    };
  }

  function shipCells(s, x, y, dir) {
    if (x === undefined) { x = s.x; y = s.y; dir = s.dir; }
    var c = [];
    for (var i = 0; i < s.len; i++) c.push(dir ? [x, y + i] : [x + i, y]);
    return c;
  }

  function occupancy(board, ignore) {
    var g = new Int8Array(N * N).fill(-1);
    board.ships.forEach(function (s) {
      if (!s.placed || s === ignore) return;
      shipCells(s).forEach(function (c) { g[c[1] * N + c[0]] = s.id; });
    });
    return g;
  }

  // In bounds, and no other ship on or next to any of its cells (diagonals included).
  function canPlace(board, s, x, y, dir) {
    var occ = occupancy(board, s);
    var cells = shipCells(s, x, y, dir);
    for (var k = 0; k < cells.length; k++) {
      var cx = cells[k][0], cy = cells[k][1];
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return false;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && occ[ny * N + nx] >= 0) return false;
      }
    }
    return true;
  }

  function randomPlace(board) {
    for (var attempt = 0; attempt < 500; attempt++) {
      board.ships.forEach(function (s) { s.placed = false; });
      var ok = true;
      for (var i = 0; i < board.ships.length && ok; i++) {
        var s = board.ships[i], done = false;
        for (var t = 0; t < 400 && !done; t++) {
          var dir = rnd(2);
          var x = rnd(dir ? N : N - s.len + 1), y = rnd(dir ? N - s.len + 1 : N);
          if (canPlace(board, s, x, y, dir)) { s.x = x; s.y = y; s.dir = dir; s.placed = true; done = true; }
        }
        if (!done) ok = false;
      }
      if (ok) return;
    }
  }

  // Place one ship somewhere valid, if possible.
  function autoPlace(board, s) {
    var opts = [];
    for (var dir = 0; dir < 2; dir++) for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      if (canPlace(board, s, x, y, dir)) opts.push([x, y, dir]);
    }
    if (!opts.length) return false;
    var o = opts[rnd(opts.length)];
    s.x = o[0]; s.y = o[1]; s.dir = o[2]; s.placed = true;
    return true;
  }

  function allPlaced(board) { return board.ships.every(function (s) { return s.placed; }); }
  function allSunk(board) { return board.ships.every(function (s) { return s.sunk; }); }
  function shipAtCell(board, x, y) {
    if (!board.occ) board.occ = occupancy(board);
    var id = board.occ[y * N + x];
    return id >= 0 ? board.ships[id] : null;
  }
  function placedShipAt(board, x, y) {
    for (var i = 0; i < board.ships.length; i++) {
      var s = board.ships[i];
      if (!s.placed || (G.drag && G.drag.ship === s)) continue;
      var cells = shipCells(s);
      for (var k = 0; k < cells.length; k++) if (cells[k][0] === x && cells[k][1] === y) return { ship: s, k: k };
    }
    return null;
  }

  function resolveShot(board, x, y) {
    var i = y * N + x;
    var s = shipAtCell(board, x, y);
    board.shotT[i] = G.time;
    if (s) {
      board.shots[i] = 2; s.hits++;
      if (s.hits >= s.len) {
        s.sunk = true; s.sunkT = G.time;
        // Ships never touch, so every cell around a sunk ship is open water.
        shipCells(s).forEach(function (c) {
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var nx = c[0] + dx, ny = c[1] + dy;
            if (nx >= 0 && ny >= 0 && nx < N && ny < N && board.shots[ny * N + nx] === 0) {
              board.shots[ny * N + nx] = 3; board.shotT[ny * N + nx] = G.time + 0.25 + Math.random() * 0.3;
            }
          }
        });
        return { hit: true, sunk: s };
      }
      return { hit: true };
    }
    board.shots[i] = 1;
    return { hit: false };
  }

  /* ------------------------------------------------------------------ */
  /* Computer opponent                                                    */
  /* ------------------------------------------------------------------ */
  var AI = {
    unknown: function (b) {
      var out = [];
      for (var i = 0; i < N * N; i++) if (b.shots[i] === 0) out.push(i);
      return out;
    },
    // Hit cells that belong to ships not yet sunk (the computer knows which ships were sunk).
    openHits: function (b) {
      var out = [];
      for (var i = 0; i < N * N; i++) {
        if (b.shots[i] === 2) { var s = shipAtCell(b, i % N, (i / N) | 0); if (!s.sunk) out.push(i); }
      }
      return out;
    },
    neighbours: function (b, i) {
      var x = i % N, y = (i / N) | 0, out = [];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && b.shots[ny * N + nx] === 0) out.push(ny * N + nx);
      });
      return out;
    },
    pickRandom: function (arr) { return arr[rnd(arr.length)]; },

    // Normal: chase hits along a line, otherwise search on a checkerboard.
    target: function (b, hits) {
      var set = {}; hits.forEach(function (h) { set[h] = 1; });
      var lineCands = [];
      hits.forEach(function (h) {
        var x = h % N, y = (h / N) | 0;
        [[1, 0], [0, 1]].forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (nx < N && ny < N && set[ny * N + nx]) {
            // extend both ways along this line
            [1, -1].forEach(function (sg) {
              var cx = x, cy = y;
              while (cx >= 0 && cy >= 0 && cx < N && cy < N && set[cy * N + cx]) { cx += d[0] * sg; cy += d[1] * sg; }
              if (cx >= 0 && cy >= 0 && cx < N && cy < N && b.shots[cy * N + cx] === 0) lineCands.push(cy * N + cx);
            });
          }
        });
      });
      if (lineCands.length) return AI.pickRandom(lineCands);
      var nb = [];
      hits.forEach(function (h) { nb = nb.concat(AI.neighbours(b, h)); });
      return nb.length ? AI.pickRandom(nb) : -1;
    },
    hunt: function (b) {
      var minLen = 9;
      b.ships.forEach(function (s) { if (!s.sunk) minLen = Math.min(minLen, s.len); });
      var cand = AI.unknown(b).filter(function (i) { return ((i % N) + ((i / N) | 0)) % minLen === 0; });
      if (!cand.length) cand = AI.unknown(b);
      return AI.pickRandom(cand);
    },
    // Hard: count every way the remaining ships could still fit, weight lines through hits heavily.
    density: function (b, hits) {
      var score = new Float64Array(N * N);
      var hitSet = {}; hits.forEach(function (h) { hitSet[h] = 1; });
      b.ships.forEach(function (s) {
        if (s.sunk) return;
        for (var dir = 0; dir < 2; dir++) for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
          var cells = [], ok = true, h = 0;
          for (var k = 0; k < s.len; k++) {
            var cx = dir ? x : x + k, cy = dir ? y + k : y;
            if (cx >= N || cy >= N) { ok = false; break; }
            var i = cy * N + cx, st = b.shots[i];
            if (st === 1 || st === 3 || (st === 2 && !hitSet[i])) { ok = false; break; }
            if (hitSet[i]) h++;
            cells.push(i);
          }
          if (!ok) continue;
          var w = h ? Math.pow(30, h) : (hits.length ? 0.02 : 1);
          cells.forEach(function (i) { if (b.shots[i] === 0) score[i] += w; });
        }
      });
      var best = -1, bestV = -1;
      for (var i = 0; i < N * N; i++) {
        if (b.shots[i] !== 0) continue;
        var v = score[i] + Math.random() * 0.01;
        if (v > bestV) { bestV = v; best = i; }
      }
      return best;
    },
    choose: function (b, diff) {
      var hits = AI.openHits(b), pick = -1;
      if (diff === 'easy') {
        if (hits.length && Math.random() < 0.25) pick = AI.target(b, hits);
        if (pick < 0) pick = AI.pickRandom(AI.unknown(b));
      } else if (diff === 'normal') {
        pick = hits.length ? AI.target(b, hits) : -1;
        if (pick < 0) pick = AI.hunt(b);
      } else {
        pick = AI.density(b, hits);
      }
      if (pick < 0 || pick === undefined) pick = AI.pickRandom(AI.unknown(b));
      return [pick % N, (pick / N) | 0];
    }
  };

  /* ------------------------------------------------------------------ */
  /* Game state                                                           */
  /* ------------------------------------------------------------------ */
  var G = {
    phase: 'menu',            // menu | place | battle | over
    diff: store.get('difficulty', 'normal'),
    player: makeBoard(),
    enemy: makeBoard(),
    turn: 'player',
    busy: false,
    paused: false,
    peek: false,
    time: 0,
    timers: [],
    particles: [],
    texts: [],
    shells: [],
    aim: null,
    shake: 0,
    hover: null,
    cursor: { x: 4, y: 4, show: false },
    drag: null,
    lastEnemyShot: null,
    lastPlayerShot: null,
    wobble: null,              // ship that refused to rotate
    stats: null,
    result: null,
    vcur: null,               // current (animated) board rectangles
    menuShips: []
  };
  if (!DIFF_INFO[G.diff]) G.diff = 'normal';
  var rec = store.get('records', null) || {};
  ['easy', 'normal', 'hard'].forEach(function (d) { if (!rec[d]) rec[d] = { w: 0, l: 0, best: 0, bestAcc: 0 }; });

  function later(ms, fn) { G.timers.push({ t: G.time + ms / 1000, fn: fn }); }

  /* ------------------------------------------------------------------ */
  /* Canvas, sizing and layout                                            */
  /* ------------------------------------------------------------------ */
  var canvas = $('cv'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1, L = null;

  function resize() {
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    relayout(true);
    makeMenuShips();
  }

  // Which board is shown large on a portrait screen.
  function bigKey() {
    if (G.phase === 'place') return 'player';
    if (G.phase === 'over') return G.peek ? 'player' : 'enemy';
    var k = G.turn === 'player' ? 'enemy' : 'player';
    if (G.peek) k = k === 'enemy' ? 'player' : 'enemy';
    return k;
  }

  function computeLayout() {
    var land = W > H * 1.05;
    var topH = H < 520 ? 48 : 56;
    document.documentElement.style.setProperty('--bar', topH + 'px');
    var pad = clamp(Math.min(W, H) * 0.025, 8, 18);
    var place = G.phase === 'place';
    var o = { land: land, topH: topH, pad: pad, place: place, views: {}, status: {}, dock: null, slots: [], bar: null, hint: null, mini: null };
    var c, band;
    if (land) {
      var availW = W - 2 * pad, availH = H - topH - 2 * pad;
      c = Math.min(availW / (2 * 10.7 + 1.2), availH / (0.7 + 10.7 + 1.35));
      band = 0.7 * c;
      var panelW = 10.7 * c, panelH = (0.7 + 10.7 + 1.35) * c;
      var gap = Math.min(availW - 2 * panelW, 3 * c);
      var x0 = (W - (2 * panelW + gap)) / 2, y0 = topH + pad + (availH - panelH) / 2;
      var gy = y0 + 0.7 * c + band, ex = x0 + panelW + gap + band;
      o.views.player = { x: x0 + band, y: gy, c: c, a: 1 };
      o.views.enemy = { x: ex, y: gy, c: c, a: place ? 0 : 1 };
      o.status.player = { x: x0 + band, y: gy + 10.3 * c, w: 10 * c, h: 0.9 * c };
      o.status.enemy = { x: ex, y: gy + 10.3 * c, w: 10 * c, h: 0.9 * c };
      if (place) {
        o.dock = { title: { x: ex - band, y: gy - band - 0.35 * c, size: clamp(c * 0.42, 12, 19) } };
        for (var i = 0; i < 5; i++) o.slots[i] = { x: ex, y: gy + i * 1.22 * c, d: c };
        var bh = clamp(c * 1.15, 42, 54);
        o.bar = { x: ex, y: gy + 11.35 * c - bh, w: 10 * c, h: bh };
        o.hint = { x: ex, y: gy + 6.25 * c, w: 10 * c, size: clamp(c * 0.36, 12, 17), lines: ['Drag ships onto your grid.', 'Tap a placed ship to rotate it.', 'Ships may not touch, even corners.'] };
      }
    } else {
      var botH = place ? 76 : 0;
      var aW = W - 2 * pad, aH = H - topH - botH - 2 * pad;
      var minStrip = place ? 120 : 110;
      c = Math.max(8, Math.min(aW / 10.7, (aH - minStrip - 8) / 11.4));
      band = 0.7 * c;
      var bigW = 10.7 * c, bigH = 11.4 * c, stripH, m = 0, d = 0;
      if (place) { d = Math.min(c, aW / 9.8, Math.max(10, (aH - bigH - 8 - 28) / 2.6)); stripH = 28 + 2.5 * d; }
      else { m = Math.max(5, Math.min((aH - bigH - 8 - 22) / 10, aW * 0.48 / 10, c * 0.62)); stripH = 22 + 10 * m; }
      var total = stripH + 8 + bigH;
      var y1 = topH + pad + Math.max(0, (aH - total) / 2);
      var mx = (W - bigW) / 2;
      var big = { x: mx + band, y: y1 + stripH + 8 + 0.7 * c + band, c: c, a: 1 };
      if (place) {
        o.views.player = big;
        o.views.enemy = { x: big.x, y: big.y, c: c, a: 0 };
        o.dock = { title: { x: W / 2, y: y1 + 11, size: clamp(c * 0.42, 13, 18), center: true } };
        var r0 = (W - 9.6 * d) / 2, r1 = (W - 9.2 * d) / 2, ry = y1 + 28;
        o.slots = [
          { x: r0, y: ry, d: d }, { x: r0 + 5.6 * d, y: ry, d: d },
          { x: r1, y: ry + 1.35 * d, d: d }, { x: r1 + 3.6 * d, y: ry + 1.35 * d, d: d }, { x: r1 + 7.2 * d, y: ry + 1.35 * d, d: d }
        ];
        var bw = Math.min(aW, 460);
        o.bar = { x: (W - bw) / 2, y: H - botH + 12, w: bw, h: 52 };
      } else {
        var bk = bigKey(), mk = bk === 'enemy' ? 'player' : 'enemy';
        o.views[bk] = big;
        o.views[mk] = { x: mx, y: y1 + 22, c: m, a: 1 };
        o.mini = { key: mk, x: mx - 4, y: y1, w: 10 * m + 8, h: 22 + 10 * m + 4 };
        var sx = mx + 10 * m + 16, sw = mx + bigW - sx;
        o.status.enemy = { x: sx, y: y1 + 22, w: sw, h: 5 * m - 4, label: true };
        o.status.player = { x: sx, y: y1 + 22 + 5 * m + 4, w: sw, h: 5 * m - 4, label: true };
      }
    }
    return o;
  }

  function relayout(snap) {
    L = computeLayout();
    if (!G.vcur || snap) {
      G.vcur = {
        player: Object.assign({}, L.views.player),
        enemy: Object.assign({}, L.views.enemy)
      };
    }
    var pb = $('placeBar');
    if (L.place && L.bar) {
      pb.classList.remove('hidden');
      pb.style.left = L.bar.x + 'px'; pb.style.top = L.bar.y + 'px';
      pb.style.width = L.bar.w + 'px'; pb.style.height = L.bar.h + 'px';
    } else pb.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /* Phases                                                               */
  /* ------------------------------------------------------------------ */
  function showOverlay(id, on) { $(id).classList.toggle('hidden', !on); }

  function setStatus(text, cls) {
    $('statusText').textContent = text;
    $('status').className = 'pill' + (cls ? ' ' + cls : '');
  }

  function resetFx() {
    G.particles = []; G.texts = []; G.shells = []; G.timers = []; G.aim = null; G.shake = 0;
    G.lastEnemyShot = null; G.lastPlayerShot = null; G.hover = null; G.drag = null;
  }

  function goMenu() {
    G.phase = 'menu'; G.paused = false; G.peek = false;
    resetFx();
    document.body.classList.add('menu');
    showOverlay('pause', false); showOverlay('over', false); showOverlay('menu', true);
    $('btnResults').classList.add('hidden');
    refreshMenu();
    relayout(true);
  }

  function refreshMenu() {
    Array.prototype.forEach.call(document.querySelectorAll('.diff'), function (b) {
      b.classList.toggle('sel', b.getAttribute('data-d') === G.diff);
    });
    ['easy', 'normal', 'hard'].forEach(function (d) {
      var r = rec[d], id = 'rec' + d[0].toUpperCase() + d.slice(1);
      $(id).textContent = 'W ' + r.w + ' · L ' + r.l;
    });
    $('diffInfo').textContent = DIFF_INFO[G.diff];
  }

  function startPlacement() {
    G.phase = 'place'; G.paused = false; G.peek = false;
    G.player = makeBoard(); G.enemy = makeBoard();
    resetFx();
    document.body.classList.remove('menu');
    showOverlay('menu', false); showOverlay('pause', false); showOverlay('over', false);
    $('btnResults').classList.add('hidden');
    updatePlaceUI();
    relayout(true);
  }

  function updatePlaceUI() {
    var left = G.player.ships.filter(function (s) { return !s.placed; }).length;
    $('btnStart').disabled = left > 0;
    setStatus(left ? 'Deploy your fleet (' + left + ' left)' : 'Fleet ready. Press Start!', left ? '' : 'you');
  }

  function beginBattle() {
    if (!allPlaced(G.player)) return;
    randomPlace(G.enemy);
    G.player.occ = occupancy(G.player); G.enemy.occ = occupancy(G.enemy);
    G.phase = 'battle'; G.turn = 'player'; G.busy = false; G.peek = false;
    G.stats = { shots: 0, hits: 0, turns: 1, eShots: 0, eHits: 0, start: G.time };
    resetFx();
    relayout(false);
    Sound.play('start');
    setStatus('Your turn: fire!', 'you');
    later(250, function () { popText('enemy', 5, 5, 'Open fire!', '#ffe08a', 0.9); });
  }

  function setTurn(who) {
    G.turn = who; G.peek = false;
    relayout(false);
    if (who === 'player') {
      G.stats.turns++;
      G.busy = false;
      setStatus('Your turn: fire!', 'you');
      Sound.play('turn');
    } else {
      setStatus('Enemy is aiming…', 'foe');
      enemyTurn();
    }
  }

  function playerFire(x, y) {
    if (G.phase !== 'battle' || G.turn !== 'player' || G.busy || G.paused) return;
    if (G.enemy.shots[y * N + x] !== 0) { Sound.play('bad'); return; }
    G.busy = true; G.stats.shots++;
    G.lastPlayerShot = { x: x, y: y };
    launchShell('enemy', x, y, function () {
      var res = resolveShot(G.enemy, x, y);
      if (res.hit) G.stats.hits++;
      afterShot('player', 'enemy', x, y, res);
    });
  }

  function enemyTurn() {
    G.busy = true;
    later(650 + Math.random() * 450, function () {
      var p = AI.choose(G.player, G.diff), x = p[0], y = p[1];
      var from = G.lastEnemyShot ? [G.lastEnemyShot.x, G.lastEnemyShot.y] : [rnd(N), rnd(N)];
      G.aim = { view: 'player', fx: from[0], fy: from[1], tx: x, ty: y, t0: G.time, dur: 0.45 };
      later(520, function () {
        G.aim = null;
        G.stats.eShots++;
        launchShell('player', x, y, function () {
          var res = resolveShot(G.player, x, y);
          if (res.hit) G.stats.eHits++;
          G.lastEnemyShot = { x: x, y: y, t: G.time };
          afterShot('enemy', 'player', x, y, res);
        });
      });
    });
  }

  // Effects, then decide who shoots next: a hit earns another shot.
  function afterShot(shooter, view, x, y, res) {
    var board = G[view];
    if (!res.hit) {
      fxSplash(view, x, y); Sound.play('splash');
      popText(view, x, y, 'Miss', '#cfeaff', 0.55);
    } else if (!res.sunk) {
      fxExplosion(view, x, y, 1); Sound.play('boom');
      popText(view, x, y, 'Hit!', '#ffb347', 0.75);
    } else {
      var s = res.sunk;
      fxExplosion(view, x, y, 1.4); Sound.play('sunk');
      shipCells(s).forEach(function (c, i) {
        later(120 + i * 110, function () { fxExplosion(view, c[0], c[1], 0.7); });
      });
      var mid = shipCells(s)[Math.floor(s.len / 2)];
      var txt = shooter === 'player' ? s.name + ' sunk!' : 'Your ' + s.name + ' sank!';
      popText(view, mid[0], mid[1], txt, shooter === 'player' ? '#ffd166' : '#ff7a5c', 1);
      G.shake = Math.max(G.shake, 14);
    }
    if (allSunk(board)) {
      later(1500, function () { endGame(shooter === 'player'); });
      G.phase = 'battle-end';
      return;
    }
    var delay = res.sunk ? 1300 : res.hit ? 800 : 700;
    later(delay, function () {
      if (G.phase !== 'battle') return;
      if (res.hit) {
        if (shooter === 'player') { G.busy = false; setStatus('Hit! Fire again!', 'you'); }
        else { setStatus('Enemy hit you! Aiming again…', 'foe'); enemyTurn(); }
      } else setTurn(shooter === 'player' ? 'enemy' : 'player');
    });
  }

  function endGame(won) {
    G.phase = 'over'; G.busy = true; G.peek = false;
    var st = G.stats, r = rec[G.diff];
    var acc = st.shots ? Math.round(st.hits / st.shots * 100) : 0;
    var secs = Math.round(G.time - st.start);
    var notes = [];
    if (won) {
      r.w++;
      if (!r.best || st.shots < r.best) { if (r.best) notes.push('New record: fewest shots to win!'); r.best = st.shots; }
      if (acc > r.bestAcc) { r.bestAcc = acc; }
    } else r.l++;
    store.set('records', rec);
    G.result = { won: won };
    // reveal the enemy ships that survived
    relayout(false);
    setStatus(won ? 'Victory!' : 'Defeat', won ? 'win' : 'lose');
    Sound.play(won ? 'win' : 'lose');
    if (won) for (var i = 0; i < 4; i++) later(i * 260, fireworkBurst);

    $('overTitle').textContent = won ? 'Victory!' : 'Defeat';
    $('overTitle').className = won ? '' : 'lose';
    var afloat = G.player.ships.filter(function (s) { return !s.sunk; }).length;
    $('overSub').textContent = won
      ? 'The enemy fleet is at the bottom of the sea. ' + afloat + ' of your 5 ships survived.'
      : (function () {
          var n = G.enemy.ships.filter(function (s) { return !s.sunk; }).length;
          return 'Your fleet was sunk. The enemy still had ' + n + (n === 1 ? ' ship' : ' ships') + ' afloat.';
        })();
    $('stShots').textContent = st.shots;
    $('stAcc').textContent = acc + '%';
    $('stTurns').textContent = st.turns;
    $('stTime').textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    var dn = G.diff[0].toUpperCase() + G.diff.slice(1);
    var line = dn + ' record: ' + r.w + ' win' + (r.w === 1 ? '' : 's') + ', ' + r.l + ' loss' + (r.l === 1 ? '' : 'es');
    if (r.best) line += ' · Best: ' + r.best + ' shots';
    $('overRec').textContent = (notes.length ? notes.join(' ') + ' ' : '') + line;
    later(1100, function () { if (G.phase === 'over') showOverlay('over', true); });
  }

  /* ------------------------------------------------------------------ */
  /* Effects (positions are in cell units of a board, so they follow it)  */
  /* ------------------------------------------------------------------ */
  function spawn(view, p) {
    if (G.particles.length > 900) return;
    p.view = view; p.life = -(p.delay || 0);
    G.particles.push(p);
  }

  function fxSplash(view, x, y) {
    var cx = x + 0.5, cy = y + 0.5, i, a, sp;
    for (i = 0; i < 26; i++) {
      a = Math.random() * Math.PI * 2; sp = 0.4 + Math.random() * 1.4;
      spawn(view, { kind: 'drop', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - (1.6 + Math.random() * 2), g: 8, drag: 0.6, max: 0.5 + Math.random() * 0.4, size: 0.04 + Math.random() * 0.06, col: Math.random() < 0.5 ? '#ffffff' : '#bfe8ff' });
    }
    for (i = 0; i < 3; i++) spawn(view, { kind: 'ring', x: cx, y: cy, vx: 0, vy: 0, max: 1.0, size: 0.15, grow: 0.9, col: '255,255,255', alpha: 0.7, delay: i * 0.14 });
    spawn(view, { kind: 'foam', x: cx, y: cy, vx: 0, vy: 0, max: 0.7, size: 0.38, grow: 0.3 });
  }

  function fxExplosion(view, x, y, power) {
    var cx = x + 0.5, cy = y + 0.5, i, a, sp;
    spawn(view, { kind: 'flash', x: cx, y: cy, vx: 0, vy: 0, max: 0.22, size: 1.3 * power });
    spawn(view, { kind: 'ring', x: cx, y: cy, vx: 0, vy: 0, max: 0.45, size: 0.2, grow: 2.6 * power, col: '255,220,160', alpha: 0.8 });
    for (i = 0; i < 28 * power; i++) {
      a = Math.random() * Math.PI * 2; sp = (1 + Math.random() * 3.2) * power;
      spawn(view, { kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3.5, g: 0, max: 0.35 + Math.random() * 0.5, size: 0.06 + Math.random() * 0.12, hue: 20 + Math.random() * 35 });
    }
    for (i = 0; i < 9 * power; i++) {
      a = Math.random() * Math.PI * 2; sp = 1 + Math.random() * 2.5;
      spawn(view, { kind: 'debris', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.2, g: 9, drag: 0.5, max: 0.6 + Math.random() * 0.5, size: 0.04 + Math.random() * 0.05, rot: Math.random() * 6 });
    }
    for (i = 0; i < 7 * power; i++) {
      a = Math.random() * Math.PI * 2; sp = 0.2 + Math.random() * 0.6;
      spawn(view, { kind: 'smoke', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, drag: 1.2, max: 1.0 + Math.random() * 0.8, size: 0.2 + Math.random() * 0.15, grow: 0.35, shade: 40 + rnd(40), delay: 0.05 });
    }
    G.shake = Math.max(G.shake, 7 * power);
  }

  function fireworkBurst() {
    var view = 'enemy', cx = 1.5 + Math.random() * 7, cy = 1.5 + Math.random() * 7;
    var hue = [45, 190, 330, 120][rnd(4)];
    for (var i = 0; i < 40; i++) {
      var a = i / 40 * Math.PI * 2, sp = 2.5 + Math.random() * 0.8;
      spawn(view, { kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 1.6, g: 1.2, max: 0.9 + Math.random() * 0.4, size: 0.07, hue: hue, sat: 90, light: 65 });
    }
    Sound.play('click');
  }

  function popText(view, x, y, text, col, size) {
    G.texts.push({ view: view, x: x + 0.5, y: y + 0.5, text: text, col: col, size: size, t: 0, max: 1.3 });
  }

  function launchShell(view, x, y, cb) {
    Sound.play('launch');
    G.shells.push({ view: view, x: x, y: y, t: 0, dur: 0.5, cb: cb });
  }

  /* ------------------------------------------------------------------ */
  /* Update                                                               */
  /* ------------------------------------------------------------------ */
  function update(dt) {
    G.time += dt;

    // animate board rectangles toward their layout targets
    var k = 1 - Math.pow(0.0006, dt);
    ['player', 'enemy'].forEach(function (key) {
      var c = G.vcur[key], t = L.views[key];
      c.x = lerp(c.x, t.x, k); c.y = lerp(c.y, t.y, k); c.c = lerp(c.c, t.c, k); c.a = lerp(c.a, t.a, k);
    });

    // timers (game time, so they pause with the game)
    if (G.timers.length) {
      var due = G.timers.filter(function (t) { return t.t <= G.time; });
      if (due.length) {
        G.timers = G.timers.filter(function (t) { return t.t > G.time; });
        due.forEach(function (t) { t.fn(); });
      }
    }

    // shells in flight
    for (var i = G.shells.length - 1; i >= 0; i--) {
      var s = G.shells[i]; s.t += dt;
      if (s.t >= s.dur) { G.shells.splice(i, 1); s.cb(); }
    }

    // particles
    for (i = G.particles.length - 1; i >= 0; i--) {
      var p = G.particles[i];
      p.life += dt;
      if (p.life < 0) continue;
      if (p.life >= p.max) { G.particles.splice(i, 1); continue; }
      if (p.drag) { var f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
      if (p.g) p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (i = G.texts.length - 1; i >= 0; i--) { G.texts[i].t += dt; if (G.texts[i].t > G.texts[i].max) G.texts.splice(i, 1); }

    // burning wrecks: fire and smoke rising from hit cells
    if (G.phase !== 'place' && G.phase !== 'menu') {
      ['player', 'enemy'].forEach(function (key) {
        var b = G[key];
        for (var j = 0; j < N * N; j++) {
          if (b.shots[j] !== 2) continue;
          var sh = shipAtCell(b, j % N, (j / N) | 0), x = j % N + 0.5, y = ((j / N) | 0) + 0.5;
          if (!sh.sunk) {
            if (Math.random() < dt * 4) spawn(key, { kind: 'smoke', x: x + (Math.random() - 0.5) * 0.3, y: y, vx: 0.25, vy: -0.55, drag: 0.3, max: 1.4 + Math.random(), size: 0.13, grow: 0.45, shade: 50 + rnd(40) });
            if (Math.random() < dt * 6) spawn(key, { kind: 'spark', x: x + (Math.random() - 0.5) * 0.3, y: y, vx: (Math.random() - 0.5) * 0.3, vy: -0.6 - Math.random() * 0.6, drag: 1, max: 0.4 + Math.random() * 0.4, size: 0.035, hue: 25 + Math.random() * 25 });
          } else if (Math.random() < dt * 0.9) {
            spawn(key, { kind: 'smoke', x: x, y: y, vx: 0.2, vy: -0.35, drag: 0.3, max: 1.6 + Math.random(), size: 0.12, grow: 0.4, shade: 25 + rnd(20), alphaMul: 0.6 });
          }
        }
      });
    }

    G.shake = Math.max(0, G.shake - dt * 40);
    updateMenuShips(dt);
  }

  /* ------------------------------------------------------------------ */
  /* Drawing helpers                                                      */
  /* ------------------------------------------------------------------ */
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  var FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

  // Full-screen ocean behind everything
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b2c4b'); g.addColorStop(1, '#041425');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var t = G.time, step = 26;
    ctx.lineWidth = 1.5;
    for (var r = 0, y = 10; y < H + step; y += step, r++) {
      ctx.strokeStyle = 'rgba(150,200,255,' + (0.035 + 0.02 * Math.sin(r * 1.7 + t * 0.5)) + ')';
      ctx.beginPath();
      for (var x = -20; x <= W + 20; x += 18) {
        var yy = y + Math.sin(x * 0.018 + t * 0.9 + r * 0.8) * 4 + Math.sin(x * 0.041 - t * 0.6 + r) * 2;
        if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    var v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,6,14,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  /* Ships, drawn top-down with the bow pointing right (rotated for vertical) */
  var PAL = {
    player: { hull: ['#c4d0db', '#8696a6'], deck: '#6e7f90', line: '#22303d', det: '#e3eaf0', dark: '#4b5b6b' },
    enemy: { hull: ['#b88d80', '#7d5a51'], deck: '#6b4a43', line: '#2e1915', det: '#e8c6b9', dark: '#4c302a' },
    sunk: { hull: ['#5b5450', '#3a3431'], deck: '#332d2a', line: '#141110', det: '#6e6560', dark: '#252120' }
  };
  var HW = [0.37, 0.32, 0.29, 0.27, 0.26];

  function hullPath(L2, c, type) {
    var cy = c / 2, hw = c * HW[type], x0 = c * 0.1, x1 = L2 - c * 0.07;
    ctx.beginPath();
    if (type === 3) {
      ctx.moveTo(x0 + hw, cy - hw);
      ctx.lineTo(x1 - c * 0.7, cy - hw);
      ctx.quadraticCurveTo(x1, cy - hw * 0.85, x1, cy);
      ctx.quadraticCurveTo(x1, cy + hw * 0.85, x1 - c * 0.7, cy + hw);
      ctx.lineTo(x0 + hw, cy + hw);
      ctx.arc(x0 + hw, cy, hw, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      return;
    }
    var bow = c * (type === 0 ? 0.75 : type === 4 ? 0.6 : 0.95);
    ctx.moveTo(x0 + c * 0.12, cy - hw);
    ctx.lineTo(x1 - bow, cy - hw);
    ctx.quadraticCurveTo(x1 - bow * 0.2, cy - hw * 0.9, x1, cy);
    ctx.quadraticCurveTo(x1 - bow * 0.2, cy + hw * 0.9, x1 - bow, cy + hw);
    ctx.lineTo(x0 + c * 0.12, cy + hw);
    ctx.quadraticCurveTo(x0, cy + hw, x0, cy + hw * 0.55);
    ctx.lineTo(x0, cy - hw * 0.55);
    ctx.quadraticCurveTo(x0, cy - hw, x0 + c * 0.12, cy - hw);
    ctx.closePath();
  }

  function turret(x, y, r, dirSign, pal, c) {
    ctx.strokeStyle = pal.line; ctx.lineWidth = Math.max(1, c * 0.05); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - r * 0.3); ctx.lineTo(x + dirSign * r * 2.1, y - r * 0.3);
    ctx.moveTo(x, y + r * 0.3); ctx.lineTo(x + dirSign * r * 2.1, y + r * 0.3); ctx.stroke();
    ctx.fillStyle = pal.det; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(0.8, c * 0.025); ctx.stroke();
  }

  // opts: { pal: 'player'|'enemy'|'sunk', alpha, dmg: [bool per segment], lift }
  function drawShip(type, len, x, y, c, dir, opts) {
    opts = opts || {};
    var pal = PAL[opts.pal || 'player'];
    ctx.save();
    ctx.globalAlpha *= (opts.alpha == null ? 1 : opts.alpha);
    if (dir) { ctx.translate(x + c, y); ctx.rotate(Math.PI / 2); } else ctx.translate(x, y);
    var Lp = len * c, cy = c / 2, hw = c * HW[type];
    var lift = opts.lift || 0;
    // shadow on the water
    ctx.save(); ctx.translate(c * (0.05 + lift * 0.15), c * (0.09 + lift * 0.25));
    hullPath(Lp, c, type); ctx.fillStyle = 'rgba(0,12,28,' + (0.35 + lift * 0.1) + ')'; ctx.fill(); ctx.restore();
    // bow wave foam
    if (opts.pal !== 'sunk' && c > 12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(1, c * 0.05);
      ctx.beginPath(); ctx.moveTo(Lp - c * 0.12, cy - hw * 0.6); ctx.quadraticCurveTo(Lp - c * 0.02, cy, Lp - c * 0.12, cy + hw * 0.6); ctx.stroke();
    }
    hullPath(Lp, c, type);
    var hc = type === 3 ? [pal.dark, pal.line] : pal.hull;
    var g = ctx.createLinearGradient(0, cy - hw, 0, cy + hw);
    g.addColorStop(0, hc[0]); g.addColorStop(1, hc[1]);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, c * 0.045); ctx.strokeStyle = pal.line; ctx.stroke();

    ctx.save();
    hullPath(Lp, c, type); ctx.clip();
    var lw = Math.max(0.8, c * 0.03);
    if (type === 0) {
      // carrier: flight deck, runway markings, island, parked aircraft
      ctx.fillStyle = pal.deck; ctx.fillRect(c * 0.18, cy - hw * 0.82, Lp - c * 0.9, hw * 1.64);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = lw; ctx.setLineDash([c * 0.18, c * 0.12]);
      ctx.beginPath(); ctx.moveTo(c * 0.3, cy + hw * 0.1); ctx.lineTo(Lp - c * 0.8, cy + hw * 0.1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,220,120,0.7)';
      ctx.beginPath(); ctx.moveTo(c * 0.4, cy + hw * 0.6); ctx.lineTo(c * 2.2, cy - hw * 0.5); ctx.stroke();
      ctx.fillStyle = pal.det; ctx.strokeStyle = pal.line;
      rrect(Lp * 0.58, cy - hw * 1.0, c * 0.6, hw * 0.55, c * 0.05); ctx.fill(); ctx.lineWidth = lw; ctx.stroke();
      for (var a = 0; a < 3; a++) plane(c * (0.55 + a * 0.55), cy - hw * 0.35, c * 0.2, pal);
    } else if (type === 1) {
      ctx.fillStyle = pal.deck; ctx.fillRect(c * 0.25, cy - hw * 0.65, Lp - c * 1.2, hw * 1.3);
      ctx.fillStyle = pal.det; ctx.strokeStyle = pal.line; ctx.lineWidth = lw;
      rrect(Lp * 0.38, cy - hw * 0.55, Lp * 0.22, hw * 1.1, c * 0.06); ctx.fill(); ctx.stroke();
      ctx.fillStyle = pal.dark; ctx.beginPath(); ctx.ellipse(Lp * 0.49, cy, c * 0.14, hw * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); ctx.save(); // turrets may overhang the clip slightly
      turret(Lp * 0.2, cy, hw * 0.42, -1, pal, c);
      turret(Lp * 0.7, cy, hw * 0.42, 1, pal, c);
      turret(Lp * 0.82, cy, hw * 0.38, 1, pal, c);
    } else if (type === 2) {
      ctx.fillStyle = pal.det; ctx.strokeStyle = pal.line; ctx.lineWidth = lw;
      rrect(Lp * 0.38, cy - hw * 0.6, Lp * 0.28, hw * 1.2, c * 0.06); ctx.fill(); ctx.stroke();
      ctx.fillStyle = pal.dark; ctx.fillRect(Lp * 0.5, cy - hw * 0.2, c * 0.18, hw * 0.4);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(Lp * 0.18, cy, hw * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(Lp * 0.18 - hw * 0.25, cy - hw * 0.3); ctx.lineTo(Lp * 0.18 - hw * 0.25, cy + hw * 0.3);
      ctx.moveTo(Lp * 0.18 + hw * 0.25, cy - hw * 0.3); ctx.lineTo(Lp * 0.18 + hw * 0.25, cy + hw * 0.3);
      ctx.moveTo(Lp * 0.18 - hw * 0.25, cy); ctx.lineTo(Lp * 0.18 + hw * 0.25, cy); ctx.stroke();
      ctx.restore(); ctx.save();
      turret(Lp * 0.78, cy, hw * 0.4, 1, pal, c);
    } else if (type === 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(c * 0.4, cy); ctx.lineTo(Lp - c * 0.5, cy); ctx.stroke();
      ctx.fillStyle = pal.hull[1]; ctx.strokeStyle = pal.line;
      rrect(Lp * 0.4, cy - hw * 0.5, c * 0.62, hw, hw * 0.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = pal.det; ctx.beginPath(); ctx.arc(Lp * 0.4 + c * 0.45, cy, hw * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); ctx.save();
      ctx.fillStyle = pal.line;
      ctx.beginPath(); ctx.moveTo(c * 0.22, cy - hw); ctx.lineTo(c * 0.02, cy - hw * 1.5); ctx.lineTo(c * 0.08, cy - hw * 0.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c * 0.22, cy + hw); ctx.lineTo(c * 0.02, cy + hw * 1.5); ctx.lineTo(c * 0.08, cy + hw * 0.4); ctx.fill();
    } else {
      ctx.fillStyle = pal.deck; ctx.fillRect(c * 0.2, cy - hw * 0.7, Lp * 0.5, hw * 1.4);
      ctx.fillStyle = pal.det; ctx.strokeStyle = pal.line; ctx.lineWidth = lw;
      rrect(Lp * 0.3, cy - hw * 0.55, Lp * 0.25, hw * 1.1, c * 0.06); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.7)'; ctx.fillRect(Lp * 0.5, cy - hw * 0.4, c * 0.07, hw * 0.8);
      ctx.restore(); ctx.save();
      turret(Lp * 0.74, cy, hw * 0.35, 1, pal, c);
    }
    ctx.restore();

    // damage marks along the hull (used for the small fleet icons)
    if (opts.dmg) {
      for (var s = 0; s < len; s++) if (opts.dmg[s]) {
        ctx.fillStyle = '#ff4b2b';
        ctx.beginPath(); ctx.arc((s + 0.5) * c, cy, Math.max(1.6, c * 0.2), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function plane(x, y, s, pal) {
    ctx.fillStyle = pal.det;
    ctx.beginPath();
    ctx.moveTo(x + s, y); ctx.lineTo(x - s * 0.6, y - s * 0.12); ctx.lineTo(x - s * 0.6, y + s * 0.12); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - s * 0.1, y - s * 0.75, s * 0.25, s * 1.5);
    ctx.fillRect(x - s * 0.65, y - s * 0.32, s * 0.16, s * 0.64);
  }

  /* ------------------------------------------------------------------ */
  /* Board drawing                                                        */
  /* ------------------------------------------------------------------ */
  function isActive(key) {
    if (G.phase === 'place') return key === 'player';
    if (G.phase === 'battle') return (G.turn === 'player') === (key === 'enemy');
    return false;
  }

  function drawBoard(key) {
    var v = G.vcur[key];
    if (v.a < 0.02 || v.c < 2) return;
    var b = G[key], c = v.c, S = 10 * c, t = G.time, i, x, y;
    var isEnemy = key === 'enemy';
    var labelA = 1;
    if (L.mini && !L.land) {
      var mc = L.views[L.mini.key].c, bc = L.views[L.mini.key === 'enemy' ? 'player' : 'enemy'].c;
      labelA = bc > mc ? clamp((c - mc) / (bc - mc) * 1.6 - 0.6, 0, 1) : 1;
    }
    ctx.save();
    ctx.globalAlpha = v.a;

    // title
    var active = isActive(key);
    var tSize = labelA > 0.5 ? clamp(c * 0.42, 12, 19) : 12;
    var ty = labelA > 0.5 ? v.y - 0.7 * c - 0.38 * c : v.y - 10;
    ctx.font = '800 ' + tSize + 'px ' + FONT;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var title = isEnemy ? 'ENEMY WATERS' : 'YOUR FLEET';
    var tx = labelA > 0.5 ? v.x - 0.7 * c : v.x;
    ctx.fillStyle = active ? '#ffd66e' : '#9fc0dc';
    ctx.fillText(title, tx, ty);
    if (L.mini && L.mini.key === key && G.phase !== 'place') {
      var tw = ctx.measureText(title).width;
      ctx.font = '700 11px ' + FONT;
      var hint = tw + ctx.measureText('TAP TO VIEW').width + 12 < S ? 'TAP TO VIEW' : (tw + ctx.measureText('TAP').width + 12 < S ? 'TAP' : '');
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(200,225,245,0.75)';
      if (hint) ctx.fillText(hint, v.x + S, ty);
    }

    // frame + glow
    ctx.save();
    if (active) { ctx.shadowColor = 'rgba(255,200,80,0.55)'; ctx.shadowBlur = 18 + Math.sin(t * 4) * 6; }
    else { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16; }
    rrect(v.x - 3, v.y - 3, S + 6, S + 6, Math.min(10, c * 0.25));
    ctx.fillStyle = active ? '#c99a3a' : '#2b4a66'; ctx.fill();
    ctx.restore();

    // sea
    ctx.save();
    ctx.beginPath(); ctx.rect(v.x, v.y, S, S); ctx.clip();
    var sg = ctx.createLinearGradient(v.x, v.y, v.x + S * 0.4, v.y + S);
    if (isEnemy) { sg.addColorStop(0, '#1a5f86'); sg.addColorStop(1, '#0b3352'); }
    else { sg.addColorStop(0, '#2380b1'); sg.addColorStop(1, '#0f4d7a'); }
    ctx.fillStyle = sg; ctx.fillRect(v.x, v.y, S, S);
    // waves
    var rows = c > 18 ? 20 : 10, step = Math.max(4, c / 4);
    ctx.lineWidth = Math.max(1, c * 0.04);
    for (var r = 0; r < rows; r++) {
      var wy = v.y + (r + 0.5) * S / rows;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.045 + 0.03 * Math.sin(r * 2.3 + t * 0.8)) + ')';
      ctx.beginPath();
      for (x = 0; x <= S + step; x += step) {
        var yy = wy + Math.sin((x / c) * 1.6 + t * 1.3 + r * 1.1) * c * 0.07 + Math.sin((x / c) * 3.7 - t * 0.9 + r) * c * 0.03;
        if (x === 0) ctx.moveTo(v.x + x, yy); else ctx.lineTo(v.x + x, yy);
      }
      ctx.stroke();
    }
    // light caustics
    for (i = 0; i < 6; i++) {
      var gx = v.x + ((i * 0.173 + t * 0.012 * (i % 2 ? 1 : -1)) % 1 + 1) % 1 * S;
      var gy2 = v.y + ((i * 0.377 + t * 0.008) % 1) * S;
      var rg = ctx.createRadialGradient(gx, gy2, 0, gx, gy2, S * 0.25);
      rg.addColorStop(0, 'rgba(160,220,255,0.07)'); rg.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(gx - S * 0.25, gy2 - S * 0.25, S * 0.5, S * 0.5);
    }
    // grid
    ctx.strokeStyle = 'rgba(200,230,255,0.17)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 1; i < N; i++) {
      var p = Math.round(v.x + i * c) + 0.5; ctx.moveTo(p, v.y); ctx.lineTo(p, v.y + S);
      p = Math.round(v.y + i * c) + 0.5; ctx.moveTo(v.x, p); ctx.lineTo(v.x + S, p);
    }
    ctx.stroke();

    // forbidden zone while dragging a ship
    if (!isEnemy && G.drag && G.drag.moved) {
      var occ = occupancy(b, G.drag.ship);
      ctx.fillStyle = 'rgba(0,15,35,0.28)';
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        var near = false;
        for (var dy = -1; dy <= 1 && !near; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && occ[ny * N + nx] >= 0) { near = true; break; }
        }
        if (near) ctx.fillRect(v.x + x * c + 1, v.y + y * c + 1, c - 2, c - 2);
      }
      var sn = G.drag.snap;
      if (sn) {
        ctx.fillStyle = sn.ok ? 'rgba(90,240,150,0.32)' : 'rgba(255,80,60,0.35)';
        shipCells(G.drag.ship, sn.x, sn.y, G.drag.ship.dir).forEach(function (cc) {
          if (cc[0] >= 0 && cc[1] >= 0 && cc[0] < N && cc[1] < N) ctx.fillRect(v.x + cc[0] * c + 1, v.y + cc[1] * c + 1, c - 2, c - 2);
        });
      }
    }

    // ships
    b.ships.forEach(function (s) {
      if (!s.placed || (G.drag && G.drag.ship === s && G.drag.moved)) return;
      var alpha = 1, pal = 'player';
      if (isEnemy) {
        if (s.sunk) { alpha = clamp((t - s.sunkT - 0.2) / 0.7, 0, 1); pal = 'sunk'; }
        else if (G.phase === 'over') { alpha = 0.75; pal = 'enemy'; }
        else return;
      } else if (s.sunk) pal = 'sunk';
      var ox = 0;
      if (G.wobble && G.wobble.ship === s) {
        var wt = t - G.wobble.t;
        if (wt < 0.4) ox = Math.sin(wt * 50) * c * 0.1 * (1 - wt / 0.4);
      }
      drawShip(s.id, s.len, v.x + s.x * c + ox, v.y + s.y * c, c, s.dir, { pal: pal, alpha: alpha });
    });

    // shot markers
    for (i = 0; i < N * N; i++) {
      var st = b.shots[i];
      if (!st) continue;
      var age = t - b.shotT[i];
      if (age < 0) continue;
      var cx = v.x + (i % N + 0.5) * c, cy = v.y + (((i / N) | 0) + 0.5) * c;
      if (st === 1) {
        var pop = clamp(age / 0.25, 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(cx, cy, c * 0.27 * pop, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#eef7ff';
        ctx.beginPath(); ctx.arc(cx, cy, c * 0.12 * pop, 0, Math.PI * 2); ctx.fill();
      } else if (st === 3) {
        ctx.fillStyle = 'rgba(220,240,255,' + 0.35 * clamp(age / 0.3, 0, 1) + ')';
        ctx.beginPath(); ctx.arc(cx, cy, c * 0.07, 0, Math.PI * 2); ctx.fill();
      } else {
        var sh = shipAtCell(b, i % N, (i / N) | 0);
        var scorch = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.45);
        scorch.addColorStop(0, 'rgba(20,8,4,0.75)'); scorch.addColorStop(1, 'rgba(20,8,4,0)');
        ctx.fillStyle = scorch; ctx.fillRect(cx - c / 2, cy - c / 2, c, c);
        if (!sh.sunk) {
          // flickering flames
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (var fl = 0; fl < 3; fl++) {
            var fr = c * (0.2 + 0.06 * Math.sin(t * 17 + i + fl * 2.1)) * (1 - fl * 0.22);
            var fg = ctx.createRadialGradient(cx, cy - fl * c * 0.06, 0, cx, cy - fl * c * 0.06, fr);
            fg.addColorStop(0, 'rgba(255,240,170,0.9)'); fg.addColorStop(0.45, 'rgba(255,140,40,0.7)'); fg.addColorStop(1, 'rgba(255,60,20,0)');
            ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(cx, cy - fl * c * 0.06, fr, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
        ctx.strokeStyle = sh.sunk ? 'rgba(255,90,60,0.65)' : '#ff5a3c';
        ctx.lineWidth = Math.max(1.5, c * 0.08); ctx.lineCap = 'round';
        var e = c * 0.2;
        ctx.beginPath(); ctx.moveTo(cx - e, cy - e); ctx.lineTo(cx + e, cy + e); ctx.moveTo(cx + e, cy - e); ctx.lineTo(cx - e, cy + e); ctx.stroke();
      }
    }

    // enemy's latest shot on your board
    if (!isEnemy && G.lastEnemyShot && G.phase !== 'over') {
      var le = G.lastEnemyShot, la = clamp(1 - (t - le.t) / 3, 0.35, 1);
      ctx.strokeStyle = 'rgba(255,120,90,' + la + ')'; ctx.lineWidth = 2;
      ctx.strokeRect(v.x + le.x * c + 2, v.y + le.y * c + 2, c - 4, c - 4);
    }
    ctx.restore(); // sea clip

    // coordinates
    if (labelA > 0.02) {
      ctx.save();
      ctx.globalAlpha = v.a * labelA;
      ctx.fillStyle = '#9fc0dc';
      ctx.font = '700 ' + clamp(c * 0.36, 9, 16) + 'px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (i = 0; i < N; i++) {
        ctx.fillText(LETTERS[i], v.x + (i + 0.5) * c, v.y - 0.38 * c);
        ctx.fillText(String(i + 1), v.x - 0.38 * c, v.y + (i + 0.5) * c);
      }
      ctx.restore();
    }

    // aiming reticle (player's mouse/keyboard, or the enemy's sweep)
    if (isEnemy && G.phase === 'battle' && G.turn === 'player' && !G.busy) {
      var h = G.hover || (G.cursor.show ? G.cursor : null);
      if (h) drawReticle(v, h.x, h.y, b.shots[h.y * N + h.x] ? 'rgba(255,255,255,0.4)' : '#ffd66e', true);
    }
    if (G.aim && G.aim.view === key) {
      var ap = clamp((t - G.aim.t0) / G.aim.dur, 0, 1), ease = 1 - Math.pow(1 - ap, 3);
      drawReticle(v, lerp(G.aim.fx, G.aim.tx, ease), lerp(G.aim.fy, G.aim.ty, ease), '#ff6a4d', false);
    }
    if (!active && G.phase === 'battle') {
      ctx.fillStyle = 'rgba(2,12,26,0.22)'; ctx.fillRect(v.x, v.y, S, S);
    }
    ctx.restore();
  }

  function drawReticle(v, x, y, col, lines) {
    var c = v.c, px = v.x + x * c, py = v.y + y * c, S = 10 * c, t = G.time;
    ctx.save();
    if (lines) {
      ctx.fillStyle = 'rgba(255,214,110,0.07)';
      ctx.fillRect(v.x, py, S, c); ctx.fillRect(px, v.y, c, S);
    }
    var pulse = 1 + Math.sin(t * 8) * 0.05;
    ctx.translate(px + c / 2, py + c / 2); ctx.scale(pulse, pulse);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, c * 0.07); ctx.lineCap = 'round';
    var e = c * 0.46, k = c * 0.18;
    ctx.beginPath();
    ctx.moveTo(-e, -e + k); ctx.lineTo(-e, -e); ctx.lineTo(-e + k, -e);
    ctx.moveTo(e - k, -e); ctx.lineTo(e, -e); ctx.lineTo(e, -e + k);
    ctx.moveTo(e, e - k); ctx.lineTo(e, e); ctx.lineTo(e - k, e);
    ctx.moveTo(-e + k, e); ctx.lineTo(-e, e); ctx.lineTo(-e, e - k);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, c * 0.04);
    ctx.beginPath(); ctx.arc(0, 0, c * 0.16, 0, Math.PI * 2);
    ctx.moveTo(0, -c * 0.3); ctx.lineTo(0, -c * 0.08); ctx.moveTo(0, c * 0.08); ctx.lineTo(0, c * 0.3);
    ctx.moveTo(-c * 0.3, 0); ctx.lineTo(-c * 0.08, 0); ctx.moveTo(c * 0.08, 0); ctx.lineTo(c * 0.3, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawShells() {
    G.shells.forEach(function (s) {
      var v = G.vcur[s.view], c = v.c, p = clamp(s.t / s.dur, 0, 1);
      var tx = v.x + (s.x + 0.5) * c, ty = v.y + (s.y + 0.5) * c;
      // shadow grows as the shell drops
      ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + p * 0.3) + ')';
      ctx.beginPath(); ctx.ellipse(tx, ty, c * 0.12 * (0.4 + p), c * 0.08 * (0.4 + p), 0, 0, Math.PI * 2); ctx.fill();
      var q = 1 - p;
      var sx = tx + q * c * 1.2, sy = ty - q * c * 3.2 - Math.sin(p * Math.PI) * c * 0.5, size = c * 0.14 * (1 + q * 1.4);
      for (var k = 1; k <= 5; k++) {
        var qq = Math.min(1, q + k * 0.05);
        ctx.fillStyle = 'rgba(255,230,190,' + (0.18 - k * 0.03) + ')';
        ctx.beginPath(); ctx.arc(tx + qq * c * 1.2, ty - qq * c * 3.2 - Math.sin((1 - qq) * Math.PI) * c * 0.5, size * (1 - k * 0.12), 0, Math.PI * 2); ctx.fill();
      }
      var g = ctx.createRadialGradient(sx - size * 0.3, sy - size * 0.3, 0, sx, sy, size);
      g.addColorStop(0, '#fff3c4'); g.addColorStop(0.4, '#c9a24a'); g.addColorStop(1, '#3d2a10');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawParticles() {
    G.particles.forEach(function (p) {
      if (p.life < 0) return;
      var v = G.vcur[p.view];
      if (v.a < 0.05) return;
      var c = v.c, x = v.x + p.x * c, y = v.y + p.y * c, f = p.life / p.max, s;
      ctx.globalAlpha = v.a;
      switch (p.kind) {
        case 'spark':
          ctx.globalCompositeOperation = 'lighter';
          s = p.size * c * (1 - f * 0.6);
          ctx.fillStyle = 'hsla(' + p.hue + ',' + (p.sat || 100) + '%,' + (p.light || (60 - f * 25)) + '%,' + (1 - f) + ')';
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, s), 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'flash':
          ctx.globalCompositeOperation = 'lighter';
          var fg = ctx.createRadialGradient(x, y, 0, x, y, p.size * c);
          fg.addColorStop(0, 'rgba(255,250,220,' + (1 - f) + ')'); fg.addColorStop(0.4, 'rgba(255,170,60,' + 0.7 * (1 - f) + ')'); fg.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, p.size * c, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'smoke':
          s = (p.size + p.grow * p.life) * c;
          var a = (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85) * 0.45 * (p.alphaMul || 1);
          ctx.fillStyle = 'rgba(' + p.shade + ',' + p.shade + ',' + (p.shade + 6) + ',' + a + ')';
          ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
          break;
        case 'drop':
          ctx.fillStyle = p.col; ctx.globalAlpha = v.a * (1 - f);
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, p.size * c), 0, Math.PI * 2); ctx.fill();
          break;
        case 'debris':
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot + p.life * 8);
          ctx.fillStyle = 'rgba(40,30,25,' + (1 - f) + ')'; s = p.size * c;
          ctx.fillRect(-s, -s * 0.5, s * 2, s); ctx.restore();
          break;
        case 'ring':
          s = (p.size + p.grow * f) * c;
          ctx.strokeStyle = 'rgba(' + p.col + ',' + p.alpha * (1 - f) + ')'; ctx.lineWidth = Math.max(1, c * 0.05 * (1 - f));
          ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'foam':
          s = (p.size + p.grow * f) * c;
          var fo = ctx.createRadialGradient(x, y, 0, x, y, s);
          fo.addColorStop(0, 'rgba(255,255,255,' + 0.5 * (1 - f) + ')'); fo.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = fo; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
          break;
      }
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawTexts() {
    G.texts.forEach(function (tx) {
      var v = G.vcur[tx.view];
      if (v.a < 0.2) return;
      var f = tx.t / tx.max, c = Math.max(v.c, 14);
      var s = tx.size * c * (f < 0.15 ? 0.6 + f / 0.15 * 0.4 : 1);
      var x = v.x + tx.x * v.c, y = v.y + tx.y * v.c - c * 0.5 - f * c * 0.7;
      y = Math.max(y, v.y + s * 0.6);
      ctx.save();
      ctx.globalAlpha = v.a * (f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1);
      ctx.font = '900 ' + s + 'px ' + FONT;
      var hw = ctx.measureText(tx.text).width / 2 + 6;
      x = 10 * v.c > hw * 2 ? clamp(x, v.x + hw, v.x + 10 * v.c - hw) : v.x + 5 * v.c;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, s * 0.18); ctx.strokeStyle = 'rgba(4,16,30,0.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(tx.text, x, y);
      ctx.fillStyle = tx.col; ctx.fillText(tx.text, x, y);
      ctx.restore();
    });
  }

  /* Fleet status: one icon per ship, crossed out when sunk */
  function drawFleetStatus(key, r) {
    if (!r || G.vcur[key].a < 0.05) return;
    var b = G[key], isEnemy = key === 'enemy';
    var afloat = b.ships.filter(function (s) { return !s.sunk; }).length;
    var top = r.y, h = r.h;
    ctx.save();
    if (r.label) {
      ctx.font = '800 12px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = '#9fc0dc';
      ctx.fillText((isEnemy ? 'ENEMY SHIPS ' : 'YOUR SHIPS ') + afloat + '/5', r.x, top + 7);
      top += 16; h -= 16;
    }
    // one row if icons stay readable, otherwise two rows
    var textW = r.label ? 0 : clamp(h * 1.6, 30, 48);
    var s1 = Math.min(h * 0.8, (r.w - textW) / 19.4), rows;
    if (s1 >= 11 || r.label == null) rows = [[0, 1, 2, 3, 4]];
    else rows = [[0, 1], [2, 3, 4]];
    var s = rows.length === 1 ? s1 : Math.min(h / 2.4, r.w / 10.4);
    rows.forEach(function (row, ri) {
      var x = r.x, y = top + (rows.length === 1 ? (h - s) / 2 : ri * s * 1.25);
      row.forEach(function (id) {
        var sh = b.ships[id], dmg = null;
        if (!isEnemy) {
          dmg = shipCells(sh).map(function (cc) { return b.shots[cc[1] * N + cc[0]] === 2; });
        }
        drawShip(id, sh.len, x, y, s, 0, { pal: sh.sunk ? 'sunk' : (isEnemy ? 'enemy' : 'player'), alpha: sh.sunk ? 0.5 : 1, dmg: sh.sunk ? null : dmg });
        if (sh.sunk) {
          ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = Math.max(1.5, s * 0.12); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x + s * 0.2, y + s * 0.2); ctx.lineTo(x + sh.len * s - s * 0.2, y + s * 0.8); ctx.stroke();
        }
        x += sh.len * s + s * 0.6;
      });
    });
    if (!r.label) {
      ctx.font = '800 ' + clamp(s * 0.8, 11, 17) + 'px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = afloat ? '#9fc0dc' : '#ff7a5c';
      ctx.fillText(afloat + '/5', r.x + r.w, top + h / 2);
    }
    ctx.restore();
  }

  /* Placement dock and dragged ship */
  function drawDock() {
    if (!L.dock) return;
    var d = L.dock;
    ctx.save();
    ctx.font = '800 ' + d.title.size + 'px ' + FONT; ctx.textBaseline = 'middle';
    ctx.textAlign = d.title.center ? 'center' : 'left';
    ctx.fillStyle = '#ffd66e';
    ctx.fillText(L.land ? 'SHIPYARD' : 'DRAG SHIPS ONTO THE GRID · TAP TO ROTATE', d.title.x, d.title.y);
    ctx.restore();
    G.player.ships.forEach(function (s) {
      var sl = L.slots[s.id];
      // empty berth outline
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(160,205,245,0.28)'; ctx.lineWidth = 1.5;
      rrect(sl.x + 1, sl.y + 1, s.len * sl.d - 2, sl.d - 2, Math.min(8, sl.d * 0.25)); ctx.stroke();
      ctx.restore();
      if (s.placed || (G.drag && G.drag.ship === s && G.drag.moved)) return;
      var bob = Math.sin(G.time * 2 + s.id) * sl.d * 0.03;
      drawShip(s.id, s.len, sl.x, sl.y + bob, sl.d, 0, { pal: 'player' });
    });
    if (L.hint) {
      ctx.save();
      ctx.font = '600 ' + L.hint.size + 'px ' + FONT; ctx.fillStyle = '#a9c4dc'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      L.hint.lines.forEach(function (ln, i) { ctx.fillText(ln, L.hint.x, L.hint.y + i * L.hint.size * 1.35); });
      ctx.restore();
    }
  }

  function drawDragged() {
    var dr = G.drag;
    if (!dr || !dr.moved) return;
    var c = G.vcur.player.c, s = dr.ship;
    var p = dragPoint(dr);
    var x = s.dir ? p.x - c / 2 : p.x - (dr.k + 0.5) * c;
    var y = s.dir ? p.y - (dr.k + 0.5) * c : p.y - c / 2;
    drawShip(s.id, s.len, x, y, c, s.dir, { pal: 'player', alpha: 0.92, lift: 1 });
  }

  /* Menu scene: ships cruising across the sea */
  function makeMenuShips() {
    var c = clamp(Math.min(W, H) / 11, 26, 70);
    G.menuShips = [
      { id: 0, len: 5, y: H * 0.2, x: W * 0.15, sp: c * 0.35, dir: 1, c: c },
      { id: 1, len: 4, y: H * 0.78, x: W * 0.7, sp: c * 0.45, dir: -1, c: c * 0.9 },
      { id: 3, len: 3, y: H * 0.5, x: W * 0.9, sp: c * 0.3, dir: 1, c: c * 0.8 },
      { id: 4, len: 2, y: H * 0.9, x: W * 0.2, sp: c * 0.6, dir: 1, c: c * 0.7 }
    ];
  }
  function updateMenuShips(dt) {
    if (G.phase !== 'menu') return;
    G.menuShips.forEach(function (m) {
      m.x += m.sp * m.dir * dt;
      var len = m.len * m.c;
      if (m.dir > 0 && m.x > W + 40) m.x = -len - 40 - Math.random() * 200;
      if (m.dir < 0 && m.x < -len - 40) m.x = W + 40 + Math.random() * 200;
    });
  }
  function drawMenuScene() {
    G.menuShips.forEach(function (m) {
      var c = m.c, len = m.len * c;
      ctx.save();
      ctx.translate(m.x + len / 2, m.y + c / 2);
      if (m.dir < 0) ctx.scale(-1, 1);
      ctx.rotate(Math.sin(G.time * 0.8 + m.id) * 0.02);
      // wake
      var wl = c * 4;
      var g = ctx.createLinearGradient(-len / 2, 0, -len / 2 - wl, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-len / 2 + c * 0.2, -c * 0.25); ctx.lineTo(-len / 2 - wl, -c * 1.2); ctx.lineTo(-len / 2 - wl, -c * 1.05); ctx.lineTo(-len / 2 + c * 0.2, -c * 0.12); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-len / 2 + c * 0.2, c * 0.25); ctx.lineTo(-len / 2 - wl, c * 1.2); ctx.lineTo(-len / 2 - wl, c * 1.05); ctx.lineTo(-len / 2 + c * 0.2, c * 0.12); ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillRect(-len / 2 - wl * 0.6, -c * 0.12, wl * 0.6, c * 0.24);
      ctx.globalAlpha = 1;
      drawShip(m.id, m.len, -len / 2, -c / 2, c, 0, { pal: m.dir < 0 ? 'enemy' : 'player' });
      ctx.restore();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Main draw                                                            */
  /* ------------------------------------------------------------------ */
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground();
    if (G.phase === 'menu') { drawMenuScene(); return; }
    ctx.save();
    if (G.shake > 0.1) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    // draw the mini board first so the big one sits on top while they swap
    var order = (L.mini && L.mini.key === 'player') ? ['player', 'enemy'] : ['enemy', 'player'];
    if (L.land) order = ['player', 'enemy'];
    order.forEach(drawBoard);
    if (G.phase === 'place') drawDock();
    else { drawFleetStatus('player', L.status.player); drawFleetStatus('enemy', L.status.enemy); }
    drawParticles();
    drawShells();
    drawTexts();
    drawDragged();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                                */
  /* ------------------------------------------------------------------ */
  function cellAt(key, px, py) {
    var v = G.vcur[key];
    if (v.a < 0.5) return null;
    var x = Math.floor((px - v.x) / v.c), y = Math.floor((py - v.y) / v.c);
    if (x < 0 || y < 0 || x >= N || y >= N) return null;
    return { x: x, y: y };
  }

  // On touch the dragged ship floats above the finger so it stays visible.
  function dragPoint(dr) {
    return { x: dr.px, y: dr.py - (dr.touch ? G.vcur.player.c * 0.9 : 0) };
  }

  function computeSnap(dr) {
    var v = G.vcur.player, c = v.c, s = dr.ship, p = dragPoint(dr);
    var fx = (p.x - v.x) / c, fy = (p.y - v.y) / c;
    if (fx < -1 || fy < -1 || fx > N + 1 || fy > N + 1) return null;
    var gx = Math.floor(fx), gy = Math.floor(fy);
    var ox = s.dir ? gx : gx - dr.k, oy = s.dir ? gy - dr.k : gy;
    ox = clamp(ox, 0, s.dir ? N - 1 : N - s.len); oy = clamp(oy, 0, s.dir ? N - s.len : N - 1);
    return { x: ox, y: oy, ok: canPlace(G.player, s, ox, oy, s.dir) };
  }

  function rotatePlaced(s) {
    var nd = 1 - s.dir, best = null, bd = 1e9;
    for (var dy = -s.len; dy <= s.len; dy++) for (var dx = -s.len; dx <= s.len; dx++) {
      var x = s.x + dx, y = s.y + dy, dist = Math.abs(dx) + Math.abs(dy);
      if (dist < bd && canPlace(G.player, s, x, y, nd)) { best = [x, y]; bd = dist; }
    }
    if (best) { s.x = best[0]; s.y = best[1]; s.dir = nd; Sound.play('rotate'); }
    else { G.wobble = { ship: s, t: G.time }; Sound.play('bad'); }
  }

  function onDown(e) {
    Sound.init();
    if (G.paused) return;
    var px = e.clientX, py = e.clientY;
    if (G.phase === 'place') {
      var cell = cellAt('player', px, py), hit = null, fromDock = false, k = 0;
      if (cell) { var r = placedShipAt(G.player, cell.x, cell.y); if (r) { hit = r.ship; k = r.k; } }
      if (!hit) {
        G.player.ships.forEach(function (s) {
          if (s.placed || hit) return;
          var sl = L.slots[s.id];
          if (px >= sl.x && px <= sl.x + s.len * sl.d && py >= sl.y - 4 && py <= sl.y + sl.d + 4) {
            hit = s; fromDock = true; k = clamp(Math.floor((px - sl.x) / sl.d), 0, s.len - 1);
          }
        });
      }
      if (hit) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        G.drag = { ship: hit, k: k, fromDock: fromDock, sx: px, sy: py, px: px, py: py, moved: false, touch: e.pointerType === 'touch', orig: { x: hit.x, y: hit.y, dir: hit.dir, placed: hit.placed }, snap: null };
        if (fromDock) hit.dir = 0;
      }
      return;
    }
    if (G.phase === 'battle' || G.phase === 'over') {
      if (L.mini && px >= L.mini.x && px <= L.mini.x + L.mini.w && py >= L.mini.y && py <= L.mini.y + L.mini.h) {
        G.peek = !G.peek; relayout(false); Sound.play('click'); return;
      }
      if (G.phase === 'battle') {
        var c2 = cellAt('enemy', px, py);
        if (c2 && (L.land || bigKey() === 'enemy')) {
          G.cursor.x = c2.x; G.cursor.y = c2.y;
          playerFire(c2.x, c2.y);
        }
      }
    }
  }

  function onMove(e) {
    var px = e.clientX, py = e.clientY;
    if (G.drag) {
      var dr = G.drag;
      dr.px = px; dr.py = py;
      if (!dr.moved && Math.hypot(px - dr.sx, py - dr.sy) > 7) { dr.moved = true; Sound.play('pick'); }
      if (dr.moved) dr.snap = computeSnap(dr);
      return;
    }
    if (e.pointerType === 'mouse' && G.phase === 'battle') {
      var c = (L.land || bigKey() === 'enemy') ? cellAt('enemy', px, py) : null;
      G.hover = c; if (c) G.cursor.show = false;
      canvas.style.cursor = c && G.turn === 'player' ? 'crosshair' : 'default';
    } else if (G.phase === 'place' && e.pointerType === 'mouse') {
      var over = cellAt('player', px, py);
      canvas.style.cursor = over && placedShipAt(G.player, over.x, over.y) ? 'grab' : 'default';
    }
  }

  function onUp() {
    var dr = G.drag;
    if (!dr) return;
    G.drag = null;
    var s = dr.ship;
    if (!dr.moved) {
      if (s.placed) rotatePlaced(s);
      else if (autoPlace(G.player, s)) Sound.play('place');
      else Sound.play('bad');
    } else {
      var sn = computeSnap(dr);
      if (sn && sn.ok) { s.x = sn.x; s.y = sn.y; s.placed = true; Sound.play('place'); }
      else {
        s.x = dr.orig.x; s.y = dr.orig.y; s.dir = dr.orig.dir; s.placed = dr.orig.placed;
        if (s.placed && !canPlace(G.player, s, s.x, s.y, s.dir)) s.placed = false;
        Sound.play('bad');
      }
    }
    updatePlaceUI();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', function () { G.hover = null; });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('keydown', function (e) {
    Sound.init();
    var k = e.key;
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (G.phase === 'place' || G.phase === 'battle') { togglePause(); e.preventDefault(); }
      return;
    }
    if (G.paused) return;
    if (G.phase === 'place') {
      if ((k === 'r' || k === 'R') && G.drag) {
        G.drag.ship.dir = 1 - G.drag.ship.dir;
        G.drag.k = Math.min(G.drag.k, G.drag.ship.len - 1);
        if (G.drag.moved) G.drag.snap = computeSnap(G.drag);
        Sound.play('rotate');
      }
      return;
    }
    if (G.phase === 'battle' && G.turn === 'player') {
      var cu = G.cursor, moved = true;
      if (k === 'ArrowLeft') cu.x = Math.max(0, cu.x - 1);
      else if (k === 'ArrowRight') cu.x = Math.min(N - 1, cu.x + 1);
      else if (k === 'ArrowUp') cu.y = Math.max(0, cu.y - 1);
      else if (k === 'ArrowDown') cu.y = Math.min(N - 1, cu.y + 1);
      else moved = false;
      if (moved) { cu.show = true; G.hover = null; e.preventDefault(); return; }
      if ((k === 'Enter' || k === ' ') && cu.show) { playerFire(cu.x, cu.y); e.preventDefault(); }
    }
  });

  /* ------------------------------------------------------------------ */
  /* HTML buttons                                                         */
  /* ------------------------------------------------------------------ */
  function onClick(id, fn) {
    $(id).addEventListener('click', function (e) { Sound.init(); Sound.play('click'); fn(e); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.diff'), function (b) {
    b.addEventListener('click', function () {
      Sound.init(); Sound.play('click');
      G.diff = b.getAttribute('data-d'); store.set('difficulty', G.diff); refreshMenu();
    });
  });
  onClick('btnPlay', startPlacement);
  onClick('btnRandom', function () { randomPlace(G.player); updatePlaceUI(); Sound.play('place'); });
  onClick('btnClear', function () { G.player.ships.forEach(function (s) { s.placed = false; s.dir = 0; }); updatePlaceUI(); });
  onClick('btnStart', beginBattle);
  onClick('btnMenu', togglePause);
  onClick('btnResume', togglePause);
  onClick('btnRestart', startPlacement);
  onClick('btnHome', goMenu);
  onClick('btnAgain', startPlacement);
  onClick('btnOverMenu', goMenu);
  onClick('btnSee', function () { showOverlay('over', false); $('btnResults').classList.remove('hidden'); });
  onClick('btnResults', function () { $('btnResults').classList.add('hidden'); showOverlay('over', true); });
  onClick('btnMute', function () { $('btnMute').classList.toggle('muted', Sound.toggle()); });
  $('btnMute').classList.toggle('muted', Sound.muted);

  function togglePause() {
    if (G.phase === 'over') { showOverlay('over', true); $('btnResults').classList.add('hidden'); return; }
    if (G.phase === 'menu') return;
    G.paused = !G.paused;
    showOverlay('pause', G.paused);
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                 */
  /* ------------------------------------------------------------------ */
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)) * (G.speed || 1);
    last = now;
    if (!G.paused) update(dt);
    else updateViewsOnly(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function updateViewsOnly() { /* frozen while paused */ }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Sound.suspend();
    else { Sound.resume(); last = performance.now(); }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  // Small hook used by automated tests and screenshots.
  window.SeaBattle = {
    state: G,
    play: startPlacement,
    random: function () { randomPlace(G.player); updatePlaceUI(); },
    start: beginBattle,
    fire: playerFire,
    resolve: resolveShot,
    menu: goMenu,
    layout: function () { return L; },
    sim: function (diff) {
      var b = makeBoard(); randomPlace(b); b.occ = occupancy(b); var n = 0;
      while (!allSunk(b) && n < 100) { var p = AI.choose(b, diff); resolveShot(b, p[0], p[1]); n++; }
      return n;
    }
  };

  resize();
  goMenu();
  requestAnimationFrame(frame);
})();
