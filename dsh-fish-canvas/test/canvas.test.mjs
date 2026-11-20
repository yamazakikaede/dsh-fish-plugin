/**
 * 纯函数先钉形状；有 ffmpeg/swift 的机器上再跑一遍真链路（没有就跳过）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isInside, outputFor, dateKey, makeInputGuard, toSlashes } from '../lib/paths.js'
import { clampInt, validColor, sanitizeText, stitchPlan, probe, info, listImages, run } from '../lib/ops.js'
import { toolSpec } from '../lib/index.js'

// ---------------------------------------------------------------- 纯函数

test('isInside：只认真正的子路径', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true)
  assert.equal(isInside('/a/b', '/a/b'), true)
  assert.equal(isInside('/a/b', '/a/bc'), false)
  assert.equal(isInside('/a/b', '/a'), false)
})

test('产物路径：日期目录 + 动作 + 时间 + 哈希，两次不撞名', () => {
  const d1 = new Date(2026, 10, 20, 21, 5, 6)
  const a = outputFor('/root', 'crop', { date: d1, seed: 'x' })
  const b = outputFor('/root', 'crop', { date: d1, seed: 'y' })
  assert.equal(dateKey(d1), '2026-11-20')
  assert.match(a.file, /\/root\/media\/canvas-crop-20261120-210506-[0-9a-f]{6}\.png$/)
  assert.notEqual(a.file, b.file)
})

test('clampInt：夹紧、取整、坏值回默认', () => {
  assert.equal(clampInt(999, 1, 100, 50), 100)
  assert.equal(clampInt(-3, 0, 10, 5), 0)
  assert.equal(clampInt('7.6', 0, 10, 0), 8)
  assert.equal(clampInt('x', 0, 10, 5), 5)
})

test('颜色：三位/六位都认，其他不认', () => {
  assert.equal(validColor('#fff'), true)
  assert.equal(validColor('112233'), true)
  assert.equal(validColor('red'), false)
  assert.equal(validColor('#12345'), false)
})

test('一行字：换行压空格、控制字符去掉、截到 200', () => {
  assert.equal(sanitizeText('你好\n世界'), '你好 世界')
  assert.equal(sanitizeText('  a\u0000b  '), 'a b')
  assert.equal(sanitizeText('字'.repeat(500)).length, 200)
})

test('stitchPlan 横向：高度取最小、间距补在右边', () => {
  const p = stitchPlan({ dims: [{ width: 800, height: 450 }, { width: 400, height: 450 }], direction: 'horizontal', gap: 8 })
  assert.equal(p.height, 450)
  assert.equal(p.width, 800 + 400 + 8)
  assert.match(p.filter, /hstack=inputs=2/)
  assert.match(p.filter, /pad=iw\+8:ih:0:0/)
})

test('stitchPlan 竖向：宽度取最小、间距补在下边', () => {
  const p = stitchPlan({ dims: [{ width: 400, height: 300 }, { width: 400, height: 200 }], direction: 'vertical', gap: 12 })
  assert.equal(p.width, 400)
  assert.equal(p.height, 300 + 200 + 12)
  assert.match(p.filter, /vstack=inputs=2/)
  assert.match(p.filter, /pad=iw:ih\+12:0:0/)
})

test('输入守卫：临时目录里的图能读，外面的不读', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-guard-'))
  try {
    const f = join(dir, 'a.png')
    await (await import('node:fs/promises')).writeFile(f, 'x')
    const check = makeInputGuard({ root: dir })
    const real = await (await import('node:fs/promises')).realpath(f)
    assert.equal(check(f), real)
    assert.throws(() => check('/etc/hosts'), /只能改数据目录或临时目录/)
    assert.throws(() => check(join(dir, 'missing.png')), /找不到这张图/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('toSlashes：只换反斜杠', () => {
  assert.equal(toSlashes('C:\\a\\b.png'), 'C:/a/b.png')
  assert.equal(toSlashes('/a/b.png'), '/a/b.png')
})

// ---------------------------------------------------------------- 真链路

async function has(bin) {
  const r = await run(bin, ['-version'])
  return r.ok
}
async function hasFile(p) {
  try { await access(p); return true } catch { return false }
}

test('真链路：造图 → 看尺寸 → 裁 → 拼 → 写字（缺工具的机器跳过）', async (t) => {
  if (!(await has('ffmpeg'))) return t.skip('没有 ffmpeg')
  if (!(await has('ffprobe'))) return t.skip('没有 ffprobe')

  const root = await mkdtemp(join(tmpdir(), 'canvas-e2e-'))
  try {
    const base = join(root, 'base.png')
    const mk = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2b2b2b:s=800x450', '-frames:v', '1', '-y', base])
    assert.equal(mk.ok, true, mk.why)

    const spec = toolSpec({ root })
    const infoOut = await spec.execute({ action: 'info', src: base })
    assert.equal(infoOut.ok, true, infoOut.why)
    assert.equal(infoOut.width, 800)
    assert.equal(infoOut.height, 450)

    const cropped = await spec.execute({ action: 'crop', src: base, x: 10, y: 20, w: 200, h: 150 })
    assert.equal(cropped.ok, true, cropped.why)
    assert.equal(cropped.width, 200)
    assert.equal(cropped.height, 150)
    assert.ok(cropped.path.includes('/media/canvas-crop-'), '产物应落在 media/ 下')
    assert.ok((await stat(cropped.path)).size > 0)

    const listed = await spec.execute({ action: 'list' })
    assert.equal(listed.ok, true, listed.why)
    assert.ok(listed.count >= 1)
    assert.ok(listed.files.some((f) => f.name.startsWith('canvas-crop-')))

    const stitched = await spec.execute({ action: 'stitch', src: base, files: [base, base], direction: 'horizontal', gap: 10 })
    assert.equal(stitched.ok, true, stitched.why)
    assert.equal(stitched.width, 800 + 800 + 10)
    assert.equal(stitched.height, 450)

    if (!(await hasFile('/usr/bin/swift'))) return t.skip('没有 swift，跳过写字')
    const labeled = await spec.execute({ action: 'label', src: base, text: '你好，第一行字。', size: 40 })
    assert.equal(labeled.ok, true, labeled.why)
    assert.equal(labeled.width, 800)
    assert.equal(labeled.height, 450)
    assert.ok((await stat(labeled.path)).size > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('listImages：只列图片、新的在前、坏目录不抛', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-list-'))
  try {
    const fsp = await import('node:fs/promises')
    await fsp.writeFile(join(dir, 'a.png'), 'x')
    await fsp.writeFile(join(dir, 'b.txt'), 'x')
    await new Promise((r) => setTimeout(r, 20))
    await fsp.writeFile(join(dir, 'c.jpg'), 'y')
    const rows = await listImages(dir)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].name, 'c.jpg')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  assert.deepEqual(await listImages(join(tmpdir(), 'no-such-dir-xyz')), [])
})
