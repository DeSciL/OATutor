const crypto = require("crypto")
const fs = require("fs")
const express = require("express")
const multer = require("multer")
const { requireUser } = require("../auth/session")
const { ImportError } = require("./errors")

function sameToken(given, expected) {
    // Hashing first gives equal lengths, which timingSafeEqual needs.
    const digest = value => crypto.createHash("sha256").update(value).digest()
    return crypto.timingSafeEqual(digest(given), digest(expected))
}

function importRoutes({ store, importToken, publicBaseUrl = "" }) {
    const router = express.Router()

    // TutorCreator sends the token; someone on the import page has a session instead.
    const allow = (roles, refusal) => (req, res, next) => {
        const given = (req.get("authorization") || "").replace(/^Bearer\s+/i, "")
        if (given) {
            if (!importToken) {
                return res.status(503).json({ detail: "Importing by token is switched off because IMPORT_TOKEN is not set." })
            }
            if (!sameToken(given, importToken)) return res.status(401).json({ detail: "The import token is wrong." })
            return next()
        }
        const role = req.session?.user?.role
        if (!role || role === "anonymous") {
            return res.status(401).json({ detail: "The import token is missing." })
        }
        if (!roles.includes(role)) return res.status(403).json({ detail: refusal })
        next()
    }
    const mayImport = allow(["teacher", "admin"], "Only teachers may import content.")
    // Which teacher a source belongs to is known to TutorCreator, not here.
    const mayRemove = allow(["admin"], "Only admins may remove a source here. Unpublish it in TutorCreator instead.")

    // Checked before multer, so nobody without permission gets to write to disk.
    const upload = multer({
        dest: store.tmpDir,
        limits: { fileSize: store.limits.maxUploadBytes, files: 1, fields: 0 },
    }).single("file")

    const lessonUrl = id => `${publicBaseUrl.replace(/\/$/, "")}/#/lessons/${id}`

    // The overlay carries the answers, so it is for signed-in users only.
    router.get("/content/overlay", requireUser, (req, res) => {
        const { body, etag } = store.overlay()
        res.set({ ETag: etag, "Cache-Control": "no-cache" })
        if (req.get("if-none-match") === etag) return res.status(304).end()
        res.type("application/json").send(body)
    })

    router.get("/imports", mayImport, async (req, res) => {
        res.json(await store.list())
    })

    router.post("/imports", mayImport, upload, async (req, res) => {
        if (!req.file) throw new ImportError(400, 'Send the zip as a multipart form field named "file".')
        try {
            const result = await store.importZip(req.file.path)
            res.status(result.replaced ? 200 : 201).json({ ...result, lessonUrls: result.lessonIds.map(lessonUrl) })
        } finally {
            await fs.promises.rm(req.file.path, { force: true })
        }
    })

    router.delete("/imports/:sourceKey", mayRemove, async (req, res) => {
        await store.remove(req.params.sourceKey)
        res.status(204).end()
    })

    router.use((err, req, res, next) => {
        if (err instanceof ImportError) {
            return res.status(err.status).json({ detail: err.message, issues: err.issues })
        }
        if (err instanceof multer.MulterError) {
            const tooLarge = err.code === "LIMIT_FILE_SIZE"
            const detail = tooLarge
                ? `The zip is larger than ${Math.round(store.limits.maxUploadBytes / 2 ** 20)} MB.`
                : `The upload was not understood (${err.message}).`
            return res.status(tooLarge ? 413 : 400).json({ detail })
        }
        next(err)
    })

    return router
}

module.exports = { importRoutes }
