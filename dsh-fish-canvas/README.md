# dsh-fish-canvas

给 [dsh-fish](https://github.com/ssamurias/dsh-fish)（大肥鱼）一把改图的刀：工具 `her_canvas`，四种动作。

| action | 做什么 | 参数 |
|---|---|---|
| `crop` | 从一张图里裁出一块 | `src` + `x` / `y` / `w` / `h`（像素，左上角为 0） |
| `label` | 在图上写一行字 | `src` + `text`，可选 `size`（8–200）/ `color`（如 `#ffffff`）/ `position`（top / center / bottom） |
| `stitch` | 把 2–6 张图拼成一排 | `files[]` + `direction`（horizontal / vertical），可选 `gap`（0–200） |
| `info` | 看一张图多大 | `src` |

成品落在 `<数据目录>/canvas/<日期>/` 下，每次一个新文件名；工具会回一行可以直接贴进对话的 markdown 图片：

```
已做好：/…/canvas/2026-11-20/label-210506-a1b2c3.png
要贴进对话就照抄这一行：![图](/…/canvas/2026-11-20/label-210506-a1b2c3.png)
```

## 靠什么做的

零依赖：**裁切 / 缩放 / 拼接用本机 ffmpeg**，**写字用 macOS 自带的 `/usr/bin/swift`**（CoreGraphics 画中文，0.4 秒一张）。

- `ffmpeg` / `ffprobe`：裁切、拼接、读尺寸都要它
- `swift`：只有 `label` 用；没有它的机器，裁切与拼接照常可用，写字会回一句「需要 macOS 自带的 swift」

## 读哪些图、写到哪

- **只读**：`<数据目录>`、系统临时目录，以及配置里 `allow` 显式放行的额外目录。别处的路径一律拒绝（读之前会再解析一次真实路径，防符号链接绕出去）。
- **只写**：`<数据目录>/canvas/<日期>/`。不写事件流、不改配置、不碰她的身份文件。
- 不联网。

## 安装

```sh
dsh plugin --profile desktop add "link:<本仓库>/dsh-fish-canvas"
```

再把工具名加进 dsh-fish 的 `config.json`：

```json
{ "tools": { "allow": ["her_canvas"] } }
```

（设置页「手上能用什么 → 白名单」里加也行。）重启 DSH 一次。

## 数据目录

插件包不写死本机路径。`root` 取值顺序：插件配置 → `DSH_FISH_HOME` → `~/.dsh-fish`。

数据目录不在默认位置时，在自己的 **profile** 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: fish-canvas
  name: dsh-fish-canvas
  config:
    root: <你的数据目录>
    allow: []        # 想让它能读工作区里的图，在这里加目录
```

## 测试

```sh
npm test
```

纯函数（路径守卫、尺寸夹紧、拼接滤镜）不依赖外部工具；真链路那一条在缺 ffmpeg / swift 的机器上会自动跳过。
