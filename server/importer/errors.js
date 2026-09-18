/** A refusal the uploader can act on, sent back with its status and any issues found. */
class ImportError extends Error {
    constructor(status, message, issues = []) {
        super(message)
        this.status = status
        this.issues = issues
    }
}

module.exports = { ImportError }
