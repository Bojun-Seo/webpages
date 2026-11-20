// Calls the API in ../api from the browser. Each call resolves with what
// the API answered, or rejects with an ApiError whose message the page can
// show as it is.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || '서버가 알 수 없는 답을 했어요. 잠시 뒤에 다시 해 주세요.');
    this.status = status;
    this.code = body?.error || 'unknown';
    this.body = body || {};
  }
}

// A client for the API at `base`. `auth` is { token, adminKey, ballotKey },
// any of them left out when not held.
export function createClient(base) {
  const root = base.replace(/\/+$/, '');

  async function call(method, path, { body, token, adminKey, ballotKey } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (adminKey) headers['x-admin-key'] = adminKey;
    if (ballotKey) headers['x-ballot-key'] = ballotKey;
    let res;
    try {
      res = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, { error: 'network', message: '서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.' });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // An answer that is not JSON is told by its status below.
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  const at = (id) => `/polls/${encodeURIComponent(id)}`;
  return {
    create: (input) => call('POST', '/polls', { body: input }),
    enter: (id, pin) => call('POST', `${at(id)}/enter`, { body: { pin } }),
    load: (id, auth) => call('GET', at(id), auth),
    vote: (id, auth, ballot) => call('PUT', `${at(id)}/ballot`, { ...auth, body: ballot }),
    unvote: (id, auth, ballotId) => call('DELETE', `${at(id)}/ballots/${encodeURIComponent(ballotId)}`, auth),
    close: (id, auth) => call('POST', `${at(id)}/close`, auth),
    reopen: (id, auth) => call('POST', `${at(id)}/reopen`, auth),
    remove: (id, auth) => call('DELETE', at(id), auth),
  };
}
