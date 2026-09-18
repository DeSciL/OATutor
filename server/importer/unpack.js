const fs = require("fs")
const path = require("path")
const { pipeline } = require("stream/promises")
const yauzl = require("yauzl")
const { ImportError } = require("./errors")

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

// Finder adds these to every zip it makes; they are not content.
const isClutter = name => name.startsWith("__MACOSX/") || path.posix.basename(name) === ".DS_Store"

function openZip(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => (err ? reject(err) : resolve(zip)))
    })
}

function nextEntry(zip) {
    return new Promise((resolve, reject) => {
        const done = () => {
            zip.off("entry", onEntry)
            zip.off("end", onEnd)
            zip.off("error", onError)
        }
        const onEntry = entry => { done(); resolve(entry) }
        const onEnd = () => { done(); resolve(null) }
        const onError = err => { done(); reject(err) }
        zip.on("entry", onEntry)
        zip.on("end", onEnd)
        zip.on("error", onError)
        zip.readEntry()
    })
}

function openEntry(zip, entry) {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)))
    })
}

function safeTarget(targetDir, name) {
    const unsafe = name.includes("\\") || name.includes("\0") || path.posix.isAbsolute(name) ||
        path.posix.normalize(name).split("/").includes("..")
    const resolved = path.resolve(targetDir, name)
    if (unsafe || !resolved.startsWith(targetDir + path.sep)) {
        throw new ImportError(400, `The zip contains an unsafe path: ${JSON.stringify(name)}`)
    }
    return resolved
}

/**
 * Extracts a zip without trusting it: entry paths must stay inside targetDir,
 * symlinks are refused, and the entry count and unpacked size are capped.
 * yauzl checks each entry's real size against its header, so a lying header
 * cannot slip a zip bomb past the size cap.
 */
async function unpack(zipFile, targetDir, { maxEntries, maxUnpackedBytes }) {
    let zip
    try {
        zip = await openZip(zipFile)
    } catch (err) {
        throw new ImportError(400, `This is not a readable zip file (${err.message}).`)
    }
    try {
        if (zip.entryCount > maxEntries) {
            throw new ImportError(413, `The zip has ${zip.entryCount} entries; at most ${maxEntries} are accepted.`)
        }
        await fs.promises.mkdir(targetDir, { recursive: true })
        let unpackedBytes = 0
        for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip)) {
            const name = entry.fileName
            if (isClutter(name)) continue
            const target = safeTarget(targetDir, name)
            if (name.endsWith("/")) continue
            if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) {
                throw new ImportError(400, `The zip contains a symbolic link: ${JSON.stringify(name)}`)
            }
            unpackedBytes += entry.uncompressedSize
            if (unpackedBytes > maxUnpackedBytes) {
                throw new ImportError(413, `The zip unpacks to more than ${Math.round(maxUnpackedBytes / 2 ** 20)} MB.`)
            }
            await fs.promises.mkdir(path.dirname(target), { recursive: true })
            await pipeline(await openEntry(zip, entry), fs.createWriteStream(target, { flags: "wx" }))
        }
    } catch (err) {
        if (err instanceof ImportError) throw err
        throw new ImportError(400, `The zip could not be read (${err.message}).`)
    } finally {
        zip.close()
    }
}

module.exports = { unpack }
