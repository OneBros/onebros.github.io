"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validAddedAt(value) {
  return validDate(value) || (typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value);
}

// YouTube IDs are case-sensitive; tracking parameters do not identify a new proof.
function proofKey(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.hostname === "youtu.be") return `youtube:video:${u.pathname.slice(1)}`;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)) {
      if (u.searchParams.has("v")) return `youtube:video:${u.searchParams.get("v")}`;
      if (u.pathname === "/playlist") return `youtube:playlist:${u.searchParams.get("list")}`;
    }
    u.searchParams.delete("si");
    return u.href;
  } catch { return String(value).trim(); }
}

function validateRunners(data, catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/games.json"), "utf8"))) {
  const errors = [], ids = new Set(), names = new Set(), formerIds = [];
  if (!Array.isArray(data.runners)) throw new Error("runners must be an array");
  for (const r of data.runners) {
    const name = String(r.name || "").trim().toLowerCase();
    if (!r.id || ids.has(r.id)) errors.push(`Duplicate/empty runner id: ${r.id}`);
    if (!name || names.has(name)) errors.push(`Duplicate/empty runner name: ${r.name}`);
    ids.add(r.id); names.add(name);
    if (r.formerIds !== undefined && !Array.isArray(r.formerIds)) errors.push(`${r.id}: formerIds must be an array`);
    for (const old of r.formerIds || []) formerIds.push([old, r.id]);
    if (!validAddedAt(r.addedAt)) errors.push(`${r.id}: invalid addedAt`);
    const entries = new Set();
    for (const e of r.games || []) {
      const key = `${e.game}/${e.role}`, proofs = new Set(), challenges = new Set();
      if (entries.has(key)) errors.push(`${r.id}: duplicate ${key}`);
      entries.add(key);
      if (!catalog.games.some(g => g.id === e.game) || !catalog.roles.some(t => t.id === e.role)) errors.push(`${r.id}: unknown ${key}`);
      if (e.addedAt !== undefined && !validAddedAt(e.addedAt)) errors.push(`${r.id}/${key}: invalid addedAt`);
      for (const c of e.challenges || []) {
        if (!validDate(c.completedAt)) errors.push(`${r.id}/${key}: invalid/missing completedAt`);
        if (c.proof) {
          try { if (!["http:", "https:"].includes(new URL(c.proof).protocol)) throw new Error(); }
          catch { errors.push(`${r.id}/${key}: invalid proof URL`); }
        }
        const proof = proofKey(c.proof), identity = JSON.stringify([c.title || "", c.restrictions || ""]);
        if ((proof && proofs.has(proof)) || (!proof && challenges.has(identity))) errors.push(`${r.id}/${key}: duplicate challenge`);
        if (proof) proofs.add(proof);
        challenges.add(identity);
      }
    }
  }
  // A former id keeps old runner links working, so it must never name another runner.
  const seenFormer = new Set();
  for (const [old, id] of formerIds) {
    if (typeof old !== "string" || !old || ids.has(old) || seenFormer.has(old)) errors.push(`${id}: former id "${old}" is empty or already in use`);
    seenFormer.add(old);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return data;
}

if (require.main === module) {
  validateRunners(JSON.parse(fs.readFileSync(path.join(__dirname, "../data/runners.json"), "utf8")));
  console.log("Runner validation passed");
}
module.exports = { validDate, validAddedAt, proofKey, validateRunners };
