# Render + Supabase deployment

This is a hosting adaptation of the supplied Control Room. Existing UI, API operations, authentication rules, database SQL and bundled public-site code are preserved. The new Render service hosts only admin/public and /api/operations. It does not serve the database directory, bundled public websites, environment files or server source.

## Supabase
Use the existing database/schema.sql exactly as documented in the original README. For a new installation use a fresh project. If the schema is already installed in your existing project, use that same project's URL and server-side service-role key; this hosting change requires no schema migration. Back up an existing database before any manual SQL changes. This package does not connect to the separate draft-only schema from the earlier Elimu prototype.

## Render Blueprint
1. Extract this ZIP. Push the contents of Bursary-Control-Room-Render into a Git repository so render.yaml and admin/ are at the repository root.
2. Render → New → Blueprint → select that repository.
3. Supply the existing configuration values:
   - SUPABASE_URL: https://your-project.supabase.co
   - SUPABASE_SERVICE_ROLE_KEY: the server-only service-role key
   - PUBLIC_URL: the exact HTTPS origin of this control-room service, e.g. https://your-service.onrender.com (not the public application website)
   - ADMIN_PASSWORD: your private access passphrase
4. Deploy. If the final hostname differs, update PUBLIC_URL to the exact deployed origin and redeploy. Login POSTs deliberately reject a mismatched origin. Update it again when moving to a custom domain.
5. Leave ALLOW_INSECURE_LOCAL unset in production. Render provides PORT; do not hardcode it.

## Manual service setup
Choose Web Service (not Static Site), runtime Node, Root Directory admin, Build Command npm run check, Start Command npm start, health-check path /. Add the four environment variables above. Use Node 22 or later. No npm dependencies need installation.

## Verification and limitations
The Render adapter binds 0.0.0.0 on PORT, serves the original frontend and forwards /api/operations requests into the original GET/POST handlers. It also reproduces the security headers from admin/vercel.json; Render does not consume that Vercel configuration. Existing authentication and Supabase RPC behavior are unchanged. A reachable homepage proves server availability, not database connectivity. After deployment sign in and check the overview to validate Supabase access.

No live Render account or Supabase database was accessed while preparing this package. Set your own credentials in Render, never in browser code or Git. The bundled public websites and their payment flows are unchanged and are not deployed by this Blueprint. Earlier separately supplied Elimu proposal packages do not automatically become connected to this control room.

References: https://render.com/docs/web-services and https://render.com/docs/blueprint-spec
