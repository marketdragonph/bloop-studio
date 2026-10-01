// SQLite via Node's built-in driver: one file in the app-data folder, WAL mode,
// foreign keys on, numbered .sql migrations applied once each inside a transaction.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDatabase(filePath) {
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
    const db = new DatabaseSync(filePath);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db);
    return db;
}

function migrate(db) {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
    const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name));
    const pending = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

    for (const name of pending) {
        transaction(db, () => {
            db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
            db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
        });
    }
}

/** Runs fn inside BEGIN/COMMIT, rolling back on any error. Returns fn's result. */
export function transaction(db, fn) {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

export const now = () => new Date().toISOString();
