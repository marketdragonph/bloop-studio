import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { candidates, findInstall, inspect, isLocal, withAddress } from '../src/server/services/comfy-install.js';
import { ComfyLauncher } from '../src/server/services/comfy-launcher.js';

/** A fake disk: { 'C:\\ComfyUI\\run_nvidia_gpu.bat': 'contents', ... }. */
function disk(files) {
    const paths = Object.keys(files);
    return {
        existsSync: (p) => paths.some((f) => f === p || f.startsWith(p + '\\')),
        readFileSync: (p) => files[p],
        readdirSync: (dir) => paths.filter((f) => f.startsWith(dir + '\\')).map((f) => f.slice(dir.length + 1)).filter((f) => !f.includes('\\')),
    };
}

const portable = (root, bats = { 'run_nvidia_gpu.bat': '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build\r\npause' }) => ({
    [join(root, 'python_embeded', 'python.exe')]: '',
    [join(root, 'ComfyUI', 'main.py')]: '',
    ...Object.fromEntries(Object.entries(bats).map(([name, body]) => [join(root, name), body])),
});

test('a portable ComfyUI starts the way its own .bat does', () => {
    const fs = disk(portable('C:\\ComfyUI', {
        'run_cpu.bat': '.\\python_embeded\\python.exe -s ComfyUI\\main.py --cpu --windows-standalone-build',
        'run_nvidia_gpu.bat': '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --fast fp16_accumulation %*\r\npause',
    }));
    const install = inspect('C:\\ComfyUI', fs);
    assert.equal(install.kind, 'portable');
    assert.equal(install.script, 'run_nvidia_gpu.bat'); // never the CPU script when a GPU one exists
    assert.equal(install.python, join('C:\\ComfyUI', 'python_embeded', 'python.exe'));
    // Shell plumbing (%*) is not passed on.
    assert.deepEqual(install.args, ['-s', join('ComfyUI', 'main.py'), '--windows-standalone-build', '--fast', 'fp16_accumulation']);
});

test('an AMD portable uses its own script; a git install with a venv is found too', () => {
    const amd = disk(portable('D:\\ComfyUI_windows_portable', { 'run_amd_gpu.bat': '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --use-pytorch-cross-attention' }));
    assert.deepEqual(inspect('D:\\ComfyUI_windows_portable', amd).args.slice(2), ['--windows-standalone-build', '--use-pytorch-cross-attention']);

    const git = disk({ 'E:\\ComfyUI\\main.py': '', 'E:\\ComfyUI\\venv\\Scripts\\python.exe': '' });
    assert.deepEqual(inspect('E:\\ComfyUI', git), { root: 'E:\\ComfyUI', python: 'E:\\ComfyUI\\venv\\Scripts\\python.exe', args: ['main.py'], kind: 'venv' });
    assert.equal(inspect('E:\\Nothing', git), null);
});

test('the folder the person set is looked at first, then the usual places', () => {
    const list = candidates({ configured: 'X:\\Tools\\Comfy', env: { USERPROFILE: 'C:\\Users\\jo' }, drives: 'C' });
    assert.equal(list[0], 'X:\\Tools\\Comfy');
    assert.ok(list.includes('C:\\ComfyUI_windows_portable'));
    assert.ok(list.includes(join('C:\\Users\\jo', 'Desktop', 'ComfyUI_windows_portable')));

    const fs = disk(portable('C:\\ComfyUI'));
    assert.equal(findInstall({ env: {}, drives: 'CD', fs }).root, 'C:\\ComfyUI');
});

test('only a local engine address can be started, on its own port', () => {
    assert.equal(isLocal('http://127.0.0.1:8188'), true);
    assert.equal(isLocal('http://192.168.1.20:8188'), false);
    const install = { args: ['main.py'] };
    assert.deepEqual(withAddress(install, 'http://127.0.0.1:8188'), ['main.py']);
    assert.deepEqual(withAddress(install, 'http://127.0.0.1:8190'), ['main.py', '--port', '8190']);
});

function launcher({ install = { root: 'C:\\ComfyUI', python: 'py.exe', args: ['main.py'] }, url = 'http://127.0.0.1:8188' } = {}) {
    const spawned = [];
    const killed = [];
    const settings = { get: (key) => ({ comfyUrl: url, comfyPath: '' })[key] };
    const l = new ComfyLauncher({
        settings,
        find: () => install,
        spawn: (cmd, args, opts) => {
            const child = Object.assign(new EventEmitter(), { pid: 4242, stdout: new EventEmitter(), stderr: new EventEmitter() });
            spawned.push({ cmd, args, opts, child });
            return child;
        },
        killTree: (pid) => killed.push(pid),
    });
    return { l, spawned, killed };
}

test('Start runs ComfyUI hidden; Stop ends the whole tree; it is starting until it answers', () => {
    const { l, spawned, killed } = launcher();
    l.start();
    l.start(); // a second press does not start a second engine
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].opts.windowsHide, true);
    assert.equal(spawned[0].opts.cwd, 'C:\\ComfyUI');
    assert.equal(spawned[0].opts.env.PYTHONIOENCODING, 'utf-8'); // an emoji in a node's log must not crash it
    assert.deepEqual(l.state(), { available: true, path: 'C:\\ComfyUI', running: true, starting: true, error: null });
    assert.equal(l.state({ online: true }).starting, false);

    l.stop();
    assert.deepEqual(killed, [4242]);
    spawned[0].child.emit('exit', 1); // the kill's own exit is not reported as a failure
    assert.equal(l.state().error, null);
});

test('a ComfyUI that exits on its own says why, with its last line', () => {
    const { l, spawned } = launcher();
    l.start();
    spawned[0].child.stderr.emit('data', 'Loading...\nRuntimeError: CUDA out of memory\n');
    spawned[0].child.emit('exit', 1);
    const state = l.state();
    assert.equal(state.running, false);
    assert.match(state.error, /code 1.*CUDA out of memory/);
    assert.deepEqual(l.log(), ['Loading...', 'RuntimeError: CUDA out of memory']);
});

test('nothing to start: no install, or an engine on another PC; Stop never touches one it did not start', () => {
    assert.throws(() => launcher({ install: null }).l.start(), /No ComfyUI found/);
    const remote = launcher({ url: 'http://192.168.1.20:8188' });
    assert.equal(remote.l.state().available, false);
    assert.throws(() => remote.l.start());

    const { l, killed } = launcher();
    l.stop();
    assert.deepEqual(killed, []);
});
