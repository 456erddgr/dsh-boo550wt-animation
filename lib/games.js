/**
 * dsh-boo550wt-animation — built-in mini games served over the plugin route.
 *
 * A game is an isolated HTML page rendered full-screen inside the boot
 * overlay. It must finish on its own (or let the user finish it), because the
 * overlay is dismissed when the game reports completion. The Host serves the
 * page; the browser half loads it in an iframe and listens for the completion
 * message.
 *
 * The snake game here is intentionally tiny: a 20x16 grid, arrow keys, and a
 * score. It is the kind of thing you can genuinely finish, which is exactly
 * what a boot game needs.
 */

/** Render the built-in snake game as a self-contained HTML page. */
export function snakeGameHtml() {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>贪吃蛇</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden;
    font-family: ui-monospace, Consolas, "Microsoft YaHei", monospace; }
  #app { display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; gap: 14px; }
  h1 { color: #9fe8ff; font-size: 22px; margin: 0; letter-spacing: 4px; }
  canvas { background: #0a0f14; border: 1px solid #1e3a4a; border-radius: 6px; }
  #hud { display: flex; gap: 24px; color: #5f7d8c; font-size: 14px; }
  #hud b { color: #9fe8ff; font-weight: 600; }
  #msg { color: #f5c451; font-size: 15px; min-height: 20px; }
  #tip { color: #3d5563; font-size: 12px; }
</style>
</head>
<body>
<div id="app">
  <h1>贪 吃 蛇</h1>
  <canvas id="c"></canvas>
  <div id="hud"><span>分数 <b id="score">0</b></span><span>长度 <b id="len">3</b></span></div>
  <div id="msg"></div>
  <div id="tip">方向键 / WASD 控制 · 撞墙或撞自己则结束 · 吃完 30 个豆子通关</div>
</div>
<script>
(function () {
  var COLS = 20, ROWS = 16, CELL = 24;
  var W = COLS * CELL, H = ROWS * CELL;
  var TARGET = 30;
  var c = document.getElementById("c");
  c.width = W; c.height = H;
  var g = c.getContext("2d");
  var score = 0, len = 3, over = false, won = false;
  var snake = [{ x: 9, y: 8 }, { x: 8, y: 8 }, { x: 7, y: 8 }];
  var dir = { x: 1, y: 0 }, nextDir = { x: 1, y: 0 };
  var food = null;
  var speed = 130;
  var timer = null;

  function placeFood() {
    var free = [];
    for (var x = 0; x < COLS; x++) for (var y = 0; y < ROWS; y++) {
      var hit = snake.some(function (s) { return s.x === x && s.y === y; });
      if (!hit) free.push({ x: x, y: y });
    }
    if (free.length === 0) { finish(true); return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function draw() {
    g.fillStyle = "#0a0f14"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#13222c"; g.lineWidth = 1;
    for (var x = 0; x <= COLS; x++) { g.beginPath(); g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, H); g.stroke(); }
    for (var y = 0; y <= ROWS; y++) { g.beginPath(); g.moveTo(0, y * CELL + 0.5); g.lineTo(W, y * CELL + 0.5); g.stroke(); }
    snake.forEach(function (s, i) {
      g.fillStyle = i === 0 ? "#7ef29a" : "#2e8f5a";
      g.fillRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4);
    });
    if (food) {
      g.fillStyle = "#ff6b6b";
      g.beginPath();
      g.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  function step() {
    if (over || won) return;
    dir = { x: nextDir.x, y: nextDir.y };
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    var hitWall = head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
    var hitSelf = snake.some(function (s) { return s.x === head.x && s.y === head.y; });
    if (hitWall || hitSelf) { finish(false); return; }
    snake.unshift(head);
    if (food && head.x === food.x && head.y === food.y) {
      score += 1; len += 1;
      if (score >= TARGET) { finish(true); return; }
      placeFood();
      if (speed > 60) { speed -= 2; clearInterval(timer); timer = setInterval(step, speed); }
    } else {
      snake.pop();
    }
    document.getElementById("score").textContent = score;
    document.getElementById("len").textContent = len;
    draw();
  }

  function finish(success) {
    over = true;
    if (success) won = true;
    clearInterval(timer);
    var msg = document.getElementById("msg");
    msg.textContent = success ? "通关！即将进入…" : "游戏结束 · 按 空格 重新开始";
    draw();
    if (success) {
      setTimeout(function () {
        try { parent.postMessage({ __bootGameDone: true, score: score, game: "snake" }, "*"); } catch (e) {}
      }, 800);
    }
  }

  function restart() {
    score = 0; len = 3; over = false; won = false;
    snake = [{ x: 9, y: 8 }, { x: 8, y: 8 }, { x: 7, y: 8 }];
    dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
    speed = 130;
    document.getElementById("score").textContent = "0";
    document.getElementById("len").textContent = "3";
    document.getElementById("msg").textContent = "";
    clearInterval(timer);
    placeFood();
    timer = setInterval(step, speed);
    draw();
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowUp" || k === "w" || k === "W") { if (dir.y !== 1) nextDir = { x: 0, y: -1 }; e.preventDefault(); }
    else if (k === "ArrowDown" || k === "s" || k === "S") { if (dir.y !== -1) nextDir = { x: 0, y: 1 }; e.preventDefault(); }
    else if (k === "ArrowLeft" || k === "a" || k === "A") { if (dir.x !== 1) nextDir = { x: -1, y: 0 }; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { if (dir.x !== -1) nextDir = { x: 1, y: 0 }; e.preventDefault(); }
    else if (k === " " && over) { restart(); e.preventDefault(); }
  });

  placeFood();
  draw();
  timer = setInterval(step, speed);
})();
</script>
</body>
</html>`;
}

/** Serve the requested built-in game. Returns false for unknown games. */
export function serveGame(game, req, res) {
  const html = game === "snake" ? snakeGameHtml() : null;
  if (html === null) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`boot animation: unknown game ${JSON.stringify(game)}`);
    return false;
  }
  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
  return true;
}
