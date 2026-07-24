-- Correct derived diagnostics for fade-family rows. This does not touch the recorded decision,
-- side, fill, size, outcome, or P&L; see KB updown-paper-engine-alignment-v2.
UPDATE "paper_trade"
SET
  "edge_mid" = CASE
    WHEN "side" = 'up' THEN (1 - "p_signal") - "implied_mid"
    WHEN "side" = 'down' THEN "p_signal" - (1 - "implied_mid")
    ELSE "edge_mid"
  END,
  "edge_ask" = CASE
    WHEN "side" = 'up' THEN (1 - "p_signal") - "ask_paid"
    WHEN "side" = 'down' THEN "p_signal" - "ask_paid"
    ELSE "edge_ask"
  END,
  "model_meta" = jsonb_build_object(
    'version', 'signal-bridge-v1-backfill',
    'sourcePup', "p_signal",
    'fairPup', 1 - "p_signal"
  )
WHERE "bot_key" IN ('fade', 'fadeStrong', 'fadeRegime', 'gaugeFade', 'fadeV1')
  AND "p_signal" IS NOT NULL;
