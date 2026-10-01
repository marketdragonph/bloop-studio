// One Director turn: pick the provider from Settings, run the tool loop against the board,
// persist the history and the log, and report text and board actions as they happen.
import { runClaudeTurn, describeClaudeError } from './providers/anthropic.js';
import { runOpenAITurn, describeOpenAIError } from './providers/openai.js';
import { SPACE_DIRECTOR_SYSTEM, turnOrigin, userTurn } from './prompt.js';
import { BoardActions, TOOL_DEFINITIONS } from './tools.js';

const PROVIDERS = {
    anthropic: { run: runClaudeTurn, describe: describeClaudeError, keyName: 'anthropicApiKey', modelName: 'anthropicModel', label: 'Claude' },
    openai: { run: runOpenAITurn, describe: describeOpenAIError, keyName: 'openaiApiKey', modelName: 'openaiModel', label: 'OpenAI' },
};

export class DirectorService {
    constructor({ settings, spaces, director }) {
        this.settings = settings;
        this.spaces = spaces;
        this.director = director;
        this.busy = new Set(); // one turn per space at a time
    }

    /** emit(event, data): 'text' (delta), 'actions' (board changes), 'done' (final log entry), 'error'. */
    async turn(spaceId, request, emit, signal) {
        const provider = PROVIDERS[this.settings.get('llmProvider')] ?? PROVIDERS.anthropic;
        const apiKey = this.settings.get(provider.keyName);
        if (!apiKey) return emit('error', { message: `Add your ${provider.label} API key in Settings to use the Director.` });
        if (this.busy.has(spaceId)) return emit('error', { message: 'The Director is still working on the last request.' });

        this.busy.add(spaceId);
        const model = this.settings.get(provider.modelName);
        const providerId = this.settings.get('llmProvider');
        const board = this.spaces.board(spaceId);
        const actions = new BoardActions({ spaces: this.spaces, spaceId, origin: turnOrigin(board.nodes) });
        this.director.addLog(spaceId, 'user', request);

        try {
            const result = await provider.run({
                apiKey,
                model,
                system: SPACE_DIRECTOR_SYSTEM,
                history: this.director.thread(spaceId, providerId, model),
                userContent: userTurn(request, board),
                tools: TOOL_DEFINITIONS,
                execute: (name, input) => {
                    const outcome = actions.run(name, input);
                    if (outcome.ok) emit('actions', { actions: actions.actions.slice(-1) });
                    return outcome;
                },
                onText: (delta) => emit('text', { delta }),
                signal,
            });

            this.director.saveThread(spaceId, providerId, model, result.history);
            const text = result.text || (actions.actions.length ? 'Done.' : '');
            const id = this.director.addLog(spaceId, 'assistant', text, actions.actions);
            if (result.notice) this.director.addLog(spaceId, 'notice', result.notice);
            emit('done', { id, text, actions: actions.actions, notice: result.notice });
        } catch (error) {
            const message = signal?.aborted ? 'Stopped.' : provider.describe(error) ?? `The Director failed: ${error.message}`;
            if (!signal?.aborted) console.error('director turn failed:', error);
            this.director.addLog(spaceId, 'notice', message, actions.actions);
            emit('error', { message, actions: actions.actions });
        } finally {
            this.busy.delete(spaceId);
        }
    }
}
