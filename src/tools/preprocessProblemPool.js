const path = require("path")
const fs = require("fs")
const { CONTENT_SOURCE } = require('../../common/global-config')
const { buildPool } = require("./buildProblemPool")

// the current file should be in src/tools so ../content-sources/* should be src/content-sources/*
const problemPoolPath = path.join(__dirname, '..', 'content-sources', CONTENT_SOURCE, 'content-pool')
// Served as a file and fetched at startup (src/content/contentStore.js). Bundled into the
// JavaScript, its 36 MB ran the build out of memory and was downloaded again after every deploy.
const generatedPath = path.join(__dirname, '..', '..', 'public', 'content-pool')
const poolFilePath = path.join(generatedPath, `${CONTENT_SOURCE}.json`)
const staticFiguresPath = path.join(__dirname, '..', '..', 'public', 'static', 'images', 'figures', CONTENT_SOURCE)

;(async () => {
    // Figures of problems that were removed would otherwise linger.
    await fs.promises.rm(staticFiguresPath, { recursive: true, force: true })

    const problems = await buildPool({
        contentPoolDir: problemPoolPath,
        figuresOutDir: staticFiguresPath,
        onWarn: message => console.warn(message),
    })

    console.debug(`writing ${problems.length} problems to pool file...`)
    await fs.promises.mkdir(generatedPath, { recursive: true })
    await fs.promises.writeFile(poolFilePath, JSON.stringify(problems))
})().catch(err => {
    console.error('error building the problem pool:', err.message)
    process.exit(1)
})
