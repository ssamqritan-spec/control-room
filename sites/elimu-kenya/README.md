# Elimu Kenya (public website)
Pages: index.html -> apply.html -> pay.html. Deploy this folder to its own Vercel project (no build step).

Database: this site uses the SAME Supabase project as the control room. Run /database/schema.sql ONCE (it is shared by both websites).
config.js: set window.ELIMU = { url: <Supabase Project URL>, key: <anon / publishable key> }. Never use the service_role key here.
config.js also has window.SITE = 'elimu' - do not change it; it is what keeps this site's records in its own section of the control room.
Payments are confirmed from the control room (Payments > Verify). Leaving config.js blank runs a local preview that auto-confirms payment. Never deploy that way.
