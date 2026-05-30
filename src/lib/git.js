import { execFile } from 'child_process';

function execGit(args, cwd) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd }, (error, stdout) => {
            if (error) {
                error.gitOutput = stdout;
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

export { execGit };
