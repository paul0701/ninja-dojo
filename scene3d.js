/* Ninja Dojo — 3D renderer (Three.js). The game logic in game.js stays 2D-agnostic:
   it tracks enemies as (direction, distance) on a ring and the player at the centre.
   This module mirrors that state into a real 3D scene with lighting and shadows.
   window.Scene3D is the whole interface game.js talks to. */
(function () {
  'use strict';
  var T = window.THREE;
  var ARENA_R = 4.2;
  var DIR = [[0, -1], [0.7071, -0.7071], [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071]];
  function worldOf(dir, d) { return [DIR[dir][0] * d * ARENA_R, DIR[dir][1] * d * ARENA_R]; }

  var renderer, scene, camera, keyLight, arenaGroup, playerG, slashes = [], anim = [], meshes = new Map();
  var curArena = 'dojo', A = null, W = 1, H = 1, DPRv = 1, ok = false;
  var tmp = new T.Vector3();

  function mat(color, opts) {
    opts = opts || {};
    return new T.MeshStandardMaterial({ color: new T.Color(color), roughness: opts.rough == null ? 0.78 : opts.rough,
      metalness: opts.metal || 0.05, emissive: new T.Color(opts.emissive || 0x000000), emissiveIntensity: opts.ei || 1 });
  }
  function cyl(rt, rb, h, m) { var g = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 14), m); g.castShadow = true; return g; }
  function sph(r, m) { var g = new T.Mesh(new T.SphereGeometry(r, 16, 12), m); g.castShadow = true; return g; }
  function box(w, h, d, m) { var g = new T.Mesh(new T.BoxGeometry(w, h, d), m); g.castShadow = true; return g; }

  /* ---- a low-poly fighter built from primitives ---- */
  function makeFighter(c) {
    var g = new T.Group(), H0 = c.height, bulk = c.bulk || 1;
    var bodyMat = mat(c.body), dark = mat(shadeHex(c.body, -0.35));
    var mats = [bodyMat, dark];
    // legs (pivoted at hip so they can swing)
    function limb(x, y, len, r, m) { var pivot = new T.Group(); pivot.position.set(x, y, 0);
      var s = cyl(r, r * 0.85, len, m); s.position.y = -len / 2; pivot.add(s); g.add(pivot); return pivot; }
    var legLen = 0.34 * H0, legR = 0.09 * H0 * bulk;
    var legL = limb(-0.12 * H0 * bulk, legLen, legLen, legR, dark);
    var legR_ = limb(0.12 * H0 * bulk, legLen, legLen, legR, dark);
    // torso
    var torso = cyl(0.17 * H0 * bulk, 0.21 * H0 * bulk, 0.42 * H0, bodyMat);
    torso.position.y = 0.34 * H0 + 0.21 * H0; g.add(torso);
    // belt
    if (c.belt) { var beltMat = mat(c.belt); mats.push(beltMat); var belt = new T.Mesh(new T.TorusGeometry(0.2 * H0 * bulk, 0.05 * H0, 8, 20), beltMat);
      belt.rotation.x = Math.PI / 2; belt.position.y = 0.46 * H0; g.add(belt); }
    // sash (ninja)
    if (c.sash) { var sashMat = mat(c.sash); mats.push(sashMat); var sash = box(0.44 * H0 * bulk, 0.08 * H0, 0.34 * H0, sashMat);
      sash.position.y = 0.58 * H0; sash.rotation.z = 0.5; g.add(sash); }
    // arms
    var armLen = 0.3 * H0, armR = 0.07 * H0 * bulk, sy = 0.72 * H0, sx = 0.2 * H0 * bulk + armR;
    var armL = limb(-sx, sy, armLen, armR, bodyMat);
    var armR_ = limb(sx, sy, armLen, armR, bodyMat);
    // head
    var headMat = mat(c.body); mats.push(headMat);
    var head = sph(0.15 * H0 * (c.bigHead ? 1.15 : 1), headMat); head.position.y = 0.92 * H0; g.add(head);
    // eyes (emissive, facing +Z)
    var eyeMat = new T.MeshStandardMaterial({ color: new T.Color(c.eyes || 0xeaffff), emissive: new T.Color(c.eyes || 0xeaffff), emissiveIntensity: c.eyeGlow ? 1.4 : 0.6 });
    var ey = 0.94 * H0, ez = 0.12 * H0, er = 0.028 * H0;
    [[-0.05 * H0, 1], [0.05 * H0, 1]].forEach(function (e) { var m = new T.Mesh(new T.BoxGeometry(er * 1.6, er * 1.1, er), eyeMat); m.position.set(e[0], ey, ez); g.add(m); });
    // headband (ninja)
    if (c.band) { var bandMat = mat(c.band, { emissive: c.band, ei: 0.25 }); mats.push(bandMat);
      var band = new T.Mesh(new T.TorusGeometry(0.15 * H0, 0.03 * H0, 8, 18), bandMat); band.position.y = 0.97 * H0; band.rotation.x = Math.PI / 2; g.add(band);
      var tail = box(0.05 * H0, 0.18 * H0, 0.03 * H0, bandMat); tail.position.set(0.12 * H0, 0.9 * H0, -0.1 * H0); tail.rotation.z = 0.6; g.add(tail); c._tail = tail; }
    // topknot (sumo)
    if (c.topknot) { var tk = sph(0.07 * H0, dark); tk.position.y = 1.07 * H0; g.add(tk); }
    // shield (guard)
    if (c.shield) { var shMat = new T.MeshStandardMaterial({ color: 0x243f54, emissive: new T.Color(c.shieldGlow || 0x8fd3ff), emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.5 });
      var shield = new T.Mesh(new T.CylinderGeometry(0.26 * H0 * bulk, 0.26 * H0 * bulk, 0.04 * H0, 20), shMat);
      shield.rotation.x = Math.PI / 2; shield.position.set(0, 0.6 * H0, 0.26 * H0); shield.castShadow = true; g.add(shield); g._shieldMat = shMat; }
    // scarf (ninja) — a trailing ribbon we wave in frame()
    if (c.scarf) { var scMat = mat(c.scarf); mats.push(scMat); var scarf = box(0.08 * H0, 0.05 * H0, 0.3 * H0, scMat);
      scarf.position.set(0.05 * H0, 0.74 * H0, -0.18 * H0); g.add(scarf); g._scarf = scarf; }

    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    g.userData = { legL: legL, legR: legR_, armL: armL, armR: armR_, head: head, torso: torso,
      mats: mats, bodyMats: [bodyMat, dark, headMat], eyeMat: eyeMat, base: c.body };
    return g;
  }

  function makeEnemy(e) {
    // bold, distinct colours and silhouettes per type
    if (e.boss) return makeFighter({ height: 2.0, body: 0xf0c49a, bulk: 2.05, bigHead: 1, belt: 0xe11d48, topknot: 1, eyes: 0x1a1010 });      // huge pale sumo, crimson mawashi
    if (e.type === 'guard') return makeFighter({ height: 1.22, body: 0x2f6bd6, bulk: 1.35, shield: 1, shieldGlow: 0x8fd3ff, eyes: 0xdff1ff }); // broad royal-blue guard
    if (e.type === 'dasher') return makeFighter({ height: 1.22, body: 0x16d6c6, bulk: 0.72, eyes: 0xffffff, eyeGlow: 1, band: 0x0bb3a6 });      // tall, lean, electric-cyan
    return makeFighter({ height: 1.04, body: 0xe85526, bulk: 1.3, eyes: 0xffe14d, eyeGlow: 1 });                                               // squat orange brawler, yellow eyes
  }

  /* ---- arenas ---- */
  function clearGroup(g) { if (!g) return; g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); }); } }); scene.remove(g); }

  function buildArena() {
    clearGroup(arenaGroup); arenaGroup = new T.Group(); scene.add(arenaGroup);
    anim = [];
    scene.background = new T.Color(A.sky); scene.fog = new T.Fog(new T.Color(A.sky).getHex(), 14, 30);
    // arena floor
    var floorMat = mat(A.floor, { rough: curArena === 'tokyo' ? 0.35 : 0.9, metal: curArena === 'tokyo' ? 0.5 : 0.05 });
    var floor = new T.Mesh(new T.CircleGeometry(ARENA_R, 48), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; arenaGroup.add(floor);
    // concentric rings
    for (var i = 1; i <= 3; i++) { var ring = new T.Mesh(new T.RingGeometry(ARENA_R * i / 3.2 - 0.03, ARENA_R * i / 3.2, 48), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; arenaGroup.add(ring); }
    // centre glow ring
    var cg = new T.Mesh(new T.RingGeometry(ARENA_R * 0.14, ARENA_R * 0.17, 40), new T.MeshBasicMaterial({ color: new T.Color(A.glow), transparent: true, opacity: 0.8, side: T.DoubleSide }));
    cg.rotation.x = -Math.PI / 2; cg.position.y = 0.02; arenaGroup.add(cg); anim.push({ glow: cg });
    // surrounding dark ground
    var gnd = new T.Mesh(new T.CircleGeometry(40, 32), mat(0x070606)); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.05; arenaGroup.add(gnd);

    if (curArena === 'tokyo') buildTokyo(); else buildDojo();
  }

  function buildDojo() {
    // back wall + shoji glow
    var wall = box(ARENA_R * 2.6, 5, 0.4, mat(0x2a1d13)); wall.position.set(0, 2.2, -ARENA_R * 1.25); arenaGroup.add(wall);
    var shoji = new T.Mesh(new T.PlaneGeometry(ARENA_R * 2.4, 2.2), new T.MeshStandardMaterial({ color: 0xffcb57, emissive: 0xffb24a, emissiveIntensity: 0.5 }));
    shoji.position.set(0, 1.6, -ARENA_R * 1.23); arenaGroup.add(shoji);
    // shoji grid lines
    for (var gx = -5; gx <= 5; gx++) { var v = box(0.03, 2.2, 0.05, mat(0x120c08)); v.position.set(gx * ARENA_R * 0.24, 1.6, -ARENA_R * 1.22); arenaGroup.add(v); }
    for (var gy2 = 0; gy2 <= 3; gy2++) { var hb = box(ARENA_R * 2.4, 0.04, 0.05, mat(0x120c08)); hb.position.set(0, 0.6 + gy2 * 0.66, -ARENA_R * 1.22); arenaGroup.add(hb); }
    // side pillars
    [-1, 1].forEach(function (s) { var p = box(0.5, 6, 0.5, mat(0x17100b)); p.position.set(s * ARENA_R * 1.15, 3, -ARENA_R * 0.4); arenaGroup.add(p); });
    // hanging lanterns with light
    for (var l = 0; l < 3; l++) {
      var lx = (l - 1) * ARENA_R * 0.7, grp = new T.Group();
      var lan = sph(0.32, new T.MeshStandardMaterial({ color: 0xc62f28, emissive: 0xff6a3a, emissiveIntensity: 0.9 })); lan.scale.y = 1.2;
      grp.add(lan); grp.position.set(lx, 3.4, -ARENA_R * 0.9);
      var pl = new T.PointLight(0xffa64a, 0.9, 10); pl.position.set(0, 0, 0); grp.add(pl);
      arenaGroup.add(grp); anim.push({ lantern: grp, base: lx, phase: l });
    }
    keyLight.color.set(0xfff0d8); keyLight.intensity = 1.0;
  }

  function buildTokyo() {
    // skyline of boxes
    for (var i = 0; i < 26; i++) {
      var bx = (Math.random() - 0.5) * 44, bz = -ARENA_R * 1.2 - Math.random() * 16, bh = 3 + Math.random() * 10;
      var b = box(1.4 + Math.random() * 2, bh, 1.4 + Math.random() * 2, mat(0x0e0b1c, { emissive: 0x161030, ei: 0.4 }));
      b.position.set(bx, bh / 2, bz); b.castShadow = false; arenaGroup.add(b);
    }
    // neon signs (emissive planes that blink)
    for (var s = 0; s < 7; s++) {
      var hue = (s * 57) % 360, col = new T.Color('hsl(' + hue + ',95%,60%)');
      var sign = new T.Mesh(new T.PlaneGeometry(1.6, 0.7), new T.MeshBasicMaterial({ color: col }));
      sign.position.set((s - 3) * 3.2, 2.5 + (s % 3) * 1.5, -ARENA_R * 1.15 - (s % 2) * 2);
      arenaGroup.add(sign);
      var nl = new T.PointLight(col.getHex(), 0.5, 9); nl.position.copy(sign.position); arenaGroup.add(nl);
      anim.push({ sign: sign, light: nl, phase: s, speed: 1.1 + s * 0.4 });
    }
    // moon
    var moon = sph(1.6, new T.MeshBasicMaterial({ color: 0xdfe3ff })); moon.position.set(12, 11, -20); arenaGroup.add(moon);
    keyLight.color.set(0xbfc8ff); keyLight.intensity = 0.7;
  }

  /* ---- public API ---- */
  var Scene3D = {
    get ok() { return ok; },
    init: function (canvas) {
      try {
        renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
        if ('outputEncoding' in renderer) renderer.outputEncoding = T.sRGBEncoding;
        scene = new T.Scene();
        camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 7.2, 8.6); camera.lookAt(0, 0.8, 0.4);
        var amb = new T.HemisphereLight(0x9fb0d0, 0x20160f, 0.65); scene.add(amb);
        keyLight = new T.DirectionalLight(0xffffff, 1.0); keyLight.position.set(5, 11, 6); keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024); var sc = keyLight.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30;
        scene.add(keyLight);
        playerG = makeFighter({ height: 1.25, body: 0x242b3d, eyes: 0x8fe9ff, eyeGlow: 1, band: 0xd7261e, scarf: 0xd7261e, sash: 0x3a2f28 });
        scene.add(playerG);
        A = window.NDARENAS ? window.NDARENAS.dojo : { sky: 0x140d09, floor: 0xb07a43, floor2: 0x7c5330, glow: 0xffcb57 };
        buildArena();
        ok = true;
      } catch (e) { ok = false; }
    },
    resize: function (wCss, hCss, dpr) {
      if (!ok) return; W = Math.max(1, wCss); H = Math.max(1, hCss); DPRv = Math.min(dpr || 1, 2);
      renderer.setPixelRatio(DPRv); renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
    },
    setArena: function (key, arena) { if (!ok) return; curArena = key; A = arena; buildArena(); },
    reset: function () { if (!ok) return; meshes.forEach(function (m) { clearGroup(m); }); meshes.clear(); slashes.forEach(function (s) { clearGroup(s.m); }); slashes = []; },
    slash: function (dir, reach, color) {
      if (!ok) return;
      var geo = new T.RingGeometry(0.3, reach * ARENA_R, 24, 1, -0.6, 1.2);
      var m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: new T.Color(color || 0xeaffff), transparent: true, opacity: 0.9, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.12; m.rotation.z = -Math.atan2(DIR[dir][0], -DIR[dir][1]);
      scene.add(m); slashes.push({ m: m, life: 0.22, max: 0.22 });
    },
    worldPx: function (dir, d) {
      if (!ok) return { x: W / 2, y: H / 2 };
      var w = worldOf(dir, d); tmp.set(w[0], 0.9, w[1]); tmp.project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * W * DPRv, y: (-tmp.y * 0.5 + 0.5) * H * DPRv };
    },
    frame: function (S, player) {
      if (!ok) return;
      var t = S.t;
      // camera shake
      camera.position.set((Math.random() - 0.5) * S.shake * 0.6, 7.2 + (Math.random() - 0.5) * S.shake * 0.4, 8.6);
      camera.lookAt(0, 0.8, 0.4);
      // player
      var face = player.face, fv = DIR[face];
      playerG.rotation.y = Math.atan2(fv[0], -fv[1]);
      var lunge = player.strikeT > 0 ? player.strikeT / 0.18 : 0;
      playerG.position.set(0, 0, 0);
      playerG.translateZ(lunge * 0.5);
      var bob = Math.sin(t * 3) * 0.03; playerG.position.y = bob;
      swingWalk(playerG, t * 3, 0.15);
      if (player.strikeT > 0) { playerG.userData.armR.rotation.x = -1.6 * lunge; }
      flashBody(playerG, player.hurt > 0 ? 0.6 : 0, 0xff4444);
      if (playerG._scarf) playerG._scarf.rotation.y = Math.sin(t * 6) * 0.5;
      // enemies: reconcile
      var present = new Set(S.enemies);
      S.enemies.forEach(function (e) {
        var m = meshes.get(e);
        if (!m) { m = makeEnemy(e); scene.add(m); meshes.set(e, m); }
        var w = worldOf(e.dir, e.d); m.position.set(w[0], 0, w[1]);
        m.rotation.y = Math.atan2(-w[0], w[1]);   // face the centre
        var ph = e.t * 7 + e.wob;
        if (e.state === 'dead') { var k = Math.max(0, e.dead / 0.35); m.scale.set(1 + (1 - k) * 0.4, k, 1 + (1 - k) * 0.4); m.rotation.x = (1 - k) * 1.2; }
        else { m.scale.set(1, 1, 1); m.rotation.x = 0; swingWalk(m, ph, e.type === 'dasher' ? 0.5 : 0.3);
          m.position.y = Math.abs(Math.sin(ph)) * 0.04; }
        var windup = e.state === 'windup';
        if (windup && m.userData.torso) m.userData.torso.rotation.x = -0.25;
        else if (m.userData.torso) m.userData.torso.rotation.x = 0;
        flashBody(m, e.hitFlash > 0 ? Math.min(1, e.hitFlash * 5) : (windup ? 0.5 : 0), windup ? 0xff2a2a : 0xffffff);
        if (m._shieldMat) m._shieldMat.emissive.set(e.hp < e.maxhp ? 0xffd36b : 0x8fd3ff);
      });
      meshes.forEach(function (m, e) { if (!present.has(e)) { scene.remove(m); clearGroup(m); meshes.delete(e); } });
      // slash effects
      for (var i = slashes.length - 1; i >= 0; i--) { var s = slashes[i]; s.life -= 0.016;
        var a = Math.max(0, s.life / s.max); s.m.material.opacity = a * 0.9; s.m.scale.setScalar(1 + (1 - a) * 0.4);
        if (s.life <= 0) { scene.remove(s.m); clearGroup(s.m); slashes.splice(i, 1); } }
      // arena animation
      anim.forEach(function (o) {
        if (o.lantern) o.lantern.position.x = o.base + Math.sin(t * 1.1 + o.phase) * 0.25;
        if (o.glow) o.glow.material.opacity = 0.5 + 0.3 * Math.sin(t * 2);
        if (o.sign) { var on = (Math.floor(t * o.speed + o.phase) % 5) !== 0; o.sign.material.opacity = on ? 1 : 0.25; o.sign.material.transparent = true; if (o.light) o.light.intensity = on ? 0.6 : 0.08; }
      });
      renderer.render(scene, camera);
    }
  };

  function swingWalk(g, phase, amt) { var u = g.userData; if (!u || !u.legL) return;
    var s = Math.sin(phase) * amt; u.legL.rotation.x = s; u.legR.rotation.x = -s;
    if (u.armL) { u.armL.rotation.x = -s * 0.6; u.armR.rotation.x = s * 0.6; } }
  function flashBody(g, amt, color) {
    var u = g.userData; if (!u || !u.mats) return;
    if (amt > 0) { var c = new T.Color(color); u.mats.forEach(function (m) { if (m.emissive) { m.emissive.copy(c); m.emissiveIntensity = amt; } }); }
    else {
      u.mats.forEach(function (m) { if (m.emissive) m.emissiveIntensity = 0; });
      var b = new T.Color(u.base); (u.bodyMats || []).forEach(function (m) { m.emissive.copy(b); m.emissiveIntensity = 0.2; });  // a gentle self-glow keeps body colours vivid in shadow
    }
    if (u.eyeMat) u.eyeMat.emissiveIntensity = 0.7 + Math.max(0, amt);
  }

  function shadeHex(hex, amt) { var c = new T.Color(hex); c.r = clamp01(c.r + amt); c.g = clamp01(c.g + amt); c.b = clamp01(c.b + amt); return c.getHex(); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  window.Scene3D = Scene3D;
})();
