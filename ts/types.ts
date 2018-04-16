export interface TaskExecParams {
    cmd: string;
    env?: {[varible: string]: string};
    stdin?: string;
}

export interface Task extends TaskExecParams {
    tags?: {[fld: string]: any};
}

export interface TaskExecResult {
    retCode: number;
    stdout?: string;
    stderr?: string;
}

export interface QueueTaskItem {
    id: number;
    task: Task;
}

export interface Progress {
    total: number;
    completed: number;
    percentCompleted: number;
}

export interface TasksRunnerJSON {
    running: boolean;
    totalTasks: number;
    tasksCompleted: number;
    queue: QueueTaskItem[];
    runningProcesses: {[pid: string]: {id: number, start: number, task: Task}};
}