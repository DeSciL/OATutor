const path = require("path")
const fs = require("fs")

// Reads a content pool into the array OATutor serves. Shared by the build-time
// preprocessor and the import server, so it throws instead of exiting and reads
// JSON from disk each time: require() would cache, and a re-import would serve
// the content it replaced.

const readJson = async file => JSON.parse(await fs.promises.readFile(file, "utf8"))

const isHidden = name => name.startsWith("_") || name.startsWith(".")

async function listDirs(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    return entries
        .filter(entry => entry.isDirectory() && !isHidden(entry.name))
        .map(entry => entry.name)
        .sort()
}

async function listFiles(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(err => {
        if (err.code === "ENOENT") return []
        throw err
    })
    return entries
        .filter(entry => entry.isFile() && !entry.name.startsWith("."))
        .map(entry => entry.name)
        .sort()
}

function pathwayName(fileName, stepName) {
    // "<stepId>DefaultPathway.json" is keyed as "DefaultPathway"; anything else keeps its file name.
    return fileName.includes(stepName)
        ? fileName.substr(fileName.indexOf(stepName) + stepName.length).replace(/\.[^/.]+$/, "")
        : fileName
}

async function buildStep(problemName, stepPath, stepName, onWarn) {
    const step = await readJson(path.join(stepPath, `${stepName}.json`))
    const tutoringPath = path.join(stepPath, "tutoring")
    const pathwayFiles = await listFiles(tutoringPath)
    if (pathwayFiles.length === 0) {
        onWarn(`${problemName} -> ${stepName} has no hints (pathways).`)
    }
    const pathways = await Promise.all(
        pathwayFiles.map(async file => [pathwayName(file, stepName), await readJson(path.join(tutoringPath, file))])
    )
    step.hints = Object.fromEntries(pathways)
    return step
}

async function copyFigures(problemPath, problemName, figuresOutDir) {
    const figures = await listFiles(path.join(problemPath, "figures"))
    if (figures.length === 0) return
    const target = path.join(figuresOutDir, problemName)
    await fs.promises.mkdir(target, { recursive: true })
    await Promise.all(
        figures.map(figure => fs.promises.copyFile(path.join(problemPath, "figures", figure), path.join(target, figure)))
    )
}

async function buildProblem(contentPoolDir, problemName, { figuresOutDir, onWarn }) {
    const problemPath = path.join(contentPoolDir, problemName)
    const problem = await readJson(path.join(problemPath, `${problemName}.json`))

    const stepNames = await listDirs(path.join(problemPath, "steps")).catch(err => {
        if (err.code === "ENOENT") return []
        throw err
    })
    if (stepNames.length === 0) {
        throw new Error(`${problemName} has no steps.`)
    }

    if (figuresOutDir) {
        await copyFigures(problemPath, problemName, figuresOutDir)
    }

    problem.steps = await Promise.all(
        stepNames.map(stepName => buildStep(problemName, path.join(problemPath, "steps", stepName), stepName, onWarn))
    )
    return problem
}

/**
 * @param {object} options
 * @param {string} options.contentPoolDir  directory holding one folder per problem
 * @param {string} [options.figuresOutDir] where figures are copied to, as <figuresOutDir>/<problemId>/<file>
 * @param {(message: string) => void} [options.onWarn]
 * @returns {Promise<object[]>} problems with their steps and hint pathways inlined
 */
async function buildPool({ contentPoolDir, figuresOutDir, onWarn = console.warn }) {
    const problemNames = await listDirs(contentPoolDir)
    return Promise.all(
        problemNames.map(problemName =>
            buildProblem(contentPoolDir, problemName, { figuresOutDir, onWarn }).catch(err => {
                err.message = `${problemName}: ${err.message}`
                throw err
            })
        )
    )
}

module.exports = { buildPool }
