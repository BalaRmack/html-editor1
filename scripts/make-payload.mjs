#!/usr/bin/env node
/**
 * Packs `release/win-unpacked` (or any directory) into `dist-payload/app.zip`.
 *
 * Written by hand because the build runs on both Windows and Linux and adding a
 * zip library just for this would pull a dependency into CI. Files are streamed
 * with data descriptors (bit 3), so a 170 MB `VerdantLauncher.exe` never has to
 * sit in RAM.
 */
import { createWriteStream } from 'node:fs'
import { open, readdir, stat, mkdir, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { createDeflateRaw } from 'node:zlib'

const SOURCE = process.argv[2] ?? 'release/win-unpacked'
const TARGET = process.argv[3] ?? 'dist-payload/app.zip'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value
  }
  return table
})()

function crc32(buffer, previous = 0) {
  let crc = previous ^ -1
  for (let index = 0; index < buffer.length; index++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff]
  return (crc ^ -1) >>> 0
}

const SKIP = [/\.pdb$/i, /\.map$/i, /^LICENSES\.chromium\.html$/i, /^version$/i]

async function collect(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const rel = relative(SOURCE, path).split(sep).join('/')
    if (entry.isDirectory()) await collect(path, files)
    else if (!SKIP.some((pattern) => pattern.test(rel))) files.push({ path, rel })
  }
  return files
}

const now = new Date()
const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31)
const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31)

const files = await collect(SOURCE)
if (files.length === 0) {
  console.error(`Нет файлов для упаковки в ${SOURCE}`)
  process.exit(1)
}

await rm(TARGET, { force: true })
await mkdir(dirname(TARGET), { recursive: true })
const out = createWriteStream(TARGET)
let offset = 0
const write = async (buffer) => {
  if (!out.write(buffer)) await new Promise((resolve) => out.once('drain', resolve))
  offset += buffer.length
}

const central = []
let totalBytes = 0

for (const file of files) {
  const info = await stat(file.path)
  const name = Buffer.from(file.rel, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6) // UTF-8 names
  header.writeUInt16LE(8, 8) // deflate
  header.writeUInt16LE(dosTime, 10)
  header.writeUInt16LE(dosDate, 12)
  header.writeUInt32LE(0, 14) // crc — later in the data descriptor
  header.writeUInt32LE(0, 18)
  header.writeUInt32LE(0, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  const headerOffset = offset
  await write(header)
  await write(name)

  let crc = 0
  let compressed = 0
  const handle = await open(file.path, 'r')
  const source = handle.createReadStream({ highWaterMark: 1024 * 1024 })
  const deflate = createDeflateRaw({ level: 9 })
  source.on('data', (chunk) => {
    crc = crc32(chunk, crc)
  })
  source.pipe(deflate)
  // `for await` gives us backpressure: no whole-file buffering, no lost chunks.
  for await (const chunk of deflate) {
    await write(chunk)
    compressed += chunk.length
  }
  await handle.close()

  const descriptor = Buffer.alloc(16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc >>> 0, 4)
  descriptor.writeUInt32LE(compressed, 8)
  descriptor.writeUInt32LE(info.size, 12)
  await write(descriptor)

  central.push({ name, crc: crc >>> 0, compressed, uncompressed: info.size, headerOffset })
  totalBytes += info.size
  console.log(`  + ${file.rel} (${(info.size / (1024 * 1024)).toFixed(1)} МБ)`)
}

const centralStart = offset
for (const entry of central) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(8, 10)
  header.writeUInt16LE(dosTime, 12)
  header.writeUInt16LE(dosDate, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.compressed, 20)
  header.writeUInt32LE(entry.uncompressed, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.headerOffset, 42)
  await write(header)
  await write(entry.name)
}
const centralSize = offset - centralStart

const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(central.length, 8)
end.writeUInt16LE(central.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(centralStart, 16)
end.writeUInt16LE(0, 20)
await write(end)
await new Promise((resolve) => out.end(resolve))

const size = (await stat(TARGET)).size
console.log(`\napp.zip: ${files.length} файлов, ${(totalBytes / (1024 * 1024)).toFixed(1)} МБ распакованных → ${(size / (1024 * 1024)).toFixed(1)} МБ архива`)
