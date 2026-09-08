-- Apply after 021. Additive: preserves request/quota/replay contracts, private
-- response retention, the global admission lock, and anonymous deletion costs.
-- Monetary month remains the existing rolling 30-day window; daily is UTC.

ALTER TABLE public.focus_ai_requests ADD COLUMN IF NOT EXISTS admission_policy jsonb;
ALTER TABLE public.focus_ai_requests ADD COLUMN IF NOT EXISTS model_attempts_required boolean NOT NULL DEFAULT false;

-- Operator kill switch is read in the same transaction as every admission and
-- attempt. Unlike a deployment environment variable, it reaches warm workers.
CREATE TABLE IF NOT EXISTS public.focus_ai_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  paid_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.focus_ai_control(singleton,paid_enabled) VALUES(true,true) ON CONFLICT DO NOTHING;
ALTER TABLE public.focus_ai_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_ai_control FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.focus_ai_control TO service_role;

CREATE OR REPLACE FUNCTION public.focus_ai_get_control()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce((SELECT jsonb_build_object('status','ok','paid_enabled',paid_enabled,'updated_at',updated_at)
    FROM public.focus_ai_control WHERE singleton),jsonb_build_object('status','unavailable','paid_enabled',false));
$$;
CREATE OR REPLACE FUNCTION public.focus_ai_set_control(p_paid_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  IF p_paid_enabled IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  INSERT INTO public.focus_ai_control(singleton,paid_enabled,updated_at) VALUES(true,p_paid_enabled,clock_timestamp())
    ON CONFLICT(singleton) DO UPDATE SET paid_enabled=excluded.paid_enabled,updated_at=excluded.updated_at;
  RETURN public.focus_ai_get_control();
END $$;

CREATE TABLE IF NOT EXISTS public.focus_ai_model_attempts (
  request_row_id uuid NOT NULL REFERENCES public.focus_ai_requests(id) ON DELETE CASCADE,
  attempt_index integer NOT NULL CHECK (attempt_index BETWEEN 0 AND 1),
  model text NOT NULL CHECK (model IN ('gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol')),
  tier text NOT NULL CHECK (tier IN ('luna','terra','sol')),
  reason text NOT NULL CHECK (reason ~ '^[a-zA-Z0-9_:-]{1,96}$'),
  state text NOT NULL DEFAULT 'started' CHECK (state IN ('started','settled')),
  reserved_usd numeric(16,9) NOT NULL CHECK (reserved_usd > 0 AND reserved_usd <= 5),
  actual_usd numeric(16,9) CHECK (actual_usd >= 0 AND actual_usd < 1000000),
  outcome text CHECK (outcome IN ('success','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY (request_row_id,attempt_index),
  CHECK (model = 'gpt-5.6-' || tier)
);
CREATE INDEX IF NOT EXISTS focus_ai_model_attempts_tier_created ON public.focus_ai_model_attempts(tier,created_at);
ALTER TABLE public.focus_ai_model_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_ai_model_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.focus_ai_model_attempts TO service_role;

CREATE TABLE IF NOT EXISTS public.focus_ai_budget_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global_daily','global_monthly','sol_share','reservation_overrun')),
  period_start date NOT NULL,
  threshold_percent numeric(6,2) NOT NULL CHECK (threshold_percent > 0 AND threshold_percent <= 100),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope,period_start,threshold_percent)
);
ALTER TABLE public.focus_ai_budget_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_ai_budget_alerts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.focus_ai_budget_alerts TO service_role;

-- Preserve the fully deployed 021 implementations, then wrap their contracts.
DO $$ BEGIN
  IF to_regprocedure('public.focus_ai_admit_v1(uuid,text,text,text,jsonb,numeric,jsonb)') IS NULL THEN
    ALTER FUNCTION public.focus_ai_admit(uuid,text,text,text,jsonb,numeric,jsonb) RENAME TO focus_ai_admit_v1;
  END IF;
  IF to_regprocedure('public.focus_ai_finish_v1(uuid,text,uuid,jsonb,numeric,text)') IS NULL THEN
    ALTER FUNCTION public.focus_ai_finish(uuid,text,uuid,jsonb,numeric,text) RENAME TO focus_ai_finish_v1;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_model_policy_valid(p_policy jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_key text; v_value numeric; v_alert jsonb;
BEGIN
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['daily_budget_usd','monthly_budget_usd','user_daily_budget_usd','user_monthly_budget_usd'] LOOP
    v_value:=(p_policy->>v_key)::numeric;
    IF v_value IS NULL OR NOT(v_value>0 AND v_value<1000000) THEN RETURN false; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['sol_daily_budget_usd','sol_monthly_budget_usd','request_budget_usd'] LOOP
    IF p_policy ? v_key THEN
      v_value := (p_policy->>v_key)::numeric;
      IF v_value IS NULL OR NOT(v_value >= 0 AND v_value <= 1000) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['sol_user_daily_requests','sol_user_monthly_requests','sol_share_min_requests'] LOOP
    IF p_policy ? v_key THEN
      v_value := (p_policy->>v_key)::numeric;
      IF v_value IS NULL OR NOT(v_value >= 0 AND v_value <= 10000 AND v_value=trunc(v_value)) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['economy_percent','sol_share_alert_percent'] LOOP
    IF p_policy ? v_key THEN
      v_value := (p_policy->>v_key)::numeric;
      IF v_value IS NULL OR NOT(v_value > 0 AND v_value <= 100) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF p_policy ? 'sol_enabled' AND jsonb_typeof(p_policy->'sol_enabled') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF p_policy ? 'model_attempts_required' AND jsonb_typeof(p_policy->'model_attempts_required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF p_policy ? 'alert_percentages' THEN
    IF jsonb_typeof(p_policy->'alert_percentages') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_policy->'alert_percentages') NOT BETWEEN 1 AND 5 THEN RETURN false; END IF;
    FOR v_alert IN SELECT value FROM jsonb_array_elements(p_policy->'alert_percentages') LOOP
      IF jsonb_typeof(v_alert) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      v_value := v_alert::numeric;
      IF NOT(v_value > 0 AND v_value <= 100) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_budget_snapshot(p_user_id uuid,p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_now timestamptz:=clock_timestamp(); v_today timestamptz; v_month timestamptz;
  v_daily numeric; v_monthly numeric; v_user_daily numeric; v_user_monthly numeric; v_ratio numeric;
  v_sol_daily numeric; v_sol_monthly numeric; v_sol_day_count bigint; v_sol_month_count bigint;
  v_paid_requests bigint; v_sol_requests bigint; v_level text;
BEGIN
  v_today:=date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; v_month:=v_now-interval '30 days';
  WITH charges AS (
    SELECT user_id,created_at,coalesce(actual_usd,reserved_usd) AS cost FROM public.focus_ai_requests WHERE created_at>=v_month
    UNION ALL
    SELECT e.user_id,e.created_at,e.estimated_cost_usd FROM public.ai_usage_events e WHERE e.created_at>=v_month
      AND NOT EXISTS(SELECT 1 FROM public.focus_ai_requests r WHERE r.user_id=e.user_id AND r.lease_id::text=e.metadata->>'admission_lease_id')
  ) SELECT coalesce(sum(cost) FILTER(WHERE created_at>=v_today),0),coalesce(sum(cost),0),
      coalesce(sum(cost) FILTER(WHERE user_id=p_user_id AND created_at>=v_today),0),coalesce(sum(cost) FILTER(WHERE user_id=p_user_id),0)
    INTO v_daily,v_monthly,v_user_daily,v_user_monthly FROM charges;
  SELECT coalesce(sum(coalesce(a.actual_usd,a.reserved_usd)) FILTER(WHERE a.tier='sol' AND a.created_at>=v_today),0),
      coalesce(sum(coalesce(a.actual_usd,a.reserved_usd)) FILTER(WHERE a.tier='sol'),0),
      count(*) FILTER(WHERE a.tier='sol' AND r.user_id=p_user_id AND a.created_at>=v_today),
      count(*) FILTER(WHERE a.tier='sol' AND r.user_id=p_user_id),
      count(DISTINCT a.request_row_id),count(DISTINCT a.request_row_id) FILTER(WHERE a.tier='sol')
    INTO v_sol_daily,v_sol_monthly,v_sol_day_count,v_sol_month_count,v_paid_requests,v_sol_requests
    FROM public.focus_ai_model_attempts a JOIN public.focus_ai_requests r ON r.id=a.request_row_id WHERE a.created_at>=v_month;
  v_ratio:=greatest(v_daily/nullif((p_policy->>'daily_budget_usd')::numeric,0),v_monthly/nullif((p_policy->>'monthly_budget_usd')::numeric,0),
      v_user_daily/nullif((p_policy->>'user_daily_budget_usd')::numeric,0),v_user_monthly/nullif((p_policy->>'user_monthly_budget_usd')::numeric,0));
  v_level:=CASE WHEN v_ratio>=1 THEN 'blocked'
    WHEN v_ratio*100>=coalesce((p_policy->>'economy_percent')::numeric,90) THEN 'economy'
    WHEN v_ratio*100 >= (SELECT min(value::numeric) FROM jsonb_array_elements(coalesce(p_policy->'alert_percentages','[50,75,90]'::jsonb))) THEN 'alert' ELSE 'normal' END;
  RETURN jsonb_build_object('budget_level',v_level,'daily_spent_usd',v_daily,'monthly_spent_usd',v_monthly,
    'user_daily_spent_usd',v_user_daily,'user_monthly_spent_usd',v_user_monthly,
    'model_metrics',jsonb_build_object('sol_daily_spent_usd',v_sol_daily,'sol_monthly_spent_usd',v_sol_monthly,
      'sol_user_daily_requests',v_sol_day_count,'sol_user_monthly_requests',v_sol_month_count,
      'paid_request_count',v_paid_requests,'sol_request_count',v_sol_requests,
      'sol_request_share',CASE WHEN v_paid_requests=0 THEN 0 ELSE v_sol_requests::numeric/v_paid_requests END));
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_emit_budget_alerts(p_snapshot jsonb,p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_scope text; v_start date; v_percent numeric; v_ratio numeric; v_row public.focus_ai_budget_alerts%ROWTYPE; v_new jsonb:='[]';
BEGIN
  FOREACH v_scope IN ARRAY ARRAY['global_daily','global_monthly'] LOOP
    v_start:=CASE WHEN v_scope='global_daily' THEN (v_now AT TIME ZONE 'UTC')::date ELSE date_trunc('month',v_now AT TIME ZONE 'UTC')::date END;
    v_ratio:=CASE WHEN v_scope='global_daily' THEN (p_snapshot->>'daily_spent_usd')::numeric/nullif((p_policy->>'daily_budget_usd')::numeric,0)
      ELSE (p_snapshot->>'monthly_spent_usd')::numeric/nullif((p_policy->>'monthly_budget_usd')::numeric,0) END;
    FOR v_percent IN SELECT DISTINCT value::numeric FROM jsonb_array_elements(coalesce(p_policy->'alert_percentages','[50,75,90]'::jsonb)) LOOP
      IF v_ratio*100>=v_percent THEN
        INSERT INTO public.focus_ai_budget_alerts(scope,period_start,threshold_percent,snapshot)
          VALUES(v_scope,v_start,v_percent,jsonb_build_object('ratio',v_ratio,'rolling_month_days',30)) ON CONFLICT DO NOTHING RETURNING * INTO v_row;
        IF FOUND THEN v_new:=v_new||jsonb_build_array(to_jsonb(v_row)); END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF (p_snapshot#>>'{model_metrics,paid_request_count}')::integer>=coalesce((p_policy->>'sol_share_min_requests')::integer,20)
    AND (p_snapshot#>>'{model_metrics,sol_request_share}')::numeric*100>=coalesce((p_policy->>'sol_share_alert_percent')::numeric,5) THEN
    INSERT INTO public.focus_ai_budget_alerts(scope,period_start,threshold_percent,snapshot)
      VALUES('sol_share',date_trunc('month',v_now AT TIME ZONE 'UTC')::date,coalesce((p_policy->>'sol_share_alert_percent')::numeric,5),p_snapshot->'model_metrics')
      ON CONFLICT DO NOTHING RETURNING * INTO v_row;
    IF FOUND THEN v_new:=v_new||jsonb_build_array(to_jsonb(v_row)); END IF;
  END IF;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_admit(p_user_id uuid,p_request_id text,p_fingerprint text,p_action_type text,p_limits jsonb,p_reserve_usd numeric,p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_snapshot jsonb; v_row public.focus_ai_requests%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  IF coalesce((SELECT paid_enabled FROM public.focus_ai_control WHERE singleton),false)=false THEN
    -- A completed private replay performs no model call or new reservation.
    -- Preserve it during a kill so clients need not create another logical ID.
    SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id;
    IF FOUND THEN
      IF v_row.fingerprint IS DISTINCT FROM p_fingerprint OR v_row.action_type IS DISTINCT FROM p_action_type THEN
        RETURN jsonb_build_object('status','conflict','reason','request_mismatch');
      END IF;
      IF v_row.state<>'in_progress' AND v_row.response IS NOT NULL AND v_row.response_expires_at>clock_timestamp() THEN
        RETURN jsonb_build_object('status','replay','response',v_row.response,'lease_id',v_row.lease_id);
      END IF;
    END IF;
    RETURN jsonb_build_object('status','unavailable','reason','paid_ai_disabled');
  END IF;
  IF NOT public.focus_ai_model_policy_valid(p_policy) THEN RETURN jsonb_build_object('status','unavailable','reason','invalid_model_policy'); END IF;
  IF p_policy ? 'request_budget_usd' AND (p_reserve_usd IS NULL OR p_reserve_usd>(p_policy->>'request_budget_usd')::numeric) THEN
    RETURN jsonb_build_object('status','budget','reason','request_budget','budget_level','blocked');
  END IF;
  v_result:=public.focus_ai_admit_v1(p_user_id,p_request_id,p_fingerprint,p_action_type,p_limits,p_reserve_usd,p_policy);
  IF v_result->>'status'='admitted' THEN
    UPDATE public.focus_ai_requests SET admission_policy=p_policy,model_attempts_required=coalesce((p_policy->>'model_attempts_required')::boolean,false)
      WHERE user_id=p_user_id AND request_id=p_request_id;
  END IF;
  IF v_result->>'status' IN ('admitted','budget') THEN
    v_snapshot:=public.focus_ai_budget_snapshot(p_user_id,p_policy);
    v_result:=v_result||v_snapshot||jsonb_build_object('budget_alerts',public.focus_ai_emit_budget_alerts(v_snapshot,p_policy));
    IF v_result->>'status'='budget' THEN v_result:=v_result||jsonb_build_object('budget_level','blocked'); END IF;
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_begin_attempt(p_user_id uuid,p_request_id text,p_lease_id uuid,p_attempt_index integer,
  p_model text,p_tier text,p_reserve_usd numeric,p_policy jsonb,p_reason text DEFAULT 'unspecified')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.focus_ai_requests%ROWTYPE; v_count integer; v_reserved numeric; v_snapshot jsonb; v_model jsonb; v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  IF coalesce((SELECT paid_enabled FROM public.focus_ai_control WHERE singleton),false)=false THEN
    RETURN jsonb_build_object('status','unavailable','reason','paid_ai_disabled');
  END IF;
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.lease_id IS DISTINCT FROM p_lease_id OR v_row.state<>'in_progress' OR v_row.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('status','unavailable','reason','invalid_lease'); END IF;
  IF NOT public.focus_ai_model_policy_valid(p_policy) OR p_attempt_index IS NULL OR p_attempt_index NOT BETWEEN 0 AND 1
    OR p_model IS NULL OR p_tier IS NULL OR p_tier NOT IN ('luna','terra','sol') OR p_model<>'gpt-5.6-'||p_tier
    OR p_reserve_usd IS NULL OR NOT(p_reserve_usd>0 AND p_reserve_usd<=5) OR p_reason IS NULL OR p_reason!~'^[a-zA-Z0-9_:-]{1,96}$' THEN
    RETURN jsonb_build_object('status','unavailable','reason','invalid_attempt');
  END IF;
  IF EXISTS(SELECT 1 FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id AND attempt_index=p_attempt_index) THEN
    RETURN jsonb_build_object('status','already_started');
  END IF;
  SELECT count(*),coalesce(sum(coalesce(actual_usd,reserved_usd)),0) INTO v_count,v_reserved FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id;
  IF p_attempt_index<>v_count OR v_reserved+p_reserve_usd>v_row.reserved_usd THEN RETURN jsonb_build_object('status','unavailable','reason','attempt_reservation'); END IF;
  IF EXISTS(SELECT 1 FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id AND state='started') THEN RETURN jsonb_build_object('status','in_progress'); END IF;
  IF p_tier='sol' AND EXISTS(SELECT 1 FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id AND tier='sol') THEN RETURN jsonb_build_object('status','model_quota','reason','sol_once_per_request'); END IF;
  v_snapshot:=public.focus_ai_budget_snapshot(p_user_id,p_policy);
  v_model:=v_snapshot->'model_metrics';
  IF p_tier='sol' THEN
    IF coalesce((p_policy->>'sol_enabled')::boolean,true)=false THEN v_status:='model_budget';
    ELSIF v_snapshot->>'budget_level' IN ('economy','blocked') THEN v_status:='economy';
    ELSIF (v_model->>'sol_daily_spent_usd')::numeric+p_reserve_usd>coalesce((p_policy->>'sol_daily_budget_usd')::numeric,.50)
      OR (v_model->>'sol_monthly_spent_usd')::numeric+p_reserve_usd>coalesce((p_policy->>'sol_monthly_budget_usd')::numeric,3) THEN v_status:='model_budget';
    ELSIF (v_model->>'sol_user_daily_requests')::integer>=coalesce((p_policy->>'sol_user_daily_requests')::integer,2)
      OR (v_model->>'sol_user_monthly_requests')::integer>=coalesce((p_policy->>'sol_user_monthly_requests')::integer,10) THEN v_status:='model_quota';
    END IF;
    IF v_status IS NOT NULL THEN RETURN v_snapshot||jsonb_build_object('status',v_status,'model','gpt-5.6-sol','budget_alerts',public.focus_ai_emit_budget_alerts(v_snapshot,p_policy)); END IF;
  END IF;
  INSERT INTO public.focus_ai_model_attempts(request_row_id,attempt_index,model,tier,reason,reserved_usd)
    VALUES(v_row.id,p_attempt_index,p_model,p_tier,p_reason,p_reserve_usd);
  v_snapshot:=public.focus_ai_budget_snapshot(p_user_id,p_policy);
  RETURN v_snapshot||jsonb_build_object('status','started','attempt_index',p_attempt_index,'reserved_usd',p_reserve_usd,
    'budget_alerts',public.focus_ai_emit_budget_alerts(v_snapshot,p_policy));
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_settle_attempt(p_user_id uuid,p_request_id text,p_lease_id uuid,p_attempt_index integer,p_actual_usd numeric,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.focus_ai_requests%ROWTYPE; v_attempt public.focus_ai_model_attempts%ROWTYPE; v_snapshot jsonb; v_alerts jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.lease_id IS DISTINCT FROM p_lease_id OR v_row.state<>'in_progress' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO v_attempt FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id AND attempt_index=p_attempt_index FOR UPDATE;
  IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN ('success','failed') OR (p_actual_usd IS NOT NULL AND NOT(p_actual_usd>=0 AND p_actual_usd<1000000)) THEN RETURN jsonb_build_object('status','unavailable','reason','invalid_settlement'); END IF;
  IF v_attempt.state='settled' THEN RETURN jsonb_build_object('status','settled','actual_usd',v_attempt.actual_usd); END IF;
  UPDATE public.focus_ai_model_attempts SET state='settled',outcome=p_outcome,actual_usd=coalesce(p_actual_usd,reserved_usd),settled_at=clock_timestamp()
    WHERE request_row_id=v_row.id AND attempt_index=p_attempt_index;
  -- An observed overrun is visible to the next admission immediately, before
  -- this request's final response is persisted. Never lower its global hold.
  UPDATE public.focus_ai_requests SET actual_usd=greatest(reserved_usd,coalesce(actual_usd,0),
    (SELECT coalesce(sum(coalesce(a.actual_usd,a.reserved_usd)),0) FROM public.focus_ai_model_attempts a WHERE a.request_row_id=v_row.id))
    WHERE id=v_row.id AND EXISTS(SELECT 1 FROM public.focus_ai_model_attempts a WHERE a.request_row_id=v_row.id AND a.actual_usd>a.reserved_usd);
  v_snapshot:=public.focus_ai_budget_snapshot(p_user_id,v_row.admission_policy);
  v_alerts:=public.focus_ai_emit_budget_alerts(v_snapshot,v_row.admission_policy);
  RETURN jsonb_build_object('status','settled','actual_usd',coalesce(p_actual_usd,v_attempt.reserved_usd),'reservation_overrun',coalesce(p_actual_usd,0)>v_attempt.reserved_usd,'budget_alerts',v_alerts);
END $$;

CREATE OR REPLACE FUNCTION public.focus_ai_finish(p_user_id uuid,p_request_id text,p_lease_id uuid,p_response jsonb,p_actual_usd numeric,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.focus_ai_requests%ROWTYPE; v_count integer; v_cost numeric; v_result jsonb; v_snapshot jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('focus_ai_admission_v1',0));
  SELECT * INTO v_row FROM public.focus_ai_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_row.lease_id IS DISTINCT FROM p_lease_id THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_actual_usd IS NOT NULL AND NOT(p_actual_usd>=0 AND p_actual_usd<1000000) THEN
    RETURN jsonb_build_object('status','unavailable','reason','invalid_settlement');
  END IF;
  SELECT count(*),coalesce(sum(coalesce(actual_usd,reserved_usd)),0) INTO v_count,v_cost FROM public.focus_ai_model_attempts WHERE request_row_id=v_row.id;
  IF v_count>0 THEN
    -- Caller totals may retain additional conservative cost, never erase an attempt.
    v_cost:=greatest(v_cost,coalesce(p_actual_usd,v_cost),coalesce(v_row.actual_usd,0));
  ELSIF v_row.model_attempts_required THEN
    -- No model attempt was authorized. Releasing the bootstrap reservation is safe.
    v_cost:=0;
  ELSE v_cost:=p_actual_usd;
  END IF;
  v_result:=public.focus_ai_finish_v1(p_user_id,p_request_id,p_lease_id,p_response,v_cost,p_outcome);
  IF v_result->>'status'='completed' AND v_row.admission_policy IS NOT NULL THEN
    v_snapshot:=public.focus_ai_budget_snapshot(p_user_id,v_row.admission_policy);
    v_result:=v_result||v_snapshot||jsonb_build_object('budget_alerts',public.focus_ai_emit_budget_alerts(v_snapshot,v_row.admission_policy));
  END IF;
  RETURN v_result;
END $$;

-- Service-only operational snapshot: no user messages, emails or identifiers.
CREATE OR REPLACE FUNCTION public.focus_ai_model_metrics(p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_snapshot jsonb; v_tiers jsonb;
BEGIN
  IF NOT public.focus_ai_model_policy_valid(p_policy) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  v_snapshot:=public.focus_ai_budget_snapshot(NULL,p_policy);
  SELECT coalesce(jsonb_agg(t),'[]'::jsonb) INTO v_tiers FROM (
    SELECT tier,model,count(*) AS attempts,count(DISTINCT request_row_id) AS requests,
      sum(coalesce(actual_usd,reserved_usd)) AS cost_usd,
      count(*) FILTER(WHERE actual_usd IS NULL) AS unresolved_attempts
    FROM public.focus_ai_model_attempts WHERE created_at>=clock_timestamp()-interval '30 days' GROUP BY tier,model ORDER BY tier
  ) t;
  RETURN v_snapshot||jsonb_build_object('status','ok','tiers',v_tiers);
END $$;

REVOKE ALL ON FUNCTION public.focus_ai_get_control() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_set_control(boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_model_policy_valid(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_budget_snapshot(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_emit_budget_alerts(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_admit(uuid,text,text,text,jsonb,numeric,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_begin_attempt(uuid,text,uuid,integer,text,text,numeric,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_settle_attempt(uuid,text,uuid,integer,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_finish(uuid,text,uuid,jsonb,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.focus_ai_model_metrics(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.focus_ai_get_control() TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_set_control(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_model_policy_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_budget_snapshot(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_emit_budget_alerts(jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_admit(uuid,text,text,text,jsonb,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_begin_attempt(uuid,text,uuid,integer,text,text,numeric,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_settle_attempt(uuid,text,uuid,integer,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_finish(uuid,text,uuid,jsonb,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.focus_ai_model_metrics(jsonb) TO service_role;
