const { Pool } = require("pg")

/** What students did, one row per logged event. */
class EventStore {
    constructor(databaseUrl) {
        this.pool = new Pool({ connectionString: databaseUrl })
    }

    async insert(event) {
        await this.pool.query(
            `INSERT INTO event
                (user_sub, collection, event_type, lesson_id, problem_id, step_id, is_correct, client_time, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                event.userSub,
                event.collection,
                event.eventType,
                event.lessonId,
                event.problemId,
                event.stepId,
                event.isCorrect,
                event.clientTime,
                event.payload,
            ]
        )
    }
}

/** For local work without Postgres: takes events and keeps none. */
const discardEvents = { insert: async () => {} }

module.exports = { EventStore, discardEvents }
