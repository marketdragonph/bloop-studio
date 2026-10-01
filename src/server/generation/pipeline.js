// Runs stages in order; each stage is async (ctx, next) and may stop the pipeline by not calling next.
export async function runPipeline(stages, ctx) {
    const dispatch = async (index) => {
        if (index < stages.length) await stages[index](ctx, () => dispatch(index + 1));
    };
    await dispatch(0);
    return ctx;
}

export class StageError extends Error {}
