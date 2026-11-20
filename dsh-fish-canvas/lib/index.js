/**
 * dsh-fish-canvas —— 给大肥鱼一把改图的刀
 *
 * 一个工具 `her_canvas`，五种动作：
 *   crop    裁出一块
 *   label   在图上写一行字
 *   stitch  把几张拼在一起
 *   info    看这张图多大
 *   list    看 media/ 里有哪些图（她看不见目录时的入口）
 *
 * 只读她自己的数据目录与临时目录；产物落在 `<数据目录>/media/`，
 * 和 bili_watch 的拼图放在一起——那里她认得，也读得到。
 * 不写事件流、不改配置、不联网。
 */
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeInputGuard, outputFor, ensureDir, mediaDir, toSlashes } from './paths.js'
import { run, info, crop, label, stitch, listImages } from './ops.js'

export const name = 'dsh-fish-canvas'
export const inject = ['tools']

export const ACTIONS = Object.freeze(['crop', 'label', 'stitch', 'info', 'list'])

const DESCRIPTION =
  '给她一把改图的刀：action 选 crop / label / stitch / info / list。'
  + 'crop 从一张图里裁出一块（src + x/y/w/h，坐标是像素，左上角为 0）；'
  + 'label 在图上写一行字（src + text，可选 size 字号 / color 颜色 / position 放上中下）；'
  + 'stitch 把 2–6 张图拼成一排（files + direction 横或竖，可选 gap 间隔）；'
  + 'info 看一张图的尺寸；list 看 media/ 里有哪些图（新的在前，可带 limit）。'
  + '只改数据目录和临时目录里的图；成品落在数据目录的 media/ 下（和 bili_watch 的拼图同一个地方），'
  + '并回你一行可直接贴进对话的 markdown 图片。'

export function toolSpec({ root, allow = [], exec = run } = {}) {
  const check = makeInputGuard({ root, allow })
  return {
    name: 'her_canvas',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: '要做什么。' },
        src: { type: 'string', description: 'crop / label / info 用的那张图。' },
        x: { type: 'integer', description: 'crop 的左上角横坐标（像素）。' },
        y: { type: 'integer', description: 'crop 的左上角纵坐标（像素）。' },
        w: { type: 'integer', description: 'crop 的宽度（像素）。' },
        h: { type: 'integer', description: 'crop 的高度（像素）。' },
        text: { type: 'string', description: 'label 要写的那一行字。' },
        size: { type: 'integer', description: 'label 的字号（8–200，默认 36）。' },
        color: { type: 'string', description: 'label 的字色，如 #ffffff。' },
        position: { type: 'string', enum: ['top', 'center', 'bottom'], description: 'label 把字放在哪。' },
        files: { type: 'array', items: { type: 'string' }, description: 'stitch 要拼的图（2–6 张）。' },
        direction: { type: 'string', enum: ['horizontal', 'vertical'], description: 'stitch 横着拼还是竖着拼。' },
        gap: { type: 'integer', description: 'stitch 的间隔像素（0–200，默认 8）。' },
        limit: { type: 'integer', description: 'list 最多列几张（1–100，默认 20）。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          path: { type: 'string' },
          markdown: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          bytes: { type: 'number' },
          count: { type: 'number' },
          files: { type: 'array', items: { type: 'object' } },
          why: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_args, out) => {
        if (!out?.ok) return [{ type: 'text', text: String(out?.why || '没做成。') }]
        if (out.action === 'info') {
          return [{ type: 'text', text: `${out.path}：${out.width}×${out.height}，${out.bytes} 字节` }]
        }
        if (out.action === 'list') {
          const list = Array.isArray(out.files) ? out.files : []
          if (!list.length) return [{ type: 'text', text: 'media/ 里现在没有图。' }]
          const lines = list.map((f) => `- ${f.name}（${Math.max(1, Math.round(f.bytes / 1024))} KB，${f.at}）`)
          return [{ type: 'text', text: `media/ 里有这些图（新的在前，共 ${out.count} 张）：\n${lines.join('\n')}\n要看哪张就把它给 info / crop / label。` }]
        }
        return [{ type: 'text', text: `已做好：${out.path}\n要贴进对话就照抄这一行：${out.markdown}` }]
      },
    },
    async execute(args = {}) {
      const action = String(args?.action ?? '').trim()
      if (!ACTIONS.includes(action)) {
        return { ok: false, why: `action 只能是 ${ACTIONS.join(' / ')}。` }
      }
      try {
        if (action === 'list') {
          const rows = await listImages(mediaDir(root), { limit: args?.limit })
          const fmt = (ms) => {
            const d = new Date(Number(ms) || Date.now())
            const p = (n) => String(n).padStart(2, '0')
            return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
          }
          return {
            ok: true,
            action,
            count: rows.length,
            files: rows.map((r) => ({ name: r.name, bytes: r.bytes, at: fmt(r.mtime) })),
          }
        }

        if (action === 'info') {
          const file = check(args?.src)
          const d = await info(exec, file)
          return { ok: true, action, path: toSlashes(file), width: d.width, height: d.height, bytes: d.bytes }
        }

        if (action === 'crop') {
          const src = check(args?.src)
          const out = outputFor(root, 'crop', { seed: src })
          await ensureDir(out.dir)
          const d = await crop(exec, { src, out: out.file, x: args?.x, y: args?.y, w: args?.w, h: args?.h })
          return { ok: true, action, path: toSlashes(out.file), markdown: `![图](${toSlashes(out.file)})`, ...d }
        }

        if (action === 'label') {
          const src = check(args?.src)
          const out = outputFor(root, 'label', { seed: src })
          await ensureDir(out.dir)
          const d = await label(exec, {
            src,
            out: out.file,
            text: args?.text,
            size: args?.size,
            color: args?.color,
            position: args?.position,
            tmpDir: tmpdir(),
          })
          return { ok: true, action, path: toSlashes(out.file), markdown: `![图](${toSlashes(out.file)})`, ...d }
        }

        // stitch
        const files = (Array.isArray(args?.files) ? args.files : []).map((f) => check(f))
        if (files.length < 2) return { ok: false, why: '拼图至少要两张。' }
        const out = outputFor(root, 'stitch', { seed: files.join('|') })
        await ensureDir(out.dir)
        const d = await stitch(exec, {
          files,
          out: out.file,
          direction: args?.direction,
          gap: args?.gap,
        })
        return { ok: true, action, path: toSlashes(out.file), markdown: `![图](${toSlashes(out.file)})`, ...d }
      } catch (err) {
        return { ok: false, why: String(err?.message ?? err).slice(0, 300) }
      }
    },
  }
}

export function apply(ctx, config = {}) {
  const root = String(config.root || process.env.DSH_FISH_HOME || join(homedir(), '.dsh-fish'))
  const allow = Array.isArray(config.allow) ? config.allow : []
  const off = ctx.tools.register(toolSpec({ root, allow }))
  if (typeof off === 'function') return () => off()
  if (off && typeof off.dispose === 'function') return () => off().dispose?.()
  return () => {}
}
