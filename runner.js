/* OneBros - runner page
 * One renderer for every runner. Reads ?runner=<id> (or #runner=<id>), then
 * loads data/runners.json through the shared catalog. Depends on shared.js.
 */
(function () {
  "use strict";

  const {
    PATHS,
    $,
    escapeHtml,
    safeUrl,
    loadJson,
    loadCatalog,
    runnerCard,
    avatarHtml,
    staffForRunner,
    withStaffIdentity,
    bindAvatarFallback,
    initChrome,
    initGamesMenu,
    loadErrorHtml,
  } = window.OneBros;

  function runnerIdFromLocation() {
    return (
      new URLSearchParams(window.location.search).get("runner") ||
      new URLSearchParams(window.location.hash.replace(/^#/, "")).get("runner") ||
      ""
    );
  }

  function isYoutubeUrl(url) {
    try {
      return /^(?:www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  function explicitChannel(url) {
    try {
      const u = new URL(url);
      if (!/youtube\.com/i.test(u.hostname)) return "";
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0]?.startsWith("@")) return `${u.origin}/${parts[0]}`;
      if ((parts[0] === "channel" || parts[0] === "c") && parts[1]) return `${u.origin}/${parts[0]}/${parts[1]}`;
    } catch {
      /* not a channel url */
    }
    return "";
  }

  function youtubeUrls(runner, person) {
    const urls = [];
    if (runner.profile) urls.push(runner.profile);
    if (person && person.profile) urls.push(person.profile);
    for (const entry of runner.games || []) {
      for (const challenge of entry.challenges || []) {
        if (challenge.proof) urls.push(challenge.proof);
      }
    }
    return urls.map((url) => safeUrl(url)).filter((url) => url && isYoutubeUrl(url));
  }

  function knownChannel(runner, person) {
    for (const url of youtubeUrls(runner, person)) {
      const channel = explicitChannel(url);
      if (channel) return channel;
    }
    return "";
  }

  async function channelFromProofs(runner, person) {
    for (const url of youtubeUrls(runner, person)) {
      if (explicitChannel(url)) continue;
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        );
        if (!res.ok) continue;
        const data = await res.json();
        const channel = data.author_url && safeUrl(data.author_url);
        if (channel && isYoutubeUrl(channel)) return channel;
      } catch {
        /* try the next proof */
      }
    }
    return "";
  }

  function linkButton(url, label) {
    return `<a class="btn btn-ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function profileActionsHtml(profileUrl, channelUrl) {
    const links = [];
    const profileIsYoutube = profileUrl && isYoutubeUrl(profileUrl);
    if (profileUrl && !profileIsYoutube) links.push(linkButton(profileUrl, profileLinkLabel(profileUrl)));
    const youtube = channelUrl || (profileIsYoutube ? explicitChannel(profileUrl) || profileUrl : "");
    if (youtube) links.push(linkButton(youtube, "YouTube"));
    return links.length ? `<div class="hero-actions" id="profile-links">${links.join("")}</div>` : "";
  }

  function profileLinkLabel(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === "youtube.com" || host === "youtu.be") return "YouTube";
      if (host === "teamhitless.com") return "Team Hitless";
      return host;
    } catch {
      return "Profile";
    }
  }

  function staffBadgesHtml(staffData, person) {
    if (!person) return "";
    const rolesById = new Map(((staffData && staffData.roles) || []).map((r) => [r.id, r]));
    const badges = [...rolesById.values()]
      .filter((role) => (person.roles || []).includes(role.id))
      .map((role) => `<li class="staff-badge">${escapeHtml(role.name)}</li>`)
      .join("");
    return badges ? `<ul class="staff-badges">${badges}</ul>` : "";
  }

  function runsLead(runner) {
    const runs = (runner.games || []).length;
    if (!runs) return "No verified runs yet.";
    const games = new Set(runner.games.map((g) => g.game)).size;
    const runWord = runs === 1 ? "run" : "runs";
    const gameWord = games === 1 ? "game" : "games";
    return `${runs} verified ${runWord} across ${games} ${gameWord}.`;
  }

  function renderHero(catalog, runner, staffData) {
    const person = staffForRunner(staffData && staffData.staff, runner);
    runner = withStaffIdentity(runner, person);
    const external = safeUrl(runner.profile);
    const badges = staffBadgesHtml(staffData, person);
    const channel = knownChannel(runner, person);
    document.title = `Onebros - ${runner.name}`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", `Verified runs by ${runner.name} on Onebros.`);

    renderPageBackground(catalog, runner);

    // On their own page the picture and name open the runner's external profile, never this page
    // again: a known YouTube channel first, else runner.profile (YouTube or e.g. Team Hitless, which
    // also keeps its own button). Plain text without either.
    const identityUrl = channel || external;

    $("#runner-hero").innerHTML = `
      <p class="breadcrumb"><a href="runners.html">Runners</a> <span aria-hidden="true">/</span> ${escapeHtml(runner.name)}</p>
      <header class="runner-head profile-id">
        ${avatarHtml(runner, identityUrl)}
        <div class="profile-id-text">
          <h1 id="runner-title" class="runner-name">${identityNameHtml(runner, identityUrl)}</h1>
          ${badges}
        </div>
      </header>
      <p class="hero-lead">${escapeHtml(runsLead(runner))}</p>
      ${profileActionsHtml(external, channel)}`;

    if (!channel) {
      channelFromProofs(runner, person).then((found) => {
        if (!found) return;
        // A channel found from the proofs takes over the picture and name unless they already open YouTube.
        if (!identityUrl || !isYoutubeUrl(identityUrl)) setIdentityLink(runner, found);
        let box = $("#profile-links");
        if (box && box.querySelector('a[href*="youtube.com"], a[href*="youtu.be"]')) return;
        if (!box) {
          const lead = $("#runner-hero .hero-lead");
          if (!lead) return;
          lead.insertAdjacentHTML("afterend", `<div class="hero-actions" id="profile-links"></div>`);
          box = $("#profile-links");
        }
        box.insertAdjacentHTML("beforeend", linkButton(found, "YouTube"));
      });
    }
  }

  // Game artwork from games.json; `keys` sets which background to prefer.
  function gameArt(game, keys = ["cardBackground", "pageBackground"]) {
    const bg = game && keys.map((key) => game[key]).find((b) => b && safeUrl(b.src));
    const src = bg && safeUrl(bg.src);
    if (!src) return { src: "", position: "" };
    const position = /^[\w\s.%-]+$/.test(bg.position || "") ? bg.position : "";
    return { src, position };
  }

  function identityNameHtml(runner, url) {
    const name = escapeHtml(runner.name);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name;
  }

  // Point the hero picture and name at `url` (re-rendered, so a plain picture becomes a link).
  function setIdentityLink(runner, url) {
    const avatar = $("#runner-hero .profile-id .runner-avatar");
    const title = $("#runner-title");
    if (avatar) avatar.outerHTML = avatarHtml(runner, url);
    if (title) title.innerHTML = identityNameHtml(runner, url);
  }

  // Full-page artwork, as on game pages (body.has-page-bg): the pageBackground of the game holding
  // the runner's highest tier. Without artwork, or if it fails to load, the normal site background stays.
  function renderPageBackground(catalog, runner) {
    const entries = runner.games || [];
    const top = entries.length ? [...entries].sort(catalog.compareEntryTier)[0] : null;
    const art = top ? gameArt(catalog.game(top.game), ["pageBackground", "cardBackground"]) : null;
    if (!art || !art.src) return;
    const body = document.body;
    body.style.setProperty("--page-bg", `url("${art.src}")`);
    if (art.position) body.style.setProperty("--page-bg-position", art.position);
    body.classList.add("has-page-bg");
    // A CSS background fails silently, so probe the image to fall back cleanly.
    const probe = new Image();
    probe.addEventListener("error", () => {
      body.classList.remove("has-page-bg");
      body.style.removeProperty("--page-bg");
      body.style.removeProperty("--page-bg-position");
    });
    probe.src = art.src;
  }

  function gameLogoHtml(game) {
    const logo = game && game.logo;
    const src = logo && safeUrl(logo.src);
    if (!src) return "";
    const size = logo.width && logo.height ? ` width="${Number(logo.width)}" height="${Number(logo.height)}"` : "";
    const blend = logo.blend === "screen" ? " blend-screen" : "";
    return `<img class="profile-game-logo${blend}" src="${escapeHtml(src)}"${size} alt="" aria-hidden="true" decoding="async">`;
  }

  function gameBannerHtml(catalog, gameId) {
    const game = catalog.game(gameId);
    const title = escapeHtml(game ? game.title : gameId);
    const pageUrl = catalog.gamePageUrl(gameId);
    const art = game ? gameArt(game) : { src: "", position: "" };
    const logo = game ? gameLogoHtml(game) : "";
    const artImg = art.src
      ? `<img class="profile-game-art" src="${escapeHtml(art.src)}" alt=""${art.position ? ` style="object-position: ${art.position}"` : ""}>`
      : "";
    const heading = logo
      ? `<h3 class="sr-only">${title}</h3>`
      : `<h3 class="profile-game-title">${title}</h3>`;
    const inner = `${artImg}${logo}${heading}`;
    const cls = `profile-game-banner${art.src ? "" : " is-plain"}`;
    return pageUrl
      ? `<a class="${cls}" href="${escapeHtml(pageUrl)}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }

  function renderRuns(catalog, runner) {
    const entries = runner.games || [];
    const byGame = new Map();
    for (const entry of entries) {
      if (!byGame.has(entry.game)) byGame.set(entry.game, []);
      byGame.get(entry.game).push(entry);
    }
    const order = new Map(catalog.games.map((g, i) => [g.id, i]));
    const highest = (group) =>
      group.reduce((top, entry) => (catalog.compareEntryTier(entry, top) < 0 ? entry : top));
    // Highest tier first, so the leading section is the one behind the page background.
    const groups = [...byGame.entries()].sort((a, b) => {
      const byTier = catalog.compareEntryTier(highest(a[1]), highest(b[1]));
      if (byTier) return byTier;
      return (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99);
    });
    const body = groups.length
      ? groups
          .map(([gameId, group]) => {
            // No card artwork: the game banner above the card already shows it.
            const card = runnerCard(catalog, runner, group, {
              challengeMode: "full",
              head: false,
              showGame: false,
            });
            return `
              <section class="profile-game">
                ${gameBannerHtml(catalog, gameId)}
                ${card}
              </section>`;
          })
          .join("")
      : `<p class="empty">No verified runs yet.</p>`;
    $("#runner-content").innerHTML = `
      <section class="section" id="runs" aria-labelledby="runs-title">
        <div class="container">
          <header class="section-head">
            <h2 id="runs-title" class="section-title">Verified Runs</h2>
          </header>
          <div class="profile-runs">${body}</div>
        </div>
      </section>`;
  }

  function renderNotFound(message) {
    document.title = "Onebros - Runner not found";
    $("#runner-hero").innerHTML = `
      <p class="breadcrumb"><a href="runners.html">Runners</a></p>
      <h1 id="runner-title" class="game-hero-title">Runner not found</h1>
      <p class="hero-lead">${message}</p>
      <div class="hero-actions"><a class="btn btn-primary" href="runners.html">Back to runners</a></div>`;
    $("#runner-content").innerHTML = "";
  }

  async function init() {
    initChrome();
    const content = $("#runner-content");
    bindAvatarFallback($("#runner-hero"));
    bindAvatarFallback(content);

    const runnerId = runnerIdFromLocation();
    let catalog;
    let staffData = null;
    try {
      [catalog, staffData] = await Promise.all([
        loadCatalog(),
        loadJson(PATHS.staff).catch(() => null),
      ]);
    } catch (err) {
      console.error(err);
      $("#runner-hero").innerHTML = loadErrorHtml();
      return;
    }
    initGamesMenu(catalog);

    const runner = catalog.runners.find((r) => r.id === runnerId);
    if (!runner) {
      renderNotFound(
        runnerId ? "We couldn't find that runner." : "Choose a runner to view their verified runs."
      );
      return;
    }

    renderHero(catalog, runner, staffData);
    renderRuns(catalog, runner);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
