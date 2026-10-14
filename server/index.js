const path = require("path")
const { createApp } = require("./app")
const { authSettings } = require("./auth/config")
const { connectOidc } = require("./auth/oidc")
const { migrate } = require("./db/migrate")
const { EventStore, discardEvents } = require("./events/store")
const { loadBuiltinIndex } = require("./importer/builtin")
const { ContentStore } = require("./importer/store")

const env = process.env
const buildDir = env.BUILD_DIR || path.join(__dirname, "..", "build")
const dataDir = env.DATA_DIR || path.join(__dirname, "..", "data")
const port = Number(env.PORT || 8080)
const megabytes = name => (env[name] ? Number(env[name]) * 2 ** 20 : undefined)

async function eventStore(auth) {
    if (!env.DATABASE_URL) {
        if (auth.mode === "oidc") throw new Error("AUTH_MODE=oidc needs DATABASE_URL, or what students do would be lost.")
        console.warn("DATABASE_URL is not set; what students do is not stored.")
        return discardEvents
    }
    const events = new EventStore(env.DATABASE_URL)
    await migrate(events.pool)
    return events
}

async function main() {
    const auth = authSettings(env)
    const store = new ContentStore({
        dataDir,
        builtin: loadBuiltinIndex(env.BUILTIN_INDEX || path.join(__dirname, "..", "generated", "builtin-index.json")),
        limits: Object.fromEntries(
            Object.entries({ maxUploadBytes: megabytes("MAX_UPLOAD_MB") }).filter(([, value]) => value !== undefined)
        ),
    })
    await store.init()
    if (!env.IMPORT_TOKEN) console.warn("IMPORT_TOKEN is not set; nothing can be imported by token.")

    const app = createApp({
        buildDir,
        store,
        importToken: env.IMPORT_TOKEN,
        publicBaseUrl: auth.publicBaseUrl,
        auth,
        oidc: auth.mode === "oidc" ? await connectOidc(auth) : null,
        events: await eventStore(auth),
    })
    app.listen(port, () => {
        console.log(`OATutor serving ${buildDir} on port ${port}, imports in ${dataDir}, sign-in: ${auth.mode}`)
    })
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
