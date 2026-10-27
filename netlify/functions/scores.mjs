// Ninja Dojo leaderboard backend — a single Netlify Function backed by Netlify Blobs.
// GET  /api/scores?top=N        -> { scores: [{ name, score, at }] }
// POST /api/scores { name, score } -> stores the score, returns the top list.
//
// The game is a compiled build we can't change, so the client submits the best
// score the game saved locally. This is therefore a trust-based board: it
// validates the name, caps implausible scores, keeps a player's best, rate-limits
// per name and per IP, and keeps the top 200 in one blob. Writes to that blob use
// optimistic concurrency (compare-and-swap on the etag) so simultaneous
// submissions can't clobber each other.
import { getStore, getDeployStore } from '@netlify/blobs';

// Netlify Blobs site-wide stores (getStore) are shared across ALL deploy
// contexts, so a deploy-preview would read and overwrite the production board.
// Keep production on the persistent site-wide store (scores must survive
// deploys), and route every other context (deploy-preview, branch-deploy, dev)
// to an isolated, auto-cleaned deploy store so previews can't touch real data.
const IS_PROD = (process.env.CONTEXT || 'production') === 'production';
const openStore = (name) => (IS_PROD ? getStore(name) : getDeployStore(name));

const NAME_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;
const MAX_KEEP = 200;
const MAX_SCORE = 50_000_000;   // generous ceiling; the game tops out far below this
const MIN_GAP_MS = 3000;        // per-name: stop one name spamming
const IP_GAP_MS = 2000;         // per-IP: a speed bump against scripted flooding
const CAS_RETRIES = 10;         // retries when a concurrent write beats us

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return NAME_RE.test(n) ? n : null;
};

const top10 = (board) => board.slice(0, 10).map(({ name, score, at }) => ({ name, score, at }));

// Read-modify-write the shared 'board' blob with compare-and-swap: write only if
// the blob hasn't changed since we read it, retrying on conflict. `update` is
// given the current board and returns the next one. Returns the written board,
// or null if it still conflicts after CAS_RETRIES attempts.
const commitBoard = async (store, update) => {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    if (attempt > 0) await sleep(Math.floor(Math.random() * 40) * attempt); // jittered backoff to de-correlate contenders
    const current = await store.getWithMetadata('board', { type: 'json' });
    const board = (current && current.data) || [];
    const next = update(board);
    const opts = current && current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const res = await store.setJSON('board', next, opts);
    if (res && res.modified) return next;
  }
  return null;
};

const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') ||
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  'unknown';

export default async (req) => {
  const store = openStore('ninja-dojo-scores');

  if (req.method === 'GET') {
    const top = Math.min(100, Math.max(1, parseInt(new URL(req.url).searchParams.get('top') || '10', 10) || 10));
    const board = (await store.get('board', { type: 'json' })) || [];
    return json({ scores: board.slice(0, top).map(({ name, score, at }) => ({ name, score, at })) });
  }
  if (req.method !== 'POST') return json({ message: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ message: 'Bad request' }, 400); }
  const name = cleanName(body && body.name);
  const score = Number(body && body.score);
  if (!name) return json({ message: 'Enter a name (2–16 characters).' }, 400);
  if (!Number.isFinite(score) || score < 0 || score !== Math.floor(score) || score > MAX_SCORE) return json({ message: 'Invalid score.' }, 400);

  const now = Date.now();

  // Per-IP speed bump. Best-effort and keyed per IP, so it needs no CAS.
  const ipStore = openStore('ninja-dojo-rl');
  const ip = clientIp(req);
  try {
    const last = Number(await ipStore.get('ip:' + ip)) || 0;
    if (now - last < IP_GAP_MS) return json({ message: 'Slow down a moment and try again.' }, 429);
    await ipStore.set('ip:' + ip, String(now));
  } catch { /* if the rate-limit store is unavailable, don't block submissions */ }

  let rateLimited = false;
  const next = await commitBoard(store, (board) => {
    const existing = board.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (existing && now - (existing.at || 0) < MIN_GAP_MS) { rateLimited = true; return board; }
    rateLimited = false;
    const others = board.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
    const best = Math.max(score, existing ? existing.score : 0);
    return others.concat([{ name, score: best, at: now }]).sort((a, b) => b.score - a.score).slice(0, MAX_KEEP);
  });

  if (rateLimited) return json({ message: 'Slow down a moment and try again.' }, 429);
  if (!next) return json({ message: 'Busy right now — try again in a moment.' }, 503);
  return json({ ok: true, scores: top10(next) });
};

export const config = { path: '/api/scores' };
