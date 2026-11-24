// The API's bindings kept in this process's memory, for the tests, the
// browser smoke test and `npm run serve`: each poll's Durable Object is a
// Poll on a Map, with the storage calls the Poll makes. Nothing is kept
// after the process ends, and alarms do not go off by themselves; a test
// calls `alarm()`.

import { Poll } from './src/poll.js';

function memoryStorage() {
  const data = new Map();
  let alarm = null;
  return {
    data,
    async get(key) {
      return structuredClone(data.get(key));
    },
    async put(key, value) {
      const entries = typeof key === 'string' ? { [key]: value } : key;
      for (const [name, entry] of Object.entries(entries)) data.set(name, structuredClone(entry));
    },
    async delete(key) {
      return data.delete(key);
    },
    // The entries whose keys start with `prefix`, in the order of their
    // keys, after `startAfter`, at most `limit`, as a Durable Object's list.
    async list({ prefix = '', startAfter, limit = Infinity } = {}) {
      const keys = [...data.keys()].filter((key) => key.startsWith(prefix) && (startAfter === undefined || key > startAfter)).sort();
      return new Map(keys.slice(0, limit).map((key) => [key, structuredClone(data.get(key))]));
    },
    async deleteAll() {
      data.clear();
      alarm = null;
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at) {
      alarm = Number(at);
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
}

// The env a Worker gets: POLLS, whose `objects` holds each poll's Poll and
// storage by name, ALLOWED_ORIGINS, and whatever `vars` add, such as a
// `clock` or a RESEARCH_TOKEN.
export function memoryEnv(vars = {}) {
  const objects = new Map();
  const env = { ALLOWED_ORIGINS: '', ...vars };
  env.POLLS = {
    objects,
    idFromName: (name) => name,
    get(name) {
      if (!objects.has(name)) {
        const storage = memoryStorage();
        objects.set(name, { storage, poll: new Poll({ storage }, env) });
      }
      const { poll } = objects.get(name);
      return { fetch: (url, init) => poll.fetch(new Request(url, init)) };
    },
  };
  return env;
}
