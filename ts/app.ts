import * as types from "./types";
import * as tr from "./tasks-runner";
import * as fs from "fs";
import * as readline from "readline";

function parseCommandFile(filePath: string): Promise<types.Task[]> {
    return new Promise<types.Task[]>((resolve: (value: types.Task[]) => void, reject: () => void) => {
        let ret: types.Task[] = [];
        let lineReader = readline.createInterface({input: fs.createReadStream(filePath)});
        lineReader.on("close", () => {
            resolve(ret);
        }).on("line", (line: string) => {
            let parts = line.split("\t");
            if (parts.length >= 1) {
                let cmd = parts[0];
                if (cmd) {
                    let task: types.Task = {cmd};
                    ret.push(task);
                }
            }
        });
    });
}

let inputFile = process.argv[2];
if (!inputFile) {
    console.error("inputFile is not optional");
    process.exit(1);
}

parseCommandFile(inputFile)
.then((tasks: types.Task[]) => {
    console.log(`number of tasks to run: ${tasks.length}`);
    let tasksRunner = tr.get(20);

    return tasksRunner.on("finish", () => {
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
    }).run(tasks);
}).then(() => {
    console.log("Done");
    process.exit(0);
}).catch((err: any) => {
    console.error(`!!! Error: ${JSON.stringify(err)}`);
    process.exit(1);
});

/*
let tasks: types.Task[] = [];

for (let i = 0; i < 100; i++) {
    let task: types.Task = {
        //cmd: "echo How are you"
        cmd: "C:\\run\\exe\\sleep.exe 4"
    }
    tasks.push(task);
}

let tasksRunner = tr.get(20);

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
}).run(tasks)
.then(() => {
    console.log("Done");
    process.exit(0);
}).catch((err: any) => {
    console.error(`!!! Error: ${JSON.stringify(err)}`);
    process.exit(1);
});

*/