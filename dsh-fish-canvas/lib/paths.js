/**
 * paths.js —— 允许读哪些图、产物放哪
 *
 * 两条规矩：
 *   1. **只读她自己的数据目录和临时目录**（再加配置里显式放行的额外目录）。
 *      读图要再解析一次真实路径，防符号链接从允许目录指到别处。
 *   2. 产物落在 `<数据目录>/media/`（和 bili_watch 的拼图放在一起）——
 *      canvas/ 那个目录她从没见过，回话说「放在 canvas/ 下」等于让她看不见
 *      自己做了什么。文件名带 `canvas-` 前缀，不覆盖旧图。
 */
import { realpathSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** child 是否在 parent 里面（含相等）。两边都按 resolve 后的绝对路径比。 */
export function isInside(parent, child) {
  const p = resolve(String(parent ?? ''))
  const c = resolve(String(child ?? ''))
  return c === p || c.startsWith(p + sep)
}

function realDir(dir) {
  try { return realpathSync(dir) } catch { return resolve(String(dir)) }
}

/**
 * 造一个输入检查函数：给一个路径，返回真实路径或抛一句人话。
 * @param {{root:string, allow?:string[]}} opts
 */
export function makeInputGuard({ root, allow = [] } = {}) {
  const dirs = [root, tmpdir(), ...(Array.isArray(allow) ? allow : [])]
    .filter(Boolean)
    .map(realDir)
  return (p) => {
    const raw = String(p ?? '').trim()
    if (!raw) throw new Error('要给一个图片路径。')
    let real
    try {
      real = realpathSync(raw)
    } catch {
      throw new Error(`找不到这张图：${raw}`)
    }
    if (!dirs.some((d) => isInside(d, real))) {
      throw new Error('只能改数据目录或临时目录里的图；别的路径读不到（也没打算读）。')
    }
    return real
  }
}

const pad2 = (n) => String(n).padStart(2, '0')

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function hhmmss(date) {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

/** 她看图的那个目录：`<数据目录>/media/`。 */
export function mediaDir(root) {
  return join(String(root), 'media')
}

/**
 * 下一次产物的路径：`<数据目录>/media/canvas-<动作>-<日期>-<时分秒>-<6位哈希>.png`
 * 哈希里带时间戳与 seed，连续两次调用也不会撞名。
 */
export function outputFor(root, action, { date = new Date(), seed = '' } = {}) {
  const dir = mediaDir(root)
  const hash = createHash('sha1')
    .update(`${action}|${date.getTime()}|${String(seed)}`)
    .digest('hex')
    .slice(0, 6)
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${hhmmss(date)}`
  return { dir, file: join(dir, `canvas-${action}-${stamp}-${hash}.png`) }
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** 交给模型的路径一律用正斜杠（反斜杠写进 markdown 图片会显示不出来）。 */
export function toSlashes(p) {
  return String(p ?? '').replace(/\\/g, '/')
}
