// Ninja Dojo leaderboard: a single Netlify Function backed by Netlify Blobs.
// GET  /api/scores?top=N   -> { scores: [{ name, score, wave, at }] }
// POST /api/scores { name, score, wave, kills } -> stores a score, returns the top list.
//
// This is a light, server-side leaderboard: it validates the name and that the
// score is plausible for the wave reached, rate-limits per name, and keeps the
// top 100 in one blob. It is not account-protected, so names are not reserved.
import { getStore } from '@netlify/blobs';

const NAME_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;
const MAX_KEEP = 100;
const MIN_GAP_MS = 3000;          // one submission per name every few seconds
const PER_WAVE_CAP = 60000;       // generous ceiling on points creditable per wave

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return NAME_RE.test(n) ? n : null;
};

export default async (req) => {
  const store = getStore('ninja-dojo');

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const top = Math.min(100, Math.max(1, parseInt(url.searchParams.get('top') || '10', 10) || 10));
    const board = (await store.get('board', { type: 'json' })) || [];
    return json({ scores: board.slice(0, top).map(({ name, score, wave, at }) => ({ name, score, wave, at })) });
  }

  if (req.method !== 'POST') return json({ message: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ message: 'Bad request' }, 400); }

  const name = cleanName(body && body.name);
  const score = Number(body && body.score);
  const wave = Math.max(1, Math.min(999, parseInt(body && body.wave, 10) || 1));
  const kills = Math.max(0, Math.min(100000, parseInt(body && body.kills, 10) || 0));

  if (!name) return json({ message: 'Enter a name (2–16 characters).' }, 400);
  if (!Number.isFinite(score) || score < 0 || score !== Math.floor(score)) return json({ message: 'Invalid score.' }, 400);
  // plausibility: score can't exceed what the waves reached could realistically yield
  if (score > wave * PER_WAVE_CAP + 50000) return json({ message: 'Score looks out of range.' }, 400);

  const store2 = store;
  const board = (await store2.get('board', { type: 'json' })) || [];

  // simple per-name rate limit
  const now = Date.now();
  const recent = board.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (recent && now - (recent.at || 0) < MIN_GAP_MS) return json({ message: 'Slow down a moment and try again.' }, 429);

  // keep a player's best only
  const others = board.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
  const prevBest = recent ? recent.score : 0;
  const entry = { name, score: Math.max(score, prevBest), wave, kills, at: now };
  const next = others.concat([entry]).sort((a, b) => b.score - a.score).slice(0, MAX_KEEP);
  await store2.setJSON('board', next);

  return json({ ok: true, scores: next.slice(0, 10).map(({ name, score, wave, at }) => ({ name, score, wave, at })) });
};

export const config = { path: '/api/scores' };
