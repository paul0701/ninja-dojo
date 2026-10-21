/* Ninja Dojo — a single-file arena brawler. Hold the centre, strike in eight
   directions, clear escalating waves, pick a power-up each wave, counter the sumo.
   Pseudo-3D: enemies live on a ground plane (angle + distance from centre) and are
   projected through a tilted camera. No build step — plain canvas + JS. */
(function () {
  'use strict';
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };
  var W = 0, H = 0, R = 1, CX = 0, CY = 0, DPR = 1;
  var DEPTH = 0.62, LIFT = 0.9;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- eight directions (screen-space ground vectors) ---------- */
  var DIR = [
    [0, -1], [0.7071, -0.7071], [1, 0], [0.7071, 0.7071],
    [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071]
  ]; // 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW
  var KEYDIR = { q: 7, w: 0, e: 1, a: 6, d: 2, z: 5, x: 4, c: 3,
    arrowup: 0, arrowright: 2, arrowdown: 4, arrowleft: 6 };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(n) { return Math.floor(Math.random() * n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- state ---------- */
  var S, player, ARENA = 'dojo';
  var ARENAS = {
    dojo:  { name: 'Dojo courtyard', floor: '#b07a43', floor2: '#7c5330', wall: '#2a1d13', glow: '#ffcb57', sky: '#140d09' },
    tokyo: { name: 'Neon Tokyo street', floor: '#2c2740', floor2: '#1b1830', wall: '#0e0b18', glow: '#ff3da6', sky: '#0a0814' }
  };

  function freshPlayer() {
    return { face: 4, strikeT: 0, cd: 0, reach: 0.44, cdBase: 0.26, slash: 0, hurt: 0,
      powers: {}, meter: 0, meterMax: 10 };
  }
  function reset() {
    S = { scene: 'menu', t: 0, wave: 0, score: 0, kills: 0, combo: 0, comboT: 0, lives: 3, maxLives: 5,
      enemies: [], slashes: [], parts: [], texts: [], shuriken: [], spawnQ: [], spawnT: 0, waveLeft: 0,
      shake: 0, flash: 0, flashColor: '#fff', best: loadBest(), muted: loadMuted(),
      boss: null, slowT: 0, submitted: false, lastDir: 4 };
    player = freshPlayer();
  }

  function loadBest() { try { return +localStorage.getItem('ninjaDojo.best') || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('ninjaDojo.best', String(v)); } catch (e) {} }
  function loadMuted() { try { return localStorage.getItem('ninjaDojo.sound') === 'off'; } catch (e) { return false; } }

  /* ---------- projection ---------- */
  function project(wx, wz, elev) {
    var sx = CX + wx * R;
    var sy = CY + wz * R * DEPTH - (elev || 0) * R * LIFT;
    var scale = 0.62 + (wz + 1) * 0.30;   // nearer (bottom) = bigger
    return { x: sx, y: sy, s: scale };
  }
  function enemyPos(e) { return project(DIR[e.dir][0] * e.d, DIR[e.dir][1] * e.d, 0); }

  /* ---------- resize ---------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(innerWidth * DPR); H = Math.round(innerHeight * DPR);
    cv.width = W; cv.height = H;
    R = Math.min(W, H * 1.25) * 0.42;
    CX = W * 0.5; CY = H * 0.5 + R * 0.08;
  }

  /* ---------- waves / difficulty ---------- */
  function startWave(n) {
    S.wave = n; S.scene = 'play';
    var q = [], i;
    var bossWave = n % 5 === 0;
    // escalating counts and speed; no passive regen — difficulty must come from the wave
    var count = Math.min(40, 4 + Math.floor(n * 1.7));
    var speed = 0.10 + n * 0.0135;                 // distance/sec of approach
    var guards = n >= 3 ? Math.floor(n * 0.5) : 0;
    var dashers = n >= 2 ? Math.floor(n * 0.7) : 0;
    for (i = 0; i < count; i++) {
      var type = 'brawler';
      if (dashers > 0 && Math.random() < 0.3) { type = 'dasher'; dashers--; }
      else if (guards > 0 && Math.random() < 0.3) { type = 'guard'; guards--; }
      q.push({ type: type, speed: speed * (type === 'dasher' ? 1.7 : 1) });
    }
    if (bossWave) { var bosses = n >= 15 ? 2 : 1; for (i = 0; i < bosses; i++) q.push({ type: 'sumo', speed: 0.055 + n * 0.002, boss: true }); }
    // shuffle
    for (i = q.length - 1; i > 0; i--) { var j = ri(i + 1), t = q[i]; q[i] = q[j]; q[j] = t; }
    S.spawnQ = q; S.waveLeft = q.length; S.spawnT = 0.4;
    S.spawnGap = Math.max(0.28, 1.15 - n * 0.045);
    toast('WAVE ' + n, bossWave ? ARENAS[ARENA].glow : '#fff', bossWave ? 'Sumo incoming' : '');
    setOverlay(null);
  }

  function spawnEnemy(spec) {
    var dir = ri(8);
    var e = { type: spec.type, dir: dir, d: 1.08, speed: spec.speed, boss: !!spec.boss,
      hp: 1, maxhp: 1, t: 0, state: 'walk', windup: 0, hitFlash: 0, wob: Math.random() * 6, dead: 0 };
    if (spec.type === 'guard') { e.hp = e.maxhp = 2; }
    if (spec.type === 'sumo') { e.hp = e.maxhp = 8 + Math.floor(S.wave / 5) * 2; e.d = 1.12; }
    S.enemies.push(e);
  }

  /* ---------- power-ups ---------- */
  var POWERS = {
    nunchucks: { ico: '🥢', name: 'Nunchucks', desc: 'Longer reach — strike enemies further out.', group: 'range',
      apply: function () { player.reach += 0.09; player.powers.nunchucks = (player.powers.nunchucks || 0) + 1; } },
    heart:     { ico: '❤️', name: 'Spirit', desc: 'Restore a heart (up to five).',
      apply: function () { S.lives = Math.min(S.maxLives, S.lives + 1); } },
    swift:     { ico: '⚡', name: 'Swift strikes', desc: 'Strike faster — shorter recovery.',
      apply: function () { player.cdBase = Math.max(0.12, player.cdBase - 0.045); } },
    shuriken:  { ico: '✴️', name: 'Shuriken', desc: 'Throw a star at the nearest foe every few seconds.', group: 'range',
      apply: function () { player.powers.shuriken = (player.powers.shuriken || 0) + 1; } },
    whirlwind: { ico: '🌀', name: 'Whirlwind', desc: 'Fills a meter as you strike; unleash a spin that clears everyone near.',
      apply: function () { player.powers.whirlwind = true; } },
    focus:     { ico: '🧘', name: 'Focus', desc: 'A clean counter briefly slows time.',
      apply: function () { player.powers.focus = true; } }
  };
  function ownedGroup(g) {   // which range weapon (if any) the player has committed to
    return Object.keys(POWERS).some(function (k) { return POWERS[k].group === g && player.powers[k]; });
  }
  function offerPowers() {
    S.scene = 'levelup';
    var keys = Object.keys(POWERS).slice();
    // drop a range weapon once you've committed to the other (no shuriken + nunchucks)
    if (ownedGroup('range')) keys = keys.filter(function (k) { return !(POWERS[k].group === 'range' && !player.powers[k]); });
    for (var i = keys.length - 1; i > 0; i--) { var j = ri(i + 1), t = keys[i]; keys[i] = keys[j]; keys[j] = t; }
    // pick three, but never two of the same group in one offer
    var pick = [], groups = {};
    for (i = 0; i < keys.length && pick.length < 3; i++) {
      var g = POWERS[keys[i]].group;
      if (g && groups[g]) continue;
      if (g) groups[g] = 1;
      pick.push(keys[i]);
    }
    if (S.lives < S.maxLives && pick.indexOf('heart') < 0) pick[pick.length - 1] = 'heart';
    var wrap = $('levelCards'); wrap.innerHTML = '';
    $('levelWave').textContent = S.wave;
    pick.forEach(function (k) {
      var p = POWERS[k], lvl = player.powers[k];
      var el = document.createElement('button'); el.className = 'card'; el.type = 'button';
      el.innerHTML = '<div class="ico">' + p.ico + '</div><h3>' + p.name + '</h3><p>' + p.desc + '</p>' +
        '<div class="lvl">' + (lvl ? 'Level ' + (lvl + 1) : 'New') + '</div>';
      el.addEventListener('click', function () { p.apply(); sfx('power'); startWave(S.wave + 1); });
      wrap.appendChild(el);
    });
    setOverlay('ovLevel');
  }

  /* ---------- combat ---------- */
  function strike(dir) {
    if (S.scene !== 'play' || player.cd > 0) return;
    player.face = dir; S.lastDir = dir;
    player.cd = player.cdBase; player.strikeT = 0.18; player.slash = 1;
    sfx('slash');
    var sv = DIR[dir], hit = 0, i, e;
    for (i = 0; i < S.enemies.length; i++) {
      e = S.enemies[i];
      if (e.state === 'dead') continue;
      var ev = DIR[e.dir], dot = ev[0] * sv[0] + ev[1] * sv[1];
      // in the struck arc and within reach
      if (dot > 0.6 && e.d <= player.reach + (e.boss ? 0.12 : 0.04)) {
        var counter = e.boss && e.state === 'windup';
        damage(e, counter ? 3 : 1, counter);
        hit++;
        if (player.powers.whirlwind) player.meter = Math.min(player.meterMax, player.meter + 1);
      }
    }
    if (hit) { bumpCombo(); } else { player.meter = Math.min(player.meterMax, player.meter + 0.2); }
    if (player.powers.whirlwind && player.meter >= player.meterMax) whirlwind();
  }

  function damage(e, amount, counter) {
    e.hp -= amount; e.hitFlash = 0.18; S.shake = Math.max(S.shake, e.boss ? 0.5 : 0.22);
    var p = enemyPos(e);
    burst(p.x, p.y - R * 0.12 * p.s, e.boss ? ARENAS[ARENA].glow : '#ffe6c0', e.boss ? 14 : 8, 170);
    if (counter) { toast('COUNTER!', '#ff5f6d', ''); if (player.powers.focus) S.slowT = 0.9; S.flash = 0.5; S.flashColor = '#ffd36b'; }
    if (e.hp <= 0) kill(e);
  }

  function kill(e) {
    e.state = 'dead'; e.dead = 0.35; S.kills++;
    var base = e.boss ? 1500 : e.type === 'guard' ? 150 : e.type === 'dasher' ? 120 : 80;
    var gain = Math.round(base * Math.max(1, S.combo));
    S.score += gain;
    var p = enemyPos(e);
    burst(p.x, p.y - R * 0.1 * p.s, e.boss ? ARENAS[ARENA].glow : '#fff', e.boss ? 40 : 14, e.boss ? 320 : 220);
    float('+' + gain, p.x, p.y - R * 0.22 * p.s, e.boss ? ARENAS[ARENA].glow : '#ffe6c0');
    if (e.boss) { S.flash = 0.6; S.flashColor = ARENAS[ARENA].glow; sfx('boss'); } else sfx('hit');
  }

  function whirlwind() {
    player.meter = 0; S.shake = 0.6; S.flash = 0.5; S.flashColor = '#bfe9ff'; sfx('whirl');
    toast('WHIRLWIND', '#bfe9ff', '');
    S.enemies.forEach(function (e) { if (e.state !== 'dead' && e.d < 0.62) damage(e, e.boss ? 2 : 5); });
    for (var a = 0; a < 26; a++) { var an = a / 26 * 6.283; burst(CX + Math.cos(an) * R * 0.4, CY + Math.sin(an) * R * 0.4 * DEPTH, '#bfe9ff', 1, 240); }
  }

  function bumpCombo() { S.combo = Math.min(9, S.combo + 1); S.comboT = 2.4; }
  function hurtPlayer(n) {
    if (player.hurt > 0) return;
    S.lives -= n; player.hurt = 1.1; S.shake = 0.7; S.flash = 0.55; S.flashColor = '#d7261e';
    S.combo = 0; sfx('ouch');
    if (S.lives <= 0) gameOver();
  }

  /* ---------- effects ---------- */
  function burst(x, y, color, n, spd) {
    for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, s = spd * (0.3 + Math.random());
      S.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.3 + Math.random() * 0.4, max: 0.7, color: color, r: 1 + Math.random() * 2.4 }); }
  }
  function float(text, x, y, color) { S.texts.push({ text: text, x: x, y: y, color: color, life: 0.9, max: 0.9, scale: 1 }); }
  function toast(text, color, sub) { S.texts.push({ text: text, sub: sub, x: CX, y: CY - R * 0.7, color: color, life: 1.5, max: 1.5, scale: 1.8, big: true }); }

  /* ---------- update ---------- */
  function update(dt) {
    S.t += dt;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 2.4);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 1.6);
    // particles/texts always animate
    for (var i = 0; i < S.parts.length; i++) { var p = S.parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; }
    S.parts = S.parts.filter(function (p) { return p.life > 0; });
    for (i = 0; i < S.texts.length; i++) { var tx = S.texts[i]; tx.life -= dt; if (!tx.big) tx.y -= 42 * dt; }
    S.texts = S.texts.filter(function (t) { return t.life > 0; });

    if (S.scene !== 'play') return;
    var sdt = dt * (S.slowT > 0 ? 0.4 : 1);
    if (S.slowT > 0) S.slowT -= dt;

    player.cd = Math.max(0, player.cd - dt);
    player.strikeT = Math.max(0, player.strikeT - dt);
    player.slash = Math.max(0, player.slash - dt * 5);
    player.hurt = Math.max(0, player.hurt - dt);
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }

    // shuriken auto-throw
    if (player.powers.shuriken) {
      player.shurT = (player.shurT || 0) - sdt;
      if (player.shurT <= 0) { player.shurT = Math.max(0.7, 2.2 - player.powers.shuriken * 0.35); throwStar(); }
    }
    for (i = 0; i < S.shuriken.length; i++) { var st = S.shuriken[i]; st.d += st.sp * sdt; st.spin += dt * 20;
      // hit first enemy along its direction near its distance
      for (var k = 0; k < S.enemies.length; k++) { var se = S.enemies[k];
        if (se.state !== 'dead' && se.dir === st.dir && Math.abs(se.d - st.d) < 0.06) { damage(se, 1); st.d = 2; break; } } }
    S.shuriken = S.shuriken.filter(function (s) { return s.d < 1.15; });

    // spawning
    if (S.spawnQ.length) { S.spawnT -= sdt; if (S.spawnT <= 0) { spawnEnemy(S.spawnQ.shift()); S.spawnT = S.spawnGap; } }

    // enemies
    for (i = 0; i < S.enemies.length; i++) {
      var e = S.enemies[i];
      e.t += sdt; e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.state === 'dead') { e.dead -= dt; continue; }
      if (e.boss) {
        // sumo: lumbers in, then winds up a charge you must counter
        if (e.d > 0.26) { e.d -= e.speed * sdt; }
        else {
          if (e.state === 'walk') { e.state = 'windup'; e.windup = 1.0; }
          else if (e.state === 'windup') { e.windup -= sdt; if (e.windup <= 0) { hurtPlayer(2); e.state = 'walk'; e.d = 0.5; } }
        }
      } else {
        e.d -= e.speed * sdt;
        if (e.d <= 0.14 && e.state !== 'strike') { e.state = 'strike'; e.windup = 0.28; }
        if (e.state === 'strike') { e.windup -= sdt; if (e.windup <= 0) { hurtPlayer(1); e.state = 'dead'; e.dead = 0.2; var pp = enemyPos(e); burst(pp.x, pp.y, '#d7261e', 8, 140); } }
      }
    }
    S.enemies = S.enemies.filter(function (e) { return !(e.state === 'dead' && e.dead <= 0); });

    // wave cleared?
    if (S.spawnQ.length === 0 && S.enemies.length === 0) {
      S.score += 200 * S.wave; offerPowers();
    }
  }

  function throwStar() {
    // aim at nearest live enemy
    var best = null, bd = 9; S.enemies.forEach(function (e) { if (e.state !== 'dead' && e.d < bd) { bd = e.d; best = e; } });
    if (!best) return;
    S.shuriken.push({ dir: best.dir, d: 0.12, sp: 1.6, spin: 0 }); sfx('star');
  }

  /* ---------- render ---------- */
  function draw() {
    var A = ARENAS[ARENA];
    ctx.save();
    if (S.shake > 0) ctx.translate(rnd(-1, 1) * S.shake * 10, rnd(-1, 1) * S.shake * 10);
    drawArena(A);

    // build a draw list (floor shadow + sprite) sorted by depth (wz)
    var list = [];
    S.enemies.forEach(function (e) { var wz = DIR[e.dir][1] * e.d; list.push({ wz: wz, e: e }); });
    list.push({ wz: 0, player: true });
    list.sort(function (a, b) { return a.wz - b.wz; });

    // ground shadows first (so sprites overlap cleanly)
    S.enemies.forEach(function (e) { var p = enemyPos(e); shadow(p.x, p.y, (e.boss ? 0.16 : 0.09) * R * p.s); });
    shadow(CX, CY, 0.11 * R);

    list.forEach(function (it) { if (it.player) drawPlayer(A); else drawEnemy(it.e, A); });

    // shuriken
    S.shuriken.forEach(function (st) { var p = project(DIR[st.dir][0] * st.d, DIR[st.dir][1] * st.d, 0.3);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(st.spin); ctx.fillStyle = '#e9f6ff';
      for (var a = 0; a < 4; a++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5 * p.s, -2); ctx.lineTo(13 * p.s, 0); ctx.lineTo(5 * p.s, 2); ctx.fill(); }
      ctx.restore(); });

    // particles
    S.parts.forEach(function (p) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * DPR, 0, 6.283); ctx.fill(); });
    ctx.globalAlpha = 1;

    drawHUD(A);

    // texts
    S.texts.forEach(function (t) {
      var a = clamp(t.life / t.max, 0, 1); ctx.globalAlpha = a; ctx.textAlign = 'center';
      if (t.big) {
        ctx.font = '800 ' + (28 * t.scale * DPR) + 'px "Shippori Mincho B1",serif'; ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        if (t.sub) { ctx.font = '700 ' + (14 * DPR) + 'px "Zen Kaku Gothic New",sans-serif'; ctx.fillStyle = '#d8ccb8'; ctx.fillText(t.sub, t.x, t.y + 26 * DPR); }
      } else {
        ctx.font = '900 ' + (16 * DPR) + 'px "Zen Kaku Gothic New",sans-serif'; ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    if (S.flash > 0) { ctx.globalAlpha = S.flash * 0.5; ctx.fillStyle = S.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function shadow(x, y, r) { ctx.save(); ctx.translate(x, y); ctx.scale(1, DEPTH); ctx.fillStyle = 'rgba(0,0,0,.33)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill(); ctx.restore(); }

  function drawArena(A) {
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, A.sky); g.addColorStop(1, '#070504');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (ARENA === 'tokyo') drawTokyo(A); else drawDojoBg(A);
    // the dojo ring (the arena floor), projected as an ellipse
    ctx.save(); ctx.translate(CX, CY); ctx.scale(1, DEPTH);
    var fg = ctx.createRadialGradient(0, -R * 0.2, R * 0.1, 0, 0, R * 1.05);
    fg.addColorStop(0, A.floor); fg.addColorStop(1, A.floor2);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2 * DPR;
    for (var i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(0, 0, R * i / 3.2, 0, 6.283); ctx.stroke(); }
    // centre mark
    ctx.strokeStyle = A.glow; ctx.globalAlpha = 0.5; ctx.lineWidth = 3 * DPR; ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
  }
  function drawDojoBg(A) {
    // back wall with shoji panels
    ctx.fillStyle = A.wall; ctx.fillRect(0, 0, W, CY - R * 0.55);
    ctx.strokeStyle = 'rgba(255,203,87,.16)'; ctx.lineWidth = 2 * DPR;
    var y = CY - R * 0.62;
    for (var x = 0; x < W; x += W / 10) { ctx.strokeRect(x + 4, y - 70 * DPR, W / 10 - 8, 70 * DPR); }
    // paper lantern glow
    var lg = ctx.createRadialGradient(W * 0.5, y - 20 * DPR, 0, W * 0.5, y - 20 * DPR, R * 0.9);
    lg.addColorStop(0, 'rgba(255,203,87,.18)'); lg.addColorStop(1, 'rgba(255,203,87,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, CY);
  }
  function drawTokyo(A) {
    ctx.fillStyle = A.wall; ctx.fillRect(0, 0, W, CY - R * 0.5);
    // blinking neon signs
    var signs = 7;
    for (var i = 0; i < signs; i++) {
      var sx = (i + 0.5) / signs * W, sy = (i % 3) * 34 * DPR + 30 * DPR;
      var on = (Math.floor(S.t * (1.3 + i * 0.4) + i) % 4) !== 0;
      var hue = (i * 57) % 360, col = 'hsl(' + hue + ',90%,' + (on ? 62 : 32) + '%)';
      ctx.globalAlpha = on ? 1 : 0.5; ctx.fillStyle = col;
      ctx.fillRect(sx - 24 * DPR, sy, 48 * DPR, 16 * DPR);
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = 18 * DPR; ctx.fillRect(sx - 24 * DPR, sy, 48 * DPR, 16 * DPR); ctx.shadowBlur = 0; }
    }
    ctx.globalAlpha = 1;
  }

  function dirAngleScreen(dir) { var v = DIR[dir]; return Math.atan2(v[1] * DEPTH, v[0]); }

  function drawPlayer(A) {
    var hb = player.hurt > 0 && Math.floor(S.t * 20) % 2 === 0;
    ctx.save(); ctx.translate(CX, CY);
    var fa = dirAngleScreen(player.face);
    // strike slash arc, pointing exactly where you struck
    if (player.slash > 0) {
      ctx.save(); ctx.rotate(fa);
      ctx.globalAlpha = clamp(player.slash, 0, 1);
      var rr = player.reach * R;
      ctx.strokeStyle = A.glow; ctx.lineWidth = 12 * DPR; ctx.lineCap = 'round'; ctx.globalAlpha = 0.35 * player.slash;
      ctx.beginPath(); ctx.arc(0, 0, rr, -0.7, 0.7); ctx.stroke();
      ctx.globalAlpha = clamp(player.slash, 0, 1); ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 5 * DPR;
      ctx.beginPath(); ctx.arc(0, 0, rr, -0.55, 0.55); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // ninja figure — darker body, red sash and a soft rim so "you" reads clearly
    var bw = R * 0.058, bh = R * 0.14;
    ctx.save(); ctx.shadowColor = A.glow; ctx.shadowBlur = 10 * DPR;
    ctx.fillStyle = hb ? '#ff6a6a' : '#211a16';
    ctx.beginPath(); ctx.ellipse(0, -bh, bw, bh, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -bh * 2.1, bw * 0.95, 0, 6.283); ctx.fill();
    ctx.restore();
    // red sash across the body
    ctx.fillStyle = '#d7261e'; ctx.fillRect(-bw, -bh * 1.35, bw * 2, bw * 0.55);
    // head wrap + a bright tick pointing the way you face
    ctx.fillStyle = '#17120f'; ctx.beginPath(); ctx.arc(0, -bh * 2.1, bw * 0.98, Math.PI, 0); ctx.fill();
    ctx.save(); ctx.rotate(fa + Math.PI / 2);
    ctx.fillStyle = A.glow; ctx.fillRect(-bw * 0.65, -bh * 2.1 - bw * 2.4, bw * 1.3, bw * 0.55);
    ctx.fillStyle = '#eaffff'; ctx.fillRect(-bw * 0.2, -bh * 2.1 - bw * 3.1, bw * 0.4, bw * 1.0);
    ctx.restore();
    ctx.restore();
  }

  function drawEnemy(e, A) {
    var p = enemyPos(e); var sc = p.s;
    ctx.save(); ctx.translate(p.x, p.y);
    if (e.state === 'dead') { ctx.globalAlpha = clamp(e.dead / 0.35, 0, 1); ctx.scale(1 + (1 - e.dead / 0.35) * 0.3, 1); }
    var flash = e.hitFlash > 0, windup = e.state === 'windup' && Math.floor(S.t * 12) % 2 === 0;
    var body = e.boss ? (windup ? '#ff4d4d' : '#6b2b2b') : e.type === 'guard' ? '#2d5d7a' : e.type === 'dasher' ? '#6a4b86' : '#3a2f28';
    if (flash) body = '#fff';
    var size = e.boss ? 0.18 : 0.085;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, -size * R * sc, size * R * sc * 0.9, size * R * sc * 1.25, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -size * R * sc * 2.1, size * R * sc * 0.72, 0, 6.283); ctx.fill();
    if (e.type === 'guard') { ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2.4 * DPR; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(0, -size * R * sc, size * R * sc * 1.5, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1; }
    if (e.boss) { // hp pips
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-size * R * sc, -size * R * sc * 3.4, size * R * sc * 2, 5 * DPR);
      ctx.fillStyle = windup ? '#ffd36b' : '#ff6a6a'; ctx.fillRect(-size * R * sc, -size * R * sc * 3.4, size * R * sc * 2 * (e.hp / e.maxhp), 5 * DPR); }
    ctx.restore();
  }

  function drawHUD(A) {
    ctx.textAlign = 'left';
    // hearts
    for (var i = 0; i < S.maxLives; i++) { ctx.globalAlpha = i < S.lives ? 1 : 0.22; ctx.fillStyle = '#ff4d5e';
      heart(18 * DPR + i * 26 * DPR, 26 * DPR, 9 * DPR); }
    ctx.globalAlpha = 1;
    // score + wave + combo
    ctx.fillStyle = '#fff'; ctx.font = '800 ' + (24 * DPR) + 'px "Shippori Mincho B1",serif'; ctx.textAlign = 'right';
    ctx.fillText(S.score.toLocaleString(), W - 16 * DPR, 30 * DPR);
    ctx.font = '700 ' + (12 * DPR) + 'px "Zen Kaku Gothic New",sans-serif'; ctx.fillStyle = '#b6a98f';
    ctx.fillText('WAVE ' + S.wave + '  ·  BEST ' + S.best.toLocaleString(), W - 16 * DPR, 48 * DPR);
    if (S.combo > 1) { ctx.textAlign = 'center'; ctx.fillStyle = A.glow; ctx.font = '900 ' + (22 * DPR) + 'px "Zen Kaku Gothic New",sans-serif';
      ctx.fillText('x' + S.combo, CX, 34 * DPR); }
    // whirlwind meter
    if (player.powers.whirlwind) { var mw = 120 * DPR, mx = CX - mw / 2, my = H - 22 * DPR;
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(mx, my, mw, 7 * DPR);
      ctx.fillStyle = '#bfe9ff'; ctx.fillRect(mx, my, mw * (player.meter / player.meterMax), 7 * DPR); }
  }
  function heart(x, y, r) { ctx.beginPath(); ctx.moveTo(x, y + r * 0.4); ctx.bezierCurveTo(x - r, y - r * 0.6, x - r * 0.1, y - r, x, y - r * 0.3);
    ctx.bezierCurveTo(x + r * 0.1, y - r, x + r, y - r * 0.6, x, y + r * 0.4); ctx.fill(); }

  /* ---------- loop ---------- */
  var last = 0, raf = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
    update(dt); draw();
  }

  /* ---------- scenes / overlays ---------- */
  var OVS = ['ovTitle', 'ovHow', 'ovLevel', 'ovPause', 'ovOver'];
  function setOverlay(id) {
    OVS.forEach(function (o) { $(o).hidden = o !== id; });
    var playing = id === null;
    $('pauseBtn').hidden = !playing;
  }
  function startGame() {
    var best = S.best, muted = S.muted;
    reset(); S.best = best; S.muted = muted;
    startWave(1);
  }
  function gameOver() {
    S.scene = 'over';
    var isBest = S.score > S.best; if (isBest) { S.best = S.score; saveBest(S.best); }
    $('sScore').textContent = S.score.toLocaleString();
    $('sWave').textContent = S.wave; $('sKills').textContent = S.kills;
    $('newBest').hidden = !isBest;
    $('submitNote').textContent = ''; $('submitWrap').style.display = '';
    try { var nm = localStorage.getItem('ninjaDojo.name'); if (nm) $('nameInput').value = nm; } catch (e) {}
    setOverlay('ovOver'); loadLeaderboard();
    sfx('over');
  }

  /* ---------- leaderboard client ---------- */
  var API = '/api/scores';
  function loadLeaderboard(mine) {
    var ol = $('lbList');
    fetch(API + '?top=10').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (d) {
      var rows = (d && d.scores) || [];
      if (!rows.length) { ol.innerHTML = '<li class="muted">No scores yet — be the first.</li>'; return; }
      ol.innerHTML = rows.map(function (s) {
        return '<li' + (mine && s.name === mine ? ' class="me"' : '') + '><span>' + esc(s.name) + '</span><b>' + Number(s.score).toLocaleString() + '</b></li>';
      }).join('');
    }).catch(function () { ol.innerHTML = '<li class="muted">Leaderboard offline — scores save once it is live.</li>'; });
  }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  function submitScore() {
    var name = ($('nameInput').value || '').trim();
    if (name.length < 2) { $('submitNote').textContent = 'Enter a name (2–16 characters).'; return; }
    try { localStorage.setItem('ninjaDojo.name', name); } catch (e) {}
    $('submitNote').textContent = 'Submitting…';
    fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, score: S.score, wave: S.wave, kills: S.kills }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (res) {
        if (!res.ok) { $('submitNote').textContent = res.b && res.b.message || 'Could not submit.'; return; }
        $('submitNote').textContent = 'Submitted — nice work.'; $('submitWrap').style.display = 'none'; loadLeaderboard(name);
      }).catch(function () { $('submitNote').textContent = 'Leaderboard offline just now. Try again later.'; });
  }

  /* ---------- tiny sound (synth, muted by default toggle) ---------- */
  var AC = window.AudioContext || window.webkitAudioContext, actx = null, mg = null;
  function audio() { if (!AC) return null; if (!actx) { actx = new AC(); mg = actx.createGain(); mg.gain.value = 0.5; mg.connect(actx.destination); } return actx; }
  function sfx(kind) {
    if (S.muted) return; var c = audio(); if (!c) return; if (c.state === 'suspended') c.resume();
    var t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    var map = { slash: ['square', 500, 900, 0.07], hit: ['triangle', 300, 120, 0.12], boss: ['sawtooth', 160, 60, 0.4],
      ouch: ['sawtooth', 220, 90, 0.25], power: ['triangle', 520, 880, 0.18], whirl: ['sawtooth', 700, 200, 0.3],
      star: ['square', 1200, 1600, 0.05], over: ['triangle', 300, 120, 0.5] }[kind] || ['square', 440, 440, 0.1];
    o.type = map[0]; o.frequency.setValueAtTime(map[1], t); o.frequency.exponentialRampToValueAtTime(Math.max(1, map[2]), t + map[3]);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + map[3]);
    o.connect(g).connect(mg); o.start(t); o.stop(t + map[3] + 0.02);
  }
  function setMuted(m) { S.muted = m; try { localStorage.setItem('ninjaDojo.sound', m ? 'off' : 'on'); } catch (e) {}
    $('soundBtn').innerHTML = m ? '&#128263;' : '&#128266;'; }

  /* ---------- input ---------- */
  function onKey(e) {
    var k = e.key.toLowerCase();
    if (k === 'escape') { if (S.scene === 'play') pause(); else if (S.scene === 'paused') resume(); return; }
    if (k === 'm') { setMuted(!S.muted); return; }
    if (S.scene !== 'play') return;
    if (k in KEYDIR) { e.preventDefault(); strike(KEYDIR[k]); }
  }
  function octant(cx, cy) {
    var a = Math.atan2((cy - CY) / DEPTH, cx - CX); // undo depth squash
    var idx = Math.round(a / (Math.PI / 4)); // 0=E
    // map screen angle to our DIR index (0 N,2 E,4 S,6 W)
    var m = [2, 3, 4, 5, 6, 7, 0, 1]; // idx where 0=E(0rad)
    return m[((idx % 8) + 8) % 8];
  }
  var touchStart = null;
  function pointerDown(x, y) { if (S.scene !== 'play') return; touchStart = { x: x, y: y, t: S.t, moved: false }; }
  function pointerMove(x, y) { if (!touchStart || touchStart.moved || S.scene !== 'play') return;
    var dx = x - touchStart.x, dy = y - touchStart.y; if (Math.hypot(dx, dy) > 26 * DPR) { touchStart.moved = true;
      var a = Math.atan2(dy / DEPTH, dx), idx = Math.round(a / (Math.PI / 4)), m = [2, 3, 4, 5, 6, 7, 0, 1]; strike(m[((idx % 8) + 8) % 8]); } }
  function pointerUp(x, y) { if (!touchStart || S.scene !== 'play') { touchStart = null; return; }
    if (!touchStart.moved) strike(octant(x, y)); touchStart = null; }

  function pause() { if (S.scene !== 'play') return; S.scene = 'paused'; setOverlay('ovPause'); }
  function resume() { if (S.scene !== 'paused') return; S.scene = 'play'; setOverlay(null); last = 0; }

  /* ---------- arena preview thumbnails ---------- */
  function buildPicker() {
    var wrap = $('arenaPicker'); wrap.innerHTML = '';
    Object.keys(ARENAS).forEach(function (key) {
      var A = ARENAS[key];
      var el = document.createElement('button'); el.className = 'arena'; el.type = 'button';
      el.setAttribute('aria-pressed', key === ARENA ? 'true' : 'false');
      var c = document.createElement('canvas'); c.width = 320; c.height = 180;
      var x = c.getContext('2d'); var g = x.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, A.sky); g.addColorStop(1, '#070504');
      x.fillStyle = g; x.fillRect(0, 0, 320, 180); x.fillStyle = A.wall; x.fillRect(0, 0, 320, 70);
      x.save(); x.translate(160, 120); x.scale(1, 0.6); x.fillStyle = A.floor; x.beginPath(); x.arc(0, 0, 90, 0, 6.283); x.fill(); x.restore();
      if (key === 'tokyo') { for (var i = 0; i < 6; i++) { x.fillStyle = 'hsl(' + (i * 60) + ',90%,60%)'; x.fillRect(20 + i * 48, 14 + (i % 2) * 24, 34, 12); } }
      else { x.strokeStyle = 'rgba(255,203,87,.4)'; for (var j = 0; j < 6; j++) x.strokeRect(10 + j * 50, 10, 44, 54); }
      el.appendChild(c);
      var b = document.createElement('b'); b.innerHTML = A.name + '<small>' + (key === 'tokyo' ? 'Neon, blinking signs' : 'Lanterns and shoji') + '</small>';
      el.appendChild(b);
      el.addEventListener('click', function () { ARENA = key; [].forEach.call(wrap.children, function (ch) { ch.setAttribute('aria-pressed', 'false'); }); el.setAttribute('aria-pressed', 'true'); });
      wrap.appendChild(el);
    });
  }

  /* ---------- wire up ---------- */
  function wire() {
    $('playBtn').addEventListener('click', function () { audio() && actx.resume(); startGame(); });
    $('howBtn').addEventListener('click', function () { setOverlay('ovHow'); });
    $('howBack').addEventListener('click', function () { setOverlay('ovTitle'); });
    $('resumeBtn').addEventListener('click', resume);
    $('quitBtn').addEventListener('click', function () { S.scene = 'menu'; setOverlay('ovTitle'); $('titleBest').textContent = S.best.toLocaleString(); });
    $('againBtn').addEventListener('click', startGame);
    $('menuBtn').addEventListener('click', function () { S.scene = 'menu'; setOverlay('ovTitle'); $('titleBest').textContent = S.best.toLocaleString(); });
    $('submitBtn').addEventListener('click', submitScore);
    $('soundBtn').addEventListener('click', function () { setMuted(!S.muted); });
    $('pauseBtn').addEventListener('click', pause);
    addEventListener('keydown', onKey);
    cv.addEventListener('pointerdown', function (e) { pointerDown(e.clientX * DPR, e.clientY * DPR); });
    cv.addEventListener('pointermove', function (e) { pointerMove(e.clientX * DPR, e.clientY * DPR); });
    cv.addEventListener('pointerup', function (e) { pointerUp(e.clientX * DPR, e.clientY * DPR); });
    addEventListener('resize', resize);
  }

  /* ---------- boot ---------- */
  reset(); resize(); wire(); buildPicker();
  $('titleBest').textContent = S.best.toLocaleString();
  setMuted(S.muted); setOverlay('ovTitle');
  // dismiss the native splash from the old build if present
  var sp = document.getElementById('nd-splash'); if (sp) sp.remove();
  raf = requestAnimationFrame(loop);
})();
