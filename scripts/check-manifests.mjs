#!/usr/bin/env node
/**
 * 每个插件目录的清单自检。
 *
 * 为什么要有它：2026-11-20 给 canvas 装插件时，package.json 漏了
 * `dsh.bundle.patch`——宿主于是只把它当普通依赖，插件不挂载、工具不注册，
 * 而白名单照念（她的身份文档写着有、手上却没有）。这一条检查把同一个坑
 * 挡在提交之前。
 *
 * 用法：npm run check（或 node scripts/check-manifests.mjs）
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
const rows = []

for (const name of readdirSync(root).sort()) {
  const dir = join(root, name)
  if (name.startsWith('.') || name === 'scripts') continue
  if (!statSync(dir).isDirectory()) continue
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const marks = []
  const ok = (m) => marks.push('✓ ' + m)
  const fail = (m) => { marks.push('✗ ' + m); problems.push(`${name}: ${m}`) }

  if (pkg.name === name) ok('name')
  else fail(`包名应为 ${name}`)

  if (Array.isArray(pkg.keywords) && pkg.keywords.includes('dsh-plugin')) ok('keywords')
  else fail('缺 keywords: ["dsh-plugin", "dsh-fish"]')

  if (pkg.engines?.dsh) ok('engines.dsh')
  else fail('缺 engines.dsh')

  if (pkg.scripts?.test) ok('scripts.test')
  else fail('缺 scripts.test（npm test 跑不起来）')

  if (pkg.dependencies && Object.keys(pkg.dependencies).length === 0) ok('dependencies {}')
  else fail('dependencies 必须是 {}')

  const patch = pkg.dsh?.bundle?.patch
  if (!patch) {
    fail('缺 dsh.bundle.patch —— 宿主不会把它当插件包，工具注册不上')
  } else if (!existsSync(join(dir, patch))) {
    fail(`bundle patch 文件不存在：${patch}`)
  } else {
    const text = readFileSync(join(dir, patch), 'utf8')
    const m = text.match(/-\s*insert:[\s\S]*?name:\s*['"]?([^\s'"]+)['"]?/)
    const inserted = m?.[1] ?? ''
    if (inserted === pkg.name) ok('bundle patch name')
    else fail(`bundle patch 里 insert 的 name 是「${inserted || '空'}」，与包名不一致`)
  }

  const testDir = join(dir, 'test')
  const hasTest = existsSync(testDir) && readdirSync(testDir).some((f) => f.endsWith('.test.mjs'))
  if (hasTest) ok('node:test')
  else fail('缺 test/*.test.mjs')

  rows.push([name, marks.join('  ')])
}

for (const [name, line] of rows) console.log(`${name.padEnd(18)} ${line}`)
if (problems.length) {
  console.error(`\n${problems.length} 个问题：`)
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log(`\n${rows.length} 个插件清单都合格。`)
