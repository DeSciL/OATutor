const fs = require("fs")
const os = require("os")
const path = require("path")
const yazl = require("yazl")
const { createApp } = require("../app")
const { toSets } = require("../importer/builtin")
const { ContentStore } = require("../importer/store")

const TOKEN = "test-token"

const BUILTIN = {
    problemIds: ["a005bd5real1"],
    lessonIds: ["51ukvlfX-chiP-S46rcW2BcC"],
    courseNames: ["OpenStax: College Algebra"],
    bktSkills: ["real_numbers"],
}

/** The files of a content source as aitutor exports it, keyed by path inside the zip. */
function contentSource({
    key = "algebra_k1",
    problems = ["p1"],
    courseName = "Algebra",
    manifest = true,
    skills = ["algebra_k1"],
    figure = false,
    lessonId = `${key}-lesson`,
} = {}) {
    const json = value => JSON.stringify(value, null, 4)
    const files = {
        "coursePlans.json": json([{ courseName, lessons: [{ id: lessonId, name: courseName, learningObjectives: {} }] }]),
        "skillModel.json": json(Object.fromEntries(problems.map(id => [`${id}a`, skills]))),
        "bkt-params/defaultBKTParams.json": json(
            Object.fromEntries(skills.map(skill => [skill, { probMastery: 0.2, probTransit: 0.1, probSlip: 0.1, probGuess: 0.1 }]))
        ),
    }
    if (manifest) {
        files["manifest.json"] = json({ format: "oatutor-content-source", formatVersion: 1, sourceKey: key, lessonIds: [lessonId] })
    }
    for (const id of problems) {
        const base = `content-pool/${id}`
        files[`${base}/${id}.json`] = json({ id, title: `Problem ${id}`, body: "", lessonId, courseName })
        files[`${base}/steps/${id}a/${id}a.json`] = json({ id: `${id}a`, stepAnswer: ["4"], problemType: "TextBox", answerType: "arithmetic" })
        files[`${base}/steps/${id}a/tutoring/${id}aDefaultPathway.json`] = json([
            { id: `${id}a-h1`, type: "hint", title: "Hint", text: "Add them.", dependencies: [] },
        ])
        if (figure) files[`${base}/figures/graph.png`] = "not really a png"
    }
    return files
}

function zipOf(files) {
    const zip = new yazl.ZipFile()
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name)
    zip.end()
    return new Promise((resolve, reject) => {
        const chunks = []
        zip.outputStream.on("data", chunk => chunks.push(chunk))
        zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
        zip.outputStream.on("error", reject)
    })
}

/** A running server over a fresh data directory. */
async function startServer({ limits, ...options } = {}) {
    // A default parameter would also replace an explicit undefined, which is the case under test.
    const importToken = "importToken" in options ? options.importToken : TOKEN
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oatutor-server-"))
    const buildDir = path.join(root, "build")
    fs.mkdirSync(path.join(buildDir, "static", "js"), { recursive: true })
    fs.writeFileSync(path.join(buildDir, "index.html"), "<div id=root></div>")
    fs.writeFileSync(path.join(buildDir, "static", "js", "main.abc123.js"), "")
    fs.mkdirSync(path.join(buildDir, "static", "images", "figures", "oatutor", "builtin1"), { recursive: true })
    fs.writeFileSync(path.join(buildDir, "static", "images", "figures", "oatutor", "builtin1", "graph.png"), "")
    fs.mkdirSync(path.join(buildDir, "content-pool"))
    const pool = Array.from({ length: 200 }, (_, i) => ({ id: `builtin${i}`, title: "A built-in problem" }))
    fs.writeFileSync(path.join(buildDir, "content-pool", "oatutor.json"), JSON.stringify(pool))

    const dataDir = path.join(root, "data")
    const store = new ContentStore({ dataDir, builtin: toSets(BUILTIN), limits })
    await store.init()
    const server = createApp({ buildDir, store, importToken, publicBaseUrl: "https://tutor.example" }).listen(0)
    await new Promise(resolve => server.once("listening", resolve))

    const base = `http://127.0.0.1:${server.address().port}`
    const auth = { Authorization: `Bearer ${TOKEN}` }
    return {
        base,
        dataDir,
        close: () => new Promise(resolve => server.close(resolve)),
        upload: async (zip, headers = auth) => {
            const form = new FormData()
            form.append("file", new Blob([zip]), "source.zip")
            const response = await fetch(`${base}/api/imports`, { method: "POST", body: form, headers })
            return { status: response.status, body: await response.json() }
        },
        overlay: async () => (await fetch(`${base}/api/content/overlay`)).json(),
        remove: key => fetch(`${base}/api/imports/${key}`, { method: "DELETE", headers: auth }),
        list: async () => (await fetch(`${base}/api/imports`, { headers: auth })).json(),
    }
}

module.exports = { contentSource, zipOf, startServer, TOKEN }
