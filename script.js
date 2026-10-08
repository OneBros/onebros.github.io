/* OneBros - homepage script
 * Renders the Games, Verified Runs and General Rules sections from
 * data/games.json, data/runners.json and data/rules.json. Depends on shared.js.
 */
(function () {
  "use strict";

  const {
    PATHS,
    $,
    escapeHtml,
    cardBackgroundStyle,
    loadJson,
    loadCatalog,
    rulePanelHtml,
    runnerCard,
    staffForRunner,
    withStaffIdentity,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    initPanelToggle,
    loadErrorHtml,
    discordIcon,
  } = window.OneBros;

  let catalog;
  let staffPeople = [];

  const HOMEPAGE_RECENT_RUNS = 10;

  function renderStats() {
    const challengeCount = catalog.completionCount();
    const set = (key, value) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    };
    set("runners", catalog.runners.length);
    set("runs", challengeCount);
    set("games", catalog.games.length);
  }

  // "Submit a run" and "Join the Discord" link to the URLs in games.json; each stays hidden without one.
  function renderHeroLinks() {
    const show = (sel, url) => {
      if (!url) return;
      const link = $(sel);
      link.href = url;
      link.hidden = false;
    };
    show("#submit-run", catalog.submitRunUrl);
    show("#discord-link", catalog.discordUrl);
    if (catalog.discordUrl) $("#discord-link").insertAdjacentHTML("afterbegin", discordIcon);
  }

  function renderGames() {
    $("#games-grid").innerHTML = catalog.games
      .map((game) => {
        const runnerCount = new Set(
          catalog.entries().filter(({ entry }) => entry.game === game.id).map(({ runner }) => runner.id)
        ).size;
        const url = catalog.gamePageUrl(game.id);

        const body = `
          <div class="game-card-top">
            <span class="game-short">${escapeHtml(game.short)}</span>
            <span class="game-year">${escapeHtml(game.year)}</span>
          </div>
          <h3 class="game-title">${escapeHtml(game.title)}</h3>
          ${game.subtitle ? `<p class="game-subtitle">${escapeHtml(game.subtitle)}</p>` : ""}
          <p class="game-meta">
            ${
              url
                ? `<span><strong>${runnerCount}</strong> verified runner${runnerCount === 1 ? "" : "s"}</span>
                   <span class="game-cta">Rules &amp; Hall of Fame →</span>`
                : `<span class="soon-tag">Page coming soon</span>`
            }
          </p>`;

        const bg = cardBackgroundStyle(game);
        const cls = `game-card${bg ? " has-bg" : ""}`;
        return url
          ? `<a class="${cls} is-link" href="${escapeHtml(url)}"${bg}>${body}</a>`
          : `<article class="${cls} is-soon" aria-disabled="true"${bg}>${body}</article>`;
      })
      .join("");
  }

  /* ---------- General rules (data/rules.json) ---------- */

  async function renderRules() {
    const accordion = $("#rules-accordion");
    const exception = $("#rules-exception");
    let data;
    try {
      data = await loadJson(PATHS.generalRules);
    } catch (err) {
      console.error(err);
      accordion.innerHTML = loadErrorHtml();
      return;
    }

    // Exception rulesets (No Hit) are shown apart from the regular OneBros rules.
    const regular = (data.sections || []).filter((s) => !s.exception);
    const exceptions = (data.sections || []).filter((s) => s.exception);
    const hash = decodeURIComponent(window.location.hash.slice(1));

    // All panels start collapsed; only a panel targeted by a direct #anchor opens.
    accordion.innerHTML = regular.map((s) => rulePanelHtml(s, s.id === hash)).join("");
    exception.innerHTML = exceptions.length
      ? `<p class="rules-exception-label">Exception — not covered by the rules above</p>
         ${exceptions.map((s) => rulePanelHtml(s, s.id === hash)).join("")}`
      : "";

    initPanelToggle($("#rules-toggle-all"), () => [...document.querySelectorAll("#rules .rule-panel")]);
  }

  function populateFilters() {
    $("#filter-game").insertAdjacentHTML(
      "beforeend",
      catalog.games.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.title)}</option>`).join("")
    );
    // One option group per track, so No Hit roles stay separate from OneBros roles.
    $("#filter-role").insertAdjacentHTML(
      "beforeend",
      catalog.tracks
        .map(
          (track) => `
        <optgroup label="${escapeHtml(track.name)}">
          ${catalog
            .rolesInTrack(track.id)
            .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`)
            .join("")}
        </optgroup>`
        )
        .join("")
    );
  }

  function renderRunners() {
    const grid = $("#runners-grid");
    const query = $("#filter-search").value.trim().toLowerCase();
    const game = $("#filter-game").value;
    const role = $("#filter-role").value;

    const matchesEntry = (entry) => (!game || entry.game === game) && (!role || entry.role === role);
    const filtering = Boolean(query || game || role);

    const totalRunners = catalog.runners.length;
    const totalRuns = catalog.entries().length;

    let pairs = catalog
      .entries()
      .filter(({ runner, entry }) => {
        if (query) {
          const person = staffForRunner(staffPeople, runner);
          const shown = withStaffIdentity(runner, person);
          const matchesName = [shown.name, runner.name, runner.id, person && person.username].some((value) =>
            String(value || "").toLowerCase().includes(query)
          );
          if (!matchesName) return false;
        }
        return matchesEntry(entry);
      })
      // A game filter lists that game's runs by tier; otherwise newest added first.
      .sort(game ? catalog.compareTierCompleted : catalog.compareVerifiedEntry);

    const countEl = $("#results-count");
    if (!totalRunners) {
      countEl.textContent = "";
      grid.innerHTML = `<p class="empty">No verified runs have been added yet.</p>`;
      return;
    }
    if (!pairs.length) {
      countEl.textContent = filtering
        ? `0 of ${totalRuns} verified run${totalRuns === 1 ? "" : "s"}`
        : "";
      grid.innerHTML = `<p class="empty">No runs match these filters.</p>`;
      return;
    }

    if (!filtering) {
      pairs = pairs.slice(0, HOMEPAGE_RECENT_RUNS);
      countEl.textContent = `Showing ${pairs.length} most recent of ${totalRuns} verified run${totalRuns === 1 ? "" : "s"} · ${totalRunners} runner${totalRunners === 1 ? "" : "s"}`;
    } else {
      countEl.textContent = `${pairs.length} of ${totalRuns} verified run${totalRuns === 1 ? "" : "s"}`;
    }

    grid.innerHTML = pairs
      .map(({ runner, entry }) =>
        runnerCard(catalog, withStaffIdentity(runner, staffForRunner(staffPeople, runner)), [entry], {
          highlight: filtering ? matchesEntry : undefined,
          background: true,
        })
      )
      .join("");
  }

  // A direct #anchor (e.g. #rules-no-hit) points into content rendered from JSON. Scroll to it
  // only once every section above it has rendered, so later content can't push it out of view.
  function scrollToHash() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const target = hash && document.getElementById(hash);
    if (target) target.scrollIntoView();
  }

  async function init() {
    initChrome();
    const rulesReady = renderRules();
    bindAvatarFallback($("#runners-grid"));

    try {
      catalog = await loadCatalog();
      staffPeople = ((await loadJson(PATHS.staff).catch(() => null)) || {}).staff || [];
      initGamesMenu(catalog);
      renderStats();
      renderHeroLinks();
      renderGames();
      populateFilters();
      renderRunners();

      $("#filter-search").addEventListener("input", renderRunners);
      $("#filter-game").addEventListener("change", renderRunners);
      $("#filter-role").addEventListener("change", renderRunners);
    } catch (err) {
      console.error(err);
      ["#games-grid", "#runners-grid"].forEach((sel) => ($(sel).innerHTML = loadErrorHtml()));
    }

    await rulesReady;
    scrollToHash();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
