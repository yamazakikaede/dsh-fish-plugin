# dsh-fish-plugin

给 [dsh-fish](https://github.com/ssamurias/dsh-fish)（大肥鱼）的私人插件集合。按主包的《第三方插件约定（v1）》维护：独立 DSH 插件、零依赖、工具靠 `config.tools.allow` 放行、不碰她的事件流/配置/身份。

## 里面有什么

| 插件 | 工具 | 做什么 |
|---|---|---|
| [`dsh-fish-mirror`](dsh-fish-mirror/) | `her_mirror` | 照镜子：只读 `<数据目录>/avatar.*`（退 `mirror.*`），把路径交给她自己用 `read_image` 看。没有图就照实说「镜子里是空的」。 |
| [`dsh-fish-tts`](dsh-fish-tts/) | `her_micro` | 说一句：按情绪合成语音，回一行 ` ```fish-voice ` 围栏，对话里出现可点的播放器。支持本地 macOS `say` 与 OpenAI 兼容 TTS 接口。 |

两个插件都不 import 主包模块，主包升级不会影响它们。

## 安装

```sh
dsh plugin --profile desktop add "link:<本仓库>/dsh-fish-mirror"
dsh plugin --profile desktop add "link:<本仓库>/dsh-fish-tts"
```

再把两个工具名写进 dsh-fish 的 `config.json`：

```json
{ "tools": { "allow": ["her_mirror", "her_micro"] } }
```

（设置页「手上能用什么 → 白名单」里加也行。）重启 DSH 一次，宿主侧的工具与路由才会装配。

## 数据目录

插件包不写死本机路径。`root` 取值顺序：插件配置 → `DSH_FISH_HOME` → `~/.dsh-fish`。

数据目录不在默认位置时，在**自己 profile** 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: fish-mirror
  name: dsh-fish-mirror
  config:
    root: <你的数据目录>
- id: fish-tts
  name: dsh-fish-tts
  config:
    root: <你的数据目录>
```

## 边界（按约定 v1）

- **不写她的数据**：不碰 `events.jsonl`、不改 `config.json` 的人格键、不动 `state.json` / `她的身份.md`。镜子只读头像；语音只往 `<数据目录>/voice/` 落产物（是她说出口的东西，不是她的状态）。
- **没有人格入口**：两个工具都只做「多一种能做的事」。
- **外发只说清**：`her_micro` 用本地 `say` 时不出网；用 OpenAI 兼容接口时，只把**她要说的那句话**发到你配置的端点，不发事件流/日记/历史。
- **零依赖、无安装脚本、各带 `node:test`**。

## 开发

每个插件目录各自独立：

```sh
cd dsh-fish-mirror && npm test
cd dsh-fish-tts && npm test
```

## 许可

MIT（见各插件内 `LICENSE`；未附带时以本仓库根许可为准）。
