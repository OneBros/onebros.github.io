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
    const total = catalog.runners.length;

    if (!total) {
      countEl.textContent = "";
      grid.innerHTML = `<p class="empty">No verified runners have been added yet.</p>`;
      return;
    }

    const runners = catalog.runners
      .filter((runner) => {
        if (!query) return true;
        const person = staffForRunner(staffPeople, runner);
        const shown = withStaffIdentity(runner, person);
        return [shown.name, runner.name, runner.id, person && person.username]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort(catalog.compareRunnerCompleted);

    const word = total === 1 ? "runner" : "runners";
    countEl.textContent = query ? `${runners.length} of ${total} verified ${word}` : `${total} verified ${word}`;
    grid.innerHTML = runners.length
      ? runners
          .map((runner) => {
            const shown = withStaffIdentity(runner, staffForRunner(staffPeople, runner));
            return runnerCard(catalog, shown, shown.games || [], { background: true });
          })
          .join("")
      : `<p class="empty">No runners match this search.</p>`;
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
    renderRunners();
    $("#filter-search").addEventListener("input", renderRunners);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
