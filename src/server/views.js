// Edge.js (Blade-like) renderer. Globals every view needs are registered once here.
import { Edge } from 'edge.js';

export function createViews({ csrfToken }) {
    const edge = Edge.create({ cache: process.env.NODE_ENV === 'production' });
    edge.mount(new URL('./views/', import.meta.url));
    edge.global('csrfToken', csrfToken);
    edge.global('appName', 'Bloop Studio');

    return {
        render: (template, data = {}) => edge.render(template, data),
    };
}
