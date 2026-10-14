import builtinBKTParams from "../content-sources/oatutor/bkt-params/defaultBKTParams.json";

const builtinSkill = Object.keys(builtinBKTParams)[0];

const overlay = () => ({
    coursePlans: [
        {
            courseName: "Imported course",
            language: "en",
            lessons: [{ id: "imported-lesson", name: "Imported lesson", learningObjectives: { imported_skill: 0.85 } }],
        },
    ],
    problems: [{ id: "imported1", lessonId: "imported-lesson", steps: [] }],
    skillModel: { imported1a: ["imported_skill"] },
    bktParams: {
        default: {
            imported_skill: { probMastery: 0.2, probTransit: 0.1, probSlip: 0.1, probGuess: 0.1 },
            [builtinSkill]: { probMastery: 0.99, probTransit: 0.99, probSlip: 0.99, probGuess: 0.99 },
        },
        experimental: {},
    },
});

// Each test gets its own module registry, so config.js runs its load-time setup afresh.
const isolated = run => jest.isolateModules(run);

test("a lesson imported before config.js loads can be opened", () => {
    isolated(() => {
        require("./contentStore").applyOverlay(overlay());
        const { findLessonById } = require("../config/config");

        expect(findLessonById("imported-lesson")).toMatchObject({ id: "imported-lesson", courseName: "Imported course" });
    });
});

test("imported problems and skills join the built-in ones", async () => {
    // The pool is served as a file; the real one is 36 MB.
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: "builtin1", lessonId: "builtin-lesson" }] }));
    let store;
    isolated(() => {
        store = require("./contentStore");
    });

    await store.loadProblemPool();
    store.applyOverlay(overlay());

    expect(global.fetch).toHaveBeenCalledWith("/content-pool/oatutor.json", expect.anything());
    expect(store.problemPool.map(problem => problem.id)).toEqual(["builtin1", "imported1"]);
    expect(store.skillModel.imported1a).toEqual(["imported_skill"]);
    expect(store.defaultBKTParams.imported_skill.probMastery).toBe(0.2);
});

test("built-in skill parameters are never replaced", () => {
    isolated(() => {
        const store = require("./contentStore");
        store.applyOverlay(overlay());

        expect(store.defaultBKTParams[builtinSkill]).toEqual(builtinBKTParams[builtinSkill]);
    });
});

test("applying twice adds nothing twice", () => {
    isolated(() => {
        const store = require("./contentStore");
        const courses = store.coursePlans.length;
        store.applyOverlay(overlay());
        store.applyOverlay(overlay());

        expect(store.coursePlans.length).toBe(courses + 1);
    });
});

test("with built-in content off, only imported courses exist", async () => {
    process.env.REACT_APP_BUILTIN_CONTENT = "off";
    global.fetch = jest.fn();
    let store;
    isolated(() => {
        store = require("./contentStore");
    });
    delete process.env.REACT_APP_BUILTIN_CONTENT;

    await store.loadProblemPool();
    store.applyOverlay(overlay());

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.coursePlans.map(course => course.courseName)).toEqual(["Imported course"]);
    expect(store.problemPool.map(problem => problem.id)).toEqual(["imported1"]);
    // Nothing built-in is left to win over the imported parameters.
    expect(store.defaultBKTParams[builtinSkill].probMastery).toBe(0.99);
});
