// JSON requests to our own server. Every failure becomes an ApiError with words a person
// can read, so nothing on the board ever fails silently (bloop's lost-save bug).
const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export async function api(method, url, body) {
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                Accept: 'application/json',
                'X-CSRF-Token': csrfToken(),
                ...(body !== undefined && { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError('The studio server did not answer. Is the app still running?', 0);
    }

    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(data?.error ?? `Request failed (${response.status}).`, response.status);
    return data;
}
