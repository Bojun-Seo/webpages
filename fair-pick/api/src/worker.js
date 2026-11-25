// The API behind the fair-pick page: a Cloudflare Worker in front of one
// Durable Object for each poll, named by its group ID, so that each poll
// is kept in one place and its changes happen one at a time.
//
//   POST   /polls                      { id, pin, kind, title, note, options, deadline }
//                                        → 201 { token, adminKey, poll, ballots }
//   POST   /polls/:id/enter            { pin } → { token, poll, ballots }
//   GET    /polls/:id                  → { poll, ballots }
//   PUT    /polls/:id/ballot           { name, grades, ballotId? } → { ballotId, ballotKey?, poll, ballots }
//   DELETE /polls/:id/ballots/:ballot  → { poll, ballots }
//   POST   /polls/:id/close            → { poll, ballots }
//   POST   /polls/:id/reopen           → { poll, ballots }
//   POST   /polls/:id/draw             → { poll, ballots }, the roulette's pick of a tie
//   DELETE /polls/:id                  → { deleted: true }
//
//   POST   /donations                  { id, key, record } → 201 or 200 { kept: true }
//   DELETE /donations/:id              → { deleted: true }
//   GET    /donations?after=:id        → { donations: [{ id, month, record }], next }
//
// Every call but the first two carries the poll's token, which the PIN
// unlocks, as `Authorization: Bearer`, and that is all closing the poll or
// spinning its roulette needs; reopening and deleting the poll, or another
// voter's ballot, also need the admin key its maker got
// (`X-Admin-Key`), and changing a ballot the key its voter got
// (`X-Ballot-Key`). A ballot's grades are each date's ✕ △ ○ (0 to 2), or
// each option's points from its place, n - 1 for the first of n; until the
// poll closes, the ballots answered carry no grades. An error answers
// { error, message }, the message in Korean for the page to show.
//
// A record for research is what a closed date poll gives when its maker
// asked and every voter went along (common/site/research.js): its maker's
// phone sends it under a random ID and key, and may send it again or take
// it back (`X-Donation-Key`) with that key. Only whoever holds the
// RESEARCH_TOKEN secret reads the records, as `Authorization: Bearer`;
// without the secret nobody does.
//
// poll.js keeps each poll and decides who may do what; this module routes
// a call to its poll and answers browsers on the page's site.

import { idProblem, normalizeId } from '../../../common/site/poll-rules.js';
import { GATE, Poll, RESEARCH, SIGNED_OUT, WRONG, json, sameText, sha256 } from './poll.js';

// workerd needs the Durable Object's class among the main module's exports.
export { Poll };

const MAX_BODY = 16 * 1024;

// The CORS headers for a page at `origin`: those of the page's own site,
// listed in ALLOWED_ORIGINS, and of a page on this machine, for trying the
// page out. Any other origin gets none, so a browser keeps its pages from
// the answers.
function corsFor(origin, allowed = '') {
  if (!origin) return {};
  const listed = allowed.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!listed.includes(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-admin-key, x-ballot-key, x-donation-key',
    'access-control-max-age': '86400',
  };
}

const TOO_BIG = Symbol('too big');
const NOT_JSON = Symbol('not json');

async function readBody(request) {
  if (request.method === 'GET' || request.method === 'DELETE') return {};
  if (Number(request.headers.get('content-length')) > MAX_BODY) return TOO_BIG;
  const text = await request.text();
  if (text.length > MAX_BODY) return TOO_BIG;
  if (text === '') return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : NOT_JSON;
  } catch {
    return NOT_JSON;
  }
}

// The action a request asks for, from its method and path.
function actionOf(method, parts) {
  const [, , what] = parts;
  if (parts.length === 1) return method === 'POST' ? 'create' : null;
  if (parts.length === 2) return { GET: 'get', DELETE: 'delete' }[method] || null;
  if (parts.length === 3) {
    if (method === 'POST') return { enter: 'enter', close: 'close', reopen: 'reopen', draw: 'draw' }[what] || null;
    return method === 'PUT' && what === 'ballot' ? 'vote' : null;
  }
  return parts.length === 4 && method === 'DELETE' && what === 'ballots' ? 'unvote' : null;
}

function call(env, name, action, input) {
  const stub = env.POLLS.get(env.POLLS.idFromName(name));
  return stub.fetch(`https://poll/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// A part of the path as it was before it was encoded, '' when it is not
// encoded right.
function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
}

// The records for research: sent by a poll's maker's phone, at most as
// many an hour from one address as polls; taken back with their key; and
// read with the RESEARCH_TOKEN secret.
async function donations(request, env, parts) {
  const { method } = request;
  if (parts.length === 1 && method === 'GET') {
    if (!env.RESEARCH_TOKEN) return json(404, { error: 'route', message: '없는 요청이에요.' });
    if (!sameText(request.headers.get('authorization') || '', `Bearer ${env.RESEARCH_TOKEN}`)) {
      return json(401, { error: 'token', message: '읽을 권한이 없어요.' });
    }
    return call(env, RESEARCH, 'donations', { after: new URL(request.url).searchParams.get('after') || '' });
  }
  if (parts.length === 1 && method === 'POST') {
    const body = await readBody(request);
    if (body === TOO_BIG) return json(413, { error: 'invalid', message: '보낸 내용이 너무 커요.' });
    if (body === NOT_JSON) return json(400, { error: 'invalid', message: '보낸 내용을 읽지 못했어요.' });
    const address = request.headers.get('cf-connecting-ip') || 'local';
    const gate = await call(env, GATE, 'gate', { key: await sha256(`donate|${address}`), what: 'donate' });
    if (gate.status !== 200) return gate;
    return call(env, RESEARCH, 'donate', { body });
  }
  if (parts.length === 2 && method === 'DELETE') {
    return call(env, RESEARCH, 'withdraw', { id: decode(parts[1]), key: request.headers.get('x-donation-key') || '' });
  }
  return json(parts.length > 2 ? 404 : 405, { error: 'route', message: '없는 요청이에요.' });
}

async function route(request, env) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts[0] === 'donations') return donations(request, env, parts);
  if (parts[0] !== 'polls' || parts.length > 4) return json(404, { error: 'route', message: '없는 요청이에요.' });
  const action = actionOf(request.method, parts);
  if (!action) return json(405, { error: 'route', message: '없는 요청이에요.' });

  const body = await readBody(request);
  if (body === TOO_BIG) return json(413, { error: 'invalid', message: '보낸 내용이 너무 커요.' });
  if (body === NOT_JSON) return json(400, { error: 'invalid', message: '보낸 내용을 읽지 못했어요.' });

  const id = normalizeId(action === 'create' ? body.id : decode(parts[1]));
  const idError = idProblem(id);
  if (idError) {
    if (action === 'create') return json(400, { error: 'invalid', message: idError, field: 'id' });
    if (action === 'enter') return json(401, { error: 'wrong', message: WRONG });
    return json(SIGNED_OUT.status, SIGNED_OUT.body);
  }

  const address = request.headers.get('cf-connecting-ip') || 'local';
  if (action === 'create') {
    const gate = await call(env, GATE, 'gate', { key: await sha256(`create|${address}`) });
    if (gate.status !== 200) return gate;
  }

  const bearer = request.headers.get('authorization') || '';
  return call(env, id, action, {
    id,
    body,
    // Who is trying a PIN, as wrong PINs are counted: a hash, not the address.
    key: action === 'enter' ? await sha256(`enter|${id}|${address}`) : null,
    ballotId: parts[3] ? decode(parts[3]) : null,
    auth: {
      token: bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '',
      adminKey: request.headers.get('x-admin-key') || '',
      ballotKey: request.headers.get('x-ballot-key') || '',
    },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsFor(request.headers.get('origin'), env.ALLOWED_ORIGINS);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, vary: 'Origin' } });
    let answer;
    try {
      answer = await route(request, env);
    } catch (error) {
      console.error(error);
      answer = json(500, { error: 'server', message: '서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.' });
    }
    // An answer from a Durable Object cannot have its headers changed.
    const response = new Response(answer.body, answer);
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    response.headers.set('vary', 'Origin');
    return response;
  },
};
