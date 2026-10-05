import { DatabaseSync as Database } from 'node:sqlite';
const db = new Database(process.env.TEMP + '/bloop-studio-dev/bloop-studio.db', { readOnly: true });
const tag = process.argv[2];
const nodes = db.prepare('SELECT id, type, label, text_content, settings FROM space_nodes WHERE space_id = 3').all();
const byId = new Map(nodes.map((n) => [n.id, n]));
for (const n of nodes.filter((n) => n.label === tag || n.label?.startsWith(`${tag} ·`))) {
    console.log(`\n@${n.id} ${n.type} "${n.label}" ${n.settings !== '{}' ? n.settings : ''}`);
    if (n.text_content) console.log(n.text_content);
    const ins = db.prepare('SELECT from_node_id f, to_socket s FROM space_connections WHERE to_node_id = ?').all(n.id);
    if (ins.length) console.log('  ← ' + ins.map((w) => `${byId.get(w.f)?.label} [${byId.get(w.f)?.type}]${w.s !== 'prompt' ? ` (${w.s})` : ''}`).join(' | '));
}
