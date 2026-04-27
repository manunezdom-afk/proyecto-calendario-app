-- Vínculo Focus ↔ Kairos: permite que la app hermana Kairos envíe eventos al
-- inbox de Focus para que Nova los proponga al usuario.
--
-- Modelo:
--   - Cada usuario de Focus tiene un "focus_code" público (6 caracteres,
--     legible, sin colisión con I/O/0/1). Es el código que el usuario pega en
--     Kairos para identificar su cuenta de Focus.
--   - El usuario opcionalmente guarda el "kairos_code" que vio en Kairos —
--     no lo necesitamos para recibir eventos, pero lo dejamos visible para
--     que el usuario verifique el vínculo.
--   - Kairos envía eventos a /api/kairos/inbox.js incluyendo el focus_code.
--     El backend busca el user_id y crea una sugerencia en suggestions.
--
-- Seguridad:
--   - focus_code es identificador, no secreto: cualquiera con el código puede
--     mandar sugerencias al inbox del usuario, pero esas sugerencias están
--     en estado pending y el usuario decide aprobarlas. No ejecutan acciones
--     directas. Si el código se filtra basta con regenerarlo.
--   - RLS: sólo el dueño puede leer/modificar su fila. El backend con
--     service_role puede buscar por focus_code para resolver el user_id.

CREATE TABLE IF NOT EXISTS public.kairos_links (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  focus_code   TEXT NOT NULL UNIQUE,
  kairos_code  TEXT,
  linked_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.kairos_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own kairos link"
  ON public.kairos_links FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS kairos_links_focus_code_idx
  ON public.kairos_links (focus_code);
