// PromptProcessor (ported from bloop): a prompt is composed from small parts, each with create().
//   const text = new PromptProcessor().create(new UpstreamTextPrompt(upstream));

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

    /** Shot text first, then the cast's fixed looks, then the location: the shot leads, references follow. */
    create() {
        const rank = (n) => (/^cast\b/i.test(n.label ?? '') ? 1 : /^location\b/i.test(n.label ?? '') ? 2 : 0);
        return this.upstream
            .filter((n) => n.to_socket === 'prompt' && n.text_content?.trim())
            .sort((a, b) => rank(a) - rank(b))
            .map((n) => (rank(n) ? `${n.label.replace(/^\w+\s*·\s*/, '')}: ${n.text_content.trim()}` : n.text_content.trim()))
            .join('\n\n');
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
export function composePrompt({ upstream, dialect }) {
    const parts = [new UpstreamTextPrompt(upstream)];
    return dialect === 'h3' ? new H3FormatPrompt(...parts).create() : new PromptProcessor().create(...parts);
}
