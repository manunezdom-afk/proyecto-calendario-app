// Real admission SQL with synthetic users only. This is not a production mock:
// the small adapter replaces HTTP transport, while PostgreSQL executes the RPCs.
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export async function ephemeralAIDatabase() {
  const modulePath = process.env.FOCUS_PGLITE_MODULE
  const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`)
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  const names = readdirSync(directory).filter(name => /^(010_ai_usage|013_ai_usage_events|020_atomic_ai_usage|021_ai_admission|022_.*)\.sql$/.test(name)).sort()
  for (const name of names) await db.exec(readFileSync(new URL(name, directory), 'utf8'))
  const calls = [], events = []
  const admin = {
    async rpc(name, args) {
      if (!/^focus_ai_[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error('Unexpected RPC identifier')
      calls.push({ name, args })
      const entries = Object.entries(args)
      try {
        const result = await db.query(`SELECT public.${name}(${entries.map(([key], index) => `${key} => $${index + 1}`).join(',')}) AS result`,
          entries.map(([, value]) => value != null && typeof value === 'object' ? JSON.stringify(value) : value))
        return { data: result.rows[0].result, error: null }
      } catch (error) { return { data: null, error: { code: error.code, message: 'Synthetic database RPC failed' } } }
    },
    from(table) {
      if (table !== 'ai_usage_events') throw new Error('Unexpected telemetry table')
      return { async insert(row) {
        try {
          await db.query(`INSERT INTO public.ai_usage_events(user_id,action_type,model_used,input_tokens,output_tokens,estimated_cost_usd,metadata)
            VALUES($1,$2,$3,$4,$5,$6,$7)`, [row.user_id,row.action_type,row.model_used,row.input_tokens,row.output_tokens,row.estimated_cost_usd,JSON.stringify(row.metadata)])
          events.push({ ...row, created_at: new Date().toISOString() }); return { error: null }
        } catch (error) { return { error: { code: error.code, message: 'Synthetic telemetry insert failed' } } }
      } }
    },
  }
  return { db, admin, calls, events, migrations: names, close: () => db.close() }
}
