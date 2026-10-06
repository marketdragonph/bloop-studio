// The mecha select (ported from bloop's enhancedSelect): an ARIA listbox with full keyboard
// support whose panel is teleported to <body>, because clipped parents (cut cards, the board's
// zoomed world) would otherwise clip it away. Options and value are functions so the select
// stays in sync with whatever state owns them.
//
//   x-data="MechaSelect({ options: () => [...], value: () => current, onChange: (v) => save(v) })"
//
// A long list (the Model list with bloop's cloud models) gets a search box: it filters on the
// label and the description, so "cloud", "kling" or "credits" all narrow it.
let uid = 0;
const SEARCH_FROM = 9; // options before the search box appears

export default function MechaSelect({ options, value, onChange, placeholder = 'Choose…' }) {
    return {
        id: `sel-${++uid}`,
        open: false,
        active: -1,
        placeholder,
        panelStyle: {},
        query: '',

        get allItems() {
            return options() ?? [];
        },

        get searchable() {
            return this.allItems.length >= SEARCH_FROM;
        },

        /** The options shown: all of them, or those matching every word typed. None while closed: a board has six
         *  selects per card, and rendering every closed list (the long Model one too) slowed big boards down. */
        get items() {
            if (!this.open) return [];
            const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!words.length) return this.allItems;
            return this.allItems.filter((o) => {
                const text = `${o.label} ${o.description ?? ''}`.toLowerCase();
                return words.every((w) => text.includes(w));
            });
        },

        get selected() {
            return this.allItems.find((o) => o.value === value()) ?? null;
        },

        /** Typing narrows the list and highlights its first match. */
        search() {
            this.active = this.items.length ? 0 : -1;
        },

        optionId(index) {
            return `${this.id}-opt-${index}`;
        },

        toggle() {
            this.open ? this.close() : this.show();
        },

        show() {
            if (this.$refs.trigger.disabled) return;
            this.place();
            this.query = '';
            this.open = true;
            this.active = Math.max(0, this.items.findIndex((o) => o.value === value()));
            // By id: the box lives in the teleported panel, where $refs does not reach.
            if (this.searchable) this.$nextTick(() => document.getElementById(`${this.id}-search`)?.focus());
        },

        close() {
            this.open = false;
            this.active = -1;
            this.query = '';
        },

        closeAndFocus() {
            this.close();
            this.$refs.trigger.focus();
        },

        /**
         * Fixed coordinates from the trigger's on-screen rect; flips upward near the bottom. A searchable
         * list is wider (long model names and their prices), and is kept inside the window.
         */
        place() {
            const rect = this.$refs.trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom;
            const width = this.searchable ? Math.min(Math.max(rect.width, 320), window.innerWidth - 16) : Math.max(rect.width, 160);
            const style = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`, minWidth: `${width}px` };
            if (below < 200 && rect.top > below) style.bottom = `${window.innerHeight - rect.top + 4}px`;
            else style.top = `${rect.bottom + 4}px`;
            this.panelStyle = style;
        },

        move(step) {
            if (!this.open) return this.show();
            const count = this.items.length;
            if (count) this.active = (this.active + step + count) % count;
            this.$nextTick(() => document.getElementById(this.optionId(this.active))?.scrollIntoView({ block: 'nearest' }));
        },

        choose(index = this.active) {
            const option = this.items[index];
            if (!option) return;
            if (option.value !== value()) onChange(option.value);
            this.closeAndFocus();
        },
    };
}
