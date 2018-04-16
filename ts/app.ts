import * as types from "./types";
import * as tr from "./tasks-runner";

let tasks: types.Task[] = [];

for (let i = 0; i < 100; i++) {
    let task: types.Task = {
        //cmd: "echo How are you"
        cmd: "C:\\run\\exe\\sleep.exe 4"
    }
    tasks.push(task);
}

let tasksRunner = tr.get(8);

tasksRunner.on("finish", () => {
    console.log("<<FINISH>> :-)");
}).on("progress", (progress: types.Progress) => {
    console.log(`<<PROGRESS>>: ${JSON.stringify(progress, null, 2)}`);
}).on("task-complete", (id: number, task: types.Task, pid: number, result: types.TaskExecResult, durationMS: number) => {
    console.log(`<<task-complete>>: ${JSON.stringify({id, task, pid, result, durationMS}, null, 2)}`);
}).on("killing-tasks", (tasks: {id: number, pid: number}[]) => {
    console.log(`<<killing-tasks>>: ${JSON.stringify(tasks, null, 2)}`);
}).on("aborting", () => {
    console.log("<<ABORTING...>>");
}).on("abort-failed", (err: any) => {
    console.log(`<<ABORT-FAILED>>: ${JSON.stringify(err)} :-(`);
}).on("aborted", () => {
    console.log("<<ABORTED>> :-");
}).run(tasks, 20)
.then(() => {
    console.log("Done");
    process.exit(0);
}).catch((err: any) => {
    console.error(`!!! Error: ${JSON.stringify(err)}`);
    process.exit(1);
});