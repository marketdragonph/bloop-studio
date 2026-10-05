// Settings › Director › Editing style (Katana P4, 05 §3.8): the field shows the saved style with its registry hook,
// a save stores it trimmed to 600 characters, and a form without the field never wipes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViews } from '../src/server/views.js';
import { settingsRoutes } from '../src/server/routes/settings.js';

function fakeSettings(values = {}) {
    const data = { comfyUrl: 'http://127.0.0.1:8188', mediaDir: 'C:/media', llmProvider: 'anthropic', editStyle: '', ...values };
    return { data, all: () => ({ ...data, configured: {} }), get: (k) => data[k], update: (v) => Object.assign(data, v), clearSecret: () => {} };
}

const form = (fields) => new URLSearchParams({ comfyUrl: 'http://127.0.0.1:8188', mediaDir: 'C:/media', llmProvider: 'anthropic', ...fields }).toString();
const post = (routes, fields) => routes.request('/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(fields) });

test('Editing style: the field, its hook and the saved words; a save trims to 600; a form without it keeps it', async () => {
    const views = createViews({ csrfToken: 't' });
    const settings = fakeSettings({ editStyle: 'No dissolves. Hold the last shot.' });
    const html = await views.render('pages/settings', { settings: settings.all(), errors: {}, saved: false });
    assert.match(html, /<div class="field" data-control="settings\.editingStyle">/);
    assert.match(html, /<textarea class="field__input field__input--area" id="field-editStyle" name="editStyle"[^>]*maxlength="600"[^>]*>No dissolves\. Hold the last shot\.<\/textarea>/);
    assert.match(html, /<label class="field__label ae-stencil" for="field-editStyle">Editing style<\/label>/);

    const routes = settingsRoutes({ views, settings, onThemeChange: () => {} });
    const saved = await post(routes, { editStyle: `  Fast cuts, on the beat.${' x'.repeat(400)}  ` });
    assert.equal(saved.status, 302);
    assert.equal(settings.data.editStyle.length, 600);
    assert.ok(settings.data.editStyle.startsWith('Fast cuts, on the beat.'));
    await post(routes, {});
    assert.ok(settings.data.editStyle.startsWith('Fast cuts'), 'a form without the field never wipes the style');
    await post(routes, { editStyle: '' });
    assert.equal(settings.data.editStyle, '', 'an emptied field clears it');
});
