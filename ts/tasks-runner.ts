import * as events from "events";
import {QueueTaskItem, Task, TaskExecResult, Progress, TasksRunnerJSON} from "./types";
import {TaskRunner} from "./task-runner";
import treeKill = require('tree-kill');

interface IQueue {
    enqueue(tasks: Task[]);
    dequeue(maxToDequeue: number): QueueTaskItem[];
    clear();
    toJSON(): QueueTaskItem[];
    on(event: "enqueue", listener: () => void): this;
}

class Queue extends events.EventEmitter {
    private __queue: QueueTaskItem[];
    constructor() {
        super();
        this.__queue = [];
    }
    enqueue(tasks: Task[]) {
        for (let i in tasks) {
            this.__queue.push({id: parseInt(i), task: tasks[i]});
        }
        this.emit("enqueue");
    }
    clear() {
        this.__queue = [];
    }
    dequeue(maxToDequeue: number): QueueTaskItem[] {
        let n = Math.min(this.__queue.length, maxToDequeue);
        if (n > 0) {
            return this.__queue.splice(0, n);
        } else {
            return null;
        }
    }
    toJSON(): QueueTaskItem[] {
        return this.__queue;
    }
}

interface IProcessesTracker {
    add(pid: number, id: number, task: Task): void
    remove(pid: number, result: TaskExecResult): Task;
    clear();
    getRunningTooLongTasks(thresholdMinutes: number): {id: number, pid: number}[];
    readonly count: number;
    readonly runningTasks: {id: number, pid: number}[];
    toJSON(): {[pid: string]: {id: number, start: number, task: Task}};
    on(event: "added", listener: (id: number, pid: number, task: Task) => void);
    on(event: "removed", listener: (id: number, pid: number, task: Task, result: TaskExecResult, durationMS: number) => void);
}

class ProcessesTracker extends events.EventEmitter {
    private __map: {[pid: string]: {id: number, task: Task, start: number}};
    private __count: number;
    constructor() {
        super();
        this.__map = {};
        this.__count = 0;
    }
    add(pid: number, id: number, task: Task) {
        let s = pid.toString();
        if (!this.__map[s]) {
            this.__map[s] = {id, task, start: new Date().getTime()};
            this.__count++;
            this.emit("added", id, pid, task);
        }
    }
    remove(pid: number, result: TaskExecResult): Task {
        let s = pid.toString();
        let item = this.__map[s];
        if (item) {
            let id = item.id;
            let task = item.task;
            let start = item.start;
            delete this.__map[s];
            this.__count--;
            let durationMS = new Date().getTime() - start;
            this.emit("removed", id, pid, task, result, durationMS);
            return task;
        } else {
            return null;
        }
    }
    get count(): number {
        return this.__count;
    }
    toJSON(): {[pid: string]: {id: number, start: number, task: Task}} {
        return this.__map;
    }
    // returns current running tasks, null if no running task
    get runningTasks(): {id: number, pid: number}[] {
        let ret: {id: number, pid: number}[] = [];
        for (let pid in this.__map) {
            let item = this.__map[pid];
            ret.push({id: item.id, pid: parseInt(pid)});
        }
        return (ret.length > 0 ? ret : null);
    }
    getRunningTooLongTasks(thresholdSeconds: number): {id: number, pid: number}[] {
        let thresholdMS = thresholdSeconds * 1000;
        let now = new Date().getTime();
        let ret: {id: number, pid: number}[] = [];
        for (let pid in this.__map) {
            let item = this.__map[pid];
            if (now - item.start > thresholdMS) {
                ret.push({id: item.id, pid: parseInt(pid)});
            }
        }
        return (ret.length > 0 ? ret : null);
    }
    clear() {
        this.__map = {};
        this.__count = 0;        
    }
}

class TasksRunner extends events.EventEmitter {
    private __queue: IQueue;
    private __procesessTracker: IProcessesTracker;
    private __totalTasks: number;
    private __tasksCompleted: number;
    private __completionResolve: () => void;
    private __abortTimer: NodeJS.Timer;
    private __processesHealthCheckTimer: NodeJS.Timer;
        
    constructor(private maxConcurrent: number, private maxTaskExecutionSeconds: number) {
        super();
        this.__queue = new Queue();
        this.__queue.on("enqueue", () => {
            this.runTasksIfNecessary();
        });
        this.__procesessTracker = new ProcessesTracker();
        this.__procesessTracker.on("removed", (id: number, pid: number, task: Task, result: TaskExecResult, durationMS: number) => {
            this.runTasksIfNecessary();
            this.__tasksCompleted++;
            let progress: Progress = {
                total: this.__totalTasks
                ,completed: this.__tasksCompleted
                ,percentCompleted: (this.__totalTasks ? (this.__tasksCompleted * 100.0/(this.__totalTasks* 1.0)) : null)
            }
            this.emit("progress", progress);
            this.emit("task-complete", id, task, pid, result, durationMS);
            if (this.__totalTasks > 0 && this.__tasksCompleted === this.__totalTasks) {
                this.onAllTasksComplete();
            }
        });
        this.__totalTasks = 0;
        this.__tasksCompleted = 0;
        this.__completionResolve = null;
        this.__abortTimer = null;
        if (this.maxTaskExecutionSeconds) {
            this.__processesHealthCheckTimer = setInterval(() => {
                let tasks = this.__procesessTracker.getRunningTooLongTasks(this.maxTaskExecutionSeconds);
                this.killTasks(tasks);
            }, 5 * 1000);
        } else {
            this.__processesHealthCheckTimer = null;
        }
    }
    private killTasks(tasks: {id: number, pid: number}[]) {
        if (tasks) {
            this.emit("killing-tasks", tasks);
            for (let i in tasks) {
                treeKill(tasks[i].pid);
            }
        }
    }

    public get totalTasks(): number {return this.__totalTasks;}
    public get tasksCompleted(): number {return this.__tasksCompleted;}

    private get numAvailable(): number {
        return Math.max(this.maxConcurrent - this.__procesessTracker.count, 0);
    }
    private get hasAvailable(): boolean {
        return (this.numAvailable > 0);
    }
    public get running(): boolean {
        return (this.__procesessTracker.count > 0);
    }
    private runTasksIfNecessary() {
        let taskItems: QueueTaskItem[] = null;
        if (this.hasAvailable && (taskItems = this.__queue.dequeue(this.numAvailable)) != null) {
            for (let i in taskItems) {
                let taskItem = taskItems[i];
                this.__procesessTracker.add(TaskRunner.run(taskItem.task, this.onTaskCompleteHandler), taskItem.id, taskItem.task);
            }
        }
    }
    private onTaskComplete(pid: number, result: TaskExecResult) {
        this.__procesessTracker.remove(pid, result);
    }
    private get onTaskCompleteHandler(): (pid: number, result: TaskExecResult) => void {
        let __this = this;
        return __this.onTaskComplete.bind(__this);
    }

    private onFinalCleanup(triggerCompletion: boolean) {
        if (this.__processesHealthCheckTimer) {
            clearInterval(this.__processesHealthCheckTimer);
            this.__processesHealthCheckTimer = null;
        }
        if (this.__abortTimer) {
            clearTimeout(this.__abortTimer);
            this.__abortTimer = null;
        }
        if (this.__completionResolve) {
            if (triggerCompletion) this.__completionResolve();
            this.__completionResolve = null;
        }
    }

    private onAllTasksComplete() {
        this.onFinalCleanup(true);
        this.emit("finish");
    }
    run(tasks: Task[], timeoutSeconds?: number): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: any) => void) => {
            if (this.running) {
                reject("already running");
            } else if (!tasks || tasks.length === 0) {
                reject("no task to run");
            } else {
                this.__totalTasks = tasks.length;
                this.__tasksCompleted = 0;
                this.__completionResolve = resolve;
                if (timeoutSeconds) {
                    this.__abortTimer = setTimeout(() => {
                        this.abort()
                        .then(() => {
                            reject("aborted");
                        }).catch((err: any) => {
                            reject(err);
                        });
                    }, timeoutSeconds * 1000);
                }
                this.__queue.enqueue(tasks);
            }
        });
    }
    private abort(): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: any) => void) => {
            let MAX_TRY_KILL_COUNT = 3;
            let CHECK_INTERVAL_MS = 3 * 1000;

            this.emit("aborting");
            this.__queue.clear();

            this.onFinalCleanup(false);

            let tryKillCount = 0;
            let checkTimer: NodeJS.Timer = null;

            let exitAbort = (err?: any) => {
                if (checkTimer) {
                    clearInterval(checkTimer);
                    checkTimer = null;
                }
                if (err) {
                    this.emit("abort-failed", err);
                    reject(err);
                } else {    // no error
                    this.emit("aborted");
                    resolve();
                }
            };

            let runningTasks = this.__procesessTracker.runningTasks;    // check running tasks
            if (runningTasks) { // some tasks still running
                this.killTasks(runningTasks);
                tryKillCount++;

                checkTimer = setInterval(() => {
                    let runningTasks = this.__procesessTracker.runningTasks;    // check running tasks
                    if (runningTasks) { // some tasks still running
                        if (tryKillCount < MAX_TRY_KILL_COUNT) {
                            this.killTasks(runningTasks);
                            tryKillCount++;
                        } else {    // try kill count reaches MAX_TRY_KILL_COUNT and there are still running tasks
                            this.__procesessTracker.clear();
                            let error = `unable to abort all tasks/processes after ${MAX_TRY_KILL_COUNT} tries. still running tasks: ${JSON.stringify(runningTasks)}`;
                            exitAbort(error);
                        }
                    } else {    // no more running tasks
                        exitAbort();
                    }
                }, CHECK_INTERVAL_MS);
            } else {    // no more running tasks
                exitAbort();
            }
        });
    }

    toJSON(): TasksRunnerJSON {
        return {
            running: this.running
            ,totalTasks: this.totalTasks
            ,tasksCompleted: this.tasksCompleted
            ,queue: this.__queue.toJSON()
            ,runningProcesses: this.__procesessTracker.toJSON()            
        };
    }
}

export interface ITasksRunner {
    run(tasks: Task[], timeoutSeconds?: number): Promise<void>;
    readonly totalTasks: number;
    readonly tasksCompleted: number;
    readonly running: boolean;
    toJSON(): TasksRunnerJSON;
    on(event: "progress", listener: (progress: Progress) => void): this;
    on(event: "task-complete", listener: (id: number, task: Task, pid: number, result: TaskExecResult, durationMS: number) => void): this;
    on(event: "finish", listener: () => void): this;
    on(event: "killing-tasks", listener: (tasks: {id: number, pid: number}[]) => void): this;
    on(event: "aborting", listener: () => void): this;
    on(event: "abort-failed", listener: (err: any) => void): this;
    on(event: "aborted", listener: () => void): this;
}

export function get(maxConcurrent: number = 2, maxTaskExecutionSeconds?: number): ITasksRunner {
    return new TasksRunner(maxConcurrent, maxTaskExecutionSeconds);
}