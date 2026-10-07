/* OneBros - shared helpers and components
 * Used by the homepage (script.js), game pages (game.js), the runners list (runners.js)
 * and runner pages (runner.js).
 * Exposes a single global: window.OneBros
 */
(function () {
  "use strict";

  const PATHS = {
    games: "data/games.json",
    runners: "data/runners.json",
    generalRules: "data/rules.json",
    staff: "data/staff.json",
    gameRules: (id) => `data/games/${encodeURIComponent(id)}.json`,
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Only allow http(s) links coming from the data files.
  function safeUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-");
  }

  /* ---------- Rule text rendering ---------- */

  // Rule text: escaped, with **double asterisks** rendered as bold (the only markup supported).
  function inlineHtml(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // Rule text with the ** markers removed (for places that are already emphasised, e.g. headings).
  function plainText(text) {
    return String(text ?? "").replace(/\*\*(.+?)\*\*/g, "$1");
  }

  // List items are either a string or { text, items: [...] } for nested lists.
  function listHtml(items, cls = "rule-items") {
    if (!items || !items.length) return "";
    return `<ul class="${cls}">${items
      .map((item) =>
        typeof item === "string"
          ? `<li>${inlineHtml(item)}</li>`
          : `<li>${inlineHtml(item.text)}${listHtml(item.items)}</li>`
      )
      .join("")}</ul>`;
  }

  /* Content blocks:
   *   "text"                     paragraph
   *   { list: [...] }            bullet list
   *   { note, text }             callout
   *   { label, text, url }       external link, e.g. a proof example (opens in a new tab)
   */
  function contentHtml(blocks) {
    return (blocks || [])
      .map((block) => {
        if (typeof block === "string") return `<p>${inlineHtml(block)}</p>`;
        if (block.list) return listHtml(block.list);
        if (block.note) {
          return `<p class="rule-note"><strong>${escapeHtml(block.note)}</strong> ${inlineHtml(block.text)}</p>`;
        }
        if (block.url) {
          const url = safeUrl(block.url);
          const text = escapeHtml(block.text || block.url);
          return `<p class="rule-link">${block.label ? `<strong>${escapeHtml(block.label)}</strong> ` : ""}${
            url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text} ↗</a>` : text
          }</p>`;
        }
        return "";
      })
      .join("");
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- Catalog (games + roles + runners) ---------- */

  // ?runner= is the GitHub Pages link; the hash keeps the id when a local
  // static server rewrites the URL and drops the query.
  function runnerPageUrl(runnerId) {
    const id = encodeURIComponent(runnerId);
    return `runner.html?runner=${id}#runner=${id}`;
  }

  // Roles come in two separate tracks:
  //   "onebros" — Champion, Legend, Master, Elite Master, Grand Master (OneBros rules)
  //   "nohit"   — Hitless Scholar, Hitless Sage (Team Hitless ruleset)
  // Ranks only compare roles within the same track (except effectiveLevel, below).
  const HITLESS_LEVEL_ROLE = "legend"; // No Hit roles count as this Onebros role's level

  function createCatalog(gameData, runnerData) {
    const tracks = gameData.tracks || [];
    const trackOrder = new Map(tracks.map((t, i) => [t.id, i]));
    const roles = [...(gameData.roles || [])].sort(
      (a, b) => (trackOrder.get(a.track) ?? 99) - (trackOrder.get(b.track) ?? 99) || a.rank - b.rank
    );
    const games = gameData.games || [];
    const runners = runnerData.runners || [];
    const gamesById = new Map(games.map((g) => [g.id, g]));
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const runnerIndex = new Map(runners.map((r, i) => [r, i])); // position in runners.json
    const gameIndex = new Map(games.map((g, i) => [g.id, i])); // position in games.json

    const catalog = {
      tracks,
      roles,
      games,
      runners,
      submitRunUrl: safeUrl(gameData.submitRunUrl), // Run Submissions Form, shared by every game
      discordUrl: safeUrl(gameData.discordUrl), // Community Discord invite; its buttons stay hidden without one
      game: (id) => gamesById.get(id),
      role: (id) => rolesById.get(id),
      track: (id) => tracksById.get(id),
      rolesInTrack: (trackId) => roles.filter((r) => r.track === trackId),

      // Game-specific role name (e.g. "Old One"), falling back to the default (e.g. "Master").
      roleName(gameId, roleId) {
        const game = gamesById.get(gameId);
        const custom = game && game.roleNames && game.roleNames[roleId];
        if (custom) return custom;
        const role = rolesById.get(roleId);
        return role ? role.name : roleId;
      },

      // Sort key: every OneBros role above every No Hit role, higher rank first within a track.
      roleSortKey(roleId) {
        const role = rolesById.get(roleId);
        if (!role) return 0;
        return (tracks.length - (trackOrder.get(role.track) ?? tracks.length)) * 100 + role.rank;
      },

      // Highest role first (roleSortKey); equal roles follow games.json order, unknown games last.
      compareEntryTier(a, b) {
        return (
          catalog.roleSortKey(b.role) - catalog.roleSortKey(a.role) ||
          (gameIndex.get(a.game) ?? games.length) - (gameIndex.get(b.game) ?? games.length)
        );
      },

      /* Effective Onebros level, used to pick a runner's top entry (runner page hero artwork).
       * An SL1/BL4 Hitless role counts as Legend-level: above Champion, below Legend.
       *   Champion < Hitless Scholar < Hitless Sage < Legend < Master < Elite Master < Grand Master
       * Onebros roles are rank * 10; No Hit roles sit just under the Legend rank, ordered by their own rank. */
      effectiveLevel(roleId) {
        const role = rolesById.get(roleId);
        if (!role) return 0;
        if (role.track !== "nohit") return role.rank * 10;
        const legend = rolesById.get(HITLESS_LEVEL_ROLE);
        return (legend ? legend.rank : 2) * 10 - 5 + role.rank;
      },

      // Highest effectiveLevel first; equal levels follow games.json order, unknown games last.
      compareEntryLevel(a, b) {
        return (
          catalog.effectiveLevel(b.role) - catalog.effectiveLevel(a.role) ||
          (gameIndex.get(a.game) ?? games.length) - (gameIndex.get(b.game) ?? games.length)
        );
      },

      // The highest of these entries by compareEntryLevel (default: all of a runner's), or null.
      // Picks the artwork behind runner cards and the runner page hero.
      topEntry(runner, entries = runner.games || []) {
        return [...entries].sort(catalog.compareEntryLevel)[0] || null;
      },

      gamePageUrl(gameId) {
        const game = gamesById.get(gameId);
        if (!game || !game.page) return "";
        // Keep ?game= for GitHub Pages. Also put the id in the hash so local
        // static servers that rewrite game.html → /game (and drop the query) still work.
        const id = encodeURIComponent(game.id);
        return `game.html?game=${id}#game=${id}`;
      },

      runnerPageUrl,

      // Every { runner, entry } pair, where entry = one role a runner holds in one game.
      entries() {
        return runners.flatMap((runner) => (runner.games || []).map((entry) => ({ runner, entry })));
      },

      /** When this game/role entry was added to the site: the entry's own addedAt, else the runner's.
       * completedAt is never used here, so verified historical runs still show as recent additions. */
      entryVerifiedAt(entry, runner) {
        return entry.addedAt || runner.addedAt || "";
      },

      compareVerifiedEntry(a, b) {
        const da = catalog.entryVerifiedAt(a.entry, a.runner);
        const db = catalog.entryVerifiedAt(b.entry, b.runner);
        if (da !== db) return da < db ? 1 : -1;
        return runnerIndex.get(b.runner) - runnerIndex.get(a.runner);
      },

      /** When a game/role entry was completed: the newest completedAt among its challenges, or "". */
      entryCompletedAt(entry) {
        return (entry.challenges || []).reduce((latest, c) => (c.completedAt > latest ? c.completedAt : latest), "");
      },

      /* Order within one game (homepage game filter):
       *   1. role, highest first: Grand Master … Champion, then Hitless Sage, Hitless Scholar (roleSortKey)
       *   2. completedAt, descending; entries without one come after those with one
       *   3. otherwise compareVerifiedEntry, so undated entries keep a fixed order */
      compareTierCompleted(a, b) {
        const byRole = catalog.roleSortKey(b.entry.role) - catalog.roleSortKey(a.entry.role);
        if (byRole) return byRole;
        const da = catalog.entryCompletedAt(a.entry);
        const db = catalog.entryCompletedAt(b.entry);
        if (da !== db) return da < db ? 1 : -1;
        return catalog.compareVerifiedEntry(a, b);
      },

      /* Default display order: newest added to the site first.
       *   1. addedAt, descending (ISO date or datetime strings compare correctly as text)
       *   2. same or missing addedAt: later position in runners.json first (entries are appended)
       * Runners without addedAt sort after all runners that have one. completedAt is never used here. */
      compareAdded(a, b) {
        const da = a.addedAt || "";
        const db = b.addedAt || "";
        if (da !== db) return da < db ? 1 : -1;
        return runnerIndex.get(b) - runnerIndex.get(a);
      },
    };
    return catalog;
  }

  async function loadCatalog() {
    const [gameData, runnerData] = await Promise.all([loadJson(PATHS.games), loadJson(PATHS.runners)]);
    return createCatalog(gameData, runnerData);
  }

  /* ---------- General rules sections (data/rules.json) ---------- */

  function ruleSectionBodyHtml(section) {
    const subsections = (section.subsections || [])
      .map(
        (sub) => `
          <div class="rule-sub">
            <h4 class="rule-sub-title">${escapeHtml(sub.title)}</h4>
            <div class="rule-body">${contentHtml(sub.content)}</div>
          </div>`
      )
      .join("");
    return `
      ${section.content ? `<div class="rule-body">${contentHtml(section.content)}</div>` : ""}
      ${subsections ? `<div class="rule-subs">${subsections}</div>` : ""}`;
  }

  // Collapsible panel. Sections with "exception" (No Hit) get their own styling and badge.
  function rulePanelHtml(section, open) {
    return `
      <details class="rule-panel${section.exception ? " is-exception" : ""}" id="${escapeHtml(section.id)}"${open ? " open" : ""}>
        <summary>
          <span class="rule-panel-title">${escapeHtml(section.title)}</span>
          ${section.exception ? `<span class="exception-badge">${escapeHtml(section.exception)}</span>` : ""}
          <span class="rule-panel-icon" aria-hidden="true"></span>
        </summary>
        <div class="rule-panel-body">${ruleSectionBodyHtml(section)}</div>
      </details>`;
  }

  // Optional card artwork from games.json ("cardBackground": { src, position? }), as a style
  // attribute setting the CSS variables used by .has-bg; "" when the game has none.
  function cardBackgroundStyle(game) {
    const bg = game && game.cardBackground;
    const src = bg && safeUrl(bg.src);
    if (!src) return "";
    const position = /^[\w\s.%-]+$/.test(bg.position || "") ? `; --card-bg-position: ${bg.position}` : "";
    return ` style="${escapeHtml(`--card-bg: url("${src}")${position}`)}"`;
  }

  /* ---------- Runner component ---------- */

  function avatarHtml(runner, profile) {
    const initial = escapeHtml((runner.name || "?").trim().charAt(0).toUpperCase());
    const src = safeUrl(runner.avatar);
    const inner = src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${initial}">`
      : initial;
    const cls = "runner-avatar";
    if (!profile) return `<span class="${cls}" aria-hidden="true">${inner}</span>`;
    // http(s) leaves the site (YouTube, Team Hitless). A runner page link stays in this tab.
    const external = /^https?:/i.test(profile);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a class="${cls}" href="${escapeHtml(profile)}"${attrs} tabindex="-1" aria-hidden="true">${inner}</a>`;
  }

  // shortFallback: the short label for a challenge with no canonical title (only used for proof links).
  function challengeLinkLabel(challenge, mode = "short", shortFallback = "") {
    const canonical = String(challenge.title || "").trim() || shortFallback;
    const full = String(challenge.restrictions || challenge.title || "").trim();
    if (mode === "full") return full;
    return canonical;
  }

  function challengeHtml(challenge, mode = "short", shortFallback = "") {
    const proof = safeUrl(challenge.proof);
    const label = challengeLinkLabel(challenge, mode, proof ? shortFallback : "");
    if (!label) return "";
    // A line-break opportunity after each "/" lets slash-joined restrictions
    // ("Rolling/Blocking/Parrying/…") wrap at the slashes in narrow cards; the text is unchanged.
    const title = escapeHtml(label).replace(/\//g, "/<wbr>");
    // The challenge title itself is the proof link.
    return proof
      ? `<li><a class="challenge-link" href="${escapeHtml(proof)}" target="_blank" rel="noopener noreferrer">${title}</a></li>`
      : `<li><span class="challenge-link is-unlinked">${title}</span></li>`;
  }

  /**
   * Render one runner card.
   * @param catalog  result of loadCatalog()
   * @param runner   runner object from runners.json
   * @param entries  the runner's role entries to show (defaults to all)
   * @param opts     { highlight, background, challengeMode }
   *                 background: use the cardBackground of the game holding the highest tier
   *                 challengeMode: "short" (homepage — canonical titles) or "full" (game HoF)
   *
   * The picture and name open the runner's page. A role with no recorded challenges
   * shows just "Game — Role", with no empty list or placeholder.
   * opts.head: false omits the picture and name (the runner page already shows them).
   * opts.showGame: false omits the game name on each row (the runner page titles the game once).
   */
  function runnerCard(catalog, runner, entries = runner.games || [], opts = {}) {
    const { highlight = () => false, background = false, challengeMode = "short", head = true, showGame = true } = opts;
    const pageUrl = catalog.runnerPageUrl(runner.id);
    const name = escapeHtml(runner.name);
    const sorted = [...entries].sort(catalog.compareEntryTier);
    const topRole = sorted[0] ? catalog.role(sorted[0].role) : null;
    // Background artwork is the game of the first row, which is the highest tier.
    const top = background ? sorted[0] || null : null;
    const bg = top ? cardBackgroundStyle(catalog.game(top.game)) : "";

    const entryHtml = sorted
      .map((entry) => {
        const game = catalog.game(entry.game);
        const gameTitle = game ? game.title : entry.game;
        const pageUrl = catalog.gamePageUrl(entry.game);
        const gameLabel = pageUrl
          ? `<a href="${escapeHtml(pageUrl)}">${escapeHtml(gameTitle)}</a>`
          : escapeHtml(gameTitle);
        // Cards name the OneBros tier itself (e.g. "Master"), not the game's own name for it ("Old One").
        const role = catalog.role(entry.role);
        const roleName = escapeHtml(role ? role.name : entry.role);
        // No Hit runs have no canonical challenge title: in short mode their proof link is named
        // after the role (e.g. "Hitless Sage") instead of listing the full restrictions.
        const shortFallback = role && role.track === "nohit" ? role.name : "";
        const challenges = (entry.challenges || [])
          .map((c) => challengeHtml(c, challengeMode, shortFallback))
          .filter(Boolean);
        // A role-only run (e.g. a Champion run, which has no challenge title) puts its proof on the
        // role label itself, never on a line of its own: the entry's proof, or else the proof of an
        // untitled challenge when no challenge line is shown.
        const entryProof =
          safeUrl(entry.proof) ||
          (challenges.length ? "" : (entry.challenges || []).map((c) => safeUrl(c.proof)).find(Boolean) || "");
        const roleLabel = entryProof
          ? `<a href="${escapeHtml(entryProof)}" target="_blank" rel="noopener noreferrer">${roleName}</a>`
          : roleName;
        return `
          <div class="runner-entry tier-${escapeHtml(entry.role)}${highlight(entry) ? " is-match" : ""}">
            <p class="runner-entry-head">
              <span class="tier-dot" aria-hidden="true"></span>
              ${showGame ? `<span class="runner-entry-game">${gameLabel}</span><span class="sep" aria-hidden="true">—</span>` : ""}
              <span class="runner-entry-tier">${roleLabel}</span>
            </p>
            ${challenges.length ? `<ul class="challenge-list">${challenges.join("")}</ul>` : ""}
          </div>`;
      })
      .join("");

    return `
      <article class="runner-card${head ? "" : " is-entries"}${topRole ? " tier-" + escapeHtml(topRole.id) : ""}${bg ? " has-bg" : ""}"${bg}>
        ${head ? `<header class="runner-head">
          ${avatarHtml(runner, pageUrl)}
          <h3 class="runner-name">
            <a href="${escapeHtml(pageUrl)}">${name}</a>
          </h3>
        </header>` : ""}
        <div class="runner-entries">${entryHtml}</div>
      </article>`;
  }

  // Replace broken profile pictures with the runner's initial.
  function bindAvatarFallback(root) {
    root.addEventListener(
      "error",
      (e) => {
        const img = e.target;
        if (img.tagName === "IMG" && img.dataset.fallback !== undefined) {
          img.replaceWith(document.createTextNode(img.dataset.fallback));
        }
      },
      true
    );
  }

  /* ---------- Page chrome ---------- */

  function initChrome() {
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    const toggle = $(".nav-toggle");
    const nav = $("#site-nav");
    initHomeLink(nav);
    if (toggle && nav) {
      const close = () => {
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
      };
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        document.body.classList.toggle("nav-open", open);
      });
      nav.addEventListener("click", (e) => {
        if (e.target.closest("a")) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
    }

    const header = $(".site-header");
    if (header) {
      const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // #top is the sticky header, which the browser treats as already in view, so #top links
    // scroll to the page top themselves (smooth via CSS, instant with reduced motion).
    // Focus returns to the header brand link so keyboard users continue from the top.
    document.addEventListener("click", (e) => {
      if (!e.target.closest('a[href="#top"]')) return;
      e.preventDefault();
      window.scrollTo({ top: 0 });
      const brand = $(".site-header .brand");
      if (brand) brand.focus({ preventScroll: true });
    });

    // "Back to top" only appears once the page has been scrolled past roughly one screen.
    const backToTop = $(".back-to-top");
    if (backToTop) {
      const onScroll = () =>
        backToTop.classList.toggle("is-visible", window.scrollY > Math.max(600, window.innerHeight));
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  /* "Home" as the first site nav item on internal pages, linking where the header brand does.
   * The homepage brand links to #top, so the homepage gets no Home item. */
  function initHomeLink(nav) {
    const brand = $(".site-header .brand");
    const home = brand && brand.getAttribute("href");
    const list = nav && $("ul", nav);
    if (!list || !home || home.startsWith("#") || $(".nav-home", list)) return;
    list.insertAdjacentHTML("afterbegin", `<li class="nav-home"><a href="${escapeHtml(home)}">Home</a></li>`);
  }

  /* "Expand all" / "Collapse all" button for a set of rule panels (<details>).
   * panels: function returning the current panels. */
  function initPanelToggle(toggle, panels) {
    if (!toggle) return;
    const sync = () => {
      toggle.textContent = panels().every((p) => p.open) ? "Collapse all" : "Expand all";
    };
    toggle.addEventListener("click", () => {
      const open = !panels().every((p) => p.open);
      panels().forEach((p) => (p.open = open));
      sync();
    });
    panels().forEach((p) => p.addEventListener("toggle", sync));
    sync();
  }

  /* Games dropdown in the site nav. The "Games" link (.nav-games) becomes a "Games ▾" toggle for
   * a list of "All Games" (the link's own href) plus every game with a page, in games.json order.
   * Opens inline inside the mobile menu. Without the hook or any game page, the plain link stays. */
  function initGamesMenu(catalog, currentId = "") {
    const item = $(".site-nav .nav-games");
    const link = item && $("a", item);
    const games = catalog.games.filter((g) => catalog.gamePageUrl(g.id));
    if (!link || !games.length) return;

    item.innerHTML = `
      <button class="nav-games-toggle" type="button" aria-expanded="false" aria-controls="games-menu">
        ${escapeHtml(link.textContent.trim())}<span class="nav-games-caret" aria-hidden="true">▾</span>
      </button>
      <ul class="nav-games-menu" id="games-menu" hidden>
        <li><a href="${escapeHtml(link.getAttribute("href"))}">All Games</a></li>
        ${games
          .map(
            (g) =>
              `<li><a href="${escapeHtml(catalog.gamePageUrl(g.id))}"${
                g.id === currentId ? ' aria-current="page"' : ""
              }>${escapeHtml(g.title)}</a></li>`
          )
          .join("")}
      </ul>`;

    const toggle = $(".nav-games-toggle", item);
    const menu = $(".nav-games-menu", item);
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
    };

    toggle.addEventListener("click", () => setOpen(menu.hidden));
    // Following a link closes the dropdown; the nav's own handler also closes the mobile menu.
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    // Clicks outside (including the hamburger toggle) close it.
    document.addEventListener("click", (e) => {
      if (!item.contains(e.target)) setOpen(false);
    });
    // Tabbing away closes it (focus moving to nothing, e.g. a click on plain text, is left to the click handler).
    item.addEventListener("focusout", (e) => {
      if (e.relatedTarget && !item.contains(e.relatedTarget)) setOpen(false);
    });
    // Escape closes only the dropdown (not the mobile menu) and returns focus to the toggle.
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || menu.hidden) return;
      e.stopPropagation();
      setOpen(false);
      toggle.focus();
    });
  }

  function identityKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  // A staff member and a runner are the same person when an id, username, or display name matches.
  function staffMatchesRunner(person, runner) {
    if (!person || !runner) return false;
    const runnerKeys = new Set([identityKey(runner.id), identityKey(runner.name)].filter(Boolean));
    return [person.id, person.username, person.name].some((value) => {
      const key = identityKey(value);
      return key && runnerKeys.has(key);
    });
  }

  function staffForRunner(staffList, runner) {
    return (staffList || []).find((person) => staffMatchesRunner(person, runner)) || null;
  }

  function runnerForStaff(runners, person) {
    return (runners || []).find((runner) => staffMatchesRunner(person, runner)) || null;
  }

  // Staff who are also runners use the name and picture already on their staff card.
  // Staff avatars are curated by hand: a staff avatar always wins over the runner's (YouTube)
  // avatar, and nothing ever copies a runner avatar onto a staff card.
  function withStaffIdentity(runner, person) {
    if (!person) return runner;
    const avatar = String(person.avatar || "").trim();
    const name = String(person.name || "").trim();
    const nextAvatar = avatar || runner.avatar;
    const nextName = name || runner.name;
    if (nextAvatar === runner.avatar && nextName === runner.name) return runner;
    return { ...runner, avatar: nextAvatar, name: nextName };
  }

  function loadErrorHtml() {
    return `
      <p class="error">
        Could not load data. If you opened this file directly, run a local server
        instead (e.g. VS Code Live Server) — browsers block
        <code>fetch()</code> on <code>file://</code>.
      </p>`;
  }

  // Discord logo for the "Join the Discord" buttons; decorative, since the button text names the link.
  const discordIcon =
    '<svg class="btn-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/>' +
    "</svg>";

  window.OneBros = {
    PATHS,
    $,
    escapeHtml,
    safeUrl,
    slugify,
    plainText,
    listHtml,
    contentHtml,
    loadJson,
    loadCatalog,
    ruleSectionBodyHtml,
    rulePanelHtml,
    cardBackgroundStyle,
    runnerCard,
    runnerPageUrl,
    avatarHtml,
    staffMatchesRunner,
    staffForRunner,
    runnerForStaff,
    withStaffIdentity,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    initPanelToggle,
    loadErrorHtml,
    discordIcon,
  };
})();
