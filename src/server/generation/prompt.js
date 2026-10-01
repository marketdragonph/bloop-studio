// PromptProcessor (ported from bloop): a prompt is composed from small parts, each with create().
//   const text = new PromptProcessor().create(new UpstreamTextPrompt(upstream), new DirectionPrompt(node));

export class PromptProcessor {
    constructor(separator = '\n\n') {
        this.separator = separator;
    }

    create(...parts) {
        return parts.map((part) => part.create()?.trim()).filter(Boolean).join(this.separator);
    }
}

/** Every text card wired into the card's "Words" socket, in wire order. */
export class UpstreamTextPrompt {
    constructor(upstream) {
        this.upstream = upstream;
    }

    create() {
        return this.upstream
            .filter((n) => n.to_socket === 'prompt' && n.text_content?.trim())
            .map((n) => n.text_content.trim())
            .join('\n\n');
    }
}

/** The card's own "extra direction" field. */
export class DirectionPrompt {
    constructor(node) {
        this.node = node;
    }

    create() {
        return this.node.prompt ?? '';
    }
}

/**
 * MiniMax-H3 expects three labelled sections. Text already in that shape passes through;
 * plain text becomes the scene, with neutral sound and music lines so the model still scores it.
 */
export class H3FormatPrompt {
    constructor(...parts) {
        this.parts = parts;
    }

    create() {
        const body = new PromptProcessor().create(...this.parts);
        if (/integrated_multimodal_description:/i.test(body)) return body;
        const scene = body || 'A cinematic shot.';
        return [
            `integrated_multimodal_description: [Shot 1] Live-action, cinematic. ${scene}`,
            'overall_soundscape: Natural ambient sound that matches the scene, with clear foreground sound effects for any action.',
            'non_diegetic_music: none.',
        ].join('\n\n');
    }
}

/** Builds the final prompt for a card from its preset's dialect. */
export function composePrompt({ node, upstream, dialect }) {
    const parts = [new UpstreamTextPrompt(upstream), new DirectionPrompt(node)];
    return dialect === 'h3' ? new H3FormatPrompt(...parts).create() : new PromptProcessor().create(...parts);
}
