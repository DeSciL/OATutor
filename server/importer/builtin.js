const fs = require("fs")

const EMPTY = { problemIds: [], lessonIds: [], courseNames: [], bktSkills: [] }

/**
 * Ids already taken by the content compiled into the build. The index is written
 * at build time (scripts/writeBuiltinIndex.js) so the server need not load the
 * whole built-in pool just to check for collisions.
 */
function loadBuiltinIndex(file) {
    let index = EMPTY
    if (file && fs.existsSync(file)) {
        index = JSON.parse(fs.readFileSync(file, "utf8"))
    } else {
        console.warn(`No built-in content index at ${file}; imports are not checked against built-in ids.`)
    }
    return toSets(index)
}

function toSets(index) {
    return Object.fromEntries(Object.keys(EMPTY).map(key => [key, new Set(index[key] || [])]))
}

module.exports = { loadBuiltinIndex, toSets }
