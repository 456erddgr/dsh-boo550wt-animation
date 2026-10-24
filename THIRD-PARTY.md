# Third-party notices

This package vendors the following projects. Their licences are included next
to their sources.

## The Earth Migration Project

- Source: https://github.com/oxomkbk/earth-migration
- Licence: MIT (`vendor/earth-migration/LICENSE`)
- Vendored at: `vendor/earth-migration/`
- Used for both 3D boot scenes:

  | 文件 | 用在哪 |
  | --- | --- |
  | `index.html` / `beyond.html` / `ignite.html` | 上游原样保留，供离线核对 |
  | `beyond-boot.html` | 本包自己的「流浪地球 2.0」开机讲解页（第二部） |
  | `js/app.js`、`js/fx/*`、`css/app.css` | 第一部（行星发动机计划） |
  | `js/beyond/*`、`css/beyond.css` | 第二部（从发动机到银河） |
  | `assets/` | 两部共用的贴图、模型、星空 |

  上游的引擎、相机、着色器、模型与章节时间轴都没有改动，第二部的状态栏与
  事件日志也保持原样；本包只新增了两个开机页（`ignite.html` 的中文讲解层、
  `beyond-boot.html`），负责自动播放、中文解说、播完通知宿主页。自由查看的
  入口仍是上游自己的 EXPLORE 按钮与 F 键。

## three.js

- Source: https://github.com/mrdoob/three.js
- Licence: MIT (`vendor/earth-migration/vendor/three/LICENSE`)
- Vendored at: `vendor/earth-migration/vendor/three/`
- Version: r160, as shipped by the project above.

## 素材来源

上游 `assets/planets/*`、`assets/earth/*`、`assets/sky/*` 来自 NASA 影像与
three.js 官方示例贴图（公有领域/示例素材），`assets/models/*.glb` 来自
NASA 3D Resources（公有领域）。许可与来源以上游仓库说明为准。

## 配乐

- 文件：`vendor/earth-migration/assets/audio/theme.m4a`（9.8 MB）
- 来源：本包作者的原创录音（原始工程 `10月24日 .wav`，7 分 04.8 秒，
  44.1 kHz / 16-bit 立体声，PCM 1411 kbps），此处转成 AAC 192 kbps 随包分发。
- 用途：「流浪地球 2.0」开机讲解的音乐床，循环播放，音量压在解说之下。
- 上游原本用 WebAudio 程序化合成音效（drone / pad / rumble / shimmer），
  本包已把 `js/beyond/audio.js` 的整体替换为播放这首录音，对外 API 不变。

Both licences permit redistribution and modification with attribution; the
notices above and the licence files satisfy that requirement.
