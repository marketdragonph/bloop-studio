// Which Katana phases have shipped (docs/plans/katana.md §5). Flip a phase here when it lands: the Director's
// guide (guide-katana.js) and tests/katana-guide.test.js read it, so the guide never names a control that is
// not in the app. Shared by the server and the browser.

/** Every phase, in build order (owner decision 6: P2b after P2, P6 after P5, both before K1). */
export const PHASES = Object.freeze(['P0', 'P1', 'P2', 'P2b', 'P3', 'P4', 'P5', 'P6', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']);

export const SHIPPED = Object.freeze(['P0', 'P1']);

export const isShipped = (phase, shipped = SHIPPED) => shipped.includes(phase);
