-- Optional performance upgrade. The API also supports existing installations
-- with compare-and-swap counters and paginated budget reads until this applies.
CREATE OR REPLACE FUNCTION public.focus_increment_ai_usage(
  p_user_id uuid, p_day date, p_endpoint text
) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.ai_usage (user_id, day, endpoint, count, updated_at)
  VALUES (p_user_id, p_day, p_endpoint, 1, now())
  ON CONFLICT (user_id, day, endpoint) DO UPDATE
    SET count = public.ai_usage.count + 1, updated_at = now()
  RETURNING count;
$$;
REVOKE ALL ON FUNCTION public.focus_increment_ai_usage(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_increment_ai_usage(uuid, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.focus_ai_budget_totals(p_since timestamptz, p_today timestamptz)
RETURNS TABLE (daily_spent numeric, monthly_spent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= p_today), 0),
         COALESCE(SUM(estimated_cost_usd), 0)
  FROM public.ai_usage_events WHERE created_at >= p_since;
$$;
REVOKE ALL ON FUNCTION public.focus_ai_budget_totals(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.focus_ai_budget_totals(timestamptz, timestamptz) TO service_role;
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON public.ai_usage_events(created_at);
