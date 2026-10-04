// What this PC has for an offline engine: its graphics card (name, vendor, memory) and the
// free space on each drive. Read from Windows itself, so it works before ComfyUI exists.
//
// GPU: the display-adapter class in the registry. Its `HardwareInformation.qwMemorySize` is the
// card's real memory for NVIDIA and AMD alike; WMI's AdapterRAM stops at 4 GB and is useless here.
import { execFile } from 'node:child_process';
import { statfsSync } from 'node:fs';

const ADAPTERS = 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*';
const QUERY = `Get-ItemProperty '${ADAPTERS}' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { $_.DriverDesc + '|' + $_.'HardwareInformation.qwMemorySize' + '|' + $_.ProviderName }`;

/** Parses "name|bytes|provider" lines; the card with the most memory is the one that renders. */
export function parseAdapters(text) {
    const cards = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, bytes, provider] = line.split('|');
        const label = `${name} ${provider}`;
        const vendor = /nvidia/i.test(label) ? 'nvidia' : /amd|radeon|advanced micro/i.test(label) ? 'amd' : /intel/i.test(label) ? 'intel' : 'other';
        return { name: name.trim(), vendor, vramGb: Math.round((Number(bytes) / 1024 ** 3) * 10) / 10 };
    });
    return cards.sort((a, b) => b.vramGb - a.vramGb)[0] ?? null;
}

export function readGpu({ run = powershell } = {}) {
    return run(QUERY).then(parseAdapters).catch(() => null);
}

/** Fixed drives with their free space, most room first. */
export function readDrives({ letters = 'CDEFGHIJ', statfs = statfsSync } = {}) {
    const drives = [];
    for (const letter of letters) {
        try {
            const s = statfs(`${letter}:/`);
            drives.push({ letter, freeGb: Math.floor((s.bavail * s.bsize) / 1e9), totalGb: Math.floor((s.blocks * s.bsize) / 1e9) });
        } catch {
            // No such drive.
        }
    }
    return drives.sort((a, b) => b.freeGb - a.freeGb);
}

function powershell(command) {
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15_000 },
            (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
}
