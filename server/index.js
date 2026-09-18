const path = require("path")
const { createApp } = require("./app")
const { loadBuiltinIndex } = require("./importer/builtin")
const { ContentStore } = require("./importer/store")

const env = process.env
const buildDir = env.BUILD_DIR || path.join(__dirname, "..", "build")
const dataDir = env.DATA_DIR || path.join(__dirname, "..", "data")
const port = Number(env.PORT || 8080)
const megabytes = name => (env[name] ? Number(env[name]) * 2 ** 20 : undefined)

async function main() {
    const store = new ContentStore({
        dataDir,
        builtin: loadBuiltinIndex(env.BUILTIN_INDEX || path.join(__dirname, "..", "generated", "builtin-index.json")),
        limits: Object.fromEntries(
            Object.entries({ maxUploadBytes: megabytes("MAX_UPLOAD_MB") }).filter(([, value]) => value !== undefined)
        ),
    })
    await store.init()
    if (!env.IMPORT_TOKEN) console.warn("IMPORT_TOKEN is not set; importing is switched off.")

    createApp({ buildDir, store, importToken: env.IMPORT_TOKEN, publicBaseUrl: env.PUBLIC_BASE_URL }).listen(port, () => {
        console.log(`OATutor serving ${buildDir} on port ${port}, imports in ${dataDir}`)
    })
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
