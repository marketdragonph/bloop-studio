-- Mini Katana P5: which press queued a job. 'render-plan' marks the renders Render missing beats queued, so its
-- Cancel all stops only those and never a card the person started with Generate. NULL is a card's own Generate.
ALTER TABLE jobs ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN ('render-plan'));
