// OpenAI provider for the Director: official openai SDK, Chat Completions streaming with a
// manual tool loop. Tool-call fragments are accumulated by index; arguments are parsed and then
// validated by the caller's execute() before anything touches the board.
import OpenAI from 'openai';

const MAX_TOOL_ROUNDS = 8;

export async function runOpenAITurn({ apiKey, model, system, history, userContent, tools, execute, onText, signal }) {
    const client = new OpenAI({ apiKey });
    const messages = history.length ? [...history] : [{ role: 'system', content: system }];
    messages.push({ role: 'user', content: userContent });
    const apiTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
    let finalText = '';
    let notice = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await client.chat.completions.create({ model, messages, tools: apiTools, stream: true }, { signal });
        let content = '';
        let finish = null;
        const calls = [];

        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.delta?.content) {
                content += choice.delta.content;
                finalText += choice.delta.content;
                onText(choice.delta.content);
            }
            for (const part of choice.delta?.tool_calls ?? []) {
                const call = (calls[part.index] ??= { id: '', name: '', arguments: '' });
                if (part.id) call.id = part.id;
                if (part.function?.name) call.name += part.function.name;
                if (part.function?.arguments) call.arguments += part.function.arguments;
            }
            if (choice.finish_reason) finish = choice.finish_reason;
        }

        if (finish === 'content_filter') {
            notice = 'OpenAI filtered this request. Try rephrasing it.';
            break;
        }
        if (finish === 'length' && calls.length) {
            notice = 'The reply was cut off before its board actions finished. Ask again with a smaller request.';
            break;
        }

        const toolCalls = calls.filter(Boolean).map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
        messages.push({ role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
        if (!toolCalls.length) break;

        for (const call of toolCalls) {
            let input;
            try {
                input = JSON.parse(call.function.arguments || '{}');
            } catch {
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ INVALID_JSON: call.function.arguments }) });
                continue;
            }
            const { content: result } = execute(call.function.name, input);
            messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
    }

    return { history: messages, text: finalText.trim(), notice };
}

export function describeOpenAIError(error) {
    if (error instanceof OpenAI.AuthenticationError) return 'OpenAI rejected the API key. Check it in Settings.';
    if (error instanceof OpenAI.NotFoundError) return 'OpenAI does not know that model name. Check it in Settings.';
    if (error instanceof OpenAI.RateLimitError) return 'OpenAI is rate-limiting this key (or the account is out of credit).';
    if (error instanceof OpenAI.PermissionDeniedError) return 'This OpenAI key cannot use that model.';
    if (error instanceof OpenAI.BadRequestError) return `OpenAI rejected the request: ${error.message}`;
    if (error instanceof OpenAI.APIConnectionError) return 'Could not reach OpenAI. Check the internet connection.';
    if (error instanceof OpenAI.APIError) return `OpenAI error ${error.status}: ${error.message}`;
    return null;
}
