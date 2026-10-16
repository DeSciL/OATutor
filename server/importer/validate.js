const fs = require("fs")
const path = require("path")
const { ImportError } = require("./errors")

const ID = /^[A-Za-z0-9_-]+$/
const MANIFEST_FORMAT = "oatutor-content-source"
const BKT_FILES = { default: "defaultBKTParams.json", experimental: "experimentalBKTParams.json" }

const isHidden = name => name.startsWith(".") || name.startsWith("_")

async function readJson(file, what) {
    let text
    try {
        text = await fs.promises.readFile(file, "utf8")
    } catch (err) {
        if (err.code === "ENOENT") return undefined
        throw err
    }
    try {
        return JSON.parse(text)
    } catch (err) {
        throw new ImportError(422, `${what} is not valid JSON (${err.message}).`)
    }
}

const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value)

async function visibleEntries(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    return entries.filter(entry => !isHidden(entry.name) && entry.name !== "__MACOSX")
}

/** Zipping a folder in Finder nests everything one level down; look inside it. */
async function locateRoot(dir) {
    const entries = await visibleEntries(dir)
    if (entries.some(entry => entry.name === "coursePlans.json")) return dir
    const dirs = entries.filter(entry => entry.isDirectory())
    if (dirs.length === 1 && entries.length === 1) {
        const inner = path.join(dir, dirs[0].name)
        if (fs.existsSync(path.join(inner, "coursePlans.json"))) return inner
    }
    throw new ImportError(422, "The zip has no coursePlans.json at its top level, so it is not an OATutor content source.")
}

function checkCoursePlans(coursePlans, issues) {
    if (!Array.isArray(coursePlans) || coursePlans.length === 0) {
        throw new ImportError(422, "coursePlans.json must be a non-empty list of courses.")
    }
    const lessonIds = []
    for (const course of coursePlans) {
        const name = course && course.courseName
        if (typeof name !== "string" || !name.trim()) {
            issues.push("A course in coursePlans.json has no courseName.")
            continue
        }
        if (name.startsWith("!!")) issues.push(`Course "${name}" starts with "!!", which OATutor hides.`)
        if (!Array.isArray(course.lessons) || course.lessons.length === 0) {
            issues.push(`Course "${name}" has no lessons.`)
            continue
        }
        for (const lesson of course.lessons) {
            if (!lesson || typeof lesson.id !== "string" || !ID.test(lesson.id)) {
                issues.push(`Course "${name}" has a lesson whose id is missing or not made of letters, digits, _ and -.`)
            } else if (lessonIds.includes(lesson.id)) {
                issues.push(`Lesson id ${lesson.id} appears twice.`)
            } else {
                lessonIds.push(lesson.id)
            }
        }
    }
    return lessonIds
}

function sourceKeyFrom(manifest, lessonIds, issues, warnings) {
    if (manifest === undefined) {
        if (lessonIds.length === 1) {
            warnings.push(`There is no manifest.json, so this source is identified by its lesson id, ${lessonIds[0]}.`)
            return lessonIds[0]
        }
        issues.push("Without a manifest.json the source must hold exactly one lesson, so it can be recognised when imported again.")
        return undefined
    }
    if (!isObject(manifest) || manifest.format !== MANIFEST_FORMAT) {
        issues.push(`manifest.json does not describe an ${MANIFEST_FORMAT}.`)
        return undefined
    }
    if (manifest.formatVersion !== 1) {
        issues.push(`manifest.json has formatVersion ${manifest.formatVersion}; this OATutor reads version 1.`)
        return undefined
    }
    if (typeof manifest.sourceKey !== "string" || !ID.test(manifest.sourceKey)) {
        issues.push("manifest.json has no usable sourceKey.")
        return undefined
    }
    const listed = Array.isArray(manifest.lessonIds) ? [...manifest.lessonIds].sort() : []
    if (listed.join() !== [...lessonIds].sort().join()) {
        issues.push("The lessons in manifest.json do not match those in coursePlans.json.")
    }
    return manifest.sourceKey
}

async function checkProblems(contentPoolDir, lessonIds, { maxProblems }, issues) {
    let entries
    try {
        entries = await visibleEntries(contentPoolDir)
    } catch (err) {
        if (err.code === "ENOENT") throw new ImportError(422, "The zip has no content-pool folder.")
        throw err
    }
    const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    if (names.length === 0) throw new ImportError(422, "The content-pool folder holds no problems.")
    if (names.length > maxProblems) {
        throw new ImportError(413, `The source has ${names.length} problems; at most ${maxProblems} are accepted.`)
    }
    const lessonOf = {}
    for (const name of names) {
        if (!ID.test(name)) {
            issues.push(`Problem folder "${name}" is not made of letters, digits, _ and -.`)
            continue
        }
        const problem = await readJson(path.join(contentPoolDir, name, `${name}.json`), `Problem ${name}`)
        if (problem === undefined) {
            issues.push(`Problem folder ${name} has no ${name}.json.`)
        } else if (problem.id !== name) {
            issues.push(`Problem ${name} has id "${problem.id}"; it must match its folder.`)
        } else if (!lessonIds.includes(problem.lessonId)) {
            // OATutor shows a problem without a lessonId in every lesson, built-in ones included.
            issues.push(`Problem ${name} does not belong to a lesson of this source (lessonId "${problem.lessonId}").`)
        } else {
            lessonOf[name] = problem.lessonId
        }
    }
    return { problemIds: names, lessonOf }
}

/** A problemOrder naming a problem the lesson does not serve would end the lesson there. */
function checkProblemOrder(coursePlans, lessonOf, issues) {
    const lessons = coursePlans.flatMap(course => (Array.isArray(course?.lessons) ? course.lessons : []))
    for (const lesson of lessons) {
        const order = lesson?.problemOrder
        if (order === undefined) continue
        if (!Array.isArray(order) || order.length === 0) {
            issues.push(`Lesson ${lesson.id} has a problemOrder that is not a list of problem ids.`)
            continue
        }
        if (new Set(order).size !== order.length) {
            issues.push(`Lesson ${lesson.id} lists a problem twice in its problemOrder.`)
        }
        for (const id of order) {
            if (lessonOf[id] !== lesson.id) {
                issues.push(`Lesson ${lesson.id} orders problem ${id}, which is not one of its problems.`)
            }
        }
    }
}

/**
 * Reads what a content source declares, and refuses it if OATutor would
 * misbehave with it. Problems themselves are assembled later by buildPool.
 */
async function readSource(root, limits) {
    const issues = []
    const warnings = []

    const coursePlans = await readJson(path.join(root, "coursePlans.json"), "coursePlans.json")
    const lessonIds = checkCoursePlans(coursePlans, issues)
    const manifest = await readJson(path.join(root, "manifest.json"), "manifest.json")
    const sourceKey = sourceKeyFrom(manifest, lessonIds, issues, warnings)
    const { problemIds, lessonOf } = await checkProblems(path.join(root, "content-pool"), lessonIds, limits, issues)
    checkProblemOrder(coursePlans, lessonOf, issues)

    const skillModel = (await readJson(path.join(root, "skillModel.json"), "skillModel.json")) ?? {}
    if (!isObject(skillModel) || !Object.values(skillModel).every(Array.isArray)) {
        issues.push("skillModel.json must map step ids to lists of skills.")
    }
    const bktParams = {}
    for (const [variant, file] of Object.entries(BKT_FILES)) {
        bktParams[variant] = (await readJson(path.join(root, "bkt-params", file), file)) ?? {}
        if (!isObject(bktParams[variant])) issues.push(`bkt-params/${file} must map skills to parameters.`)
    }

    if (issues.length) {
        throw new ImportError(422, "This is not a content source OATutor can serve.", issues)
    }
    return {
        sourceKey,
        manifest: manifest ?? null,
        coursePlans,
        lessonIds,
        problemIds,
        skillModel,
        bktParams,
        warnings,
        contentPoolDir: path.join(root, "content-pool"),
    }
}

module.exports = { locateRoot, readSource, ID }
