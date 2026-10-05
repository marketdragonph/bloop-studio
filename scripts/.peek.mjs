import { DatabaseSync as Database } from 'node:sqlite';
const db = new Database(process.env.TEMP + '/bloop-studio-dev/bloop-studio.db', { readOnly: true });
const space = Number(process.argv[3] ?? 3);
const run = db.prepare('SELECT status FROM director_runs WHERE space_id = ? ORDER BY id DESC LIMIT 1').get(space);
if (process.argv[2] === 'wait') { console.log(run?.status ?? 'none'); process.exit(0); }
for (const r of db.prepare('SELECT role, text, actions FROM director_log WHERE space_id = ? ORDER BY id').all(space)) console.log(`--- ${r.role} (${JSON.parse(r.actions).length} actions)\n${r.text}`);
for (const p of db.prepare('SELECT id, approach, questions, assumptions, aspect, runtime_seconds, dispatched_at FROM director_plans WHERE space_id = ?').all(space)) console.log('PLAN', JSON.stringify(p));
for (const s of db.prepare('SELECT s.stage, s.state, s.payload FROM director_build_stages s JOIN director_plans p ON p.id = s.plan_id WHERE p.space_id = ?').all(space)) console.log('STAGE', s.stage, s.state, s.payload.slice(0, 1500));
for (const b of db.prepare('SELECT b.tag, b.state, b.lane, b.refs, b.error FROM director_plan_beats b JOIN director_plans p ON p.id = b.plan_id WHERE p.space_id = ?').all(space)) console.log('BEAT', b.tag, b.state, b.lane, b.refs, b.error ?? '');
console.log('cards', db.prepare('SELECT count(*) n FROM space_nodes WHERE space_id = ?').get(space).n, 'wires', db.prepare('SELECT count(*) n FROM space_connections WHERE space_id = ?').get(space).n, 'name', db.prepare('SELECT name FROM spaces WHERE id = ?').get(space).name);
