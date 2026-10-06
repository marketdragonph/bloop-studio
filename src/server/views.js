// Edge.js (Blade-like) renderer. Globals every view needs are registered once here.
// Layout components are isolated from page data, so anything the layout needs must be a global.
import { Edge } from 'edge.js';
import { icon } from '../shared/icons.js';
import { controlLabel } from '../shared/katana-controls.js';
import { mediaUrlOf } from '../shared/cut-edit.js';

export const THEMES = ['dark', 'light', 'system'];

export function createViews({ csrfToken, getTheme = () => 'dark' }) {
    const edge = Edge.create({ cache: process.env.NODE_ENV === 'production' });
    edge.mount(new URL('./views/', import.meta.url));
    edge.global('csrfToken', csrfToken);
    edge.global('appName', 'Bloop Studio');
    edge.global('icon', icon);
    edge.global('controlLabel', controlLabel); // Katana controls: the words come from the registry
    edge.global('mediaUrl', mediaUrlOf); // `/media/<path>`, each segment encoded
    edge.global('currentTheme', () => {
        const theme = getTheme();
        return THEMES.includes(theme) ? theme : 'dark';
    });

    return {
        render: (template, data = {}) => edge.render(template, data),
    };
}
