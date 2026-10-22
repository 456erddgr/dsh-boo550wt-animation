# dsh-boo550wt-animation

给 **DeepSeek Harness** 加一段开机动画：打开 DSH 时全屏展示一段内容，播完（或者按 `Esc`）才进入界面。

支持四种模式，全部可以在设置面板里改：

| 模式 | 内容 | 结束方式 |
| --- | --- | --- |
| `video` | 视频（默认：自带的 550W 风格动画，16.6 秒） | 播完自动进入 |
| `image` | 图片 | 显示 `durationMs` 后进入 |
| `web` | 网页（URL 或本地 HTML 文件） | 页面发完成消息，或超时 |
| `game` | 内置小游戏（贪吃蛇） | 通关后进入，也可随时 Esc |

```
打开 DSH  ─▶  黑底 + 动画  ─▶  播完 / 通关 / 按 Esc  ─▶  淡出  ─▶  正常界面
```

关键在于**交接时机**：遮罩在 DSH 结算「启动就绪」之前就已经挂上去了，所以应用是在遮罩底下正常渲染的，等动画结束再把界面让出来 —— 而不是先看到界面再盖一层。

## 效果预览

自带素材的分镜（2.0s / 6.0s / 12.0s / 15.0s）：

![开机动画分镜：550W 标志、量子计算机控制系统、剩余进度 69%、剩余进度 100%](docs/preview.png)

真实播放时的样子 —— 画面铺满窗口，右下角在 4 秒后浮现跳过提示：

![实际播放画面，右下角显示「按 Esc 跳过」](docs/boot-scene.png)

内置贪吃蛇小游戏：

![贪吃蛇：通关即进入](docs/snake.png)

> 截图都是从真实播放里截的，不是效果图：用 Chromium 媒体栈经插件的路由解码后截帧生成（`tools/stills.mjs` 与 `tools/browser-check.mjs --shot=`）。

## 怎么用

### 1. 装

DSH 的插件用它自己的 CLI 安装（`desktop` 是保留 profile，由 Electron 应用托管）：

```powershell
# 先拿到仓库
git clone https://github.com/456erddgr/dsh-boo550wt-animation.git

# 再用 DSH 自带的 CLI 装进 desktop profile
$env:ELECTRON_RUN_AS_NODE = '1'
& "<你的安装目录>\DeepSeek Harness.exe" --expose-internals `
  "<你的安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add "<clone 出来的目录>"
```

`<你的安装目录>` 默认是 `%LOCALAPPDATA%\Programs\DeepSeek Harness`。

这条命令会做三件事：加一条 `link:` 依赖、在 `node_modules` 里建好入口、把 bundle 追加进 `dsh.profile.bundles`。

> `add` 底层是 pnpm，所以也接受 git 形式：
> `plugin --profile desktop add github:456erddgr/dsh-boo550wt-animation`

### 2. 重启 DSH

**必须重启。** Host 半侧的代码只在 DSH 启动时被 import 一次，热更新不会加载它。设置面板的修改在重启后生效。

### 3. 在设置里改开机动画

重启后，打开 **设置 → 开机动画**，可以改：

- **类型**：视频 / 图片 / 网页 / 小游戏
- **视频 / 图片路径**：留空用自带素材，填绝对路径用你自己的文件
- **网页地址**：填 URL，或本地 HTML 文件绝对路径
- **小游戏**：目前内置贪吃蛇
- **显示时长**（图片/网页用）
- **硬上限**（秒）：任何内容最多播这么久，绝不让窗口卡死
- **淡出时长**、**提示延迟**、**跳过提示文字**

改完点保存，下次启动生效。设置存在 `~/.dsh/boot-animation-settings.json`。

### 4. 跳过 / 卸载

- **跳过**：随时按 `Esc`。视频被浏览器静音拦截时会退回静音并在角上说明，点一下可带着声音重来。内容解不开时，遮罩 0.9 秒后放弃，正常界面照常出现。
- **卸载**：

```powershell
plugin --profile desktop remove dsh-boo550wt-animation
```

---

## 原理

这个插件是 **Host-only + 浏览器设置面板**：

1. **`webserver/index-inject` 注入行** —— 一条 `style`、一条 body `script`。DSH 会把注入行应用到页面上，时机**早于** `__DSH_BOOT_READY__` 结算、也早于客户端模块加载器启动，这正是遮罩能成为屏幕上第一个东西的原因。脚本启动时拉一次 `/config`，用你最新保存的设置来决定显示什么。
2. **`/boot-animation` 下的路由** —— 带 `Range`、`HEAD`、`416` 处理，交给浏览器自己的媒体栈去解码；配置、图片、视频、网页、小游戏都是经同一套路由提供的。
3. **设置面板** —— 通过 `settings.section` slot 挂进 DSH 设置界面，读写同一份 `/config`。

客户端脚本是把一个真函数 `toString()` 出来的（`lib/inject.js`），所以注入的 JavaScript 是当普通源码被解析和检查的，也保证不含尖括号和 `</script`。

## 自检工具

| 命令 | 能证明什么 |
| --- | --- |
| `node tools/selftest.mjs` | 配置读写、注入行、Range 服务（视频+图片）、游戏页面、路由与状态码 —— 33 项 |
| `node tools/browser-check.mjs` | 真实 Chromium 里：视频/图片/网页/小游戏四种模式 + 跳过 + 拆除 —— 14 项 |
| `ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe> --expose-internals tools/verify-install.mjs` | 用 DSH 自己的 profile 加载器验证：bundle 被组合进去了（loaded 而不是 skipped），Host 入口能解析 |

---

## 说明与限制

- 视频的 `moov` atom 在文件尾部，所以首帧之前浏览器要把整个 12 MB 抓下来；走 loopback 基本无感。素材如果真的变大，用 `-movflags +faststart` 重新封装就能消掉这个等待。
- 跳过和硬上限是刻意的设计：开机动画**永远**不应该有能力锁死窗口。
- 遮罩追加到 `body`，从不碰 `#root`，所以 React 的挂载点不受影响；拆除时它会连同自己的监听器和定时器一起收干净。
- `web` 模式加载的是**你给的**网页：如果你在设置里填了外网 URL，开机时 DSH 会去访问它。这是有意为之的能力，不是默认行为（默认是视频）。
- `assets/boot.mp4` 与本仓库的示例素材只作 550W 风味参考，与《流浪地球》官方无关。如果要公开分发本仓库，请自行确认你对该素材拥有相应权利。
