// OpenAI provider for the Director: official openai SDK, Responses API (newer models refuse function
// tools on Chat Completions), streaming manual tool loop. Conversation stays local (store: false):
// each response's output items, encrypted reasoning included, are appended to our own input list.
// Tool arguments are parsed, then validated by the caller's execute() before anything runs.
import OpenAI from 'openai';

const MAX_TOOL_ROUNDS = 8;

export async function runOpenAITurn({ apiKey, model, system, history, userContent, tools, execute, onText, signal }) {
    const client = new OpenAI({ apiKey });
    const input = [...history, { role: 'user', content: userContent }];
    const apiTools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema, strict: false }));
    let finalText = '';
    let notice = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await client.responses.create({
            model,
            instructions: system,
            input,
            tools: apiTools,
            store: false,
            include: ['reasoning.encrypted_content'],
            stream: true,
        }, { signal });

        let response = null;
        for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
                finalText += event.delta;
                onText(event.delta);
            } else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
                response = event.response;
            } else if (event.type === 'error') {
                throw new Error(event.message ?? 'OpenAI stream error');
            }
        }
        if (!response) throw new Error('OpenAI ended the stream without a response.');
        if (response.status === 'failed') throw new Error(response.error?.message ?? 'OpenAI could not complete the request.');

        const calls = response.output.filter((item) => item.type === 'function_call');
        if (response.status === 'incomplete') {
            const reason = response.incomplete_details?.reason;
            notice = reason === 'content_filter'
                ? 'OpenAI filtered this request. Try rephrasing it.'
                : 'The reply was cut off before it finished. Ask again with a smaller request.';
            if (calls.length) break; // never run tool calls from a cut-off reply; do not append it
        }

        input.push(...response.output);
        if (!calls.length) break;

        for (const call of calls) {
            let args;
            try {
                args = JSON.parse(call.arguments || '{}');
            } catch {
                input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ INVALID_JSON: call.arguments }) });
                continue;
            }
            const { content } = execute(call.name, args);
            input.push({ type: 'function_call_output', call_id: call.call_id, output: content });
        }
    }

    return { history: input, text: finalText.trim(), notice };
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
