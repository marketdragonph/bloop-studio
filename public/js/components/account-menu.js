// Top-bar account menu (partials/account-menu.edge): a disclosure that closes on Escape, on a
// click outside it, and when focus leaves it.
export default function AccountMenu() {
    return {
        open: false,

        toggle() {
            this.open = !this.open;
            if (this.open) this.$nextTick(() => this.$refs.panel?.querySelector('a, button')?.focus());
        },

        close(returnFocus = false) {
            if (!this.open) return;
            this.open = false;
            if (returnFocus) this.$refs.trigger?.focus();
        },

        onFocusOut(event) {
            if (!this.$el.contains(event.relatedTarget)) this.close();
        },
    };
}
