// Builds the NSIS installer and copies it to release/ with a SHA-256 file.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// A fixed command line (no user input): npm is a .cmd script on Windows, so it runs through the shell.
const build = spawnSync('npm run tauri -- build --bundles nsis', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})
if (build.status !== 0) process.exit(build.status ?? 1)

const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const suffix = `_${version}_x64-setup.exe`
const prefix = "Interactive Studio"
const found = readdirSync(nsisDir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
if (found.length !== 1) {
  console.error(`Expected one *${suffix} in ${nsisDir}, found ${found.length}`)
  process.exit(1)
}

const name = `Interactive-Studio-${version}-Setup.exe`
const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const target = join(outDir, name)
copyFileSync(join(nsisDir, found[0]), target)

const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
writeFileSync(`${target}.sha256`, `${hash}  ${name}\n`)

const mib = (statSync(target).size / 1024 / 1024).toFixed(2)
console.log(`\n${target}\nsize:   ${mib} MiB\nsha256: ${hash}`)
