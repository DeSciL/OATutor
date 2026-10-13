-- The typed columns are the ones a progress view filters on; everything the app sent is in payload.
CREATE TABLE event (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now(),
    user_sub    text NOT NULL,
    collection  text NOT NULL,
    event_type  text,
    lesson_id   text,
    problem_id  text,
    step_id     text,
    is_correct  boolean,
    client_time timestamptz,
    payload     jsonb NOT NULL
);

CREATE INDEX event_lesson_user_idx ON event (lesson_id, user_sub);
CREATE INDEX event_user_time_idx ON event (user_sub, received_at);
