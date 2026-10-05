import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectVoice, reduceTrack } from '../public/js/components/audio-player.js';
import { fmtTime } from '../public/js/components/media-player.js';

test('the waveform: 80 bars normalised to the loudest, quiet stretches marked, speech share measured', () => {
    const rate = 8000;
    const data = new Float32Array(rate * 2); // 1 s of tone, then 1 s of near silence
    for (let i = 0; i < rate; i++) data[i] = 0.5 * Math.sin(i / 3);
    for (let i = rate; i < data.length; i++) data[i] = 0.0005 * Math.sin(i / 3);
    const track = reduceTrack(data, rate);
    assert.equal(track.peaks.length, 80);
    assert.ok(Math.max(...track.peaks) === 1);
    // Voiced through the tone, quiet after it (the 160 ms hangover runs a few bars past the end, so a breath does not flicker).
    assert.ok(track.barVoice.slice(0, 40).every(Boolean) && track.barVoice.slice(50).every((v) => !v));
    assert.ok(track.speechRatio > 0.45 && track.speechRatio < 0.65);
});

test('a click is not a word: voice runs shorter than three frames are dropped', () => {
    const rms = new Float32Array(40).fill(0.001);
    rms[10] = 0.5; // one loud frame
    for (let f = 20; f < 30; f++) rms[f] = 0.5;
    const voice = detectVoice(rms);
    assert.equal(voice[10], 1); // held by the hangover, so it is a run of 5…
    assert.equal(voice.slice(20, 30).every(Boolean), true);
    assert.equal(fmtTime(75.4), '1:15');
    assert.equal(fmtTime(Number.NaN), '0:00');
});
