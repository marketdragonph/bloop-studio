// Any web page in any browser can POST to 127.0.0.1, so every mutating request must
// prove it came from our own window: HTMX sends the per-launch token as a header,
// plain forms send it as a hidden field.
import { timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const matches = (expected, given) =>
    typeof given === 'string' &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));

export function csrf(token) {
    return async (c, next) => {
        if (SAFE_METHODS.has(c.req.method)) return next();

        let given = c.req.header('x-csrf-token');
        if (!given && c.req.header('content-type')?.includes('form')) {
            given = (await c.req.parseBody())._csrf;
        }
        if (!matches(token, given)) return c.text('Invalid or missing CSRF token', 403);
        return next();
    };
}
