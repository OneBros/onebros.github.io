/* OneBros - game page script
 * One renderer for every game. Reads ?game=<id>, then loads
 * data/games.json, data/runners.json and data/games/<id>.json.
 * Depends on shared.js.
 */
(function () {
  "use strict";

  const {
    PATHS,
    $,
    escapeHtml,
    slugify,
    safeUrl,
    plainText,
    listHtml,
    contentHtml,
    loadJson,
    loadCatalog,
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

  let staffPeople = [];

  function sectionHtml({ id, eyebrow, title, lead = "", body, alt }) {
    return `
      <section class="section${alt ? " section-alt" : ""}"
               id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">
        <div class="container">
          <header class="section-head">
            ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
            <h2 id="${escapeHtml(id)}-title" class="section-title">${escapeHtml(title)}</h2>
            ${lead ? `<p class="section-lead">${lead}</p>` : ""}
          </header>
          ${body}
        </div>
      </section>`;
  }

  // A tier's challenge variants, listed in full inside its rule card.
  function cardChallengesHtml(title, challenges) {
    if (!challenges || !challenges.length) return "";
    return `
      <h4 class="subhead">${escapeHtml(title || "Challenges")}</h4>
      <ul class="card-challenges">
        ${challenges
          .map(
            (c) => `
          <li>
            <strong class="card-challenge-title">${escapeHtml(plainText(c.title))}</strong>
            ${listHtml(c.items)}
          </li>`
          )
          .join("")}
      </ul>`;
  }

  // One rule card: every piece of a role's rules, shown once. A collapsible panel like the
  // General Rules: collapsed unless a direct #anchor targets it.
  function ruleCardHtml({ id, cls, label, title, body, open }) {
    return `
      <details class="rule-panel rule-card is-tier ${cls}" id="${escapeHtml(id)}"${open ? " open" : ""}>
        <summary>
          <span class="rule-panel-heading">
            <span class="tier-label">${escapeHtml(label)}</span>
            <span class="rule-panel-title">${escapeHtml(title)}</span>
          </span>
          <span class="rule-panel-icon" aria-hidden="true"></span>
        </summary>
        <div class="rule-panel-body"><div class="rule-card-body">${body}</div></div>
      </details>`;
  }

  function hallOfFameGroupHtml(catalog, game, role, entries) {
    return `
      <div class="hof-group tier-${escapeHtml(role.id)}">
        <h3 class="hof-group-title">
          <span class="tier-dot" aria-hidden="true"></span>
          ${escapeHtml(catalog.roleName(game.id, role.id))}
          <span class="hof-count">${entries.length}</span>
        </h3>
        <div class="runners-grid">
          ${entries
            .map(({ runner, entry }) =>
              runnerCard(catalog, withStaffIdentity(runner, staffForRunner(staffPeople, runner)), [entry], {
                challengeMode: "full",
              })
            )
            .join("")}
        </div>
      </div>`;
  }

  const sameName = (a, b) => String(a).replace(/\s+/g, "").toLowerCase() === String(b).replace(/\s+/g, "").toLowerCase();

  /**
   * @param catalog  result of loadCatalog()
   * @param game     game object from games.json
   * @param rules    data/games/<id>.json
   */
  function buildPage(catalog, game, rules) {
    // One entry per OneBros tier the game defines, in progression order.
    const tierSections = (rules.tiers || []).map((t) => {
      const role = catalog.role(t.role) || { name: t.role, rank: 0 };
      const name = catalog.roleName(game.id, t.role);
      // "Tier 3 · Master" — the default role name is only repeated when the game renames it.
      const label = sameName(name, role.name) ? `Tier ${role.rank}` : `Tier ${role.rank} · ${role.name}`;
      return { ...t, name, label, id: slugify(name) };
    });

    // No Hit is a separate track (Team Hitless ruleset), never ranked against the OneBros tiers.
    const noHitTrack = catalog.track("nohit") || { name: "No Hit" };
    const noHit = rules.noHit
      ? {
          id: "no-hit",
          name: noHitTrack.name,
          label: `Separate track${noHitTrack.ruleset ? ` · ${noHitTrack.ruleset}` : ""}`,
          content: rules.noHit.content || [],
          roles: (rules.noHit.roles || []).map((r) => ({ ...r, name: catalog.roleName(game.id, r.role) })),
        }
      : null;

    const gameEntries = catalog.entries().filter(({ entry }) => entry.game === game.id);
    const sections = [];

    /* Challenge Rules — one full-content card per role; the No Hit track keeps its own card */
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const tierCards = tierSections.map((t) =>
      ruleCardHtml({
        id: t.id,
        cls: `tier-${escapeHtml(t.role)}`,
        label: t.label,
        title: t.name,
        open: t.id === hash,
        body: `<div class="prose">${contentHtml(t.content)}</div>${cardChallengesHtml(t.challengesTitle, t.challenges)}`,
      })
    );
    const noHitCard = noHit
      ? ruleCardHtml({
          id: noHit.id,
          cls: "tier-nohit is-exception",
          label: noHit.label,
          title: noHit.name,
          open: noHit.id === hash,
          body: `
            <p class="card-note">Not part of the Onebros tier progression. See also the <a href="index.html#rules-no-hit">general No Hit rules</a>.</p>
            <div class="prose">${contentHtml(noHit.content)}</div>
            ${noHit.roles
              .map(
                (r) => `
              <div class="card-role tier-${escapeHtml(r.role)}">
                <h4 class="card-role-title">${escapeHtml(r.name)}</h4>
                <div class="prose">${contentHtml(r.content)}</div>
              </div>`
              )
              .join("")}`,
        })
      : "";

    sections.push({
      id: "rules",
      nav: "Challenge Rules",
      eyebrow: `${game.title} rules`,
      title: "Challenge Rules",
      lead: `${escapeHtml(game.title)}-specific rules. See also the <a href="index.html#rules">General Rules</a>.`,
      body: `
        <div class="rules-toolbar">
          <button class="link-btn" type="button" id="challenge-rules-toggle-all">Expand all</button>
        </div>
        <div class="rules-accordion">${tierCards.join("")}${noHitCard}</div>`,
    });

    /* Banned equipment / strategies */
    if (rules.restrictions) {
      const r = rules.restrictions;
      sections.push({
        id: "restrictions",
        nav: "Banned Equipment",
        eyebrow: "Equipment and strategies",
        title: r.title,
        body: `
          <div class="restriction-grid">
            ${(r.groups || [])
              .map(
                (g) => `
              <div class="restriction-group is-${escapeHtml(g.type)}">
                <h3 class="subhead">${escapeHtml(g.title)}</h3>
                ${listHtml(g.items)}
              </div>`
              )
              .join("")}
          </div>`,
      });
    }

    /* Hall of Fame — OneBros roles first (highest first), then the No Hit roles, kept apart */
    const groupsFor = (trackId) =>
      [...catalog.rolesInTrack(trackId)]
        .reverse()
        .map((role) => ({
          role,
          entries: gameEntries
            .filter(({ entry }) => entry.role === role.id)
            .sort((a, b) => catalog.compareAdded(a.runner, b.runner)),
        }))
        .filter((g) => g.entries.length);
    const mainGroups = groupsFor("onebros");
    const noHitGroups = groupsFor("nohit");

    sections.push({
      id: "hall-of-fame",
      nav: "Hall of Fame",
      eyebrow: "Verified runners",
      title: "Hall of Fame",
      // General guidance on how the Hall of Fame works — always shown.
      lead: "Click a runner to visit their channel. Click a challenge to open its proof.",
      body:
        mainGroups.length || noHitGroups.length
          ? `
          ${mainGroups.map((g) => hallOfFameGroupHtml(catalog, game, g.role, g.entries)).join("")}
          ${
            noHitGroups.length
              ? `<div class="hof-track tier-nohit">
                   <p class="rules-exception-label">${escapeHtml(noHitTrack.name)}${noHitTrack.ruleset ? ` — ${escapeHtml(noHitTrack.ruleset)}` : ""}</p>
                   ${noHitGroups.map((g) => hallOfFameGroupHtml(catalog, game, g.role, g.entries)).join("")}
                 </div>`
              : ""
          }`
          : `<p class="empty">No verified runners have been added for ${escapeHtml(game.title)} yet.</p>`,
    });

    return {
      sections,
      roleCount: tierSections.length + (noHit ? noHit.roles.length : 0),
      runnerCount: new Set(gameEntries.map((e) => e.runner.id)).size,
    };
  }

  // Decorative logo image from games.json ("logo": { src, width, height, blend }), or "" if none.
  function logoImgHtml(game, cls) {
    const logo = game.logo;
    const src = logo && safeUrl(logo.src);
    if (!src) return "";
    const size = logo.width && logo.height ? ` width="${Number(logo.width)}" height="${Number(logo.height)}"` : "";
    const blend = logo.blend === "screen" ? " blend-screen" : "";
    return `<img class="${cls}${blend}" src="${escapeHtml(src)}"${size} alt="" aria-hidden="true" decoding="async">`;
  }

  /* Cinematic cover from games.json — artwork, logo, or both:
   *   "hero": { src, width, height, alt, position? }  optional artwork, cropped to fill (object-fit: cover)
   *   "logo": { src, width, height, blend? }          optional, large and centred
   * With a logo but no artwork the cover is logo-only, on the page background (.cover--logo).
   * "position" is an optional CSS object-position (e.g. "center 35%") to keep the key part in view.
   * Returns whether a logo is shown on the cover (it is then the visible page title). */
  function renderCover(game) {
    const hero = game.hero;
    const src = hero && safeUrl(hero.src);
    const logo = logoImgHtml(game, "cover-logo");
    if (!src && !logo) return false;
    const size = src && hero.width && hero.height ? ` width="${Number(hero.width)}" height="${Number(hero.height)}"` : "";
    const position = src && /^[\w\s.%-]+$/.test(hero.position || "") ? ` style="object-position: ${hero.position}"` : "";
    const cover = $("#game-cover");
    cover.classList.toggle("cover--logo", !src);
    cover.innerHTML = `
      ${src ? `<img class="cover-img" src="${escapeHtml(src)}"${size}${position} alt="${escapeHtml(hero.alt || "")}" fetchpriority="high" decoding="async">` : ""}
      ${logo}`;
    cover.hidden = false;
    $("#overview").classList.add("has-cover");
    return Boolean(logo);
  }

  // Optional full-page artwork from games.json ("pageBackground": { src, position? }), shown behind
  // the whole page under a dark overlay (body.has-page-bg). Nothing changes without one.
  function renderPageBackground(game) {
    const bg = game.pageBackground;
    const src = bg && safeUrl(bg.src);
    if (!src) return;
    document.body.style.setProperty("--page-bg", `url("${src}")`);
    if (/^[\w\s.%-]+$/.test(bg.position || "")) document.body.style.setProperty("--page-bg-position", bg.position);
    document.body.classList.add("has-page-bg");
  }

  // Page title. The heading text is always in the HTML for screen readers; when the logo is shown
  // on the cover it is the visible title and the heading is visually hidden.
  function titleHtml(game, logoOnCover) {
    return logoOnCover
      ? `<h1 id="game-title" class="sr-only">${escapeHtml(game.title)}</h1>`
      : `<h1 id="game-title" class="game-hero-title">${escapeHtml(game.title)}</h1>`;
  }

  // Roles are presented once, as the Challenge Rules cards; the hero only states how many challenge
  // roles the page presents (every OneBros tier plus every No Hit role) and links to the submission form.
  function renderHero(game, roleCount, runnerCount, submitRunUrl, discordUrl) {
    const actions = [
      discordUrl
        ? `<a class="btn btn-discord" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener noreferrer">${discordIcon}Join the Discord</a>`
        : "",
      submitRunUrl
        ? `<a class="btn btn-primary" href="${escapeHtml(submitRunUrl)}" target="_blank" rel="noopener noreferrer">Submit a run</a>`
        : "",
    ].join("");
    document.title = `Onebros - ${game.title}`;
    renderPageBackground(game);
    const logoOnCover = renderCover(game);
    // Fill a fresh element: the cover appears above it in this same frame, and reusing the
    // placeholder's element would count as that element shifting down (a layout shift).
    const placeholder = $("#game-hero");
    const hero = placeholder.cloneNode(false);
    placeholder.replaceWith(hero);
    hero.innerHTML = `
      <p class="breadcrumb"><a href="index.html#games">Games</a> <span aria-hidden="true">/</span> ${escapeHtml(game.short)}</p>
      <p class="eyebrow">Challenge rules &amp; Hall of Fame</p>
      ${titleHtml(game, logoOnCover)}
      ${game.subtitle ? `<p class="hero-lead">${escapeHtml(game.subtitle)}</p>` : ""}
      <div class="game-overview">
        <dl class="hero-stats">
          <div class="stat"><dt>Verified runners</dt><dd>${runnerCount}</dd></div>
          <div class="stat"><dt>Challenge roles</dt><dd>${roleCount}</dd></div>
        </dl>
        ${actions ? `<div class="game-actions">${actions}</div>` : ""}
      </div>`;
  }

  function renderSectionNav(sections) {
    const nav = $("#section-nav");
    $("#section-nav-list").innerHTML = sections
      .map((s) => `<li><a href="#${escapeHtml(s.id)}" data-section="${escapeHtml(s.id)}">${escapeHtml(s.nav)}</a></li>`)
      .join("");
    nav.hidden = false;

    // Highlight the section currently in view.
    const list = $("#section-nav-list");
    const links = new Map([...nav.querySelectorAll("[data-section]")].map((a) => [a.dataset.section, a]));
    const setActive = (id) => {
      links.forEach((a, key) => {
        if (key === id) {
          a.setAttribute("aria-current", "true");
          // Keep the active link visible on narrow screens (horizontal scroll only).
          const li = a.parentElement;
          if (li.offsetLeft < list.scrollLeft || li.offsetLeft + li.offsetWidth > list.scrollLeft + list.clientWidth) {
            list.scrollLeft = li.offsetLeft - 16;
          }
        } else {
          a.removeAttribute("aria-current");
        }
      });
    };
    const observer = new IntersectionObserver(
      (items) => {
        const visible = items.filter((i) => i.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-35% 0px -60% 0px" }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
  }

  function renderNotFound(message, catalog) {
    document.title = "Onebros - Game not found";
    const published = catalog
      ? catalog.games.filter((g) => catalog.gamePageUrl(g.id))
      : [];
    const picker = published.length
      ? `<div class="hero-actions">${published
          .map(
            (g) =>
              `<a class="btn btn-ghost" href="${escapeHtml(catalog.gamePageUrl(g.id))}">${escapeHtml(g.title)}</a>`
          )
          .join("")}</div>`
      : `<div class="hero-actions"><a class="btn btn-primary" href="index.html#games">Back to all games</a></div>`;
    $("#game-hero").innerHTML = `
      <p class="breadcrumb"><a href="index.html#games">Games</a></p>
      <h1 id="game-title" class="game-hero-title">Page not available</h1>
      <p class="hero-lead">${message}</p>
      ${picker}`;
  }

  async function init() {
    initChrome();
    const content = $("#game-content");
    bindAvatarFallback(content);

    const gameId =
      new URLSearchParams(window.location.search).get("game") ||
      new URLSearchParams(window.location.hash.replace(/^#/, "")).get("game") ||
      "";

    let catalog;
    try {
      catalog = await loadCatalog();
      staffPeople = ((await loadJson(PATHS.staff).catch(() => null)) || {}).staff || [];
    } catch (err) {
      console.error(err);
      $("#game-hero").innerHTML = loadErrorHtml();
      return;
    }
    initGamesMenu(catalog, gameId);

    const game = catalog.game(gameId);
    if (!game || !game.page) {
      renderNotFound(
        game
          ? `The ${escapeHtml(game.title)} page hasn't been published yet.`
          : gameId
            ? "We couldn't find that game."
            : "Choose a game to view its rules and Hall of Fame.",
        catalog
      );
      return;
    }

    let rules;
    try {
      rules = await loadJson(PATHS.gameRules(game.id));
    } catch (err) {
      console.error(err);
      $("#game-hero").innerHTML = loadErrorHtml();
      return;
    }

    const { sections, roleCount, runnerCount } = buildPage(catalog, game, rules);
    renderHero(game, roleCount, runnerCount, catalog.submitRunUrl, catalog.discordUrl);
    content.innerHTML = sections.map((s, i) => sectionHtml({ ...s, alt: i % 2 === 0 })).join("");
    initPanelToggle($("#challenge-rules-toggle-all"), () => [...document.querySelectorAll("#rules .rule-panel")]);
    renderSectionNav([{ id: "overview", nav: "Overview" }, ...sections]);

    // Jump to a section #hash after rendering. Ignore the #game=<id> routing hash.
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && !hash.startsWith("game=")) {
      const target = document.getElementById(hash);
      if (target) target.scrollIntoView();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
