// lib/store.js — tiny JSON-file store (no DB needed to run).
// Swap for SQLite/Postgres later; the API stays the same.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = join(dir, 'db.json');

function load() {
  const empty = { users: {}, doubts: {}, quizzes: {}, speaking: {} };
  if (!existsSync(FILE)) return empty;
  try { return { ...empty, ...JSON.parse(readFileSync(FILE, 'utf8')) }; }
  catch { return empty; }
}
function save(db) { writeFileSync(FILE, JSON.stringify(db, null, 2)); }

export const store = {
  getUser(email) { return load().users[email.toLowerCase()] || null; },
  addUser(user) {
    const db = load();
    db.users[user.email.toLowerCase()] = user;
    save(db);
  },
  saveDoubt(email, doubt) {
    const db = load();
    const e = email.toLowerCase();
    db.doubts[e] = db.doubts[e] || [];
    // `doubt` may carry a full `lesson` object (slides + narration + topicIntro)
    // so the saved doubt can be re-opened and re-narrated later, exactly as built.
    db.doubts[e].unshift({ ...doubt, id: Date.now().toString(), at: new Date().toISOString() });
    save(db);
  },
  listDoubts(email) { return load().doubts[email.toLowerCase()] || []; },

  saveQuizResult(email, rec) {
    const db = load();
    const e = email.toLowerCase();
    db.quizzes = db.quizzes || {};
    db.quizzes[e] = db.quizzes[e] || [];
    db.quizzes[e].unshift({ ...rec, id: Date.now().toString(), at: new Date().toISOString() });
    db.quizzes[e] = db.quizzes[e].slice(0, 100);
    save(db);
  },
  listQuizzes(email) { return (load().quizzes || {})[email.toLowerCase()] || []; },

  saveSpeaking(email, rec) {
    const db = load();
    const e = email.toLowerCase();
    db.speaking = db.speaking || {};
    db.speaking[e] = db.speaking[e] || [];
    db.speaking[e].unshift({ ...rec, id: Date.now().toString(), at: new Date().toISOString() });
    db.speaking[e] = db.speaking[e].slice(0, 100);
    save(db);
  },
  listSpeaking(email) { return (load().speaking || {})[email.toLowerCase()] || []; },
};
