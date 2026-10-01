// Modal loaded by HTMX into #modal. HTMX focuses [autofocus] after the swap; this restores
// focus to whatever opened the modal when it closes.
export default function Modal() {
    return {
        opener: null,

        init() {
            this.opener = document.activeElement;
        },

        close() {
            this.$el.closest('#modal').innerHTML = '';
            this.opener?.focus?.();
        },
    };
}
