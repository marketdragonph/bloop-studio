// Launch screen art: drifts a few pixels against the pointer, so the hangar has depth.
// Off for people who ask for reduced motion (the CSS drops the transform too).
const DRIFT_PX = 12;

export default function LaunchArt() {
    return {
        frame: 0,

        init() {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            this.move = this.move.bind(this);
            window.addEventListener('pointermove', this.move, { passive: true });
        },

        destroy() {
            window.removeEventListener('pointermove', this.move);
            cancelAnimationFrame(this.frame);
        },

        move(event) {
            const x = (event.clientX / window.innerWidth - 0.5) * -DRIFT_PX;
            const y = (event.clientY / window.innerHeight - 0.5) * -DRIFT_PX;
            cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(() => {
                this.$el.style.setProperty('--art-x', `${x.toFixed(1)}px`);
                this.$el.style.setProperty('--art-y', `${y.toFixed(1)}px`);
            });
        },
    };
}
