const fs = require("fs")
const path = require("path")

const MIGRATIONS = path.join(__dirname, "migrations")

/** Applies the SQL files that schema_migrations does not list yet, in name order. */
async function migrate(pool) {
    await pool.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    const { rows } = await pool.query("SELECT name FROM schema_migrations")
    const applied = new Set(rows.map(row => row.name))
    const pending = fs
        .readdirSync(MIGRATIONS)
        .filter(name => name.endsWith(".sql") && !applied.has(name))
        .sort()

    for (const name of pending) {
        const client = await pool.connect()
        try {
            await client.query("BEGIN")
            await client.query(fs.readFileSync(path.join(MIGRATIONS, name), "utf8"))
            await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name])
            await client.query("COMMIT")
        } catch (err) {
            await client.query("ROLLBACK")
            throw err
        } finally {
            client.release()
        }
        console.log(`Applied migration ${name}`)
    }
}

module.exports = { migrate }
