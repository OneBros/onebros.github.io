/* OneBros - runners page
 * Lists every verified runner from data/runners.json through the shared catalog: one runner card
 * each (picture, name and every role they hold). The picture and name open the runner page.
 * Order is each runner's newest completedAt first. Depends on shared.js.
 */
(function () {
  "use strict";

  const {
    PATHS,
    $,
    loadJson,
    loadCatalog,
    populateRunnerFilters,
    runnerCard,
    staffForRunner,
    withStaffIdentity,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    loadErrorHtml,
  } = window.OneBros;

  let catalog;
  let staffPeople = [];

  function renderRunners() {
    const grid = $("#runners-grid");
    const countEl = $("#results-count");
    const query = $("#filter-search").value.trim().toLowerCase();
    const game = $("#filter-game").value;
    const role = $("#filter-role").value;
    const filtering = Boolean(query || game || role);
    const total = catalog.runners.length;

    if (!total) {
      countEl.textContent = "";
      grid.innerHTML = `<p class="empty">No verified runners have been added yet.</p>`;
      return;
    }

    const runners = catalog.runners
      .filter((runner) => {
        // Both dropdowns must match the same recognized game/role entry.
        if ((game || role) && !(runner.games || []).some(entry =>
          (!game || entry.game === game) && (!role || entry.role === role))) return false;
        if (!query) return true;
        const person = staffForRunner(staffPeople, runner);
        const shown = withStaffIdentity(runner, person);
        return [shown.name, runner.name, runner.id, person && person.username]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort(catalog.compareRunnerCompleted);

    const word = total === 1 ? "runner" : "runners";
    countEl.textContent = filtering ? `${runners.length} of ${total} verified ${word}` : `${total} verified ${word}`;
    grid.innerHTML = runners.length
      ? runners
          .map((runner) => {
            const shown = withStaffIdentity(runner, staffForRunner(staffPeople, runner));
            return runnerCard(catalog, shown, shown.games || [], { background: true, profileOrder: true });
          })
          .join("")
      : `<p class="empty">No runners match these filters.</p>`;
  }

  async function init() {
    initChrome();
    bindAvatarFallback($("#runners-grid"));

    try {
      catalog = await loadCatalog();
      staffPeople = ((await loadJson(PATHS.staff).catch(() => null)) || {}).staff || [];
    } catch (err) {
      console.error(err);
      $("#runners-grid").innerHTML = loadErrorHtml();
      return;
    }
    initGamesMenu(catalog);
    populateRunnerFilters(catalog);
    renderRunners();
    $("#filter-search").addEventListener("input", renderRunners);
    $("#filter-game").addEventListener("change", renderRunners);
    $("#filter-role").addEventListener("change", renderRunners);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
