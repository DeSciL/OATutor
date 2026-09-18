const path = require("path")
const compression = require("compression")
const express = require("express")
const { importRoutes } = require("./importer/routes")

function createApp({ buildDir, store, importToken, publicBaseUrl }) {
    const app = express()
    app.disable("x-powered-by")
    // The problem pool is 36 MB of JSON; compressed it is a fraction of that.
    app.use(compression())

    app.get("/api/health", (req, res) => res.json({ status: "ok" }))
    app.use("/api", importRoutes({ store, importToken, publicBaseUrl }))

    // CRA fingerprints these, so they can be cached for good. The rest of /static
    // (figures, icons) keeps its name across deploys and must stay revalidated.
    for (const hashed of ["js", "css", "media"]) {
        app.use(`/static/${hashed}`, express.static(path.join(buildDir, "static", hashed), { immutable: true, maxAge: "1y" }))
    }
    app.use(express.static(buildDir))
    // Imported figures sit at the same URLs as built-in ones, so the renderer needs no change.
    app.use("/static/images/figures/oatutor", express.static(store.figuresDir))

    return app
}

module.exports = { createApp }
