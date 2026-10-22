/**
 * dsh-boo550wt-animation — browser half.
 *
 * Adds a "开机动画" section to the DSH Settings shell (the `settings.section`
 * slot) that edits this plugin's /boot-animation/config route and manages the
 * plugin's own upload directory: you can drop in a video, picture or HTML page
 * and pick it as the boot animation without touching any path by hand.
 *
 * The boot overlay itself is driven by the injected script from the Host half;
 * this module only exists so the user can change what the overlay shows.
 */

window.__ModuleLoader__.load({
  id: "dsh-boo550wt-animation",
  factory(require) {
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useState = React.useState;
    var useRef = React.useRef;

    var BASE = "/boot-animation";

    var MODES = [
      { id: "video", label: "视频", accept: "video/mp4,video/webm", hint: "MP4 / WEBM，带声音播放" },
      { id: "image", label: "图片", accept: "image/png,image/jpeg,image/gif,image/webp", hint: "PNG / JPG / GIF / WEBP" },
      { id: "web", label: "网页", accept: "text/html", hint: "本地 HTML 文件，或填一个网址" },
      { id: "game", label: "小游戏", accept: "", hint: "内置小游戏，通关后进入" },
    ];

    function fmtBytes(n) {
      if (typeof n !== "number" || !isFinite(n)) return "";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    /** Upload one file, reporting progress through onProgress(0..1). */
    function uploadFile(file, title, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", BASE + "/upload?title=" + encodeURIComponent(title || file.name));
        xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = function () {
          var body = {};
          try { body = JSON.parse(xhr.responseText || "{}"); } catch (e) { body = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error || "上传失败（HTTP " + xhr.status + "）"));
        };
        xhr.onerror = function () { reject(new Error("网络错误")); };
        xhr.send(file);
      });
    }

    function Section() {
      var state = useState(null);
      var settings = state[0];
      var setSettings = state[1];

      var uploadsState = useState([]);
      var uploads = uploadsState[0];
      var setUploads = uploadsState[1];

      var busyState = useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];
      var progressState = useState(0);
      var progress = progressState[0];
      var setProgress = progressState[1];
      var messageState = useState("");
      var message = messageState[0];
      var setMessage = messageState[1];
      var dirtyState = useState(false);
      var dirty = dirtyState[0];
      var setDirty = dirtyState[1];
      var fileRef = useRef(null);

      function refreshUploads() {
        fetch(BASE + "/uploads")
          .then(function (r) { return r.json(); })
          .then(function (d) { setUploads(d.uploads || []); })
          .catch(function () { /* keep the old list */ });
      }

      useEffect(function () {
        fetch(BASE + "/config")
          .then(function (r) { return r.json(); })
          .then(setSettings)
          .catch(function () { setMessage("无法读取设置"); });
        refreshUploads();
      }, []);

      function patch(next) {
        setSettings(function (prev) { return Object.assign({}, prev, next); });
        setDirty(true);
      }

      function save() {
        setBusy("save");
        setMessage("");
        fetch(BASE + "/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            setBusy("");
            setSettings(data);
            setDirty(false);
            setMessage("已保存 · 下次启动 DSH 时生效");
          })
          .catch(function () {
            setBusy("");
            setMessage("保存失败");
          });
      }

      function pick(file) {
        if (!file) return;
        setBusy("upload");
        setProgress(0);
        setMessage("");
        uploadFile(file, file.name, setProgress)
          .then(function (entry) {
            setBusy("");
            refreshUploads();
            // Select it right away so the new asset is what boots next.
            var key = entry.kind === "video" ? "videoUpload"
              : entry.kind === "image" ? "imageUpload" : "webUpload";
            var next = { mode: entry.kind === "web" ? "web" : entry.kind };
            next[key] = entry.name;
            patch(next);
            setMessage(entry.duplicate ? "这个文件已经在列表里了：" + entry.title : "已上传：" + entry.title);
          })
          .catch(function (error) {
            setBusy("");
            setMessage(error.message);
          });
      }

      function removeUpload(entry) {
        if (!window.confirm("删除 " + entry.title + "？")) return;
        setBusy("remove");
        fetch(BASE + "/upload-remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: entry.name }),
        })
          .then(function () {
            setBusy("");
            refreshUploads();
            if (settings.videoUpload === entry.name) patch({ videoUpload: "" });
            if (settings.imageUpload === entry.name) patch({ imageUpload: "" });
            if (settings.webUpload === entry.name) patch({ webUpload: "" });
          })
          .catch(function () { setBusy(""); setMessage("删除失败"); });
      }

      if (settings === null) {
        return h("div", { className: "dshb-section" }, h("p", { className: "dshb-muted" }, "加载中…"));
      }

      var modeDef = MODES.filter(function (m) { return m.id === settings.mode; })[0] || MODES[0];
      var pickerKey = settings.mode === "video" ? "videoUpload"
        : settings.mode === "image" ? "imageUpload" : "webUpload";
      var matching = uploads.filter(function (u) {
        if (settings.mode === "game") return false;
        if (settings.mode === "web") return u.kind === "web";
        return u.kind === settings.mode;
      });

      return h("div", { className: "dshb-section" },
        h("p", { className: "dshb-intro" },
          "打开 DSH 时全屏展示的内容。播完、通关或按 Esc 才进入界面。"),

        // ---- mode ----
        h("div", { className: "dshb-field" },
          h("label", { className: "dshb-label" }, "类型"),
          h("div", { className: "dshb-modes" },
            MODES.map(function (m) {
              return h("button", {
                key: m.id,
                type: "button",
                className: "dshb-mode" + (settings.mode === m.id ? " dshb-mode-on" : ""),
                onClick: function () { patch({ mode: m.id }); },
              },
                h("span", { className: "dshb-mode-label" }, m.label),
                h("span", { className: "dshb-mode-hint" }, m.hint),
              );
            }),
          ),
        ),

        // ---- game ----
        settings.mode === "game"
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "小游戏"),
              h("select", {
                value: settings.game,
                onChange: function (e) { patch({ game: e.target.value }); },
              }, h("option", { value: "snake" }, "贪吃蛇")),
            )
          : null,

        // ---- upload picker ----
        settings.mode !== "game"
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "素材"),
              h("div", { className: "dshb-drop",
                  onClick: function () { if (fileRef.current) fileRef.current.click(); },
                  onDragOver: function (e) { e.preventDefault(); },
                  onDrop: function (e) {
                    e.preventDefault();
                    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                      pick(e.dataTransfer.files[0]);
                    }
                  },
                },
                h("input", {
                  ref: fileRef,
                  type: "file",
                  accept: modeDef.accept,
                  style: { display: "none" },
                  onChange: function (e) {
                    if (e.target.files && e.target.files[0]) pick(e.target.files[0]);
                    e.target.value = "";
                  },
                }),
                h("span", { className: "dshb-drop-icon" }, "+"),
                h("span", null,
                  busy === "upload"
                    ? "上传中… " + Math.round(progress * 100) + "%"
                    : "点击选择或拖入文件（" + modeDef.hint + "）"),
              ),
              busy === "upload"
                ? h("div", { className: "dshb-bar" }, h("i", { style: { width: Math.round(progress * 100) + "%" } }))
                : null,
            )
          : null,

        // ---- upload list ----
        matching.length > 0
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "已上传"),
              h("div", { className: "dshb-list" },
                matching.map(function (u) {
                  var selected = settings[pickerKey] === u.name;
                  return h("div", {
                    key: u.name,
                    className: "dshb-item" + (selected ? " dshb-item-on" : ""),
                  },
                    h("button", {
                      type: "button",
                      className: "dshb-item-pick",
                      onClick: function () {
                        var next = {};
                        next[pickerKey] = selected ? "" : u.name;
                        patch(next);
                      },
                    },
                      h("span", { className: "dshb-item-title" }, u.title),
                      h("span", { className: "dshb-item-meta" },
                        u.kind + (u.bytes ? " · " + fmtBytes(u.bytes) : "") + (selected ? " · 使用中" : "")),
                    ),
                    h("button", {
                      type: "button",
                      className: "dshb-item-del",
                      title: "删除",
                      onClick: function () { removeUpload(u); },
                    }, "×"),
                  );
                }),
              ),
            )
          : null,

        // ---- path fallbacks ----
        settings.mode === "video"
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "或填视频路径"),
              h("input", {
                type: "text",
                value: settings.videoPath || "",
                placeholder: "留空使用自带 550W 动画",
                onChange: function (e) { patch({ videoPath: e.target.value, videoUpload: "" }); },
              }),
            )
          : null,
        settings.mode === "image"
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "或填图片路径"),
              h("input", {
                type: "text",
                value: settings.imagePath || "",
                placeholder: "留空使用自带图片",
                onChange: function (e) { patch({ imagePath: e.target.value, imageUpload: "" }); },
              }),
            )
          : null,
        settings.mode === "web"
          ? h("div", { className: "dshb-field" },
              h("label", { className: "dshb-label" }, "或填网址"),
              h("input", {
                type: "text",
                value: settings.webUrl || "",
                placeholder: "https://… 或本地 HTML 绝对路径",
                onChange: function (e) { patch({ webUrl: e.target.value, webUpload: "" }); },
              }),
            )
          : null,

        // ---- sound ----
        settings.mode === "video"
          ? h("div", { className: "dshb-field dshb-row" },
              h("label", { className: "dshb-label" }, "播放声音"),
              h("input", {
                type: "checkbox",
                checked: settings.sound !== false,
                onChange: function (e) { patch({ sound: e.target.checked }); },
              }),
              h("span", { className: "dshb-muted" },
                settings.sound !== false
                  ? "带声音播放；浏览器拒绝自动播放时自动退回静音"
                  : "静音播放"),
            )
          : null,

        // ---- timing ----
        h("div", { className: "dshb-grid" },
          numField("显示时长（秒）", settings.durationMs / 1000, function (v) {
            patch({ durationMs: Math.max(1, v) * 1000 });
          }, (settings.mode === "image" || settings.mode === "web") ? 1 : 0.1),
          numField("硬上限（秒）", settings.maxSeconds, function (v) { patch({ maxSeconds: v }); }, 1),
          numField("淡出（毫秒）", settings.fadeMs, function (v) { patch({ fadeMs: v }); }, 10),
          numField("提示延迟（毫秒）", settings.hintDelayMs, function (v) { patch({ hintDelayMs: v }); }, 100),
        ),

        h("div", { className: "dshb-field" },
          h("label", { className: "dshb-label" }, "跳过提示"),
          h("input", {
            type: "text",
            value: settings.skipHint || "",
            onChange: function (e) { patch({ skipHint: e.target.value }); },
          }),
        ),

        // ---- actions ----
        h("div", { className: "dshb-actions" },
          h("button", {
            type: "button",
            className: "dshb-save",
            disabled: busy !== "" || !dirty,
            onClick: save,
          }, busy === "save" ? "保存中…" : dirty ? "保存" : "已保存"),
          message ? h("span", { className: "dshb-message" }, message) : null,
        ),

        h("p", { className: "dshb-note" },
          "设置保存在 ~/.dsh/boot-animation-settings.json，上传的素材在 ~/.dsh/boot-animation-uploads/。"),
      );
    }

    function numField(label, value, onChange, step) {
      return h("div", { className: "dshb-field" },
        h("label", { className: "dshb-label" }, label),
        h("input", {
          type: "number",
          step: step || 1,
          value: value,
          onChange: function (e) {
            var n = Number(e.target.value);
            if (isFinite(n)) onChange(n);
          },
        }),
      );
    }

    var CSS = [
      ".dshb-section{display:flex;flex-direction:column;gap:14px;font-size:13px}",
      ".dshb-intro{margin:0;color:var(--dsw-alias-label-secondary,#888);line-height:1.6}",
      ".dshb-field{display:flex;flex-direction:column;gap:6px}",
      ".dshb-row{flex-direction:row;align-items:center;gap:10px}",
      ".dshb-label{font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}",
      ".dshb-muted{color:var(--dsw-alias-label-secondary,#888);font-size:12px;line-height:1.5}",
      ".dshb-section input[type=text],.dshb-section input[type=number],.dshb-section select{",
      "width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;",
      "border:1px solid var(--dsw-alias-border-l2,#333);background:var(--dsw-alias-bg-l1,#121212);",
      "color:var(--dsw-alias-label-primary,#eee);font-size:13px;outline:none}",
      ".dshb-section input:focus,.dshb-section select:focus{border-color:var(--dsw-alias-brand-primary,#4c9aff)}",
      ".dshb-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}",
      ".dshb-mode{display:flex;flex-direction:column;gap:2px;align-items:flex-start;cursor:pointer;",
      "padding:9px 12px;border-radius:10px;text-align:left;",
      "border:1px solid var(--dsw-alias-border-l2,#333);background:var(--dsw-alias-bg-l1,#121212);",
      "color:var(--dsw-alias-label-primary,#eee);transition:border-color .15s,background .15s}",
      ".dshb-mode:hover{border-color:var(--dsw-alias-brand-primary,#4c9aff)}",
      ".dshb-mode-on{border-color:var(--dsw-alias-brand-primary,#4c9aff);",
      "background:var(--dsw-alias-bg-l2,#1b1b1b);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#4c9aff) inset}",
      ".dshb-mode-label{font-weight:600;font-size:13px}",
      ".dshb-mode-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#888)}",
      ".dshb-drop{display:flex;align-items:center;gap:10px;cursor:pointer;padding:14px;",
      "border:1px dashed var(--dsw-alias-border-l2,#3a3a3a);border-radius:10px;",
      "color:var(--dsw-alias-label-secondary,#999);transition:border-color .15s,color .15s}",
      ".dshb-drop:hover{border-color:var(--dsw-alias-brand-primary,#4c9aff);color:var(--dsw-alias-label-primary,#eee)}",
      ".dshb-drop-icon{font-size:16px;font-weight:600;line-height:1}",
      ".dshb-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-l2,#222);overflow:hidden}",
      ".dshb-bar i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c9aff);transition:width .15s}",
      ".dshb-list{display:flex;flex-direction:column;gap:6px}",
      ".dshb-item{display:flex;align-items:center;gap:8px;border-radius:9px;padding:8px 10px;",
      "border:1px solid var(--dsw-alias-border-l2,#2c2c2c);background:var(--dsw-alias-bg-l1,#121212)}",
      ".dshb-item-on{border-color:var(--dsw-alias-brand-primary,#4c9aff)}",
      ".dshb-item-pick{flex:1;display:flex;flex-direction:column;gap:2px;align-items:flex-start;",
      "background:none;border:0;cursor:pointer;color:inherit;text-align:left;padding:0}",
      ".dshb-item-title{font-weight:600;font-size:13px}",
      ".dshb-item-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#888)}",
      ".dshb-item-del{background:none;border:0;cursor:pointer;color:var(--dsw-alias-label-secondary,#888);",
      "font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}",
      ".dshb-item-del:hover{color:#ff6b6b;background:var(--dsw-alias-bg-l2,#1e1e1e)}",
      ".dshb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}",
      ".dshb-actions{display:flex;align-items:center;gap:12px;padding-top:4px}",
      ".dshb-save{padding:8px 20px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;",
      "border:1px solid var(--dsw-alias-brand-primary,#4c9aff);",
      "background:var(--dsw-alias-brand-primary,#4c9aff);color:#fff}",
      ".dshb-save:disabled{opacity:.45;cursor:default}",
      ".dshb-message{font-size:12px;color:var(--dsw-alias-label-secondary,#8a8)}",
      ".dshb-note{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary,#666);line-height:1.6}",
    ].join("");

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.effect(function () {
          var style = document.createElement("style");
          style.textContent = CSS;
          style.setAttribute("data-dsh-boo550wt-animation", "settings");
          document.head.appendChild(style);
          return function () {
            if (style.parentNode) style.parentNode.removeChild(style);
          };
        }, "boot-animation: settings stylesheet");

        ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",
            id: "boot-animation",
            order: 200,
            label: function () { return "开机动画"; },
          }, Section);
        });
      },
    };
  },
});
