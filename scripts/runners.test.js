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
  const ctx = { window: { location: { href: "https://example.com/" } }, URL, fetch: async p => ({ ok: true, json: async () => p.includes("runners") ? data : p === "data/games.json" ? games : JSON.parse(fs.readFileSync(require.resolve(`../${p}`), "utf8")) }) };
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

const approvedHitlessTitles = new Map([
  ["face-man/des", "SL1 All Bosses No Sprint Melee Only"],
  ["adonutirl/ds1", "SL1 All Bosses"],
  ["zeldasouls/ds1", "SL1 All Bosses No Roll"],
  ["dolos6331/ds2", "SL1 Any% +0"],
  ["adonutirl/ds2", "SL1 Any% +0"],
  ["cloudi1234/ds3", "SL1 Any% +0"],
  ["vernonroche4174/ds3", "SL1 All Bosses +0 NG+7"],
  ["lecarbonator/ds3", "SL1 All Bosses +0"],
  ["admiraljub/bb", "BL4 Any% No Roll"],
  ["adonutirl/bb", "BL4 All Bosses"],
  ["recycle/er", "RL1 All Great Runes +0, No Talismans, No Auxiliary Damage, No Status Effects"],
  ["vernonroche4174/er", "RL1 Any% +0"],
  ["mmmmmhmhmhmmhm/er", "RL1 Any% +0"],
  ["adonutirl/er", "RL1 Any% +0"],
]);

// Approved titles shown as a linked main title with unlinked extra restrictions below it.
const splitHitlessTitles = new Map([["recycle/er", "RL1 All Great Runes +0"]]);
function assertHitlessTitle(api, html, key, title, end = "</") {
  const main = splitHitlessTitles.get(key);
  if (!main) return assert(html.includes(`>${api.escapeHtml(title)}${end}`), key);
  assert(title.startsWith(`${main}, `), key);
  assert(html.includes(`>${api.escapeHtml(main)}</a><span class="challenge-extras"><span class="challenge-extras-label">Extra restrictions</span>`), key);
  const extras = [...html.matchAll(/<span class="challenge-extra" role="listitem">(.*?)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(extras, title.slice(main.length + 2).split(", ").map(api.escapeHtml), key);
}

test("all four run surfaces use approved titles and preserve pending entries", async () => {
  const source = fs.readFileSync(require.resolve("../shared.js"), "utf8");
  const makeContext = async (script) => {
    const ctx = { window: { location: { href: "https://example.com/" } }, URL,
      fetch: async p => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(require.resolve(`../${p}`), "utf8")) }) };
    vm.createContext(ctx);
    vm.runInContext(script, ctx);
    return { api: ctx.window.OneBros, cat: await ctx.window.OneBros.loadCatalog() };
  };
  const { api, cat } = await makeContext(source);
  // Reproduce the pre-change renderer to compare every excluded and Hitless card.
  const previous = await makeContext(source.replace('const displayTitle = officialDisplayTitle(catalog, runner, entry, c);', 'const displayTitle = "";'));
  const surfaces = [
    ["runners.js", {}],
    ["script.js", {}],
    ["runner.js", { challengeMode: "full", sortCompleted: true, head: false }],
    ["game.js", { challengeMode: "full", sortCompleted: true, showGame: false }],
  ];
  const excluded = new Set();
  const confirmed = new Map([
    ["jonglesnorp/sekiro/master", "Attack Power 1 + No Prosthetic Tools + No Items/Buffs"],
    ["unholypancake/des/elitemaster", "SL1 NG+5 PBWT No Sprinting/Rolling/Blocking/Parrying"],
    ["geori/ds1/master", "SL1 NG+6 No Rolling/Blocking/Parrying"],
    ["reaper8475/ds1/legend", "SL1 No Rolling/Blocking/Parrying"],
    ["sassasallalla23/sekiro/elitemaster", "Attack Power 1 Sword Only No Skills"],
    ["squidofentropy/sekiro/legend", "No Skills/Combat Arts + No Items/Buffs"],
    ["jonathan/sekiro/master", "Attack Power 1 + No Prosthetic Tools + No Items/Buffs"],
  ]);
  const combinations = new Map([
    ["geori", "No Prosthetic Tools + No Skills/Combat Arts + No Items/Buffs"],
    ["geod22", "No Prosthetic Tools + No Items/Buffs"],
    ["reaper8475", "No Prosthetic Tools + No Items/Buffs"],
    ["fragileember", "No Skills/Combat Arts + No Items/Buffs"],
    ["ca-waves", "No Prosthetic Tools + No Skills/Combat Arts + No Items/Buffs"],
    ["abyssalsnake", "Attack Power 1 + No Prosthetic Tools + No Skills/Combat Arts + No Items/Buffs"],
    ["saigosen", "Attack Power 1 + No Prosthetic Tools + No Items/Buffs"],
  ]);
  let safe = 0, changed = 0, hitless = 0, pending = 0;
  const before = JSON.stringify(cat.runners);
  for (const runner of cat.runners) for (const entry of runner.games) {
    const isHitless = cat.role(entry.role).track === "nohit";
    const isExcluded = excluded.has(`${runner.id}/${entry.game}/${entry.role}`);
    const combination = entry.game === "sekiro" && ["legend", "master"].includes(entry.role)
      ? combinations.get(runner.id) : "";
    const confirmedTitle = confirmed.get(`${runner.id}/${entry.game}/${entry.role}`);
    for (const challenge of entry.challenges) {
      if (isHitless) hitless++;
      else if (isExcluded) pending++;
      else {
        if (confirmedTitle) {
          if (entry.role !== "elitemaster") {
            for (const phrase of confirmedTitle.split(" + ")) {
              assert(cat.officialTitles(entry.game, entry.role).has(phrase)
                || (entry.game === "sekiro" && entry.role === "master" && cat.officialTitles("sekiro", "legend").has(phrase)));
            }
          }
        } else if (combination) {
          for (const phrase of combination.split(" + ")) assert(cat.officialTitles("sekiro", "legend").has(phrase));
        } else if (challenge.title) assert(cat.isOfficialChallengeTitle(entry, challenge), `${runner.id}/${entry.game}/${entry.role}`);
        safe++;
        if (combination || (confirmedTitle && confirmedTitle !== challenge.title)
          || (challenge.restrictions && challenge.restrictions !== challenge.title)) changed++;
      }
    }
    for (const [file, opts] of surfaces) {
      assert.match(fs.readFileSync(require.resolve(`../${file}`), "utf8"), /runnerCard\(/);
      const html = api.runnerCard(cat, runner, [entry], opts);
      const hitlessTitle = isHitless && approvedHitlessTitles.get(`${runner.id}/${entry.game}`);
      if (isHitless && entry.challenges.some(c => c.title && c.restrictions)) {
        for (const c of entry.challenges) {
          assert(html.includes(`>${api.escapeHtml(c.title)}</a>`));
          assert(html.includes(`role="listitem">${api.escapeHtml(c.restrictions)}</span>`));
          assert(html.includes(api.escapeHtml(c.proof)));
        }
      } else if (hitlessTitle && entry.challenges.length) {
        assertHitlessTitle(api, html, `${runner.id}/${entry.game}`, hitlessTitle);
      } else if (isHitless || isExcluded) {
        assert.equal(html, previous.api.runnerCard(previous.cat, runner, [entry], opts));
      } else for (const challenge of entry.challenges) {
        const label = api.escapeHtml(confirmedTitle || combination || challenge.title).replace(/\//g, "/<wbr>");
        assert(html.includes(`>${label}</`), `${file}: ${runner.id}`);
        if (challenge.restrictions && challenge.restrictions !== challenge.title) {
          const personalLabel = api.escapeHtml(challenge.restrictions).replace(/\//g, "/<wbr>");
          assert(!html.includes(`>${personalLabel}</`), `${file}: personal restrictions`);
        }
      }
    }
  }
  assert.equal(JSON.stringify(cat.runners), before);
  assert.deepEqual({ safe, changed, hitless, pending }, { safe: 59, changed: 42, hitless: 24, pending: 0 });
});

async function sekiroRenderingFixture(sourceOverride) {
  const source = sourceOverride || fs.readFileSync(require.resolve("../shared.js"), "utf8");
  async function load(script) {
    const ctx = { window: { location: { href: "https://example.com/" } }, URL,
      fetch: async p => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(require.resolve(`../${p}`), "utf8")) }) };
    vm.createContext(ctx); vm.runInContext(script, ctx);
    return { api: ctx.window.OneBros, cat: await ctx.window.OneBros.loadCatalog() };
  }
  const current = await load(source);
  const original = await load(source.replace('const displayTitle = officialDisplayTitle(catalog, runner, entry, c);', 'const displayTitle = "";'));
  const ids = new Set(["geori", "geod22", "reaper8475", "fragileember", "ca-waves", "abyssalsnake", "saigosen"]);
  const reviewed = current.cat.runners.flatMap(r => ids.has(r.id)
    ? r.games.filter(e => e.game === "sekiro" && ["legend", "master"].includes(e.role)).map(e => ({ runner: r, entry: e })) : []);
  assert.equal(reviewed.length, 7);
  const render = (fixture, runner, entry, mode) => fixture.api.runnerCard(fixture.cat, runner, [entry], { challengeMode: mode });
  return { current, original, reviewed, render };
}

const profileEntry = (game, role, count = 1) => ({ game, role,
  challenges: Array.from({ length: count }, () => ({ title: "Test run", completedAt: "2020-01-01" })) });

test("profile games prioritize highest existing tier over run count and menu order", async () => {
  const { current: { cat } } = await sekiroRenderingFixture();
  const runner = { games: [profileEntry("des", "master", 8), profileEntry("er", "grandmaster")] };
  assert.deepEqual(Array.from(cat.profileGameGroups(runner), g => g.game), ["er", "des"]);
  const roles = ["grandmaster", "elitemaster", "master", "legend", "hitless-sage", "hitless-scholar", "champion"];
  for (let i = 1; i < roles.length; i++) {
    const games = [profileEntry("des", roles[i], 8), profileEntry("er", roles[i - 1])];
    assert.equal(cat.profileGameGroups({ games })[0].game, "er");
  }
});

test("profile tier ties count every challenge across all tiers using existing verified counts", async () => {
  const { current: { cat } } = await sekiroRenderingFixture();
  const runner = { games: [profileEntry("des", "master", 2), profileEntry("er", "master"),
    profileEntry("er", "champion", 2), profileEntry("er", "hitless-sage")] };
  const before = JSON.stringify(runner);
  const groups = cat.profileGameGroups(runner);
  assert.deepEqual(Array.from(groups, g => [g.game, g.count]), [["er", 4], ["des", 2]]);
  assert.equal(groups[0].entries.length, 3);
  assert.equal(groups.reduce((sum, g) => sum + g.count, 0), cat.completionCount(runner.games.map(entry => ({ entry }))));
  assert.equal(JSON.stringify(runner), before);
  assert.equal(cat.profileGameGroups({ games: [{ game: "des", role: "master" }] })[0].count, 1);
});

test("profile tier and count ties follow Games menu order regardless of dates or input order", async () => {
  const { current: { cat } } = await sekiroRenderingFixture();
  const games = [...cat.games].reverse().map(g => profileEntry(g.id, "master", 2));
  games[0].challenges[0].completedAt = "2026-10-15";
  games[0].addedAt = "2026-10-15T12:00:00Z";
  assert.deepEqual(Array.from(cat.profileGameGroups({ games }), g => g.game), Array.from(cat.games, g => g.id));
  assert.equal(cat.profileGameGroups({ games: [] }).length, 0);
});

test("runner profile uses the same ranked groups for background and cards without changing data or Home order", async () => {
  const { current: { cat, api } } = await sekiroRenderingFixture();
  const runner = { id: "profile-order-test", name: "Profile test", profile: "https://www.youtube.com/@example",
    addedAt: "2026-01-01", games: [profileEntry("des", "master"), profileEntry("er", "master"),
      profileEntry("er", "champion", 2), profileEntry("sekiro", "hitless-sage")] };
  cat.runners.push(runner);
  const before = JSON.stringify(cat.runners);
  const recent = Array.from(cat.entries().sort(cat.compareVerifiedEntry), pair => pair.entry);
  const nodes = new Map(["#runner-hero", "#runner-content"].map(id => [id, { innerHTML: "" }]));
  const properties = new Map(), classes = new Set();
  let init;
  const ctx = { URL, URLSearchParams, Image: class { addEventListener() {} }, console,
    document: { querySelector: () => null, addEventListener: (_, callback) => { init = callback; },
      body: { style: { setProperty: (key, value) => properties.set(key, value) },
        classList: { add: value => classes.add(value) } } },
    window: { location: { search: "?runner=profile-order-test", hash: "" },
      OneBros: { ...api, $: selector => nodes.get(selector), loadCatalog: async () => cat,
        loadJson: async () => null, initChrome() {}, initGamesMenu() {}, bindAvatarFallback() {} } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve("../runner.js"), "utf8"), ctx);
  await init();
  const html = nodes.get("#runner-content").innerHTML;
  const banners = [...html.matchAll(/class="profile-game-banner" href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(banners, ["er", "des", "sekiro"].map(id => api.escapeHtml(cat.gamePageUrl(id))));
  assert.equal((html.match(/<section class="profile-game">/g) || []).length, 3);
  assert.equal(properties.get("--page-bg"), `url("${api.safeUrl(cat.game("er").pageBackground.src)}")`);
  assert(classes.has("has-page-bg"));
  assert.equal(JSON.stringify(cat.runners), before);
  assert.deepEqual(Array.from(cat.entries().sort(cat.compareVerifiedEntry), pair => pair.entry), recent);
});

test("directory rows use effective tier, total game completions and menu order without grouping lower tiers first", async () => {
  const { current: { cat, api } } = await sekiroRenderingFixture();
  const runner = { id: "directory-test", name: "Directory test", games: [
    profileEntry("er", "champion", 3), profileEntry("des", "champion"),
    profileEntry("ds3", "master"), profileEntry("des", "grandmaster"),
    profileEntry("er", "master"), profileEntry("ds1", "master"),
    profileEntry("sekiro", "hitless-sage"), profileEntry("bb", "hitless-scholar"),
  ] };
  const before = JSON.stringify(runner);
  const expected = [runner.games[3], runner.games[4], runner.games[5], runner.games[2],
    runner.games[6], runner.games[7], runner.games[0], runner.games[1]];
  assert.deepEqual(Array.from(cat.profileCardEntries(runner)), expected);
  const html = api.runnerCard(cat, runner, runner.games, { background: true, profileOrder: true });
  assert(html.includes(cat.game("des").cardBackground.src));
  const tied = { ...runner, games: runner.games.filter(e => e.role !== "grandmaster") };
  assert.equal(cat.profileCardEntries(tied)[0].game, cat.profileGameGroups(tied)[0].game);
  assert.equal(cat.profileCardEntries(tied)[0].game, "er");
  assert(api.runnerCard(cat, tied, tied.games, { background: true, profileOrder: true }).includes(cat.game("er").cardBackground.src));
  assert.equal(cat.profileCardEntries({ games: [] }).length, 0);
  assert.equal(JSON.stringify(runner), before);
});

test("Runners enables profile ordering inside cards while preserving directory order and filtering", async () => {
  const { current: { cat, api } } = await sekiroRenderingFixture();
  const before = JSON.stringify(cat.runners);
  const recent = Array.from(cat.entries().sort(cat.compareVerifiedEntry), p => p.entry);
  const nodes = new Map(["#runners-grid", "#results-count", "#filter-search", "#filter-game", "#filter-role"]
    .map(id => [id, { innerHTML: "", value: "", addEventListener() {} }]));
  const calls = [];
  let init;
  const ctx = { console, document: { addEventListener: (_, callback) => { init = callback; } },
    window: { OneBros: { ...api, $: selector => nodes.get(selector), loadCatalog: async () => cat,
      loadJson: async () => null, initChrome() {}, initGamesMenu() {}, populateRunnerFilters() {}, bindAvatarFallback() {},
      runnerCard(catalog, runner, entries, opts) {
        calls.push({ runner, entries, opts });
        return api.runnerCard(catalog, runner, entries, opts);
      } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve("../runners.js"), "utf8"), ctx);
  await init();
  assert.deepEqual(calls.map(c => c.runner.id), Array.from([...cat.runners].sort(cat.compareRunnerCompleted), r => r.id));
  for (const { runner, entries, opts } of calls) {
    assert.equal(opts.background, true);
    assert.equal(opts.profileOrder, true);
    assert.equal(entries.length, runner.games.length);
    const sorted = cat.profileCardEntries(runner, entries);
    assert.equal(sorted[0]?.game, cat.profileGameGroups(runner)[0]?.game);
  }
  assert.equal(JSON.stringify(cat.runners), before);
  assert.deepEqual(Array.from(cat.entries().sort(cat.compareVerifiedEntry), p => p.entry), recent);
  assert(!fs.readFileSync(require.resolve("../script.js"), "utf8").includes("profileOrder"));
});

test("structured Hitless fields render consistently without runner or proof identity matching", async () => {
  const { current, render } = await sekiroRenderingFixture();
  for (const role of ["hitless-scholar", "hitless-sage"]) {
    const runner = { id: "unlisted-runner", name: "Unlisted runner", games: [] };
    const entry = { game: "sekiro", role, challenges: [{
      title: "Shura Ending", restrictions: "No Kuro's Charm",
      proof: "https://example.com/independent-proof", completedAt: "2026-09-28"
    }] };
    const before = JSON.stringify(entry);
    const short = render(current, runner, entry, "short");
    assert.equal(short, render(current, runner, entry, "full"));
    assert(short.includes('href="https://example.com/independent-proof"'));
    assert(short.includes('>Shura Ending</a>'));
    assert(short.includes('class="challenge-extra" role="listitem">No Kuro&#39;s Charm</span>'));
    assert(short.includes(current.cat.role(role).name));
    assert.equal(JSON.stringify(entry), before);
    const untitled = { ...entry, challenges: [{ ...entry.challenges[0], title: undefined }] };
    assert(!render(current, runner, untitled, "full").includes("challenge-extras"));
  }
});

test("Sekiro changed challenge data falls back instead of reusing a runner's reviewed combination", async () => {
  const { current, original, reviewed, render } = await sekiroRenderingFixture();
  for (const { runner, entry } of reviewed) {
    const challenge = entry.challenges[0];
    for (const patch of [
      { title: "Attack Power 1", restrictions: "Attack Power 1" },
      { title: challenge.title + " changed" },
      { restrictions: challenge.restrictions + ", different challenge" },
      { restrictions: undefined },
    ]) {
      const changed = { ...entry, challenges: [{ ...challenge, ...patch }] };
      for (const mode of ["short", "full"]) assert.equal(render(current, runner, changed, mode), render(original, runner, changed, mode));
    }
    const wrongTier = { ...entry, role: entry.role === "legend" ? "master" : "legend" };
    for (const mode of ["short", "full"]) assert.equal(render(current, runner, wrongTier, mode), render(original, runner, wrongTier, mode));
  }
});

test("Sekiro sibling challenges are matched independently without affecting reviewed titles", async () => {
  const { current, original, reviewed, render } = await sekiroRenderingFixture();
  for (const { runner, entry } of reviewed) {
    const extra = { title: "Attack Power 1", restrictions: "Unknown future combination", proof: "https://example.com/second-proof" };
    const pair = { ...entry, challenges: [entry.challenges[0], extra] };
    const before = JSON.stringify(pair);
    for (const mode of ["short", "full"]) {
      const html = render(current, runner, pair, mode);
      const firstList = render(current, runner, entry, mode).match(/<li>.*?<\/li>/s)[0];
      const secondList = render(original, runner, { ...entry, challenges: [extra] }, mode).match(/<li>.*?<\/li>/s)[0];
      assert(html.includes(firstList));
      assert(html.includes(secondList));
      assert.equal((html.match(/<li>/g) || []).length, 2);
    }
    assert.equal(JSON.stringify(pair), before);
  }
});

test("new Sekiro runners require exact reviewed data rather than similar restrictions", async () => {
  const { current, original, reviewed, render } = await sekiroRenderingFixture();
  for (const { runner, entry } of reviewed) {
    const newcomer = { ...runner, id: "new-runner", name: "New Runner" };
    const sameIdentity = { ...runner, id: newcomer.id, name: newcomer.name };
    for (const mode of ["short", "full"]) {
      const existing = render(current, runner, entry, mode).match(/<li>.*?<\/li>/s)[0];
      assert(render(current, newcomer, entry, mode).includes(existing));
      for (const restrictions of [entry.challenges[0].restrictions + ", No Deflect", entry.challenges[0].restrictions.toUpperCase()]) {
        const similar = { ...entry, challenges: [{ ...entry.challenges[0], restrictions }] };
        assert.equal(render(current, sameIdentity, similar, mode), render(original, sameIdentity, similar, mode));
      }
      const hitless = { ...entry, role: "hitless-sage" };
      assert.equal(render(current, newcomer, hitless, mode), render(original, newcomer, hitless, mode));
    }
  }
});

test("checker-approved labels match individual challenge data and preserve fallback and stored fields", async () => {
  const { current, original, render } = await sekiroRenderingFixture();
  const decisions = [
    ["unholypancake", "des", "elitemaster", "SL1 NG+5 PBWT No Sprinting/Rolling/Blocking/Parrying"],
    ["geori", "ds1", "master", "SL1 NG+6 No Rolling/Blocking/Parrying"],
    ["reaper8475", "ds1", "legend", "SL1 No Rolling/Blocking/Parrying"],
    ["sassasallalla23", "sekiro", "elitemaster", "Attack Power 1 Sword Only No Skills"],
    ["squidofentropy", "sekiro", "legend", "No Skills/Combat Arts + No Items/Buffs"],
    ["jonathan", "sekiro", "master", "Attack Power 1 + No Prosthetic Tools + No Items/Buffs"],
  ];
  for (const [id, game, role, title] of decisions) {
    const runner = current.cat.runners.find(r => r.id === id);
    const entry = runner.games.find(e => e.game === game && e.role === role);
    const challenge = entry.challenges[0];
    const before = JSON.stringify(runner);
    const label = current.api.escapeHtml(title).replace(/\//g, "/<wbr>");
    for (const mode of ["short", "full"]) {
      const html = render(current, runner, entry, mode);
      assert(html.includes(`>${label}</`), `${id}: confirmed title`);
      // Identity is irrelevant when the exact confirmed challenge data matches.
      assert(render(current, { ...runner, id: "new-identity" }, entry, mode).includes(`>${label}</`));
      if (id === "jonathan") {
        assert(html.includes("No Prosthetic Tools"));
        assert(html.includes("No Items/<wbr>Buffs"));
        assert(!html.includes("No Skills"));
      }
      for (const patch of [
        { title: challenge.title + " changed" },
        { restrictions: (challenge.restrictions || "") + " changed" },
        { proof: "https://example.com/different-proof" },
      ]) {
        const changed = { ...entry, challenges: [{ ...challenge, ...patch }] };
        assert.equal(render(current, runner, changed, mode), render(original, runner, changed, mode), `${id}: changed data fallback`);
      }
      const second = { title: "Unreviewed challenge", restrictions: "Unreviewed restrictions", proof: "https://example.com/second" };
      const pair = { ...entry, challenges: [challenge, second] };
      const pairHtml = render(current, runner, pair, mode);
      assert(pairHtml.includes(`>${label}</`));
      assert(pairHtml.includes(render(original, runner, { ...entry, challenges: [second] }, mode).match(/<li>.*?<\/li>/s)[0]));
      const hitless = { ...entry, role: "hitless-sage" };
      assert.equal(render(current, runner, hitless, mode), render(original, runner, hitless, mode));
    }
    assert.equal(JSON.stringify(runner), before);
  }
});

test("Jonathan's confirmed Sword Only label changes only his matching Sekiro challenge", async () => {
  const source = fs.readFileSync(require.resolve("../shared.js"), "utf8");
  const proof = "https://www.youtube.com/playlist?list=PLlouJzco8-bRjG5RQVTa4rN-tQVBXNkgd";
  const title = "Attack Power 1 + No Prosthetic Tools + No Items/Buffs";
  const previousSource = source.replace(`"${proof}", "${title}"`, `"${proof}", "Attack Power 1"`);
  assert.notEqual(previousSource, source);
  const { current, original, render } = await sekiroRenderingFixture();
  const previous = (await sekiroRenderingFixture(previousSource)).current;
  for (const runner of current.cat.runners) for (const entry of runner.games) {
    for (const mode of ["short", "full"]) {
      const html = render(current, runner, entry, mode);
      const oldHtml = render(previous, runner, entry, mode);
      if (runner.id === "jonathan" && entry.game === "sekiro" && entry.role === "master") {
        assert.notEqual(html, oldHtml);
        assert(html.includes(">Attack Power 1 + No Prosthetic Tools + No Items/<wbr>Buffs</"));
        assert(!html.includes("No Skills"));
        for (const patch of [
          { title: "Different challenge" }, { restrictions: "AP1 Sword Only" },
          { proof: "https://example.com/another-proof" },
        ]) {
          const changed = { ...entry, challenges: [{ ...entry.challenges[0], ...patch }] };
          assert.equal(render(current, runner, changed, mode), render(original, runner, changed, mode));
        }
      } else assert.equal(html, oldHtml, `${runner.id}/${entry.game}/${entry.role}: unchanged`);
    }
  }
});

test("all 24 Hitless challenges use stored titles and extras", async () => {
  const source = fs.readFileSync(require.resolve("../shared.js"), "utf8");
  const previousSource = source.replace('return hitlessDisplayTitles.get(hitlessChallengeKey(runner, entry, challenge)) || "";', 'return "";');
  assert.notEqual(previousSource, source);
  const { current, render } = await sekiroRenderingFixture();
  const previous = (await sekiroRenderingFixture(previousSource)).current;
  const before = JSON.stringify(current.cat.runners);
  let structured = 0, pending = 0;
  for (const runner of current.cat.runners) for (const entry of runner.games) {
    const isHitless = current.cat.role(entry.role).track === "nohit";
    const challenge = entry.challenges[0];
    const normalized = isHitless && challenge?.title && challenge?.restrictions;
    if (normalized) structured += entry.challenges.length;
    else if (isHitless) pending += entry.challenges.length;
    for (const mode of ["short", "full"]) {
      const html = render(current, runner, entry, mode);
      if (normalized) {
        const lists = [...html.matchAll(/<li>.*?<\/li>/gs)].map(m => m[0]);
        assert.equal(lists.length, 1);
        assert(lists[0].includes(`>${current.api.escapeHtml(challenge.title)}</a>`));
        assert(lists[0].includes(`role="listitem">${current.api.escapeHtml(challenge.restrictions)}</span>`));
        assert(lists[0].includes(current.api.escapeHtml(challenge.proof)));
        assert(!/no hit|hitless|No Upgrades/i.test(challenge.restrictions));
        assert.equal(render(current, runner, entry, "short"), render(current, runner, entry, "full"));
      } else if (isHitless && challenge) {
        assertHitlessTitle(current.api, html, `${runner.id}/${entry.game}`,
          approvedHitlessTitles.get(`${runner.id}/${entry.game}`), "</a>");
        assert(!html.includes('class="challenge-extras"'));
      } else assert.equal(html, render(previous, runner, entry, mode));
    }
  }
  assert.deepEqual({ structured, pending }, { structured: 24, pending: 0 });
  assert.equal(JSON.stringify(current.cat.runners), before);
});

test("Hitless matching requires the approved runner, game, role, title, restrictions and proof", async () => {
  const source = fs.readFileSync(require.resolve("../shared.js"), "utf8");
  const previousSource = source.replace('return hitlessDisplayTitles.get(hitlessChallengeKey(runner, entry, challenge)) || "";', 'return "";');
  const { current, render } = await sekiroRenderingFixture();
  const previous = (await sekiroRenderingFixture(previousSource)).current;
  for (const runner of current.cat.runners) for (const entry of runner.games) {
    if (entry.role !== "hitless-sage" || !approvedHitlessTitles.has(`${runner.id}/${entry.game}`)) continue;
    const challenge = entry.challenges[0];
    for (const mode of ["short", "full"]) {
      for (const patch of [
        { title: (challenge.title || "") + " changed" },
        { restrictions: (challenge.restrictions || "") + " changed" },
        { proof: "https://example.com/new-proof" },
      ]) {
        const changed = { ...entry, challenges: [{ ...challenge, ...patch }] };
        assert.equal(render(current, runner, changed, mode), render(previous, runner, changed, mode));
      }
      const otherRunner = { ...runner, id: "different-runner" };
      assert.equal(render(current, otherRunner, entry, mode), render(previous, otherRunner, entry, mode));
      for (const patch of [{ game: "sekiro" }, { role: "hitless-scholar" }]) {
        const changed = { ...entry, ...patch };
        assert.equal(render(current, runner, changed, mode), render(previous, runner, changed, mode));
      }
      const extra = { ...challenge, proof: "https://example.com/second-proof" };
      const pair = { ...entry, challenges: [challenge, extra] };
      const html = render(current, runner, pair, mode);
      assert(html.includes(render(current, runner, entry, mode).match(/<li>.*?<\/li>/s)[0]));
      assert(html.includes(render(previous, runner, { ...entry, challenges: [extra] }, mode).match(/<li>.*?<\/li>/s)[0]));
      assert.equal((html.match(/<li>/g) || []).length, 2);
    }
  }
});

// Runs that show unlinked extra restrictions under their proof-linked title.
const expectedExtras = new Map([
  ["recycle/er/hitless-sage", { title: "RL1 All Great Runes +0", extras: ["No Talismans", "No Auxiliary Damage", "No Status Effects"] }],
  ["zeldasouls/ds1/grandmaster", { title: "SL1 NG+6 +0 Weapon No Rolling/Blocking/Parrying/Auxiliary Effects", extras: ["No Sprint"] }],
]);

test("structured Hitless fields and approved runs show extra restrictions, on all four surfaces", async () => {
  const { current } = await sekiroRenderingFixture();
  const expectedByEntry = new Map(expectedExtras);
  for (const runner of current.cat.runners) for (const entry of runner.games) {
    const challenge = entry.challenges[0];
    if (current.cat.role(entry.role).track === "nohit" && challenge?.title && challenge?.restrictions) {
      expectedByEntry.set(`${runner.id}/${entry.game}/${entry.role}`, {
        title: challenge.title, extras: [current.api.escapeHtml(challenge.restrictions)]
      });
    }
  }
  // Directory and Verified Runs share the default options; Profile and Hall of Fame use full mode.
  const surfaces = [{}, { challengeMode: "full", sortCompleted: true, head: false }, { challengeMode: "full", sortCompleted: true, showGame: false }];
  const shown = new Map();
  for (const runner of current.cat.runners) for (const entry of runner.games) for (const opts of surfaces) {
    const html = current.api.runnerCard(current.cat, runner, [entry], opts);
    if (current.cat.role(entry.role).track !== "nohit" && !expectedExtras.has(`${runner.id}/${entry.game}/${entry.role}`)) {
      assert(!html.includes('class="challenge-extras"'), `${runner.id}/${entry.game}/${entry.role}`);
    }
    if (!html.includes('class="challenge-extras"')) continue;
    const key = `${runner.id}/${entry.game}/${entry.role}`;
    const expected = expectedByEntry.get(key);
    assert(expected, key);
    const proof = current.api.escapeHtml(entry.challenges[0].proof);
    const title = current.api.escapeHtml(expected.title).replace(/\//g, "/<wbr>");
    assert(html.includes(`<a class="challenge-link" href="${proof}" target="_blank" rel="noopener noreferrer">${title}</a>`), key);
    const extras = html.match(/<span class="challenge-extras">.*?<\/span><\/span><\/span>/s)[0];
    assert(!extras.includes("<a"));
    assert.deepEqual([...extras.matchAll(/role="listitem">(.*?)</g)].map(m => m[1]), expected.extras);
    shown.set(key, (shown.get(key) || 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(shown), Object.fromEntries([...expectedByEntry.keys()].map(k => [k, surfaces.length])));
});

test("confirmed extras display without exposing other normal tier restrictions or changing data", async () => {
  const { current, original, render } = await sekiroRenderingFixture();
  const runner = current.cat.runners.find(r => r.id === "zeldasouls");
  const entry = runner.games.find(e => e.game === "ds1" && e.role === "grandmaster");
  const before = JSON.stringify(entry);
  for (const mode of ["short", "full"]) {
    const html = render(current, runner, entry, mode);
    // Same title and proof as before; only the extra restriction is added beneath it.
    assert.equal(html.replace(/<span class="challenge-extras">.*?<\/span><\/span><\/span>/s, ""), render(original, runner, entry, mode));
    assert(html.includes('role="listitem">No Sprint</span>'));
    const challenge = entry.challenges[0];
    for (const changed of [
      { ...entry, challenges: [{ ...challenge, title: challenge.title + " changed" }] },
      { ...entry, challenges: [{ ...challenge, restrictions: "SL1 NG+6 No Sprint" }] },
      { ...entry, challenges: [{ ...challenge, proof: "https://example.com/other-proof" }] },
      { ...entry, role: "elitemaster" },
    ]) assert(!render(current, runner, changed, mode).includes("challenge-extras"));
    assert(!render(current, { ...runner, id: "other-runner" }, entry, mode).includes("challenge-extras"));
  }
  assert.equal(JSON.stringify(entry), before);
});

test("renamed runner keeps their data, old links resolve and imports reach the same record", () => {
  const data = JSON.parse(fs.readFileSync(require.resolve("../data/runners.json"), "utf8"));
  const runner = data.runners.find(r => r.id === "jonglesnorp");
  assert.equal(runner.name, "lord stupid idiot poop fuck");
  assert.deepEqual(runner.formerIds, ["roberto"]);
  assert.equal(runner.avatar, "assets/runners/roberto.png");
  assert.equal(runner.profile, "https://www.youtube.com/@jonglesnorp/featured");
  assert.deepEqual(runner.games[0], { game: "sekiro", role: "hitless-scholar", challenges: [{
    title: "Shura Ending", restrictions: "No Kuro's Charm",
    proof: "https://youtu.be/W62u3DBqVQI", completedAt: "2026-09-28" }] });
  assert.deepEqual(runner.games[1], { game: "ds3", role: "master", addedAt: "2026-10-14T10:03:11Z", challenges: [{
    title: "SL1 NG+7 No Rolling/Blocking/Parrying", restrictions: "SL1 NG+7 No Roll/Block/Parry",
    proof: "https://www.youtube.com/playlist?list=PLJMEYBql88d0", completedAt: "2026-10-01" }] });
  assert.equal(runner.games.length, 4);
  assert(!data.runners.some(r => r.id === "roberto"));
  // A former id may not name another runner or be claimed twice.
  const other = { ...data.runners.find(r => r.id !== runner.id) };
  assert.throws(() => validateRunners({ runners: [runner, { ...other, formerIds: [runner.id] }] }), /already in use/);
  assert.throws(() => validateRunners({ runners: [runner, { ...other, formerIds: ["roberto"] }] }), /already in use/);
  // The tracker's Discord username matches the new id, so a re-import updates this runner.
  const merged = mergeRun(data, [row({ runnerName: "jonglesnorp", gameId: "sekiro", roleId: "hitless-scholar", restrictions: "", proof: "" })], {}, now).runners;
  assert.equal(merged.runners.length, data.runners.length);
  assert.deepEqual(merged.runners.find(r => r.id === "jonglesnorp").formerIds, ["roberto"]);
});

test("UnholyPancake's DeS Elite Master shows the official No Sprinting title with no extra restrictions", async () => {
  const { current, render } = await sekiroRenderingFixture();
  const title = "SL1 NG+5 PBWT No Sprinting/Rolling/Blocking/Parrying";
  assert(current.cat.officialTitles("des", "elitemaster").has(title));
  const runner = current.cat.runners.find(r => r.id === "unholypancake");
  const entry = runner.games.find(e => e.game === "des" && e.role === "elitemaster");
  const before = JSON.stringify(runner);
  for (const mode of ["short", "full"]) {
    const html = render(current, runner, entry, mode);
    const proof = current.api.escapeHtml(entry.challenges[0].proof);
    assert(html.includes(`href="${proof}" target="_blank" rel="noopener noreferrer">${current.api.escapeHtml(title).replace(/\//g, "/<wbr>")}</a></li>`));
    assert(!html.includes("challenge-extras"));
  }
  assert.equal(JSON.stringify(runner), before);
  assert.equal(entry.challenges[0].title, "SL1 NG+5 PBWT +0 No Rolling/Blocking/Parrying");
});


test("jonglesnorp's confirmed Sekiro Master title renders on Home and profile with its original metadata", async () => {
  const { current } = await sekiroRenderingFixture();
  const runner = current.cat.runners.find(r => r.id === "jonglesnorp");
  const entry = runner.games.find(e => e.game === "sekiro" && e.role === "master");
  assert.equal(entry.challenges.length, 1);
  const title = "Attack Power 1 + No Prosthetic Tools + No Items/Buffs";
  assert.equal(entry.challenges[0].title, title);
  assert.equal(entry.role, "master");
  assert.equal(entry.addedAt, "2026-10-15T11:09:37Z");
  assert.equal(runner.addedAt, "2026-09-28");
  assert.equal(entry.challenges[0].proof, "https://www.youtube.com/playlist?list=PLVSresNA4CEiJH1-awHdwF-ByYY8kIvq9");
  assert(current.cat.officialTitles("sekiro", "master").has("Attack Power 1"));
  for (const phrase of ["No Prosthetic Tools", "No Items/Buffs"]) {
    assert(current.cat.officialTitles("sekiro", "legend").has(phrase));
  }
  assert.equal(entry.challenges[0].restrictions, undefined);
  assert.equal(entry.challenges[0].completedAt, "2026-03-08");
  const before = JSON.stringify(runner);
  for (const opts of [{ background: true }, { challengeMode: "full", sortCompleted: true, head: false, showGame: false }]) {
    const html = current.api.runnerCard(current.cat, runner, [entry], opts);
    assert(html.includes('href="' + entry.challenges[0].proof + '" target="_blank" rel="noopener noreferrer">' + title.replace(/\//g, "/<wbr>") + '</a>'));
    assert(html.includes("challenge-list"));
    assert(!html.includes("challenge-extras"));
    assert(!html.includes("Pending"));
    assert(html.includes("tier-master"));
  }
  assert.equal(current.cat.entries().sort(current.cat.compareVerifiedEntry)[0].entry,
    current.cat.runners.find(r => r.id === "acacia-vix").games.find(e => e.game === "ds2" && e.role === "master"));
  assert.equal(current.cat.entryCompletedAt(entry), "2026-03-08");
  assert.equal(JSON.stringify(runner), before);
});
