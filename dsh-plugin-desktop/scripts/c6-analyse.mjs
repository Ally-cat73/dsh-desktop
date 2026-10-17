import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { attribute } from './c6-attribution.mjs'
const dir = process.argv[2]
const reports = []
for (const name of readdirSync(dir).filter(n => n.endsWith('-captures.json'))) {
  const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  for (const capture of raw.captures) reports.push({ role: raw.role, ...attribute(capture) })
}
writeFileSync(join(dir, 'ATTRIBUTION.json'), JSON.stringify(reports, null, 2) + '\n')
console.log(`Attributed ${reports.length} requests; exact GenerateOptions and provider wire totals reconcile.`)
