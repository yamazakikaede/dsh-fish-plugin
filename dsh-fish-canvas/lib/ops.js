/**
 * ops.js —— 三种动手：裁、写、拼
 *
 * 为什么是 ffmpeg + swift：
 *   - 这台机器的 ffmpeg 构建**没有 drawtext / libass**（没有 freetype），写不了字；
 *   - macOS 自带的 `/usr/bin/swift` 能用 CoreGraphics 精确画中文，0.4 秒一张；
 *   - 裁切、缩放、拼接交给 ffmpeg（crop / scale / pad / hstack / vstack）。
 * 三条路都不引 npm 依赖。
 */
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TIMEOUT_MS = 60_000
export const DRAW_TIMEOUT_MS = 120_000
const HERE = dirname(fileURLToPath(import.meta.url))
export const DRAW_SCRIPT = join(HERE, 'draw.swift')

/** execFile 的 Promise 版：永远不抛，失败回 `{ok:false, why}`。 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout ?? TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({
            ok: false,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            why: String(stderr || err.message || err).trim().slice(0, 300),
          })
        }
        resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), why: '' })
      },
    )
  })
}

/** 读一张图的宽高。不是图片会给出人话。 */
export async function probe(exec, file) {
  const r = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    file,
  ])
  if (!r.ok) throw new Error(`读不出这张图：${r.why}`)
  let j
  try { j = JSON.parse(r.stdout) } catch { throw new Error('读不出这张图：ffprobe 没有回 JSON') }
  const s = Array.isArray(j?.streams) ? j.streams[0] : null
  const width = Number(s?.width)
  const height = Number(s?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('这个文件不是图片（读不到宽高）。')
  }
  return { width, height }
}

/** 整数夹紧；不是数就用默认值。 */
export function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function validColor(v) {
  return /^#?[0-9a-fA-F]{6}$/.test(String(v ?? '').trim()) || /^#?[0-9a-fA-F]{3}$/.test(String(v ?? '').trim())
}

/** 一行字：去控制字符、把换行压成空格、截到 200 字。 */
export function sanitizeText(t) {
  return String(t ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * 裁出一块。
 * @returns {Promise<{width:number,height:number}>} 产物尺寸
 */
export async function crop(exec, { src, out, x, y, w, h }) {
  const dims = await probe(exec, src)
  const width = clampInt(w, 1, dims.width, dims.width)
  const height = clampInt(h, 1, dims.height, dims.height)
  const left = clampInt(x, 0, Math.max(0, dims.width - width), 0)
  const top = clampInt(y, 0, Math.max(0, dims.height - height), 0)
  const r = await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', src,
    '-vf', `crop=${width}:${height}:${left}:${top}`,
    '-frames:v', '1', '-y', out,
  ])
  if (!r.ok) throw new Error(`裁切失败：${r.why}`)
  return { width, height }
}

/** 在图上写一行字（swift 渲染，返回后原尺寸不变）。 */
export async function label(exec, { src, out, text, size, color, position, tmpDir }) {
  const line = sanitizeText(text)
  if (!line) throw new Error('没有要写的字。')
  const fontSize = clampInt(size, 8, 200, 36)
  const ink = validColor(color) ? String(color).trim() : '#ffffff'
  const place = ['top', 'center', 'bottom'].includes(String(position)) ? String(position) : 'bottom'
  const r = await exec('/usr/bin/swift', [
    '-module-cache-path', join(tmpDir, 'module-cache'),
    DRAW_SCRIPT, src, out, line, String(fontSize), ink, place,
  ], { timeout: DRAW_TIMEOUT_MS })
  if (!r.ok) {
    throw new Error(`写字失败（需要 macOS 自带的 swift）：${r.why.split('\n').slice(-1)[0] || '没有输出'}`)
  }
  return probe(exec, out)
}

/**
 * 拼接的滤镜图与成品尺寸（纯函数，方便单测）。
 * 横向：高度取最小的那张，每张等比缩放；竖向：宽度取最小。
 * 间隔用 pad 补在除最后一张以外的右侧/下侧。
 */
export function stitchPlan({ dims, direction = 'horizontal', gap = 8, gapColor = '#111111' }) {
  const list = Array.isArray(dims) ? dims : []
  if (list.length < 1) throw new Error('要拼的图是空的。')
  const dir = direction === 'vertical' ? 'vertical' : 'horizontal'
  const g = clampInt(gap, 0, 200, 8)
  const color = validColor(gapColor) ? `0x${String(gapColor).replace(/^#/, '')}` : '0x111111'

  const parts = []
  const labels = []
  let total = 0
  if (dir === 'horizontal') {
    const H = Math.min(...list.map((d) => d.height))
    for (let i = 0; i < list.length; i += 1) {
      const w = Math.max(2, Math.round((list[i].width * H) / list[i].height))
      const pad = i < list.length - 1 && g > 0 ? `,pad=iw+${g}:ih:0:0:color=${color}` : ''
      parts.push(`[${i}:v]scale=-2:${H},setsar=1${pad}[g${i}]`)
      labels.push(`[g${i}]`)
      total += w + (i < list.length - 1 ? g : 0)
    }
    parts.push(`${labels.join('')}hstack=inputs=${list.length}[out]`)
    return { filter: parts.join(';'), width: total, height: H, direction: dir, gap: g }
  }

  const W = Math.min(...list.map((d) => d.width))
  for (let i = 0; i < list.length; i += 1) {
    const h = Math.max(2, Math.round((list[i].height * W) / list[i].width))
    const pad = i < list.length - 1 && g > 0 ? `,pad=iw:ih+${g}:0:0:color=${color}` : ''
    parts.push(`[${i}:v]scale=${W}:-2,setsar=1${pad}[g${i}]`)
    labels.push(`[g${i}]`)
    total += h + (i < list.length - 1 ? g : 0)
  }
  parts.push(`${labels.join('')}vstack=inputs=${list.length}[out]`)
  return { filter: parts.join(';'), width: W, height: total, direction: dir, gap: g }
}

export async function stitch(exec, { files, out, direction = 'horizontal', gap = 8, gapColor = '#111111' }) {
  const list = Array.isArray(files) ? files.filter(Boolean) : []
  if (list.length < 1) throw new Error('要拼的图是空的。')
  if (list.length > 6) throw new Error('一次最多拼 6 张。')
  const dims = []
  for (const f of list) dims.push(await probe(exec, f))
  const plan = stitchPlan({ dims, direction, gap, gapColor })
  const args = ['-hide_banner', '-loglevel', 'error']
  for (const f of list) args.push('-i', f)
  args.push('-filter_complex', plan.filter, '-map', '[out]', '-frames:v', '1', '-y', out)
  const r = await exec('ffmpeg', args, { timeout: 120_000 })
  if (!r.ok) throw new Error(`拼接失败：${r.why}`)
  return { width: plan.width, height: plan.height }
}

/** 这张图多大、什么格式、多少字节。 */
export async function info(exec, file) {
  const dims = await probe(exec, file)
  const st = await fsp.stat(file)
  return { ...dims, bytes: st.size }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i

/**
 * 列一个目录里的图（新的在前）。只认图片扩展名，不递归。
 * 给她「我看不见那个目录」一个能看的入口。
 */
export async function listImages(dir, { limit = 20 } = {}) {
  let names = []
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    if (!IMAGE_EXT.test(name)) continue
    try {
      const st = await fsp.stat(join(dir, name))
      if (!st.isFile()) continue
      rows.push({ name, bytes: st.size, mtime: st.mtimeMs })
    } catch { /* 读不到就跳过 */ }
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  const n = clampInt(limit, 1, 100, 20)
  return rows.slice(0, n)
}
