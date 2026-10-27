/* Ninja Dojo leaderboard — a companion layer for the compiled game.
   The game saves the best score to localStorage['ninjaDojo.best']; this reads
   that, lets the player put a name to it, submits to /api/scores and shows the
   global top ten. Entirely additive: it touches nothing the game owns. */
(function () {
  'use strict';
  var API = '/api/scores', KEY = 'ninjaDojo.best', NAMEK = 'ninjaDojo.name', SENTK = 'ninjaDojo.lb.sent';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function best() { return Math.max(0, parseInt(ls(KEY) || '0', 10) || 0); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  // match the server's whitespace handling so the "me" row highlight lines up
  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }

  var css = '' +
    '#ndlb-btn{position:fixed;left:14px;bottom:14px;z-index:9998;width:46px;height:46px;border-radius:12px;border:1px solid rgba(255,203,87,.4);' +
    'background:rgba(14,10,8,.72);color:#ffcb57;font-size:22px;cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(4px);' +
    'transition:transform .15s,box-shadow .2s;font-family:system-ui,sans-serif}' +
    '#ndlb-btn:hover{transform:translateY(-2px)}#ndlb-btn.pulse{animation:ndlbpulse 1s ease-in-out infinite;box-shadow:0 0 0 2px rgba(255,203,87,.5)}' +
    '@keyframes ndlbpulse{50%{box-shadow:0 0 18px 2px rgba(255,203,87,.6)}}' +
    '#ndlb-ov{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;' +
    'background:radial-gradient(120% 90% at 50% 30%,rgba(30,18,14,.75),rgba(8,6,5,.92));font-family:"Zen Kaku Gothic New",system-ui,sans-serif}' +
    '#ndlb-ov.on{display:flex}' +
    '#ndlb-panel{width:min(420px,94vw);background:linear-gradient(180deg,#201711,#140e0a);border:1px solid rgba(255,203,87,.25);border-radius:16px;' +
    'padding:20px;color:#f1e8d8;box-shadow:0 24px 60px rgba(0,0,0,.5)}' +
    '#ndlb-panel h2{margin:0 0 4px;font-family:"Shippori Mincho B1",serif;font-size:24px}#ndlb-panel h2 span{color:#d7261e}' +
    '#ndlb-panel .sub{margin:0 0 14px;color:#b6a98f;font-size:13px}' +
    '#ndlb-list{list-style:none;margin:0 0 14px;padding:0;max-height:46vh;overflow:auto;counter-reset:r}' +
    '#ndlb-list li{counter-increment:r;display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:baseline;padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.07);font-size:15px}' +
    '#ndlb-list li::before{content:counter(r);color:#ffcb57;font-weight:700;font-family:"Shippori Mincho B1",serif}' +
    '#ndlb-list li.me{background:rgba(255,203,87,.1);border-radius:8px}#ndlb-list b{font-variant-numeric:tabular-nums}' +
    '#ndlb-list .muted{display:block;text-align:center;color:#998c74;padding:14px;grid-column:1/-1}#ndlb-list .muted::before{content:none}' +
    '#ndlb-sub{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}' +
    '#ndlb-sub input{flex:1;min-width:140px;font:inherit;font-weight:700;padding:11px 13px;border-radius:9px;background:#0e0a07;border:1px solid rgba(255,255,255,.2);color:#f1e8d8}' +
    '.ndlb-bt{appearance:none;border:0;border-radius:9px;padding:11px 18px;font:inherit;font-weight:800;color:#fff;background:linear-gradient(180deg,#e5362b,#b11c15);cursor:pointer}' +
    '.ndlb-bt.ghost{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);color:#f1e8d8;font-weight:700}' +
    '#ndlb-note{font-size:12px;color:#998c74;min-height:1.2em;margin:4px 0 10px}#ndlb-yourbest{color:#ffcb57;font-weight:700}' +
    '#ndlb-foot{display:flex;justify-content:space-between;gap:10px;align-items:center}';

  var btn, ov, listEl, subEl, nameInput, noteEl, bestEl;
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    btn = document.createElement('button'); btn.id = 'ndlb-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Leaderboard'); btn.textContent = '🏆';
    document.body.appendChild(btn);
    ov = document.createElement('div'); ov.id = 'ndlb-ov';
    ov.innerHTML =
      '<div id="ndlb-panel" role="dialog" aria-label="Leaderboard">' +
      '<h2 class="serif">Dojo <span>Ranks</span></h2>' +
      '<p class="sub">The best scores from every challenger. Your best: <span id="ndlb-yourbest">0</span></p>' +
      '<div id="ndlb-sub"><input id="ndlb-name" type="text" maxlength="16" placeholder="Your name" autocomplete="off" aria-label="Your name"><button class="ndlb-bt" id="ndlb-submit" type="button">Submit best</button></div>' +
      '<p id="ndlb-note" aria-live="polite"></p>' +
      '<ol id="ndlb-list"><li class="muted">Loading…</li></ol>' +
      '<div id="ndlb-foot"><button class="ndlb-bt ghost" id="ndlb-refresh" type="button">Refresh</button><button class="ndlb-bt ghost" id="ndlb-close" type="button">Close</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    listEl = ov.querySelector('#ndlb-list'); subEl = ov.querySelector('#ndlb-sub'); nameInput = ov.querySelector('#ndlb-name');
    noteEl = ov.querySelector('#ndlb-note'); bestEl = ov.querySelector('#ndlb-yourbest');
    var saved = ls(NAMEK); if (saved) nameInput.value = saved;

    btn.addEventListener('click', open);
    ov.querySelector('#ndlb-close').addEventListener('click', close);
    ov.querySelector('#ndlb-refresh').addEventListener('click', load);
    ov.querySelector('#ndlb-submit').addEventListener('click', submit);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
  }

  function open() { btn.classList.remove('pulse'); ov.classList.add('on'); refreshSubState(); load(); }
  function close() { ov.classList.remove('on'); }

  function refreshSubState() {
    var b = best(); bestEl.textContent = b.toLocaleString();
    var sent = parseInt(ls(SENTK) || '0', 10) || 0;
    // only offer submit if there is a best worth posting and it beats what we last sent
    subEl.style.display = (b > 0 && b > sent) ? 'flex' : 'none';
    if (b <= 0) noteEl.textContent = 'Play a round first to set a score.';
    else if (b <= sent) noteEl.textContent = 'Your best is on the board. Beat it to post again.';
    else noteEl.textContent = '';
  }

  function load() {
    var mine = ls(NAMEK);
    fetch(API + '?top=10').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (d) {
      var rows = (d && d.scores) || [];
      if (!rows.length) { listEl.innerHTML = '<li class="muted">No scores yet — be the first.</li>'; return; }
      var mineLc = mine ? norm(mine).toLowerCase() : '';
      listEl.innerHTML = rows.map(function (s) {
        var me = mineLc && norm(s.name).toLowerCase() === mineLc;
        return '<li' + (me ? ' class="me"' : '') + '><span>' + esc(s.name) + '</span><b>' + Number(s.score).toLocaleString() + '</b></li>';
      }).join('');
    }).catch(function () { listEl.innerHTML = '<li class="muted">Leaderboard offline — try again shortly.</li>'; });
  }

  function submit() {
    var name = norm(nameInput.value), b = best();
    if (name.length < 2) { noteEl.textContent = 'Enter a name (2–16 characters).'; return; }
    if (b <= 0) { noteEl.textContent = 'No score to submit yet.'; return; }
    ls(NAMEK, name); noteEl.textContent = 'Submitting…';
    fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, score: b }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { noteEl.textContent = (res.j && res.j.message) || 'Could not submit.'; return; }
        // refresh state/list first, then show the confirmation so it isn't overwritten
        ls(SENTK, String(b)); refreshSubState(); load(); noteEl.textContent = 'Posted — nice work.';
      }).catch(function () { noteEl.textContent = 'Leaderboard offline just now. Try again later.'; });
  }

  // watch for a new best while playing, and nudge the button — but only while the
  // tab is visible, so a backgrounded PWA isn't polling localStorage forever
  var lastBest = best();
  setInterval(function () {
    if (document.hidden) return;
    var b = best();
    if (b > lastBest) { lastBest = b; var sent = parseInt(ls(SENTK) || '0', 10) || 0;
      if (b > sent && !ov.classList.contains('on')) btn.classList.add('pulse'); }
  }, 2000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
