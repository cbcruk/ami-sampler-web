// Bundle the repo's Amiga sample disks into public/samples/ so they ship with
// the deploy and can be picked from the in-app browser. Copies each audio file
// and writes index.json (grouped by disk). Regenerated on every dev/build.
import { readdir, mkdir, copyFile, writeFile, rm, stat } from 'node:fs/promises'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const srcRoot = join(webRoot, '..', 'Samples')
const outRoot = join(webRoot, 'public', 'samples')

// Formats the app can decode (WAV via the browser, IFF/8SVX/BRR/µ-law in TS).
// Extensionless files are kept too — the Amiga disks store raw 8SVX/BRR blobs.
const AUDIO_EXT = new Set(['.wav', '.iff', '.8svx', '.brr', '.aif', '.aiff', '.ul', '.ulaw', '.mulaw'])

function isAudio(name) {
  const e = extname(name).toLowerCase()
  return e === '' || AUDIO_EXT.has(e)
}

async function walk(dir, rel = '') {
  const out = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const rp = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...(await walk(join(dir, ent.name), rp)))
    else if (isAudio(ent.name)) out.push(rp)
  }
  return out
}

async function main() {
  let files
  try {
    files = await walk(srcRoot)
  } catch {
    console.warn(`[build-samples] no Samples/ at ${srcRoot}, skipping`)
    return
  }

  await rm(outRoot, { recursive: true, force: true })

  const byDisk = new Map()
  for (const rp of files) {
    const slash = rp.indexOf('/')
    if (slash < 0) continue // only files nested inside a disk folder
    const disk = rp.slice(0, slash)
    const src = join(srcRoot, rp)
    if ((await stat(src)).size < 8) continue

    const dest = join(outRoot, rp)
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(src, dest)

    const name = basename(rp, extname(rp))
    if (!byDisk.has(disk)) byDisk.set(disk, [])
    byDisk.get(disk).push({ name, file: rp })
  }

  const manifest = [...byDisk.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([disk, items]) => ({
      disk,
      items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))

  await mkdir(outRoot, { recursive: true })
  await writeFile(join(outRoot, 'index.json'), JSON.stringify(manifest))
  const total = manifest.reduce((n, d) => n + d.items.length, 0)
  console.log(`[build-samples] ${total} samples across ${manifest.length} disks -> public/samples/`)
}

await main()
