// Usage: node server/scripts/writeBuiltinIndex.js <output.json>
// Run after the problem pool is generated (npm run build does that first).
const fs = require("fs")
const path = require("path")
const { CONTENT_SOURCE } = require("../../common/global-config")

const root = path.join(__dirname, "..", "..")
const source = path.join(root, "src", "content-sources", CONTENT_SOURCE)
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"))

const pool = readJson(path.join(root, "public", "content-pool", `${CONTENT_SOURCE}.json`))
const courses = readJson(path.join(source, "coursePlans.json"))
const bktSkills = ["defaultBKTParams.json", "experimentalBKTParams.json"].flatMap(name =>
    Object.keys(readJson(path.join(source, "bkt-params", name)))
)

const index = {
    problemIds: pool.map(problem => problem.id),
    lessonIds: courses.flatMap(course => course.lessons.map(lesson => lesson.id)),
    courseNames: courses.map(course => course.courseName),
    bktSkills: [...new Set(bktSkills)],
}

const out = process.argv[2]
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(index))
console.log(`built-in index: ${index.problemIds.length} problems, ${index.lessonIds.length} lessons, ${index.bktSkills.length} skills`)
