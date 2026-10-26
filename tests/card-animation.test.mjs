import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("cada nova carta dispara uma animação de entrada acessível", () => {
  const game = read("game.js");
  const css = read("style.css");
  const html = read("index.html");
  assert.match(game, /function animateQuestionCard\(\)/);
  assert.match(game, /cardSurface\.classList\.remove\("card-enter"\)/);
  assert.match(game, /cardSurface\.classList\.add\("card-enter"\)/);
  assert.match(game, /animateQuestionCard\(\);/);
  assert.match(css, /\.question-card\.card-enter\s*\{/);
  assert.match(css, /@keyframes card-deal/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /game\.js\?v=deck200-animation1/);
  assert.match(html, /style\.css\?v=deck200-animation1/);
});
