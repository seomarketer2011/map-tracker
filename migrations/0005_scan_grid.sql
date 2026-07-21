-- Record what grid each scan was actually run at (size + spacing), so history
-- stays accurate even after the target's configuration changes. Old rows stay
-- NULL and the UI falls back to the target's current config.
ALTER TABLE scans ADD COLUMN grid_size INTEGER;
ALTER TABLE scans ADD COLUMN spacing_m INTEGER;
