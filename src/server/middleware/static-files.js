// Serves public/ under a URL prefix. Resolves paths against the app's own folder (not the
// process cwd, which differs once installed) and refuses anything that escapes it.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default root is public/; the board also loads src/shared/ (rules shared with the server).
const PUBLIC_RELATIVE = '../../../public/';

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ico': 'image/x-icon',
};

/** `rootRelative` is relative to this file (src/server/middleware/). */
export function staticFiles(prefix, rootRelative = PUBLIC_RELATIVE) {
    const root = fileURLToPath(new URL(rootRelative, import.meta.url));

    return async (c, next) => {
        const relative = decodeURIComponent(c.req.path.slice(prefix.length));
        const filePath = normalize(join(root, relative));
        if (!filePath.startsWith(root) || filePath.endsWith(sep)) return next();

        try {
            const body = await readFile(filePath);
            return c.body(body, 200, {
                'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
                'cache-control': 'no-cache',
            });
        } catch {
            return next();
        }
    };
}
