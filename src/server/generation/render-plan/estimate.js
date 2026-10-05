// Render missing beats, stages 3 and 4 (05-irresistible.md §2.2, owner decision 7): what the press would cost.
//
// estimate      per card: the model it renders on (its pick, else the first its Model list offers, card-source.js);
//               on this PC an estimated time only when past jobs on every one of those models finished (else "time
//               depends on your graphics card"); on bloop the model's credits and the person's balance.
// checkCredits  the press only: refuses, plainly and before anything is queued, when bloop cards would cost more
//               than the balance, when the cost or the balance cannot be read, or when nothing can render at all.
import { isCloudSource } from '../../../shared/card-source.js';
import { cloudModelKey } from '../cloud-models.js';

export class RenderRefused extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

/** Mean seconds of finished renders per model family (jobs.preset holds the family the card rendered on). */
function pastSeconds(db, families) {
    const out = new Map();
    const query = db.prepare(`
        SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400.0) AS seconds, COUNT(*) AS runs
        FROM jobs WHERE status = 'succeeded' AND preset = ? AND started_at IS NOT NULL AND finished_at IS NOT NULL
    `);
    for (const family of families) {
        const row = query.get(family);
        if (row?.runs > 0 && row.seconds > 0) out.set(family, row.seconds);
    }
    return out;
}

const REFRESH_MS = 5000;

/** The bloop balance, re-read (at most 5 s; offline, the last one bloop reported); null when unknown. */
async function freshBalance(account) {
    if (!account?.state) return null;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, REFRESH_MS); });
    await Promise.race([Promise.resolve(account.refresh?.()).catch(() => {}), late]).finally(() => clearTimeout(timer));
    const credits = account.state().account?.credits;
    return credits == null || !Number.isFinite(Number(credits)) ? null : Number(credits);
}

export async function estimate(ctx, next) {
    const { db, sources, account } = ctx.deps;
    const types = [...new Set(ctx.order.map((o) => o.node.type))];
    const byType = Object.fromEntries(await Promise.all(types.map(async (type) => [type, await sources(type)])));
    const models = ctx.order.some((o) => isCloudSource(o.node.settings?.family ?? byType[o.node.type].family)) ? await account?.models() : null;

    ctx.cards = ctx.order.map(({ node, role }) => {
        const source = byType[node.type];
        const family = node.settings?.family ?? source.family;
        const cloud = isCloudSource(family);
        const offered = source.families.find((f) => f.id === family);
        const model = cloud ? models?.[node.type]?.find((m) => m.key === cloudModelKey(family)) : null;
        return {
            node_id: node.id, label: node.label || `${node.type} ${node.id}`, type: node.type, role, family, cloud,
            model: offered?.label ?? model?.name ?? family ?? 'No model',
            credits: cloud ? (model?.credits ?? null) : null,
            pick: node.settings?.family ? null : family, // set on the card when it is queued
            blocked: !cloud && source.kind === 'none' ? source.reason : null,
        };
    });

    const local = ctx.cards.filter((c) => !c.cloud);
    const cloud = ctx.cards.filter((c) => c.cloud);
    const times = pastSeconds(db, [...new Set(local.map((c) => c.family).filter(Boolean))]);
    const timed = local.length && local.every((c) => times.has(c.family));
    const credits = cloud.some((c) => c.credits == null) ? null : cloud.reduce((sum, c) => sum + c.credits, 0);
    const balance = cloud.length ? await freshBalance(account) : null;
    ctx.summary = {
        beats: ctx.beats.length,
        cards: ctx.cards.length,
        local: { cards: local.length, seconds: timed ? Math.round(local.reduce((sum, c) => sum + times.get(c.family), 0)) : null },
        cloud: { cards: cloud.length, credits, balance, short: cloud.length > 0 && credits != null && balance != null && credits > balance },
        blocked: local.find((c) => c.blocked)?.blocked ?? null,
        skipped: ctx.skipped,
        items: ctx.cards,
    };
    await next();
}

export async function checkCredits(ctx, next) {
    const { cards, cloud, blocked } = ctx.summary;
    if (!cards) throw new RenderRefused('Every beat already has its video, or is on its way.', 'nothing');
    if (blocked) throw new RenderRefused(blocked, 'engine');
    if (cloud.cards) {
        if (cloud.credits == null) throw new RenderRefused('Could not read what these bloop models cost. Nothing was queued.', 'credits');
        if (cloud.balance == null) throw new RenderRefused('Could not read your bloop balance. Check Settings › Bloop account. Nothing was queued.', 'credits');
        if (cloud.short) throw new RenderRefused(`This needs about ${cloud.credits} credits and you have ${cloud.balance} on bloop. Nothing was queued.`, 'short');
    }
    await next();
}
