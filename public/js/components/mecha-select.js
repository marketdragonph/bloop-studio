// The mecha select (ported from bloop's enhancedSelect): an ARIA listbox with full keyboard
// support whose panel is teleported to <body>, because clipped parents (cut cards, the board's
// zoomed world) would otherwise clip it away. Options and value are functions so the select
// stays in sync with whatever state owns them.
//
//   x-data="MechaSelect({ options: () => [...], value: () => current, onChange: (v) => save(v) })"
let uid = 0;

export default function MechaSelect({ options, value, onChange, placeholder = 'Choose…' }) {
    return {
        id: `sel-${++uid}`,
        open: false,
        active: -1,
        placeholder,
        panelStyle: {},

        get items() {
            return options() ?? [];
        },

        get selected() {
            return this.items.find((o) => o.value === value()) ?? null;
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
            this.open = true;
            this.active = Math.max(0, this.items.findIndex((o) => o.value === value()));
        },

        close() {
            this.open = false;
            this.active = -1;
        },

        closeAndFocus() {
            this.close();
            this.$refs.trigger.focus();
        },

        /** Fixed coordinates from the trigger's on-screen rect; flips upward near the bottom. */
        place() {
            const rect = this.$refs.trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom;
            const style = { left: `${Math.min(rect.left, window.innerWidth - 168)}px`, minWidth: `${rect.width}px` };
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
