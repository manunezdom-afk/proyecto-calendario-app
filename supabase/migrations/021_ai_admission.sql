-- Hilante: atomic admission, bounded spending and idempotency across workers.
-- Local migration only. Deploy this BEFORE enabling the new backend.
-- Request bodies never enter this ledger. Responses are private replay data,
-- inaccessible after 24h and scrubbed on the next admission/maintenance call.
-- Unknown usage and abandoned leases retain the complete monetary reservation.

CREATE TABLE IF NOT EXISTS public.focus_ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
  fingerprint text NOT NULL CHECK (length(fingerprint) <= 128),
  action_type text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress','completed','failed')),
  lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL,
  finished_at timestamptz,
  response_expires_at timestamptz,
  response jsonb,
  reserved_usd numeric(16,9) NOT NULL CHECK (reserved_usd > 0 AND reserved_usd <= 5),
  actual_usd numeric(16,9) CHECK (actual_usd >= 0 AND actual_usd < 1000000),
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS focus_ai_requests_created ON public.focus_ai_requests(created_at);
CREATE INDEX IF NOT EXISTS focus_ai_requests_owner_created ON public.focus_ai_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS focus_ai_requests_cache_expiry ON public.focus_ai_requests(response_expires_at) WHERE response IS NOT NULL;
ALTER TABLE public.focus_ai_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_ai_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.focus_ai_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.focus_ai_consumptions (
  request_row_id uuid NOT NULL REFERENCES public.focus_ai_requests(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_row_id, action_type)
);
ALTER TABLE public.focus_ai_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_ai_consumptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.focus_ai_consumptions TO service_role;

-- Keep anonymous cost evidence when an account is deleted, without its replay.
CREATE OR REPLACE FUNCTION public.focus_ai_scrub_deleted_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL THEN
    NEW.response := NULL;
    NEW.request_id := NEW.id::text;
    NEW.fingerprint := '';
    NEW.response_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS focus_ai_scrub_owner ON public.focus_ai_requests;
CREATE TRIGGER focus_ai_scrub_owner BEFORE UPDATE OF user_id ON public.focus_ai_requests
FOR EACH ROW EXECUTE FUNCTION public.focus_ai_scrub_deleted_owner();

-- Operational purge for periods without new traffic. Run from an existing
-- server-side maintenance job after deployment; this migration schedules nothing.
CREATE OR REPLACE FUNCTION public.focus_ai_purge_replays() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    SELECT id FROM public.focus_ai_requests
      WHERE response IS NOT NULL AND response_expires_at <= clock_timestamp()
      ORDER BY response_expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
  ) UPDATE public.focus_ai_requests r SET response=NULL FROM expired e WHERE r.id=e.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.focus_ai_purge_replays() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.focus_ai_purge_replays() TO service_role;

-- Called under the SAME admission lock. Returns the violated period if any.
CREATE OR REPLACE FUNCTION public.focus_ai_quota_status(p_user_id uuid, p_action_type text, p_limits jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_day date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_period text;
  v_limit integer;
  v_used bigint;
  v_days integer;
BEGIN
  IF jsonb_typeof(p_limits) IS DISTINCT FROM 'object' OR p_limits = '{}'::jsonb THEN
    RETURN jsonb_build_object('status','unavailable','reason','missing_limits');
  END IF;
  FOREACH v_period IN ARRAY ARRAY['daily','weekly','monthly'] LOOP
    IF p_limits ? v_period THEN
      v_limit := (p_limits ->> v_period)::integer;
      IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100000 THEN
        RETURN jsonb_build_object('status','unavailable','reason','invalid_limits');
      END IF;
      v_days := CASE v_period WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE 30 END;
      SELECT coalesce(sum(count),0) INTO v_used FROM public.ai_usage
        WHERE user_id = p_user_id AND endpoint = p_action_type AND day >= v_day - (v_days - 1) AND day <= v_day;
      IF v_used >= v_limit THEN
        RETURN jsonb_build_object('status','quota','period',v_period,'used',v_used,'limit',v_limit);
      END IF;
    END IF;
  END LOOP;
  IF NOT (p_limits ?| ARRAY['daily','weekly','monthly']) THEN
    RETURN jsonb_build_object('status','unavailable','reason','missing_limits');
  END IF;
  RETURN jsonb_build_object('status','ok');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('status','unavailable','reason','invalid_limits');
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_ai_admit(
  p_user_id uuid, p_request_id text, p_fingerprint text, p_action_type text,
  p_limits jsonb, p_reserve_usd numeric, p_policy jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now timestamptz;
  v_today timestamptz;
  v_month timestamptz;
  v_row public.focus_ai_requests%ROWTYPE;
  v_check jsonb;
  v_daily numeric;
  v_monthly numeric;
  v_user_daily numeric;
  v_user_monthly numeric;
  v_daily_cap numeric := (p_policy->>'daily_budget_usd')::numeric;
  v_monthly_cap numeric := (p_policy->>'monthly_budget_usd')::numeric;
  v_user_daily_cap numeric := (p_policy->>'user_daily_budget_usd')::numeric;
  v_user_monthly_cap numeric := (p_policy->>'user_monthly_budget_usd')::numeric;
  v_rate integer := (p_policy->>'requests_per_minute')::integer;
  v_concurrency integer := (p_policy->>'max_concurrent')::integer;
  v_lease integer := (p_policy->>'lease_seconds')::integer;
  v_level text;
  v_ratio numeric;
BEGIN
  -- One short transaction owns admission for all workers/users. Provider calls
  -- occur AFTER commit; no lock is held while waiting for a model.
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1', 0));
  v_now := clock_timestamp();
  v_today := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_month := v_now - interval '30 days';
  IF p_user_id IS NULL OR p_request_id IS NULL OR p_request_id !~ '^[a-zA-Z0-9_-]{1,64}$'
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_action_type IS NULL OR length(p_action_type) NOT BETWEEN 1 AND 64
    OR p_reserve_usd IS NULL OR NOT (p_reserve_usd > 0 AND p_reserve_usd <= 5)
    OR v_daily_cap IS NULL OR NOT (v_daily_cap > 0 AND v_daily_cap < 1000000)
    OR v_monthly_cap IS NULL OR NOT (v_monthly_cap > 0 AND v_monthly_cap < 1000000)
    OR v_user_daily_cap IS NULL OR NOT (v_user_daily_cap > 0 AND v_user_daily_cap < 1000000)
    OR v_user_monthly_cap IS NULL OR NOT (v_user_monthly_cap > 0 AND v_user_monthly_cap < 1000000)
    OR v_rate IS NULL OR v_rate NOT BETWEEN 1 AND 30
    OR v_concurrency IS NULL OR v_concurrency NOT BETWEEN 1 AND 2
    OR v_lease IS NULL OR v_lease NOT BETWEEN 10 AND 120 THEN
    RETURN jsonb_build_object('status','unavailable','reason','invalid_policy');
  END IF;
  UPDATE public.focus_ai_requests SET response = NULL
    WHERE response IS NOT NULL AND response_expires_at <= v_now;
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.fingerprint <> p_fingerprint OR v_row.action_type <> p_action_type THEN
      RETURN jsonb_build_object('status','conflict','reason','request_mismatch');
    END IF;
    IF v_row.state <> 'in_progress' AND v_row.response IS NOT NULL AND v_row.response_expires_at > v_now THEN
      RETURN jsonb_build_object('status','replay','response',v_row.response,'lease_id',v_row.lease_id);
    END IF;
    IF v_row.state='in_progress' AND v_row.lease_until > v_now THEN
      RETURN jsonb_build_object('status','in_progress');
    END IF;
    -- Never re-charge/re-execute the same ID, even after cache/lease expiration.
    RETURN jsonb_build_object('status','conflict','reason','replay_expired');
  END IF;
  IF (SELECT count(*) FROM public.focus_ai_requests WHERE user_id=p_user_id AND created_at > v_now-interval '1 minute') >= v_rate THEN
    RETURN jsonb_build_object('status','rate','retry_after',60);
  END IF;
  IF (SELECT count(*) FROM public.focus_ai_requests WHERE user_id=p_user_id AND state='in_progress' AND lease_until > v_now) >= v_concurrency THEN
    RETURN jsonb_build_object('status','concurrency','retry_after',5);
  END IF;
  v_check := public.focus_ai_quota_status(p_user_id,p_action_type,p_limits);
  IF v_check->>'status' <> 'ok' THEN RETURN v_check; END IF;

  -- New ledger is authoritative. Include legacy endpoints' usage rows only
  -- when not already represented by a SERVER-issued admission lease. A client
  -- request ID must never conceal a previous legacy invocation's cost.
  WITH charges AS (
    SELECT user_id, created_at, coalesce(actual_usd,reserved_usd) AS cost
      FROM public.focus_ai_requests WHERE created_at >= v_month
    UNION ALL
    SELECT e.user_id,e.created_at,e.estimated_cost_usd FROM public.ai_usage_events e
      WHERE e.created_at >= v_month AND NOT EXISTS (
        SELECT 1 FROM public.focus_ai_requests r
          WHERE r.user_id=e.user_id AND r.lease_id::text=e.metadata->>'admission_lease_id'
      )
  ) SELECT coalesce(sum(cost) FILTER (WHERE created_at >= v_today),0),coalesce(sum(cost),0),
      coalesce(sum(cost) FILTER (WHERE user_id=p_user_id AND created_at >= v_today),0),
      coalesce(sum(cost) FILTER (WHERE user_id=p_user_id),0)
    INTO v_daily,v_monthly,v_user_daily,v_user_monthly FROM charges;
  IF v_daily+p_reserve_usd > v_daily_cap OR v_monthly+p_reserve_usd > v_monthly_cap
    OR v_user_daily+p_reserve_usd > v_user_daily_cap OR v_user_monthly+p_reserve_usd > v_user_monthly_cap THEN
    RETURN jsonb_build_object('status','budget','budget_level','blocked');
  END IF;
  v_ratio := greatest((v_daily+p_reserve_usd)/v_daily_cap,(v_monthly+p_reserve_usd)/v_monthly_cap,
    (v_user_daily+p_reserve_usd)/v_user_daily_cap,(v_user_monthly+p_reserve_usd)/v_user_monthly_cap);
  v_level := CASE WHEN v_ratio >= .90 THEN 'economy' WHEN v_ratio >= .75 THEN 'alert' ELSE 'normal' END;
  INSERT INTO public.focus_ai_requests(user_id,request_id,fingerprint,action_type,created_at,lease_until,reserved_usd)
    VALUES (p_user_id,p_request_id,p_fingerprint,p_action_type,v_now,v_now+make_interval(secs=>v_lease),p_reserve_usd)
    RETURNING * INTO v_row;
  PERFORM public.focus_increment_ai_usage(p_user_id,(v_now AT TIME ZONE 'UTC')::date,p_action_type);
  INSERT INTO public.focus_ai_consumptions(request_row_id,action_type) VALUES (v_row.id,p_action_type);
  RETURN jsonb_build_object('status','admitted','lease_id',v_row.lease_id,'budget_level',v_level);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR foreign_key_violation THEN
  RETURN jsonb_build_object('status','unavailable','reason','invalid_policy');
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_ai_finish(p_user_id uuid,p_request_id text,p_lease_id uuid,
  p_response jsonb,p_actual_usd numeric,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.focus_ai_requests%ROWTYPE; v_now timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  v_now := clock_timestamp();
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.lease_id IS DISTINCT FROM p_lease_id THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF v_row.state <> 'in_progress' THEN RETURN jsonb_build_object('status','completed'); END IF;
  IF p_outcome NOT IN ('success','failed') OR p_outcome IS NULL
    OR jsonb_typeof(p_response) IS DISTINCT FROM 'object' OR octet_length(p_response::text)>65536
    OR (p_actual_usd IS NOT NULL AND NOT (p_actual_usd >= 0 AND p_actual_usd < 1000000)) THEN
    RETURN jsonb_build_object('status','unavailable','reason','invalid_finish');
  END IF;
  UPDATE public.focus_ai_requests SET state=CASE WHEN p_outcome='success' THEN 'completed' ELSE 'failed' END,
    finished_at=v_now,response=p_response,response_expires_at=v_now+interval '24 hours',
    actual_usd=coalesce(p_actual_usd,reserved_usd)
    WHERE id=v_row.id;
  RETURN jsonb_build_object('status','completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_ai_consume(p_user_id uuid,p_request_id text,p_lease_id uuid,
  p_action_type text,p_limits jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.focus_ai_requests%ROWTYPE; v_now timestamptz; v_check jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  v_now := clock_timestamp();
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.lease_id IS DISTINCT FROM p_lease_id OR v_row.state <> 'in_progress' OR v_row.lease_until <= v_now THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.focus_ai_consumptions WHERE request_row_id=v_row.id AND action_type=p_action_type) THEN
    RETURN jsonb_build_object('status','ok');
  END IF;
  v_check := public.focus_ai_quota_status(p_user_id,p_action_type,p_limits);
  IF v_check->>'status' <> 'ok' THEN RETURN v_check; END IF;
  PERFORM public.focus_increment_ai_usage(p_user_id,(v_now AT TIME ZONE 'UTC')::date,p_action_type);
  INSERT INTO public.focus_ai_consumptions(request_row_id,action_type) VALUES (v_row.id,p_action_type);
  RETURN jsonb_build_object('status','ok');
END;
$$;

REVOKE ALL ON FUNCTION public.focus_ai_quota_status(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_admit(uuid,text,text,text,jsonb,numeric,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_finish(uuid,text,uuid,jsonb,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_consume(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.focus_ai_quota_status(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_admit(uuid,text,text,text,jsonb,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_finish(uuid,text,uuid,jsonb,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_consume(uuid,text,uuid,text,jsonb) TO service_role;
