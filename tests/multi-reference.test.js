import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection } from '../src/shared/node-types.js';
import { choosePreset, compileGraph, firstVariants, loadCatalog } from '../src/server/generation/presets.js';
import { laneOps } from '../src/server/director/build/lane.js';
import { parseBeat } from '../src/server/director/build/beat-writer.js';

const presets = firstVariants(loadCatalog());

test('an Image card takes up to three pictures; a fourth is refused', () => {
    const to = { id: 9, type: 'image' };
    const wires = [1, 2, 3].map((id) => ({ from_node_id: id, to_node_id: 9, to_socket: 'reference' }));
    assert.equal(checkConnection({ from: { id: 3, type: 'image' }, to, existing: wires.slice(0, 2), socketKey: 'reference' }).ok, true);
    const fourth = checkConnection({ from: { id: 4, type: 'image' }, to, existing: wires, socketKey: 'reference' });
    assert.deepEqual([fourth.ok, fourth.reason], [false, 'Pictures takes up to 3. Remove one first.']);
});

test('two or more pictures render on Qwen-Image-Edit, with the graph for that many; one keeps the card\'s pick', () => {
    assert.equal(choosePreset(presets, { type: 'image', settings: { family: 'zimage' }, wired: ['reference'] }).id, 'zimage-i2i');
    assert.equal(choosePreset(presets, { type: 'image', settings: { family: 'zimage' }, wired: ['reference', 'reference'] }).id, 'qwenedit-ref2');
    assert.equal(choosePreset(presets, { type: 'image', settings: { family: 'qwenedit' }, wired: ['reference'] }).id, 'qwenedit-ref1');
    assert.equal(choosePreset(presets, { type: 'image', wired: ['reference', 'reference', 'reference'] }).id, 'qwenedit-ref3');
    const graph = compileGraph(presets.get('qwenedit-ref2'), { prompt: 'x', reference1: 'a.png', reference2: 'b.png', width: 1344, height: 768 });
    const loads = Object.values(graph).filter((n) => n.class_type === 'LoadImage').map((n) => n.inputs.image);
    assert.deepEqual(loads, ['a.png', 'b.png']);
});

test('the Director wires a beat\'s sheets into its still, people first, with which picture is who', () => {
    const plates = {
        hangar: { kind: 'location', look: 1, picture: 2 },
        'mira-sen': { kind: 'cast', look: 3, picture: 4 },
        'kai-reyes': { kind: 'cast', look: 5, picture: 6 },
        drone: { kind: 'prop', look: 7, picture: 8 },
    };
    const { ops } = laneOps({ tag: 'shot', brief: 'b', refs: ['hangar', 'mira-sen', 'kai-reyes', 'drone'] }, parseBeat('STILL: s\nCLIP: c', 'b'),
        { lane: 4, plates, editFamily: 'qwenedit', lengths: [5], withSound: false });
    const pictures = ops.filter((o) => o.op === 'wire' && o.socket === 'reference').map((o) => o.from);
    assert.deepEqual(pictures, ['@4', '@6', '@8']); // three at most: the place is dropped before a person
    assert.equal(ops.find((o) => o.ref === 'shot-still').settings.family, 'qwenedit');
    assert.match(ops.find((o) => o.ref === 'shot-still-words').body, /@mira-sen is picture 1; @kai-reyes is picture 2; @drone is picture 3\. Keep every face/);
});
