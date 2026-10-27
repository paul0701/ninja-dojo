// Ninja Dojo leaderboard backend — a single Netlify Function backed by Netlify Blobs.
// GET  /api/scores?top=N        -> { scores: [{ name, score, at }] }
// POST /api/scores { name, score } -> stores the score, returns the top list.
//
// The game is a compiled build we can't change, so the client submits the best
// score the game saved locally. This is therefore a trust-based board: it
// validates the name, caps implausible scores, keeps a player's best, rate-limits
// per name and keeps the top 200 in one blob.
import { getStore } from '@netlify/blobs';

const NAME_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;
const MAX_KEEP = 200;
const MAX_SCORE = 50_000_000;   // generous ceiling; the game tops out far below this
const MIN_GAP_MS = 3000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return NAME_RE.test(n) ? n : null;
};

export default async (req) => {
  const store = getStore('ninja-dojo-scores');

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

  const board = (await store.get('board', { type: 'json' })) || [];
  const now = Date.now();
  const existing = board.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (existing && now - (existing.at || 0) < MIN_GAP_MS) return json({ message: 'Slow down a moment and try again.' }, 429);

  const others = board.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
  const best = Math.max(score, existing ? existing.score : 0);
  const next = others.concat([{ name, score: best, at: now }]).sort((a, b) => b.score - a.score).slice(0, MAX_KEEP);
  await store.setJSON('board', next);
  return json({ ok: true, scores: next.slice(0, 10).map(({ name, score, at }) => ({ name, score, at })) });
};

export const config = { path: '/api/scores' };
