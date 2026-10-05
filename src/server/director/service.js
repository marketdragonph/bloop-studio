// One Director turn: pick the provider from Settings, run the tool loop against the board,
// persist the history and the log, and report text and board actions as they happen.
import { runClaudeTurn, describeClaudeError } from './providers/anthropic.js';
import { runOpenAITurn, describeOpenAIError } from './providers/openai.js';
import { SPACE_DIRECTOR_SYSTEM, turnOrigin, userTurn } from './prompt.js';
import { BoardActions, TOOL_DEFINITIONS } from './tools.js';

// What the panel says the Director is doing while a tool runs (the reply may not have a word yet).
const ACTIVITY = {
    add_card: 'Adding cards',
    connect: 'Wiring cards',
    update_card: 'Editing cards',
    inspect_cards: 'Reading cards',
    audit_board: 'Checking the board',
};

const PROVIDERS = {
    anthropic: { run: runClaudeTurn, describe: describeClaudeError, keyName: 'anthropicApiKey', modelName: 'anthropicModel', label: 'Claude' },
    openai: { run: runOpenAITurn, describe: describeOpenAIError, keyName: 'openaiApiKey', modelName: 'openaiModel', label: 'OpenAI' },
};

export class DirectorService {
    constructor({ settings, spaces, director }) {
        this.settings = settings;
        this.spaces = spaces;
        this.director = director;
    }

    /** The chosen provider, or the other one when only the other has a key (and say so). */
    resolveProvider() {
        const chosen = PROVIDERS[this.settings.get('llmProvider')] ? this.settings.get('llmProvider') : 'anthropic';
        if (this.settings.get(PROVIDERS[chosen].keyName)) return { providerId: chosen, switched: false };
        const other = chosen === 'anthropic' ? 'openai' : 'anthropic';
        if (this.settings.get(PROVIDERS[other].keyName)) return { providerId: other, switched: true };
        return { providerId: chosen, switched: false, missing: true };
    }

    /**
     * One turn of the tool loop (DirectorRuns runs it in the background and chains another when it
     * runs out of steps). emit(event, data): 'text' (delta), 'actions' (board changes), 'notice'.
     * Resolves { status: 'done' | 'failed' | 'stopped', exhausted, text, actions, notice, error }.
     */
    async turn(spaceId, request, emit, signal, { logRequest = true } = {}) {
        const { providerId, switched, missing } = this.resolveProvider();
        const provider = PROVIDERS[providerId];
        if (missing) return { status: 'failed', error: MISSING_KEY, actions: [] };
        if (switched) emit('notice', { message: `Using ${provider.label}: it is the only key in Settings.` });

        const apiKey = this.settings.get(provider.keyName);
        const model = this.settings.get(provider.modelName);
        const board = this.spaces.board(spaceId);
        const history = this.director.thread(spaceId, providerId, model);
        // Nothing on the board and nothing said yet: plan and ask before building (tools.js gate).
        const planned = board.nodes.length > 0 || history.length > 0;
        const actions = new BoardActions({ spaces: this.spaces, spaceId, origin: turnOrigin(board.nodes), planned });
        if (logRequest) this.director.addLog(spaceId, 'user', request);
        emit('activity', { label: 'Reading the board' });

        try {
            const result = await provider.run({
                apiKey,
                model,
                system: SPACE_DIRECTOR_SYSTEM,
                history,
                userContent: userTurn(request, board),
                tools: TOOL_DEFINITIONS,
                execute: (name, input) => {
                    emit('activity', { label: ACTIVITY[name] ?? 'Working' });
                    const outcome = actions.run(name, input);
                    if (outcome.ok) emit('actions', { actions: actions.actions.slice(-1) });
                    return outcome;
                },
                afterRound: () => {
                    emit('activity', { label: 'Checking its work' });
                    return actions.afterRound();
                },
                onText: (delta) => emit('text', { delta }),
                signal,
            });

            this.director.saveThread(spaceId, providerId, model, result.history);
            const text = result.text || (actions.actions.length ? 'Done.' : '');
            this.director.addLog(spaceId, 'assistant', text, actions.actions);
            if (result.notice) this.director.addLog(spaceId, 'notice', result.notice);
            return { status: 'done', exhausted: Boolean(result.exhausted), text, actions: actions.actions, notice: result.notice };
        } catch (error) {
            const message = signal?.aborted ? 'Stopped.' : provider.describe(error) ?? `The Director failed: ${error.message}`;
            if (!signal?.aborted) console.error('director turn failed:', error);
            // Cards already added stay on the board.
            this.director.addLog(spaceId, 'notice', message, actions.actions);
            return { status: signal?.aborted ? 'stopped' : 'failed', error: message, actions: actions.actions };
        }
    }
}

export const MISSING_KEY = 'Add a Claude or OpenAI API key in Settings to use the Director.';
