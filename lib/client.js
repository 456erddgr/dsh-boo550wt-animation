/**
 * dsh-boo550wt-animation — browser half.
 *
 * Adds a "开机动画" section to the DSH Settings shell (the `settings.section`
 * slot) that edits this plugin's /boot-animation/config route. The boot
 * overlay itself is driven by the injected script from the Host half; this
 * module only exists so the user can change what the overlay shows.
 *
 * Settings live in one JSON file under the DSH home, read by the Host at boot
 * and by the injected page script at page load, so a change made here takes
 * effect on the next DSH start.
 */

window.__ModuleLoader__.load({
  id: "dsh-boo550wt-animation",
  factory(require) {
    var React = require("react");
    var h = React.createElement;

    var BASE = "/boot-animation";

    var MODES = [
      { id: "video", label: "视频" },
      { id: "image", label: "图片" },
      { id: "web", label: "网页" },
      { id: "game", label: "小游戏" },
    ];

    var LABELS = {
      mode: "开机动画类型",
      videoPath: "视频文件路径",
      imagePath: "图片文件路径",
      webUrl: "网页地址或本地文件路径",
      game: "内置小游戏",
      durationMs: "显示时长（毫秒，图片/网页用）",
      maxSeconds: "硬上限（秒）",
      fadeMs: "淡出时长（毫秒）",
      skipHint: "跳过提示",
      hintDelayMs: "提示出现延迟（毫秒）",
    };

    function Form() {
      var state = React.useState(null);
      var settings = state[0];
      var setSettings = state[1];
      var saving = React.useState(false)[0];
      var setSaving = React.useState(false)[1];
      var message = React.useState("")[0];
      var setMessage = React.useState("")[1];

      React.useEffect(function () {
        fetch(BASE + "/config")
          .then(function (res) { return res.json(); })
          .then(setSettings)
          .catch(function () { setMessage("无法读取设置"); });
      }, []);

      function patch(next) {
        setSettings(function (prev) { return Object.assign({}, prev, next); });
      }

      function save() {
        setSaving(true);
        setMessage("");
        fetch(BASE + "/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            setSaving(false);
            setSettings(data);
            setMessage("已保存，下次启动生效");
          })
          .catch(function () {
            setSaving(false);
            setMessage("保存失败");
          });
      }

      if (settings === null) {
        return h("div", { className: "dsh-boo550wt-settings" }, "加载中…");
      }

      var rows = [
        h("div", { className: "row" },
          h("label", null, LABELS.mode),
          h("select", {
            value: settings.mode,
            onChange: function (e) { patch({ mode: e.target.value }); },
          }, MODES.map(function (m) {
            return h("option", { key: m.id, value: m.id }, m.label);
          })),
        ),
      ];

      if (settings.mode === "video") {
        rows.push(field(settings, "videoPath", patch, LABELS));
      } else if (settings.mode === "image") {
        rows.push(field(settings, "imagePath", patch, LABELS));
      } else if (settings.mode === "web") {
        rows.push(field(settings, "webUrl", patch, LABELS));
      } else if (settings.mode === "game") {
        rows.push(h("div", { className: "row" },
          h("label", null, LABELS.game),
          h("select", {
            value: settings.game,
            onChange: function (e) { patch({ game: e.target.value }); },
          }, h("option", { value: "snake" }, "贪吃蛇")),
        ));
      }

      if (settings.mode === "image" || settings.mode === "web") {
        rows.push(numberField(settings, "durationMs", patch, LABELS));
      }
      rows.push(numberField(settings, "maxSeconds", patch, LABELS));
      rows.push(numberField(settings, "fadeMs", patch, LABELS));
      rows.push(numberField(settings, "hintDelayMs", patch, LABELS));
      rows.push(field(settings, "skipHint", patch, LABELS));

      return h("div", { className: "dsh-boo550wt-settings" },
        h("p", { className: "intro" },
          "设置开机时全屏展示的内容。图片/网页/小游戏显示 " + settings.durationMs + " ms 后自动进入。"),
        rows,
        h("div", { className: "actions" },
          h("button", { onClick: save, disabled: saving }, saving ? "保存中…" : "保存"),
          message ? h("span", { className: "msg" }, message) : null,
        ),
      );
    }

    function field(settings, key, patch, labels) {
      return h("div", { className: "row" },
        h("label", { htmlFor: key }, labels[key]),
        h("input", {
          id: key,
          type: "text",
          value: settings[key] ?? "",
          placeholder: "留空使用自带素材",
          onChange: function (e) {
            var next = {};
            next[key] = e.target.value;
            patch(next);
          },
        }),
      );
    }

    function numberField(settings, key, patch, labels) {
      return h("div", { className: "row" },
        h("label", { htmlFor: key }, labels[key]),
        h("input", {
          id: key,
          type: "number",
          min: 0,
          value: settings[key],
          onChange: function (e) {
            var next = {};
            next[key] = Number(e.target.value);
            patch(next);
          },
        }),
      );
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",
            id: "boot-animation",
            order: 200,
            label: function () { return "开机动画"; },
          }, Form);
        });
      },
    };
  },
});
