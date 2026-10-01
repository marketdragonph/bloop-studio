// Claude provider for the Director: official Anthropic SDK, streaming manual tool loop.
// History is append-only (full response.content is kept, thinking blocks included), tool inputs
// are validated by the caller's execute() before anything runs, refusals and truncated tool
// input stop the turn, and server-side refusal fallback is on (fallbacks: "default").
import Anthropic from '@anthropic-ai/sdk';

const MAX_TOOL_ROUNDS = 8;

export async function runClaudeTurn({ apiKey, model, effort = 'medium', system, history, userContent, tools, execute, onText, signal }) {
    const client = new Anthropic({ apiKey });
    const messages = [...history, { role: 'user', content: userContent }];
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true }));
    let jsonRetries = 0;
    let finalText = '';
    let notice = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = client.beta.messages.stream({
            model,
            max_tokens: 64000,
            output_config: { effort },
            cache_control: { type: 'ephemeral' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system,
            tools: apiTools,
            messages,
        }, { signal });
        stream.on('text', (delta) => {
            finalText += delta;
            onText(delta);
        });

        let message;
        try {
            message = await stream.finalMessage();
            jsonRetries = 0;
        } catch (error) {
            // Only an unparseable tool input is retried; API errors (auth, rate limit…) surface.
            if (error instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw error;
            continue;
        }

        if (message.stop_reason === 'refusal') {
            notice = 'Claude declined this request. Try rephrasing it.';
            messages.push({ role: 'assistant', content: message.content });
            break;
        }

        const toolUses = message.content.filter((b) => b.type === 'tool_use');
        if (message.stop_reason === 'max_tokens' && toolUses.length) {
            notice = 'The reply was cut off before its board actions finished. Ask again with a smaller request.';
            break; // never run truncated tool input; this turn is not appended
        }

        messages.push({ role: 'assistant', content: message.content });
        if (!toolUses.length || message.stop_reason === 'end_turn') break;
        if (message.stop_reason === 'pause_turn') continue;

        // All tool results go back in ONE user message (keeps parallel tool use working).
        const results = toolUses.map((use) => {
            const { ok, content } = execute(use.name, use.input);
            return { type: 'tool_result', tool_use_id: use.id, content, ...(ok ? {} : { is_error: true }) };
        });
        messages.push({ role: 'user', content: results });
    }

    return { history: messages, text: finalText.trim(), notice };
}

/** Typed errors → words for the chat panel. */
export function describeClaudeError(error) {
    if (error instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key. Check it in Settings.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'This Claude key cannot use that model.';
    if (error instanceof Anthropic.NotFoundError) return 'Claude does not know that model name. Check it in Settings.';
    if (error instanceof Anthropic.RateLimitError) return 'Claude is rate-limiting this key. Wait a moment and try again.';
    if (error instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${error.message}`;
    if (error instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check the internet connection.';
    if (error instanceof Anthropic.APIError) return `Claude error ${error.status}: ${error.message}`;
    return null;
}
