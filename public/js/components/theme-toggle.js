// Top-bar theme switch: dark → light → system. Applies instantly, then saves to settings.
const ORDER = ['dark', 'light', 'system'];
const LABELS = { dark: 'Dark theme', light: 'Light theme', system: 'Theme follows Windows' };

export default function ThemeToggle() {
    return {
        theme: document.documentElement.dataset.theme || 'dark',

        get label() {
            return `${LABELS[this.theme]}. Switch theme.`;
        },

        async cycle() {
            const previous = this.theme;
            this.theme = ORDER[(ORDER.indexOf(this.theme) + 1) % ORDER.length];
            document.documentElement.dataset.theme = this.theme;
            const response = await fetch('/settings/theme', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content ?? '',
                },
                body: JSON.stringify({ theme: this.theme }),
            }).catch(() => null);
            if (!response?.ok) {
                this.theme = previous; // keep what is saved and what is shown the same
                document.documentElement.dataset.theme = previous;
            }
        },
    };
}
