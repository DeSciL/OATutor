const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { buildPool } = require("../../src/tools/buildProblemPool")
const { ImportError } = require("./errors")
const { unpack } = require("./unpack")
const { locateRoot, readSource } = require("./validate")

const PROCESSED = "processed.json"

const DEFAULT_LIMITS = {
    maxUploadBytes: 50 * 2 ** 20,
    maxUnpackedBytes: 300 * 2 ** 20,
    maxEntries: 20000,
    maxProblems: 2000,
}

const lessonsOf = coursePlans => coursePlans.flatMap(course => course.lessons.map(lesson => lesson.id))

/**
 * Imported content sources on disk, and the overlay the app merges over its
 * built-in content at startup.
 *
 *   <dataDir>/sources/<sourceKey>/processed.json   one per import
 *   <dataDir>/figures/<problemId>/...              served beside the built-in figures
 *   <dataDir>/tmp/                                 uploads and imports in progress
 *
 * The overlay is rebuilt from the sources after every change and at startup,
 * so an interrupted import leaves nothing to repair.
 */
class ContentStore {
    constructor({ dataDir, builtin, limits = {} }) {
        this.sourcesDir = path.join(dataDir, "sources")
        this.figuresDir = path.join(dataDir, "figures")
        this.tmpDir = path.join(dataDir, "tmp")
        this.builtin = builtin
        this.limits = { ...DEFAULT_LIMITS, ...limits }
        this.queue = Promise.resolve()
        this.current = null
    }

    async init() {
        await fs.promises.rm(this.tmpDir, { recursive: true, force: true })
        for (const dir of [this.sourcesDir, this.figuresDir, this.tmpDir]) {
            await fs.promises.mkdir(dir, { recursive: true })
        }
        await this.rebuildOverlay()
    }

    /** One change at a time: imports and deletions all rewrite the overlay. */
    serialize(task) {
        const run = this.queue.then(task, task)
        this.queue = run.catch(() => {})
        return run
    }

    overlay() {
        return this.current
    }

    async readAll() {
        const keys = (await fs.promises.readdir(this.sourcesDir)).sort()
        const sources = []
        for (const key of keys) {
            const file = path.join(this.sourcesDir, key, PROCESSED)
            if (fs.existsSync(file)) sources.push(JSON.parse(await fs.promises.readFile(file, "utf8")))
        }
        return sources.sort((a, b) => a.importedAt.localeCompare(b.importedAt))
    }

    async list() {
        return (await this.readAll()).map(source => ({
            sourceKey: source.sourceKey,
            courseNames: source.coursePlans.map(course => course.courseName),
            lessonIds: lessonsOf(source.coursePlans),
            problemCount: source.problems.length,
            importedAt: source.importedAt,
        }))
    }

    importZip(zipFile) {
        return this.serialize(() => this.importNow(zipFile))
    }

    remove(sourceKey) {
        return this.serialize(async () => {
            const previous = (await this.readAll()).find(source => source.sourceKey === sourceKey)
            if (!previous) throw new ImportError(404, `No imported source is called ${sourceKey}.`)
            await this.removeFigures(previous)
            await fs.promises.rm(path.join(this.sourcesDir, sourceKey), { recursive: true, force: true })
            await this.rebuildOverlay()
        })
    }

    async importNow(zipFile) {
        const work = await fs.promises.mkdtemp(path.join(this.tmpDir, "import-"))
        try {
            const unpacked = path.join(work, "unpacked")
            await unpack(zipFile, unpacked, this.limits)
            const source = await readSource(await locateRoot(unpacked), this.limits)
            const sources = await this.readAll()
            const previous = sources.find(other => other.sourceKey === source.sourceKey)
            this.refuseCollisions(source, sources.filter(other => other !== previous))

            const warnings = [...source.warnings, ...this.sharedSkillWarnings(source)]
            const figures = path.join(work, "figures")
            const problems = await buildPool({
                contentPoolDir: source.contentPoolDir,
                figuresOutDir: figures,
                onWarn: message => warnings.push(message),
            }).catch(err => {
                throw new ImportError(422, `A problem could not be read: ${err.message}`)
            })

            const processed = {
                sourceKey: source.sourceKey,
                manifest: source.manifest,
                importedAt: new Date().toISOString(),
                coursePlans: source.coursePlans,
                skillModel: source.skillModel,
                bktParams: source.bktParams,
                problems,
                warnings,
            }
            await this.commit(work, processed, figures, previous)
            return {
                sourceKey: source.sourceKey,
                lessonIds: source.lessonIds,
                problemCount: problems.length,
                replaced: Boolean(previous),
                warnings,
            }
        } finally {
            await fs.promises.rm(work, { recursive: true, force: true })
        }
    }

    refuseCollisions(source, others) {
        const issues = []
        const owner = (id, idsOf) => others.find(other => idsOf(other).includes(id))
        for (const id of source.problemIds) {
            if (this.builtin.problemIds.has(id)) issues.push(`Problem ${id} already exists in OATutor's own content.`)
            const other = owner(id, s => s.problems.map(problem => problem.id))
            if (other) issues.push(`Problem ${id} already belongs to the imported source ${other.sourceKey}.`)
        }
        for (const id of source.lessonIds) {
            if (this.builtin.lessonIds.has(id)) issues.push(`Lesson ${id} already exists in OATutor's own content.`)
            const other = owner(id, s => lessonsOf(s.coursePlans))
            if (other) issues.push(`Lesson ${id} already belongs to the imported source ${other.sourceKey}.`)
        }
        for (const course of source.coursePlans) {
            if (this.builtin.courseNames.has(course.courseName)) {
                issues.push(`OATutor already has a course called "${course.courseName}"; rename the course.`)
            }
        }
        if (issues.length) {
            throw new ImportError(409, "This source would overwrite content that is already in OATutor.", issues)
        }
    }

    sharedSkillWarnings(source) {
        const skills = new Set(Object.values(source.skillModel).flat())
        const shared = [...skills].filter(skill => this.builtin.bktSkills.has(skill)).sort()
        if (shared.length === 0) return []
        return [
            `Skills ${shared.join(", ")} also belong to OATutor's own content. They keep OATutor's parameters, ` +
                "and a student's mastery of them carries over between the two.",
        ]
    }

    async commit(work, processed, figures, previous) {
        const staged = path.join(work, "source")
        await fs.promises.mkdir(staged)
        await fs.promises.writeFile(path.join(staged, PROCESSED), JSON.stringify(processed))

        const target = path.join(this.sourcesDir, processed.sourceKey)
        if (previous) {
            await this.removeFigures(previous)
            await fs.promises.rename(target, path.join(work, "replaced"))
        }
        await fs.promises.rename(staged, target)

        const figureDirs = fs.existsSync(figures) ? await fs.promises.readdir(figures) : []
        for (const problemId of figureDirs) {
            const destination = path.join(this.figuresDir, problemId)
            await fs.promises.rm(destination, { recursive: true, force: true })
            await fs.promises.rename(path.join(figures, problemId), destination)
        }
        await this.rebuildOverlay()
    }

    async removeFigures(source) {
        await Promise.all(
            source.problems.map(problem =>
                fs.promises.rm(path.join(this.figuresDir, problem.id), { recursive: true, force: true })
            )
        )
    }

    async rebuildOverlay() {
        const courses = new Map()
        const skillModel = {}
        const bktParams = { default: {}, experimental: {} }
        const problems = []
        for (const source of await this.readAll()) {
            // Platform.js finds a course by name, so two courses sharing one would hide each other's lessons.
            for (const course of source.coursePlans) {
                const merged = courses.get(course.courseName)
                if (merged) merged.lessons.push(...course.lessons)
                else courses.set(course.courseName, { ...course, lessons: [...course.lessons] })
            }
            Object.assign(skillModel, source.skillModel)
            for (const variant of Object.keys(bktParams)) {
                for (const [skill, params] of Object.entries(source.bktParams[variant] || {})) {
                    // Built-in parameters win: overwriting them would change how existing lessons adapt.
                    if (!this.builtin.bktSkills.has(skill) && !(skill in bktParams[variant])) {
                        bktParams[variant][skill] = params
                    }
                }
            }
            problems.push(...source.problems)
        }
        const body = JSON.stringify({ coursePlans: [...courses.values()], skillModel, bktParams, problems })
        const etag = `"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 32)}"`
        this.current = { body, etag }
    }
}

module.exports = { ContentStore, DEFAULT_LIMITS }
