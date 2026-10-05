// One Director turn (bloop's SpaceDirectorService::stream): the system prompt in bloop's order, the conversation
// as text rows, up to five rounds with the tools, then the closing logic. The beats themselves are written by the
// build runner in the background, so a turn stays short.
import { runClaudeTurn, describeClaudeError, completeClaude } from './providers/anthropic.js';
import { runOpenAITurn, describeOpenAIError, completeOpenAI } from './providers/openai.js';
import { systemPrompt } from './prompts/compose.js';
import { aspectOnBoard } from './plan/shape.js';
import { ACTIVITY, definitions, runSkill } from './skills/index.js';
import { TurnLedger } from './turn/ledger.js';
import { closeTurn } from './turn/closing.js';

const PROVIDERS = {
    anthropic: { run: runClaudeTurn, complete: completeClaude, describe: describeClaudeError, keyName: 'anthropicApiKey', modelName: 'anthropicModel', label: 'Claude' },
    openai: { run: runOpenAITurn, complete: completeOpenAI, describe: describeOpenAIError, keyName: 'openaiApiKey', modelName: 'openaiModel', label: 'OpenAI' },
};
const HISTORY_ROWS = 24; // bloop: the last 12 exchanges, text only

export const MISSING_KEY = 'Add a Claude or OpenAI API key in Settings to use the Director.';

export class DirectorService {
    /** engineInfo() → { lengths, withSound, clipFamily }: what this PC's clip model can do. */
    constructor({ settings, spaces, director, plans, stages, ops, runner, engineInfo }) {
        Object.assign(this, { settings, spaces, director, plans, stages, ops, runner, engineInfo });
    }

    /** The chosen provider, or the other one when only the other has a key (and say so). */
    resolveProvider() {
        const chosen = PROVIDERS[this.settings.get('llmProvider')] ? this.settings.get('llmProvider') : 'anthropic';
        if (this.settings.get(PROVIDERS[chosen].keyName)) return { providerId: chosen, switched: false };
        const other = chosen === 'anthropic' ? 'openai' : 'anthropic';
        if (this.settings.get(PROVIDERS[other].keyName)) return { providerId: other, switched: true };
        return { providerId: chosen, switched: false, missing: true };
    }

    /** A single call with no tools, for the beat writers. */
    async complete({ system, user, signal }) {
        const { providerId, missing } = this.resolveProvider();
        if (missing) throw new Error(MISSING_KEY);
        const p = PROVIDERS[providerId];
        return p.complete({ apiKey: this.settings.get(p.keyName), model: this.settings.get(p.modelName), system, user, signal });
    }

    /** The conversation so far, as text rows (tool calls are never replayed). */
    history(spaceId) {
        return this.director.log(spaceId)
            .filter((row) => (row.role === 'user' || row.role === 'assistant') && row.text?.trim())
            .slice(-HISTORY_ROWS)
            .map((row) => ({ role: row.role, content: row.text }));
    }

    /**
     * Runs one turn. emit(event, data): 'text' (delta), 'actions', 'activity', 'notice', 'renamed', 'replace'.
     * Resolves { status: 'done' | 'failed' | 'stopped', text, actions, notice, error }.
     */
    async turn(spaceId, request, emit, signal, { logRequest = true } = {}) {
        const { providerId, switched, missing } = this.resolveProvider();
        const provider = PROVIDERS[providerId];
        if (missing) return { status: 'failed', error: MISSING_KEY, actions: [] };
        if (switched) emit('notice', { message: `Using ${provider.label}: it is the only key in Settings.` });

        const history = this.history(spaceId);
        if (logRequest) this.director.addLog(spaceId, 'user', request);
        emit('activity', { label: 'Reading the board' });

        const engine = await this.engineInfo();
        const ledger = new TurnLedger();
        const t = {
            spaceId, spaces: this.spaces, plans: this.plans, stages: this.stages, ops: this.ops, runner: this.runner, ledger, emit,
            lengths: engine.lengths, withSound: engine.withSound, clipFamily: engine.clipFamily, editFamily: engine.editFamily,
        };
        const board = this.spaces.board(spaceId);
        const plan = this.plans.latest(spaceId);
        const prompt = systemPrompt({
            space: this.spaces.find(spaceId), board, plan,
            owed: plan ? this.stages.owed(plan) : [],
            intent: plan ? this.stages.intent(plan) : {},
            aspect: plan?.aspect ?? aspectOnBoard(board.nodes),
            beatCount: plan ? this.plans.beats(plan.id).length : 0,
            lengths: engine.lengths, withSound: engine.withSound,
        });

        try {
            const result = await provider.run({
                apiKey: this.settings.get(provider.keyName),
                model: this.settings.get(provider.modelName),
                system: prompt,
                history,
                userContent: request,
                tools: definitions(t),
                execute: (name, input) => {
                    emit('activity', { label: ACTIVITY[name] ?? 'Working' });
                    return runSkill(name, input, t);
                },
                onText: (delta) => emit('text', { delta }),
                signal,
            });
            const closed = closeTurn({
                streamed: result.text,
                ledger,
                recover: (ops) => {
                    const applied = this.ops.apply(spaceId, ops, { aspect: plan?.aspect });
                    ledger.record(applied);
                    emit('actions', { actions: applied.actions });
                    return applied;
                },
            });
            if (closed.replaced) emit('replace', { text: closed.text });
            this.director.addLog(spaceId, 'assistant', closed.text, ledger.actions);
            if (result.notice) this.director.addLog(spaceId, 'notice', result.notice);
            return { status: 'done', text: closed.text, actions: ledger.actions, notice: result.notice, failed: closed.failed };
        } catch (error) {
            const message = signal?.aborted ? 'Stopped.' : provider.describe(error) ?? 'That turn did not finish. Try it again in a moment — nothing on the board changed.';
            if (!signal?.aborted) console.error('director turn failed:', error);
            this.director.addLog(spaceId, 'notice', message, ledger.actions);
            return { status: signal?.aborted ? 'stopped' : 'failed', error: message, actions: ledger.actions };
        }
    }
}
