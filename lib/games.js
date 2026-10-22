/**
 * dsh-boo550wt-animation — built-in mini games served over the plugin route.
 *
 * A game is a self-contained HTML page rendered full-screen inside the boot
 * overlay. It reports completion (or a skip) back to the parent window through
 * `postMessage`, because an iframe swallows every key event: the parent never
 * sees the Esc the viewer pressed inside the frame.
 *
 * Every page therefore installs the same small relay:
 *
 *   - Esc            -> postMessage({ __bootSkip: true })
 *   - finishing play -> postMessage({ __bootGameDone: true, ... })
 *
 * The host page listens for both. That relay is the only reason skipping works
 * while a game is on screen.
 */

import { createReadStream, promises as fs } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Shared head: dark theme, centered layout, the skip relay. */
function pageHead(title, extraCss) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#000;overflow:hidden;
    font-family:ui-monospace,Consolas,"Microsoft YaHei",monospace;
    -webkit-user-select:none;user-select:none}
  #app{display:flex;flex-direction:column;align-items:center;justify-content:center;
    height:100%;gap:14px;padding:16px}
  h1{color:#9fe8ff;font-size:22px;margin:0;letter-spacing:4px;font-weight:600}
  canvas{background:#0a0f14;border:1px solid #1e3a4a;border-radius:6px;max-width:100%}
  .hud{display:flex;gap:24px;color:#5f7d8c;font-size:14px}
  .hud b{color:#9fe8ff;font-weight:600}
  .msg{color:#f5c451;font-size:15px;min-height:20px;text-align:center}
  .tip{color:#3d5563;font-size:12px;text-align:center}
  button.act{background:#12222c;border:1px solid #1e3a4a;border-radius:8px;color:#9fe8ff;
    padding:8px 18px;font:inherit;cursor:pointer}
  button.act:hover{background:#18303d;border-color:#2c5b73}
  ${extraCss ?? ""}
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  // ---- the relay every built-in game shares -----------------------------
  window.__bootGame = {
    done: function (detail) {
      try {
        parent.postMessage(Object.assign({ __bootGameDone: true }, detail || {}), "*");
      } catch (e) {}
    },
    skip: function () {
      try { parent.postMessage({ __bootSkip: true }, "*"); } catch (e) {}
    }
  };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc" || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      window.__bootGame.skip();
    }
  }, true);
})();
</script>`;
}

function pageFoot(body) {
  return `<script>
${body}
</script>
</body>
</html>`;
}

/** Wrap a game body into a complete document. */
function page(title, body, extraCss) {
  return `${pageHead(title, extraCss)}\n${pageFoot(body)}`;
}

/* ------------------------------------------------------------------ snake */

export function snakeGameHtml() {
  const head = pageHead("贪吃蛇");
  const body = `
(function () {
  var COLS = 20, ROWS = 16, CELL = 24, TARGET = 30;
  var W = COLS * CELL, H = ROWS * CELL;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>贪 吃 蛇</h1>' +
    '<canvas id="c"></canvas>' +
    '<div class="hud"><span>分数 <b id="score">0</b></span><span>目标 <b>' + TARGET + '</b></span></div>' +
    '<div class="msg" id="msg"></div>' +
    '<div class="tip">方向键 / WASD 控制 · 撞墙或撞自己结束 · 吃完 ' + TARGET + ' 个豆子通关 · Esc 跳过</div>';
  var c = document.getElementById("c");
  c.width = W; c.height = H;
  var g = c.getContext("2d");
  var score = 0, over = false, won = false;
  var snake = [{x:9,y:8},{x:8,y:8},{x:7,y:8}];
  var dir = {x:1,y:0}, next = {x:1,y:0};
  var food = null, speed = 130, timer = null;

  function placeFood() {
    var free = [];
    for (var x = 0; x < COLS; x++) for (var y = 0; y < ROWS; y++) {
      var hit = false;
      for (var i = 0; i < snake.length; i++) if (snake[i].x === x && snake[i].y === y) { hit = true; break; }
      if (!hit) free.push({x:x,y:y});
    }
    if (!free.length) { finish(true); return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function draw() {
    g.fillStyle = "#0a0f14"; g.fillRect(0,0,W,H);
    g.strokeStyle = "#13222c"; g.lineWidth = 1;
    for (var x = 0; x <= COLS; x++) { g.beginPath(); g.moveTo(x*CELL+.5,0); g.lineTo(x*CELL+.5,H); g.stroke(); }
    for (var y = 0; y <= ROWS; y++) { g.beginPath(); g.moveTo(0,y*CELL+.5); g.lineTo(W,y*CELL+.5); g.stroke(); }
    for (var i = 0; i < snake.length; i++) {
      g.fillStyle = i === 0 ? "#7ef29a" : "#2e8f5a";
      g.fillRect(snake[i].x*CELL+2, snake[i].y*CELL+2, CELL-4, CELL-4);
    }
    if (food) {
      g.fillStyle = "#ff6b6b"; g.beginPath();
      g.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2-4, 0, Math.PI*2); g.fill();
    }
  }

  function step() {
    if (over || won) return;
    dir = {x:next.x,y:next.y};
    var h0 = {x:snake[0].x+dir.x, y:snake[0].y+dir.y};
    if (h0.x < 0 || h0.x >= COLS || h0.y < 0 || h0.y >= ROWS) { finish(false); return; }
    for (var i = 0; i < snake.length; i++) if (snake[i].x === h0.x && snake[i].y === h0.y) { finish(false); return; }
    snake.unshift(h0);
    if (food && h0.x === food.x && h0.y === food.y) {
      score++;
      if (score >= TARGET) { finish(true); return; }
      placeFood();
      if (speed > 60) { speed -= 2; clearInterval(timer); timer = setInterval(step, speed); }
    } else {
      snake.pop();
    }
    document.getElementById("score").textContent = score;
    draw();
  }

  function finish(success) {
    over = true;
    if (success) won = true;
    clearInterval(timer);
    draw();
    if (success) {
      document.getElementById("msg").textContent = "通关！即将进入…";
      setTimeout(function () { window.__bootGame.done({ game: "snake", score: score }); }, 800);
    } else {
      document.getElementById("msg").textContent = "游戏结束 · 按 空格 重来 · Esc 跳过";
    }
  }

  function restart() {
    score = 0; over = false; won = false; speed = 130;
    snake = [{x:9,y:8},{x:8,y:8},{x:7,y:8}];
    dir = {x:1,y:0}; next = {x:1,y:0};
    document.getElementById("score").textContent = "0";
    document.getElementById("msg").textContent = "";
    clearInterval(timer);
    placeFood(); timer = setInterval(step, speed); draw();
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowUp" || k === "w" || k === "W") { if (dir.y !== 1) next = {x:0,y:-1}; e.preventDefault(); }
    else if (k === "ArrowDown" || k === "s" || k === "S") { if (dir.y !== -1) next = {x:0,y:1}; e.preventDefault(); }
    else if (k === "ArrowLeft" || k === "a" || k === "A") { if (dir.x !== 1) next = {x:-1,y:0}; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { if (dir.x !== -1) next = {x:1,y:0}; e.preventDefault(); }
    else if (k === " " && over) { restart(); e.preventDefault(); }
  });

  placeFood(); draw(); timer = setInterval(step, speed);
})();`;
  return head + pageFoot(body);
}

/* ------------------------------------------------------------------- 2048 */

export function game2048Html() {
  const head = pageHead("2048", `
  .grid{display:grid;grid-template-columns:repeat(4,88px);gap:8px;padding:8px;
    background:#141b21;border-radius:10px}
  .cell{width:88px;height:88px;border-radius:8px;display:flex;align-items:center;justify-content:center;
    font-size:26px;font-weight:700;background:#1b242c;color:#5f7d8c;transition:background .12s,color .12s}
  .cell[data-v="2"]{background:#2b3a45;color:#cfe6f2}
  .cell[data-v="4"]{background:#33566a;color:#e6f5ff}
  .cell[data-v="8"]{background:#2e7d8a;color:#fff}
  .cell[data-v="16"]{background:#2e8f5a;color:#fff}
  .cell[data-v="32"]{background:#3f9d4a;color:#fff}
  .cell[data-v="64"]{background:#a8a33c;color:#fff}
  .cell[data-v="128"]{background:#c08b2e;color:#fff}
  .cell[data-v="256"]{background:#c46a2a;color:#fff}
  .cell[data-v="512"]{background:#c04a2a;color:#fff}
  .cell[data-v="1024"]{background:#c02a2a;color:#fff}
  .cell[data-v="2048"]{background:#e04a4a;color:#fff}
  `);
  const body = `
(function () {
  var TARGET = 2048;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>2 0 4 8</h1>' +
    '<div class="hud"><span>分数 <b id="score">0</b></span><span>最高 <b id="best">0</b></span></div>' +
    '<div class="grid" id="g"></div>' +
    '<div class="msg" id="msg"></div>' +
    '<div class="tip">方向键 / WASD 移动 · 拼出 ' + TARGET + ' 即通关 · Esc 跳过</div>';
  var grid = document.getElementById("g");
  var cells = [];
  for (var i = 0; i < 16; i++) {
    var d = document.createElement("div");
    d.className = "cell";
    d.textContent = "";
    grid.appendChild(d);
    cells.push(d);
  }
  var board, score, best = 0, done = false;

  function reset() {
    board = [];
    for (var i = 0; i < 16; i++) board.push(0);
    score = 0; done = false;
    document.getElementById("msg").textContent = "";
    spawn(); spawn(); render();
  }

  function spawn() {
    var free = [];
    for (var i = 0; i < 16; i++) if (board[i] === 0) free.push(i);
    if (!free.length) return;
    board[free[Math.floor(Math.random() * free.length)]] = Math.random() < 0.9 ? 2 : 4;
  }

  function render() {
    for (var i = 0; i < 16; i++) {
      var v = board[i];
      cells[i].textContent = v === 0 ? "" : String(v);
      if (v === 0) cells[i].removeAttribute("data-v");
      else cells[i].setAttribute("data-v", String(v));
    }
    document.getElementById("score").textContent = score;
    if (score > best) best = score;
    document.getElementById("best").textContent = best;
  }

  function slide(row) {
    var out = row.filter(function (v) { return v !== 0; });
    for (var i = 0; i < out.length - 1; i++) {
      if (out[i] === out[i+1]) { out[i] *= 2; score += out[i]; out.splice(i+1, 1); }
    }
    while (out.length < 4) out.push(0);
    return out;
  }

  function move(dir) {
    if (done) return false;
    var before = board.join(",");
    var lines = [];
    var i, j, idx;
    if (dir === "left" || dir === "right") {
      for (i = 0; i < 4; i++) {
        lines.push([]);
        for (j = 0; j < 4; j++) lines[i].push(board[i*4+j]);
      }
    } else {
      for (j = 0; j < 4; j++) {
        lines.push([]);
        for (i = 0; i < 4; i++) lines[j].push(board[i*4+j]);
      }
    }
    for (i = 0; i < 4; i++) {
      if (dir === "right" || dir === "down") lines[i].reverse();
      lines[i] = slide(lines[i]);
      if (dir === "right" || dir === "down") lines[i].reverse();
    }
    if (dir === "left" || dir === "right") {
      for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) board[i*4+j] = lines[i][j];
    } else {
      for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) board[i*4+j] = lines[j][i];
    }
    if (board.join(",") !== before) { spawn(); render(); check(); return true; }
    return false;
  }

  function check() {
    for (var i = 0; i < 16; i++) {
      if (board[i] >= TARGET) {
        done = true;
        document.getElementById("msg").textContent = "达成 " + TARGET + "！即将进入…";
        setTimeout(function () { window.__bootGame.done({ game: "2048", score: score }); }, 900);
        return;
      }
    }
    // Any move left?
    for (var k = 0; k < 16; k++) if (board[k] === 0) return;
    for (var r = 0; r < 4; r++) for (var cc = 0; cc < 4; cc++) {
      var v = board[r*4+cc];
      if (cc < 3 && board[r*4+cc+1] === v) return;
      if (r < 3 && board[(r+1)*4+cc] === v) return;
    }
    done = true;
    document.getElementById("msg").textContent = "无可移动 · 按 空格 重来 · Esc 跳过";
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    var map = {
      ArrowLeft: "left", a: "left", A: "left",
      ArrowRight: "right", d: "right", D: "right",
      ArrowUp: "up", w: "up", W: "up",
      ArrowDown: "down", s: "down", S: "down"
    };
    if (map[k]) { e.preventDefault(); move(map[k]); }
    else if (k === " " && done) { e.preventDefault(); reset(); }
  });

  reset();
})();`;
  return head + pageFoot(body);
}

/* ---------------------------------------------------------------- 打砖块 */

export function breakoutGameHtml() {
  const head = pageHead("打砖块");
  const body = `
(function () {
  var W = 640, H = 420, app = document.getElementById("app");
  app.innerHTML =
    '<h1>打 砖 块</h1>' +
    '<canvas id="c"></canvas>' +
    '<div class="hud"><span>得分 <b id="score">0</b></span><span>命 <b id="lives">3</b></span></div>' +
    '<div class="msg" id="msg"></div>' +
    '<div class="tip">← → 移动挡板 · 清空所有砖块通关 · Esc 跳过</div>';
  var c = document.getElementById("c");
  c.width = W; c.height = H;
  var g = c.getContext("2d");

  var COLS = 10, ROWS = 5, BW = 56, BH = 18, PAD = 8, TOP = 40, LEFT = 20;
  var bricks = [], score = 0, lives = 3, over = false, won = false;
  var paddle = { x: W/2 - 50, w: 100, h: 12 };
  var ball = { x: W/2, y: H - 60, r: 7, dx: 4.2, dy: -4.6 };
  var timer = null;

  function resetBricks() {
    bricks = [];
    for (var r = 0; r < ROWS; r++) for (var col = 0; col < COLS; col++) {
      bricks.push({ x: LEFT + col * (BW + PAD), y: TOP + r * (BH + PAD), alive: true, row: r });
    }
  }

  function draw() {
    g.fillStyle = "#0a0f14"; g.fillRect(0, 0, W, H);
    var colors = ["#c04a2a", "#c08b2e", "#a8a33c", "#2e8f5a", "#2e7d8a"];
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      g.fillStyle = colors[b.row % colors.length];
      g.fillRect(b.x, b.y, BW, BH);
    }
    g.fillStyle = "#7ef29a";
    g.fillRect(paddle.x, H - 30, paddle.w, paddle.h);
    g.fillStyle = "#9fe8ff";
    g.beginPath(); g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); g.fill();
  }

  function step() {
    if (over || won) return;
    ball.x += ball.dx; ball.y += ball.dy;
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.dx = Math.abs(ball.dx); }
    if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.dx = -Math.abs(ball.dx); }
    if (ball.y - ball.r < 0) { ball.y = ball.r; ball.dy = Math.abs(ball.dy); }

    // paddle
    if (ball.y + ball.r >= H - 30 && ball.y + ball.r <= H - 30 + paddle.h &&
        ball.x >= paddle.x && ball.x <= paddle.x + paddle.w && ball.dy > 0) {
      ball.dy = -Math.abs(ball.dy);
      var hit = (ball.x - (paddle.x + paddle.w/2)) / (paddle.w/2);
      ball.dx = hit * 5.2;
    }

    // bricks
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + BW &&
          ball.y + ball.r > b.y && ball.y - ball.r < b.y + BH) {
        b.alive = false; score += 10;
        document.getElementById("score").textContent = score;
        ball.dy = -ball.dy;
        if (bricks.every(function (x) { return !x.alive; })) { finish(true); return; }
        break;
      }
    }

    if (ball.y - ball.r > H) {
      lives--;
      document.getElementById("lives").textContent = lives;
      if (lives <= 0) { finish(false); return; }
      ball.x = W/2; ball.y = H - 60; ball.dx = 4.2; ball.dy = -4.6;
      paddle.x = W/2 - 50;
    }
    draw();
  }

  function finish(success) {
    over = true;
    if (success) won = true;
    clearInterval(timer);
    draw();
    if (success) {
      document.getElementById("msg").textContent = "通关！即将进入…";
      setTimeout(function () { window.__bootGame.done({ game: "breakout", score: score }); }, 800);
    } else {
      document.getElementById("msg").textContent = "游戏结束 · 按 空格 重来 · Esc 跳过";
    }
  }

  function restart() {
    score = 0; lives = 3; over = false; won = false;
    document.getElementById("score").textContent = "0";
    document.getElementById("lives").textContent = "3";
    document.getElementById("msg").textContent = "";
    resetBricks();
    paddle.x = W/2 - 50;
    ball = { x: W/2, y: H - 60, r: 7, dx: 4.2, dy: -4.6 };
    clearInterval(timer);
    timer = setInterval(step, 16);
    draw();
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { paddle.x = Math.max(0, paddle.x - 34); e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { paddle.x = Math.min(W - paddle.w, paddle.x + 34); e.preventDefault(); }
    else if (k === " " && over) { restart(); e.preventDefault(); }
  });

  resetBricks(); draw(); timer = setInterval(step, 16);
})();`;
  return head + pageFoot(body);
}

/* ------------------------------------------------------------------ 记忆 */

export function memoryGameHtml() {
  const head = pageHead("记忆翻牌", `
  .pairs{display:grid;grid-template-columns:repeat(4,76px);gap:10px}
  .card{width:76px;height:76px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    font-size:30px;cursor:pointer;background:#141b21;border:1px solid #1e3a4a;
    color:transparent;transition:background .15s,color .15s,transform .1s}
  .card:hover{border-color:#2c5b73}
  .card.open{background:#18303d;color:#9fe8ff}
  .card.done{background:#1d4a33;color:#7ef29a;border-color:#2e8f5a;cursor:default}
  `);
  const body = `
(function () {
  var PAIRS = 8;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>记 忆 翻 牌</h1>' +
    '<div class="hud"><span>已配对 <b id="found">0</b>/' + PAIRS + '</span><span>步数 <b id="moves">0</b></span></div>' +
    '<div class="pairs" id="p"></div>' +
    '<div class="msg" id="msg"></div>' +
    '<div class="tip">点击翻牌 · 找出 ' + PAIRS + ' 组相同图案即通关 · Esc 跳过</div>';
  var board = document.getElementById("p");
  var glyphs = ["🍎","🍊","🍋","🍇","🍉","🍓","🥝","🍒"];
  var deck = [], first = null, lock = false, found = 0, moves = 0, done = false;

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function reset() {
    deck = [];
    for (var i = 0; i < PAIRS; i++) { deck.push(glyphs[i]); deck.push(glyphs[i]); }
    shuffle(deck);
    first = null; lock = false; found = 0; moves = 0; done = false;
    board.innerHTML = "";
    document.getElementById("found").textContent = "0";
    document.getElementById("moves").textContent = "0";
    document.getElementById("msg").textContent = "";
    for (var k = 0; k < deck.length; k++) {
      var el = document.createElement("div");
      el.className = "card";
      el.textContent = deck[k];
      el.setAttribute("data-i", String(k));
      el.addEventListener("click", function () { flip(this); });
      board.appendChild(el);
    }
  }

  function flip(el) {
    if (lock || done) return;
    if (el.classList.contains("open") || el.classList.contains("done")) return;
    el.classList.add("open");
    moves++;
    document.getElementById("moves").textContent = moves;
    if (!first) { first = el; return; }
    if (first.getAttribute("data-i") === el.getAttribute("data-i")) return;
    if (first.textContent === el.textContent) {
      first.classList.add("done"); el.classList.add("done");
      first.classList.remove("open"); el.classList.remove("open");
      first = null; found++;
      document.getElementById("found").textContent = String(found);
      if (found === PAIRS) {
        done = true;
        document.getElementById("msg").textContent = "全部配对！即将进入…";
        setTimeout(function () { window.__bootGame.done({ game: "memory", moves: moves }); }, 800);
      }
    } else {
      lock = true;
      var a = first, b = el;
      first = null;
      setTimeout(function () {
        a.classList.remove("open"); b.classList.remove("open");
        lock = false;
      }, 700);
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === " " && done) { e.preventDefault(); reset(); }
  });

  reset();
})();`;
  return head + pageFoot(body);
}

/* ------------------------------------------------------------------ 打字 */

export function typingGameHtml() {
  const head = pageHead("打字冲刺", `
  .word{font-size:34px;letter-spacing:6px;color:#9fe8ff;font-weight:700;min-height:48px}
  .word i{font-style:normal;color:#2e8f5a}
  .typed{font-size:20px;color:#7ef29a;min-height:28px;letter-spacing:2px}
  input{background:#0f171d;border:1px solid #1e3a4a;border-radius:8px;color:#9fe8ff;
    padding:10px 16px;font:inherit;font-size:18px;text-align:center;width:280px;outline:none}
  input:focus{border-color:#2c5b73}
  `);
  const body = `
(function () {
  var GOAL = 12;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>打 字 冲 刺</h1>' +
    '<div class="hud"><span>完成 <b id="done">0</b>/' + GOAL + '</span><span>错误 <b id="miss">0</b></span></div>' +
    '<div class="word" id="w"></div>' +
    '<input id="in" autocomplete="off" spellcheck="false" placeholder="在这里输入…">' +
    '<div class="msg" id="msg"></div>' +
    '<div class="tip">照抄上面的词并按回车 · 完成 ' + GOAL + ' 个通关 · Esc 跳过</div>';
  var WORDS = ["HARNESS","PLUGIN","COSMIC","VECTOR","SNAKE","PYTHON","ROCKET","QUANTUM",
               "SILICON","ORBIT","CIPHER","ENGINE","MATRIX","NEUTRON","PHOTON","LAMBDA"];
  var wordEl = document.getElementById("w");
  var input = document.getElementById("in");
  var done = 0, miss = 0, current = "";

  function next() {
    current = WORDS[Math.floor(Math.random() * WORDS.length)];
    wordEl.textContent = current;
    input.value = "";
    input.focus();
  }

  function paint() {
    var v = input.value.toUpperCase();
    var ok = current.startsWith(v);
    input.style.borderColor = v.length === 0 ? "#1e3a4a" : ok ? "#2e8f5a" : "#c04a2a";
  }

  input.addEventListener("input", paint);
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = input.value.trim().toUpperCase();
    if (v === current) {
      done++;
      document.getElementById("done").textContent = String(done);
      document.getElementById("msg").textContent = "正确！";
      if (done >= GOAL) {
        document.getElementById("msg").textContent = "全部完成！即将进入…";
        setTimeout(function () { window.__bootGame.done({ game: "typing", done: done }); }, 800);
        return;
      }
      next();
    } else {
      miss++;
      document.getElementById("miss").textContent = String(miss);
      document.getElementById("msg").textContent = "不对，再来一次";
      input.value = "";
      paint();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { input.blur(); }
  });

  next();
})();`;
  return head + pageFoot(body);
}

/* ------------------------------------------------------- 行星发动机点火 */

/**
 * A Wandering Earth themed game: ignite a planetary engine.
 *
 * The whole scene is drawn on a canvas: the Earth in the sky, the engine plaza
 * on the ground, and the plasma beam that grows as the three subsystems come
 * into range. The 转向 / 姿态 / 推力 gauges sit beside it.
 *
 * Each subsystem drifts on its own and is nudged by one key. Every gauge inside
 * its green band adds to the ignition charge; hold all three long enough and
 * the engine fires.
 */
export function wanderingEarthGameHtml() {
  const head = pageHead("行星发动机", `
  /* The scene owns the window. #app is a plain column flow pinned to the
     viewport, and the canvas is clipped to .view — its box never depends on a
     percentage-height flex chain that could resolve to the content height. */
  html,body{height:100%;overflow:hidden}
  #app{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;
    height:100%;max-height:100%;padding:8px 10px;gap:6px;overflow:hidden}
  #app h1,#app .tip,#app .warn,#app .stage,#app .charge,#app .charge-label{flex:0 0 auto;text-align:center}
  #app .charge,#app .charge-label,#app #side{text-align:left}
  .stage{position:relative;display:flex;gap:12px;align-items:stretch;
    width:100%;min-height:0;overflow:hidden}
  .view{position:relative;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow:hidden;
    border-radius:12px;border:1px solid #1e3a4a;background:#04070a}
  .view canvas{position:absolute;inset:0;display:block;width:100%;height:100%;
    max-width:none;max-height:none;border:0;border-radius:0;background:transparent}
  .side{display:flex;flex-direction:column;gap:10px;justify-content:center;
    width:120px;flex:0 0 auto;overflow:hidden}
  .gauge{position:relative;height:104px;flex:0 0 auto;background:#0d151b;
    border:1px solid #1e3a4a;border-radius:9px;overflow:hidden}
  .gauge .band{position:absolute;left:0;right:0;background:rgba(126,242,154,.18);
    border-top:1px solid #2e8f5a;border-bottom:1px solid #2e8f5a}
  .gauge .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#2e7d8a,#14242c)}
  .gauge .needle{position:absolute;left:0;right:0;height:3px;background:#9fe8ff;
    box-shadow:0 0 8px #9fe8ff}
  .gauge .name{position:absolute;top:5px;left:8px;font-size:11px;color:#7fa8bd}
  .gauge .key{position:absolute;bottom:5px;right:8px;font-size:10px;color:#4a6b7a}
  .charge{height:8px;flex:0 0 auto;border-radius:4px;background:#0d151b;
    border:1px solid #1e3a4a;overflow:hidden}
  .charge i{display:block;height:100%;width:0%;background:linear-gradient(90deg,#2e7d8a,#7ef29a);
    transition:width .12s linear}
  .charge-label{font-size:11px;flex:0 0 auto;color:#5f7d8c;display:flex;justify-content:space-between}
  .warn{color:#ff8a5c;font-size:13px;min-height:18px}
  .warn.ok{color:#7ef29a}
  @media (max-width:720px){
    .stage{flex-direction:column}
    .side{flex-direction:row;width:auto;height:92px}
    .gauge{height:100%;flex:1}
  }
  `);
  const body = `
(function () {
  var HOLD_MS = 3000;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>行 星 发 动 机</h1>' +
    '<div class="stage">' +
      '<div class="view"><canvas id="cv"></canvas></div>' +
      '<div class="side" id="side">' +
        '<div class="charge-label"><span>点火充能</span><span id="pct">0%</span></div>' +
        '<div class="charge"><i id="chg"></i></div>' +
        '<div id="gs"></div>' +
      '</div>' +
    '</div>' +
    '<div class="warn" id="msg">把三路参数压进绿区，撑满 3 秒点火</div>' +
    '<div class="tip">← → 转向 &nbsp; A / D 姿态 &nbsp; ↑ ↓ 推力 &nbsp;· Esc 跳过</div>';

  // ---- gauges ----------------------------------------------------------
  var SPECS = [
    { name: "转向", key: "← →", band: [0.42, 0.58], pos: 0.50, drift: 0.0009, push: 0.045 },
    { name: "姿态", key: "A D", band: [0.34, 0.50], pos: 0.42, drift: 0.0012, push: 0.050 },
    { name: "推力", key: "↑ ↓", band: [0.62, 0.78], pos: 0.70, drift: 0.0011, push: 0.045 },
  ];
  var gs = document.getElementById("gs");
  var doms = [];
  for (var i = 0; i < SPECS.length; i++) {
    var s = SPECS[i];
    var box = document.createElement("div");
    box.className = "gauge";
    var band = document.createElement("div");
    band.className = "band";
    band.style.bottom = (s.band[0] * 100) + "%";
    band.style.height = ((s.band[1] - s.band[0]) * 100) + "%";
    var fill = document.createElement("div");
    fill.className = "fill";
    var needle = document.createElement("div");
    needle.className = "needle";
    var name = document.createElement("div");
    name.className = "name";
    name.textContent = s.name;
    var key = document.createElement("div");
    key.className = "key";
    key.textContent = s.key;
    box.appendChild(fill); box.appendChild(band); box.appendChild(needle);
    box.appendChild(name); box.appendChild(key);
    gs.appendChild(box);
    doms.push({ fill: fill, needle: needle });
  }

  // ---- the scene -------------------------------------------------------
  var cv = document.getElementById("cv");
  var g = cv.getContext("2d");
  var W = 0, H = 0, DPR = 1;

  var sized = false;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    var appEl = document.getElementById("app");
    var stageEl = document.querySelector(".stage");
    if (stageEl && appEl) {
      // Measure once from the untouched layout, then keep the stage height
      // fixed. Recomputing on every observation would let the canvas' own
      // size feed back into the arithmetic that sizes the canvas.
      if (!sized) {
        var used = 0;
        var kids = appEl.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] === stageEl) continue;
          used += kids[i].getBoundingClientRect().height + 6;
        }
        var avail = Math.max(180, appEl.clientHeight - used - 16);
        stageEl.style.height = Math.round(avail) + "px";
        sized = true;
      }
    }
    var view = cv.parentElement;
    // The own view box, not the canvas: an absolutely positioned canvas still
    // reports its intrinsic size before the stylesheet has applied.
    var w = view ? view.clientWidth : 0;
    var h = view ? view.clientHeight : 0;
    if (w < 60 || h < 60) return; // layout not settled yet; the observer retries
    W = Math.round(w);
    H = Math.round(h);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", function () {
    sized = false;
    resize();
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () { resize(); }).observe(document.getElementById("app"));
  }

  var stars = [];
  for (var k = 0; k < 160; k++) {
    stars.push({ x: Math.random(), y: Math.random() * 0.62, r: Math.random() * 1.4 + 0.3,
                 a: Math.random() * 0.7 + 0.15, p: Math.random() * 6.28 });
  }

  /** The Earth: a sphere with a terminator, cloud bands and a faint glow. */
  function drawEarth(t, lit) {
    var cx = W * 0.18, cy = H * 0.30, R = Math.min(W, H) * 0.19;
    // Halo
    var halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.75);
    halo.addColorStop(0, "rgba(90,170,255," + (0.10 + lit * 0.16) + ")");
    halo.addColorStop(1, "rgba(90,170,255,0)");
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, R * 1.75, 0, Math.PI * 2); g.fill();

    // Body
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    var body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    body.addColorStop(0, "#2f6b9e");
    body.addColorStop(0.65, "#1b4a72");
    body.addColorStop(1, "#0a2238");
    g.fillStyle = body;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);

    // Continents: soft blobs drifting slowly, wrapped by the sphere clip.
    g.globalAlpha = 0.42;
    g.fillStyle = "#2f7a5c";
    for (var c = 0; c < 9; c++) {
      var a = (c / 9) * Math.PI * 2 + t * 0.00008;
      var bx = cx + Math.cos(a) * R * 0.52;
      var by = cy + Math.sin(a * 1.7) * R * 0.46;
      g.beginPath();
      g.ellipse(bx, by, R * (0.16 + (c % 3) * 0.08), R * (0.12 + (c % 2) * 0.07), a, 0, Math.PI * 2);
      g.fill();
    }
    // Cloud bands: a few soft, uneven wisps rather than hard stripes.
    g.globalAlpha = 0.14;
    g.fillStyle = "#e6f2ff";
    for (var b = 0; b < 4; b++) {
      var bandY = cy - R * 0.55 + (b + 0.5) * (R * 1.1 / 4);
      var wob = Math.sin(b * 1.9) * R * 0.08;
      g.beginPath();
      g.ellipse(cx + wob, bandY, R * (0.86 - b * 0.05), R * 0.085, 0.04, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Terminator: everything left of the lit edge falls into night.
    var litX = cx + R * (0.1 + 0.5 * lit) - R * (1 - lit) * 0.7;
    var term = g.createLinearGradient(litX - R * 0.6, 0, litX + R * 0.6, 0);
    term.addColorStop(0, "rgba(2,6,12,0.88)");
    term.addColorStop(1, "rgba(2,6,12,0)");
    g.fillStyle = term;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();

    // Rim light
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(150,210,255," + (0.25 + lit * 0.35) + ")";
    g.beginPath(); g.arc(cx, cy, R - 0.6, 0, Math.PI * 2); g.stroke();
    return { cx: cx, cy: cy, R: R };
  }

  /** The engine plaza: three towers around a central column, seen from afar. */
  function drawEngine(t, pow) {
    var baseY = H * 0.92;
    var cx = W * 0.58;

    // Ground silhouette
    g.fillStyle = "#050a0e";
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, baseY - H * 0.05);
    for (var x = 0; x <= W; x += 40) {
      g.lineTo(x, baseY - H * 0.05 - Math.sin(x / 130 + 1) * H * 0.018);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();

    // Plaza glow: a warm pool on the ground under the engines, not a wide slab.
    var floor = g.createRadialGradient(cx, baseY, 10, cx, baseY, W * 0.30);
    floor.addColorStop(0, "rgba(255,150,70," + (0.07 + pow * 0.30) + ")");
    floor.addColorStop(0.5, "rgba(255,130,60," + (0.03 + pow * 0.12) + ")");
    floor.addColorStop(1, "rgba(255,130,60,0)");
    g.fillStyle = floor;
    g.fillRect(0, Math.max(0, baseY - H * 0.34), W, H * 0.34);

    // Three towers + central column
    var towers = [
      { dx: -W * 0.115, w: W * 0.030, h: H * 0.20 },
      { dx: 0, w: W * 0.045, h: H * 0.30 },
      { dx: W * 0.115, w: W * 0.030, h: H * 0.20 },
    ];
    for (var i = 0; i < towers.length; i++) {
      var tw = towers[i];
      var tx = cx + tw.dx;
      var top = baseY - tw.h;
      // body
      g.fillStyle = "#0c161d";
      g.fillRect(tx - tw.w / 2, top, tw.w, tw.h);
      g.strokeStyle = "#1e3a4a";
      g.lineWidth = 1;
      g.strokeRect(tx - tw.w / 2, top, tw.w, tw.h);
      // ribbed segments
      g.strokeStyle = "rgba(60,110,140,.55)";
      for (var seg = 1; seg < 6; seg++) {
        var sy = top + (tw.h / 6) * seg;
        g.beginPath(); g.moveTo(tx - tw.w / 2, sy); g.lineTo(tx + tw.w / 2, sy); g.stroke();
      }
      // nozzle glow
      g.fillStyle = "rgba(255," + Math.round(140 + pow * 90) + ",60," + (0.25 + pow * 0.75) + ")";
      g.fillRect(tx - tw.w / 2, top - 3, tw.w, 3);
    }

    var mainTop = baseY - towers[1].h;

    // Plasma beam: straight up from the main nozzle, clipped at the top so it
    // reads as reaching into space rather than as a stripe crossing the scene.
    if (pow > 0.01) {
      var beamW = W * 0.014 + W * 0.040 * pow;
      var beamTop = Math.max(-H * 0.05, mainTop - H * (0.45 + 1.1 * pow));
      var grad = g.createLinearGradient(0, mainTop, 0, beamTop);
      grad.addColorStop(0, "rgba(255,240,190," + (0.9 * pow) + ")");
      grad.addColorStop(0.25, "rgba(255,175,85," + (0.55 * pow) + ")");
      grad.addColorStop(1, "rgba(255,130,45,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx - beamW * 0.5, mainTop);
      g.lineTo(cx + beamW * 0.5, mainTop);
      g.lineTo(cx + beamW, beamTop);
      g.lineTo(cx - beamW, beamTop);
      g.closePath();
      g.fill();

      // Hot core, narrow and bright.
      g.fillStyle = "rgba(255,255,240," + (0.6 * pow) + ")";
      g.fillRect(cx - beamW * 0.14, Math.min(mainTop, beamTop), beamW * 0.28,
        Math.abs(mainTop - beamTop));

      // Embers: rise along the beam and fade as they climb.
      for (var e = 0; e < 34; e++) {
        var ph = ((t * 0.00055 + e * 0.0937) % 1);
        var ex = cx + Math.sin(e * 2.1 + t * 0.0006) * beamW * (1.1 + ph * 0.9);
        var ey = mainTop - ph * Math.max(1, (mainTop - beamTop));
        if (ey < -20) continue;
        g.fillStyle = "rgba(255," + Math.round(180 + 40 * ph) + ",110," + (0.55 * pow * (1 - ph)) + ")";
        g.beginPath(); g.arc(ex, ey, 1 + (1 - ph) * 2.2, 0, Math.PI * 2); g.fill();
      }

      // Nozzle flare at the base.
      var flare = g.createRadialGradient(cx, mainTop, 2, cx, mainTop, beamW * 2.4);
      flare.addColorStop(0, "rgba(255,240,200," + (0.55 * pow) + ")");
      flare.addColorStop(1, "rgba(255,160,70,0)");
      g.fillStyle = flare;
      g.beginPath(); g.arc(cx, mainTop, beamW * 2.4, 0, Math.PI * 2); g.fill();
    }

    // Instrument lights on the plaza
    g.fillStyle = "rgba(120,200,255," + (0.35 + pow * 0.5) + ")";
    for (var li = 0; li < 14; li++) {
      var lx = (W / 14) * li + 8;
      g.fillRect(lx, baseY - H * 0.045, 3, 3);
    }
    return mainTop;
  }

  // ---- state -----------------------------------------------------------
  var held = 0, done = false, over = false, last = 0, pow = 0;

  function inBand(s) {
    return s.pos >= s.band[0] && s.pos <= s.band[1];
  }

  function renderGauges() {
    var stable = 0;
    for (var i = 0; i < SPECS.length; i++) {
      var s = SPECS[i], d = doms[i];
      d.fill.style.height = (s.pos * 100) + "%";
      d.needle.style.bottom = (s.pos * 100) + "%";
      var ok = inBand(s);
      d.needle.style.background = ok ? "#7ef29a" : "#ff8a5c";
      d.needle.style.boxShadow = ok ? "0 0 8px #7ef29a" : "0 0 8px #ff8a5c";
      if (ok) stable++;
    }
    var pct = Math.round((held / HOLD_MS) * 100);
    document.getElementById("pct").textContent = pct + "%";
    document.getElementById("chg").style.width = pct + "%";
    return stable;
  }

  function paint(t) {
    var lit = Math.min(1, 0.32 + pow * 0.68);
    g.fillStyle = "#04070a";
    g.fillRect(0, 0, W, H);

    // Stars
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var tw = 0.6 + 0.4 * Math.sin(t * 0.0012 + st.p);
      g.fillStyle = "rgba(200,225,255," + (st.a * tw) + ")";
      g.fillRect(st.x * W, st.y * H, st.r, st.r);
    }

    drawEarth(t, lit);
    drawEngine(t, pow);

    // Ignition flash once the beam is full
    if (done) {
      g.fillStyle = "rgba(255,220,160," + (0.12 + 0.08 * Math.sin(t * 0.01)) + ")";
      g.fillRect(0, 0, W, H);
    }
  }

  function tick(t) {
    if (over) { paint(t); requestAnimationFrame(tick); return; }
    var dt = last === 0 ? 16 : Math.min(48, t - last);
    last = t;

    if (!done) {
      var all = true;
      for (var i = 0; i < SPECS.length; i++) {
        var s = SPECS[i];
        s.pos += (Math.random() - 0.5) * s.drift * dt * 2;
        if (s.pos < 0.02) s.pos = 0.02;
        if (s.pos > 0.98) s.pos = 0.98;
        if (!inBand(s)) all = false;
      }

      if (all) {
        held += dt;
        document.getElementById("msg").textContent = "点火中 —— 保持住！";
        document.getElementById("msg").className = "warn ok";
        if (held >= HOLD_MS) {
          done = true;
          document.getElementById("msg").textContent = "发动机启动 —— 地球起航";
          document.getElementById("msg").className = "warn ok";
          setTimeout(function () {
            window.__bootGame.done({ game: "wandering-earth" });
          }, 1100);
        }
      } else {
        held = Math.max(0, held - dt * 0.6);
        document.getElementById("msg").textContent = "参数越界，充能回落";
        document.getElementById("msg").className = "warn";
      }
      renderGauges();
    }

    // Beam intensity follows the charge, eased so it grows smoothly.
    pow += ((held / HOLD_MS) - pow) * 0.12;
    if (done) pow += (1.2 - pow) * 0.1;

    paint(t);
    requestAnimationFrame(tick);
  }

  function nudge(index, amount) {
    var s = SPECS[index];
    s.pos = Math.min(0.98, Math.max(0.02, s.pos + amount));
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft") { e.preventDefault(); nudge(0, -0.045); }
    else if (k === "ArrowRight") { e.preventDefault(); nudge(0, 0.045); }
    else if (k === "a" || k === "A") { e.preventDefault(); nudge(1, -0.05); }
    else if (k === "d" || k === "D") { e.preventDefault(); nudge(1, 0.05); }
    else if (k === "ArrowUp") { e.preventDefault(); nudge(2, 0.045); }
    else if (k === "ArrowDown") { e.preventDefault(); nudge(2, -0.045); }
  });

  resize();
  renderGauges();
  // Measure again once layout has settled, then start the loop.
  requestAnimationFrame(function () {
    resize();
    requestAnimationFrame(tick);
  });
})();`;
  return head + pageFoot(body);
}

/* ---------------------------------------------------------------- registry */

/**
 * Built-in games. A game is either generated (`html`) or a real directory of
 * static files (`dir`, relative to the package root) — the Wandering Earth
 * scene is a vendored three.js project with its own textures and modules, so it
 * cannot be expressed as one string.
 */
const GAMES = {
  snake: { title: "贪吃蛇", html: snakeGameHtml },
  "2048": { title: "2048", html: game2048Html },
  breakout: { title: "打砖块", html: breakoutGameHtml },
  memory: { title: "记忆翻牌", html: memoryGameHtml },
  typing: { title: "打字冲刺", html: typingGameHtml },
  "wandering-earth": {
    title: "流浪地球 · 行星发动机计划",
    dir: "vendor/earth-migration",
    entry: "ignite.html",
  },
};

/** Every built-in game id, for the settings panel and the config validator. */
export const GAME_IDS = Object.keys(GAMES);

/** Human title for one game id. */
export function gameTitle(id) {
  return GAMES[id]?.title ?? id;
}

/** Directory of the package, used to resolve a game's static files. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Content types for the vendored assets. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve one file of a directory-backed game, confined to that directory.
 *
 * @param {string} root absolute directory of the game
 * @param {string} rel requested path relative to the root
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function serveStatic(root, rel, req, res, fallback) {
  const clean = decodeURIComponent(rel).replace(/^\/+/, "");
  // An empty remainder (or a bare trailing slash) is the game's entry document.
  const target = resolve(join(root, clean === "" ? fallback : clean));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, { "cache-control": "no-store" });
    res.end();
    return;
  }
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("not a file");
    const type = TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": String(stat.size),
      // Immutable for the life of the page; these are shipped assets.
      "cache-control": "public, max-age=3600",
    });
    if (req.method === "HEAD") { res.end(); return; }
    await new Promise((ok, fail) => {
      const stream = createReadStream(target);
      stream.on("error", fail);
      stream.on("end", ok);
      stream.pipe(res);
    });
  } catch {
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  }
}

/**
 * Serve the requested built-in game.
 *
 * Generated games answer one path; a directory game serves its whole tree, so
 * its scripts, styles and textures load exactly as they do in the upstream
 * project. `sub` is the path remainder after `/boot-animation/game/<id>`.
 *
 * @returns {Promise<boolean>} false when the id is unknown
 */
export async function serveGame(game, req, res, sub = "") {
  const entry = GAMES[game];
  if (entry === undefined) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`boot animation: unknown game ${JSON.stringify(game)}`);
    return false;
  }
  if (entry.html !== undefined) {
    const body = Buffer.from(entry.html(), "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(body.length),
      "cache-control": "no-store",
    });
    res.end(body);
    return true;
  }
  const root = resolve(PACKAGE_ROOT, entry.dir);
  // `/game/<id>` and `/game/<id>/` open the entry document; anything else is a
  // file of the game's own tree.
  await serveStatic(root, sub, req, res, entry.entry);
  return true;
}
