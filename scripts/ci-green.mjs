#!/usr/bin/env node
//
// Refuses a release unless the Push workflow passed on the commit being
// released. preversion runs neither the browser suites nor BandageJS on the
// packed core: 4.0.25 to 4.0.27 went out with both red. Push the commit, let
// CI finish, then version.
import { execFileSync } from 'node:child_process'

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}

function refuse(message) {
  console.error(`ci-green: ${message}`)
  process.exit(1)
}

const sha = run('git', ['rev-parse', 'HEAD'])
const short = sha.slice(0, 7)
const [latest] = JSON.parse(
  run('gh', [
    'run',
    'list',
    '--workflow',
    'push.yml',
    '--commit',
    sha,
    '--limit',
    '1',
    '--json',
    'databaseId,status,conclusion,url',
  ]),
)

if (!latest) {
  refuse(`no Push run on ${short}: push it and let CI finish first`)
}
if (latest.status !== 'completed') {
  refuse(`Push on ${short} is still ${latest.status}: ${latest.url}`)
}
if (latest.conclusion !== 'success') {
  const { jobs } = JSON.parse(
    run('gh', ['run', 'view', String(latest.databaseId), '--json', 'jobs']),
  )
  const failed = jobs
    .filter(j => j.conclusion !== 'success' && j.conclusion !== 'skipped')
    .map(j => j.name)
  refuse(
    `Push on ${short} ended ${latest.conclusion} (${failed.join(', ')}): ${latest.url}`,
  )
}
console.log(`ci-green: Push passed on ${short}`)
