import {exec} from 'child_process';
import treeKill = require('tree-kill');
import {TaskExecParams, TaskExecResult} from "./types";
import * as fs from 'fs';
import * as stream from 'stream';

export class TaskRunner {
    static run(taskExecParams: TaskExecParams, onCompleteHandler: (pid: number, result: TaskExecResult) => void): number {
        let cmd = taskExecParams.cmd;
        let stdin = taskExecParams.stdin;
        let instream: stream.Readable = null;
        let pid:number = null;
        let stdout = '';
        let stderr = '';
        let raisedError = "";
        if (stdin && stdin.length > 0) {
            if (stdin.length >= 1 && stdin.substr(0,1) === '@') {   // stdin string begins with '@' => a file path
                let stdinFile = stdin.substr(1);
                instream = fs.createReadStream(stdinFile, {encoding: 'utf8'});
            } else {
                instream = new stream.Readable();
                instream.setEncoding("utf8");
                instream.push(stdin);
                instream.push(null);
            }
        }
        if (instream) {
            instream.on("error", (err: any) => {    // stdin stream has some kind of error (maybe input file does not exist)
                if (err.syscall && err.path)
                    raisedError = "error " + err.syscall + " " + err.path;
                else
                    raisedError = JSON.stringify(err);
                treeKill(pid, 'SIGKILL');   // kill the child process tree
            });
        }
        let env = taskExecParams.env;
        let child = exec(cmd, {maxBuffer: 20000 * 1024, env});
        if (instream && child.stdin) instream.pipe(child.stdin);
        pid = child.pid;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (data:string) => {
            stdout += data;
        });
        child.stderr.on('data', (data:string) => {
            stderr += data;
        });
        child.on('close', (code: number, signal: string) => {
            let result: TaskExecResult = {
                retCode: code
                ,stdout: (stdout.length > 0 ? stdout : null)
                ,stderr: (stderr.length > 0 ? stderr : (raisedError ? raisedError : null))
            };
            if (typeof onCompleteHandler === "function") {
                onCompleteHandler(pid, result);
            }
        });
        return pid;
    }
}
