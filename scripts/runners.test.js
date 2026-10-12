"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { mergeRun, toIsoDate, proofUrlsEqual, rowsFromCsv } = require("./sync-runners");
const { validateRunners } = require("./validate-runners");
const now = "2026-10-12T12:34:56Z";
const row = (overrides = {}) => ({ runnerName: "New Runner", gameId: "ds1", roleId: "master", restrictions: "SL1 No Roll", proof: "https://youtu.be/AbC123", ...overrides });
const merge = (rows, base = { runners: [] }) => mergeRun(base, rows, {}, now).runners;
test("new completion, Hitless and fallback use separate site-added time", () => {
  const data = merge([row({ completedAt: "2020-01-01" }), row({ runnerName: "Hitless", roleId: "hitless-sage" })]);
  assert.equal(data.runners[0].addedAt, now);
  assert.equal(data.runners[0].games[0].challenges[0].completedAt, "2020-01-01");
  assert.equal(data.runners[1].games[0].challenges[0].completedAt, "2026-10-12");
});
test("multiple distinct proofs, equivalent proof deduplication and repeat import preserve every field", () => {
  const rows = [row(), row({ proof: "https://youtu.be/Other" }), row({ proof: "https://www.youtube.com/watch?v=AbC123&si=tracking" })];
  const data = merge(rows);
  assert.equal(data.runners.length, 1);
  assert.equal(data.runners[0].games[0].challenges.length, 2);
  assert.deepEqual(merge(rows.map(r => ({ ...r, completedAt: "2025-01-01", hitlessProfile: "https://example.com" })), data), data);
  assert.equal(proofUrlsEqual("https://youtu.be/AbC123", "https://youtu.be/abc123"), false);
});
test("new role on existing runner gets its own addedAt and preserves runner dates", () => {
  const old = merge([row({ completedAt: "2020-01-01" })]);
  old.runners[0].addedAt = "2021-01-01";
  const next = merge([row({ gameId: "ds3" })], old);
  assert.equal(next.runners[0].addedAt, "2021-01-01");
  assert.equal(next.runners[0].games[1].addedAt, now);
  assert.equal(next.runners[0].games[1].challenges[0].completedAt, "2026-10-12");
});
test("invalid dates and duplicate records are rejected", () => {
  for (const date of ["2026-02-30", "2026-13-01", "10/12/2026", "2026-01-01garbage"]) assert.throws(() => toIsoDate(date));
  const d = merge([row()]);
  assert.throws(() => validateRunners({ runners: [d.runners[0], d.runners[0]] }));
  d.runners[0].games[0].challenges.push({ ...d.runners[0].games[0].challenges[0] });
  assert.throws(() => validateRunners(d));
});
test("runner aliases, slug collisions and entry fallback are handled safely", () => {
  const old = merge([row()]);
  const alias = mergeRun(old, [row({ runnerName: "Different Discord Name" })], { "different discord name": "new-runner" }, now).runners;
  assert.deepEqual(alias, old);
  assert.throws(() => merge([row({ runnerName: "New_Runner" })], old), /collision/);
  old.runners[0].games[0].addedAt = "2022-02-02T12:00:00Z";
  const result = merge([row({ proof: "https://youtu.be/Another" })], old);
  assert.equal(result.runners[0].games[0].challenges[1].completedAt, "2022-02-02");
  assert.deepEqual(result.runners[0].games[0].challenges[0], old.runners[0].games[0].challenges[0]);
});
test("CSV ignores verification/submission and prioritizes documented completion over publication", () => {
  const text = "Status,Runner,Game,Tier,Restrictions,Checked Date,Timestamp,Completion Date,Proof Publication Date\nAccepted,New,Dark Souls,Master,SL1,2025-01-01,2024-01-01,2020-01-01,2021-01-01\nAccepted,Fallback,Dark Souls,Master,SL1,2025-01-01,2024-01-01,,\nAccepted,Publication,Dark Souls,Master,SL1,,, ,2022-01-01\n";
  const original = fs.readFileSync;
  fs.readFileSync = (file, ...args) => file === "fixture.csv" ? text : original(file, ...args);
  try { const rows = rowsFromCsv("fixture.csv"); assert.deepEqual(rows.map(r => r.completedAt), ["2020-01-01", "", "2022-01-01"]); }
  finally { fs.readFileSync = original; }
});
test("all existing runners and challenges validate and reimport without changes", () => {
  const data = JSON.parse(fs.readFileSync(require.resolve("../data/runners.json"), "utf8"));
  validateRunners(data);
  const rows = data.runners.flatMap(r => r.games.flatMap(e => (e.challenges || []).map(c => row({ runnerName: r.id, gameId: e.game, roleId: e.role, restrictions: c.restrictions || c.title, proof: c.proof, completedAt: "2000-01-01" }))));
  assert.deepEqual(merge(rows, data), data);
});
test("sorting uses latest challenge date, menu priority, stable ties and independent addedAt", async () => {
  const data = merge([row({ completedAt: "2020-01-01" }), row({ proof: "https://youtu.be/Second", completedAt: "2022-01-01" })]);
  const games = JSON.parse(fs.readFileSync(require.resolve("../data/games.json"), "utf8"));
  const ctx = { window: { location: { href: "https://example.com/" } }, URL, fetch: async p => ({ ok: true, json: async () => p.includes("runners") ? data : games }) };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(require.resolve("../shared.js"), "utf8"), ctx);
  const cat = await ctx.window.OneBros.loadCatalog();
  assert.equal(cat.runnerCompletedAt(cat.runners[0]), "2022-01-01");
  const entry = (game, date) => ({ game, role: "master", challenges: [{ completedAt: date }] });
  assert(cat.compareEntryCompleted(entry("des", "2020-01-01"), entry("ds1", "2026-01-01")) < 0);
  const tied = [{ completedAt: "2020-01-01", id: 1 }, { completedAt: "2020-01-01", id: 2 }];
  assert.deepEqual([...tied].sort(cat.compareChallengeCompleted), tied);
  // Playlist item position is irrelevant: the reviewer supplies the newest publication day.
  const videos = [{ published: "2022-01-01" }, { published: "2024-01-01" }, { published: "2021-01-01" }];
  const latest = videos.map(v => v.published).sort().at(-1);
  assert.equal(merge([row({ completedAt: latest })]).runners[0].games[0].challenges[0].completedAt, "2024-01-01");
});
