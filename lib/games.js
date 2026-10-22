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
 * A Wandering Earth themed game: balance the 行星发动机 ignition.
 *
 * The engine needs three subsystems held inside green bands at once — 转向,
 * 姿态 and 推力 — each drifting on its own, each nudged by a key. Hold all
 * three inside the bands long enough and the planet starts moving.
 */
export function wanderingEarthGameHtml() {
  const head = pageHead("行星发动机", `
  .gauges{display:flex;gap:28px;align-items:flex-end;height:260px;margin:6px 0}
  .gauge{position:relative;width:76px;height:240px;background:#0d151b;border:1px solid #1e3a4a;
    border-radius:10px;overflow:hidden}
  .band{position:absolute;left:0;right:0;background:rgba(126,242,154,.16);border-top:1px solid #2e8f5a;
    border-bottom:1px solid #2e8f5a}
  .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#2e7d8a,#18303d)}
  .needle{position:absolute;left:0;right:0;height:3px;background:#9fe8ff;box-shadow:0 0 8px #9fe8ff}
  .gname{color:#5f7d8c;font-size:12px;text-align:center;margin-top:6px}
  .gkey{color:#9fe8ff;font-size:11px;text-align:center}
  .warn{color:#ff8a5c;font-size:13px;min-height:18px}
  .ok{color:#7ef29a}
  .countdown{font-size:26px;color:#f5c451;letter-spacing:3px}
  `);
  const body = `
(function () {
  var HOLD_MS = 3000;
  var app = document.getElementById("app");
  app.innerHTML =
    '<h1>行 星 发 动 机</h1>' +
    '<div class="tip">"地球，开始流浪。" —— 把三路参数都稳定在绿色区间，持续 3 秒点火成功</div>' +
    '<div class="gauges" id="gs"></div>' +
    '<div class="countdown" id="cd">稳定性 0%</div>' +
    '<div class="warn" id="msg"></div>' +
    '<div class="tip">← → 转向 &nbsp; A / D 姿态 &nbsp; ↑ ↓ 推力 &nbsp;· Esc 跳过</div>';

  var SPECS = [
    { name: "转向", key: "← →", band: [0.42, 0.58], pos: 0.5, drift: 0.0009, push: 0.045 },
    { name: "姿态", key: "A D", band: [0.34, 0.50], pos: 0.42, drift: 0.0012, push: 0.05 },
    { name: "推力", key: "↑ ↓", band: [0.62, 0.78], pos: 0.70, drift: 0.0011, push: 0.045 },
  ];

  var doms = [];
  var container = document.getElementById("gs");
  for (var i = 0; i < SPECS.length; i++) {
    var wrap = document.createElement("div");
    var gauge = document.createElement("div");
    gauge.className = "gauge";
    var band = document.createElement("div");
    band.className = "band";
    band.style.bottom = (SPECS[i].band[0] * 100) + "%";
    band.style.height = ((SPECS[i].band[1] - SPECS[i].band[0]) * 100) + "%";
    var fill = document.createElement("div");
    fill.className = "fill";
    var needle = document.createElement("div");
    needle.className = "needle";
    gauge.appendChild(fill);
    gauge.appendChild(band);
    gauge.appendChild(needle);
    var name = document.createElement("div");
    name.className = "gname";
    name.textContent = SPECS[i].name;
    var key = document.createElement("div");
    key.className = "gkey";
    key.textContent = SPECS[i].key;
    wrap.appendChild(gauge);
    wrap.appendChild(name);
    wrap.appendChild(key);
    container.appendChild(wrap);
    doms.push({ fill: fill, needle: needle });
  }

  var held = 0, done = false, over = false;
  var last = 0;

  function inBand(s) {
    return s.pos >= s.band[0] && s.pos <= s.band[1];
  }

  function render() {
    var stable = 0;
    for (var i = 0; i < SPECS.length; i++) {
      var s = SPECS[i];
      var d = doms[i];
      d.fill.style.height = (s.pos * 100) + "%";
      d.needle.style.bottom = (s.pos * 100) + "%";
      d.needle.style.background = inBand(s) ? "#7ef29a" : "#ff8a5c";
      if (inBand(s)) stable++;
    }
    var pct = Math.round((held / HOLD_MS) * 100);
    document.getElementById("cd").textContent = "稳定性 " + pct + "%";
    return stable;
  }

  function tick(t) {
    if (over || done) return;
    var dt = last === 0 ? 16 : Math.min(48, t - last);
    last = t;

    var all = true;
    for (var i = 0; i < SPECS.length; i++) {
      var s = SPECS[i];
      s.pos += (Math.random() - 0.5) * s.drift * dt * 2;
      if (s.pos < 0.02) { s.pos = 0.02; }
      if (s.pos > 0.98) { s.pos = 0.98; }
      if (!inBand(s)) all = false;
    }

    if (all) {
      held += dt;
      document.getElementById("msg").textContent = "点火中… 保持住！";
      document.getElementById("msg").className = "warn ok";
      if (held >= HOLD_MS) {
        done = true;
        document.getElementById("cd").textContent = "点火成功";
        document.getElementById("msg").textContent = "发动机启动 —— 地球起航。即将进入…";
        setTimeout(function () { window.__bootGame.done({ game: "wandering-earth" }); }, 900);
        return;
      }
    } else {
      held = Math.max(0, held - dt * 0.6);
      document.getElementById("msg").textContent = "参数越界，稳定性回落";
      document.getElementById("msg").className = "warn";
    }

    render();
    requestAnimationFrame(tick);
  }

  function nudge(delta) {
    return function (e) {
      e.preventDefault();
      var s = SPECS[delta.index];
      s.pos = Math.min(0.98, Math.max(0.02, s.pos + delta.amount));
    };
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft") nudge({ index: 0, amount: -0.045 })(e);
    else if (k === "ArrowRight") nudge({ index: 0, amount: 0.045 })(e);
    else if (k === "a" || k === "A") nudge({ index: 1, amount: -0.05 })(e);
    else if (k === "d" || k === "D") nudge({ index: 1, amount: 0.05 })(e);
    else if (k === "ArrowUp") nudge({ index: 2, amount: 0.045 })(e);
    else if (k === "ArrowDown") nudge({ index: 2, amount: -0.045 })(e);
  });

  render();
  requestAnimationFrame(tick);
})();`;
  return page("行星发动机", body, "");
}

/* ---------------------------------------------------------------- registry */

const GAMES = {
  snake: { title: "贪吃蛇", html: snakeGameHtml },
  "2048": { title: "2048", html: game2048Html },
  breakout: { title: "打砖块", html: breakoutGameHtml },
  memory: { title: "记忆翻牌", html: memoryGameHtml },
  typing: { title: "打字冲刺", html: typingGameHtml },
  "wandering-earth": { title: "行星发动机（流浪地球）", html: wanderingEarthGameHtml },
};

/** Every built-in game id, for the settings panel and the config validator. */
export const GAME_IDS = Object.keys(GAMES);

/** Human title for one game id. */
export function gameTitle(id) {
  return GAMES[id]?.title ?? id;
}

/** Serve the requested built-in game. Returns false for unknown games. */
export function serveGame(game, req, res) {
  const entry = GAMES[game];
  if (entry === undefined) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`boot animation: unknown game ${JSON.stringify(game)}`);
    return false;
  }
  const body = Buffer.from(entry.html(), "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
  return true;
}
