"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const gameSource = fs.readFileSync(path.join(root, "game.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const updateStatsSource = gameSource.match(/function updateStats\(\) \{[\s\S]*?^\}/m)?.[0];

test("updateStats selects the progress bar by its HTML class and updates its ARIA values", () => {
  assert.ok(updateStatsSource, "updateStats() must exist");
  assert.match(htmlSource, /class=[\"'][^\"']*\bprogress-track\b[^\"']*[\"']/);
  assert.match(htmlSource, /id=[\"']progress-fill[\"']/);
  assert.match(htmlSource, /src=[\"']game\.js\?v=hcaptcha-1[\"']/);
  assert.doesNotMatch(updateStatsSource, /\$\([\"']\.progress-track[\"']\)/);
  assert.match(updateStatsSource, /document\.querySelector\([\"']\.progress-track[\"']\)/);

  const attributes = new Map();
  let selectedClass = null;
  const progressTrack = { setAttribute: (name, value) => attributes.set(name, String(value)) };
  const elements = new Map([
    ["score-value", {}], ["correct-value", {}], ["level-value", {}],
    ["points-value", {}], ["progress-text", {}], ["progress-fill", { style: {} }]
  ]);
  for (const element of elements.values()) { element.textContent = ""; element.innerHTML = ""; element.className = ""; }
  const document = {
    getElementById: id => elements.get(id) || null,
    querySelector: selector => { selectedClass = selector; return selector === ".progress-track" ? progressTrack : null; }
  };
  vm.runInNewContext(updateStatsSource + "\nupdateStats();", {
    document, $: id => document.getElementById(id),
    LEVELS: { easy: { label: "Fácil", points: 10 }, medium: { label: "Médio", points: 20 }, hard: { label: "Difícil", points: 30 } },
    highestLevel: "easy", score: 0, correct: 0
  });
  assert.equal(selectedClass, ".progress-track");
  assert.equal(attributes.get("aria-valuemax"), "3");
  assert.equal(attributes.get("aria-valuenow"), "0");
});
