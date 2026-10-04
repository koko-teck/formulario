BRIEF + MENSAJERIA — VERSION CONECTADA A SUPABASE

1. Ya existe el usuario administrador en Supabase Authentication.
2. En Edge Functions está publicada la función brief-api.
3. En Secrets debe existir ADMIN_EMAIL con el correo del administrador.
4. Este proyecto usa la clave publishable en el navegador; la service role permanece en Supabase.
5. Antes de usarlo en producción conviene limitar CORS al dominio definitivo y agregar protección anti-spam/rate limiting al endpoint público.

IMPORTANTE
- El archivo supabase/functions/brief-api/index.ts es la versión que debe estar desplegada en Supabase.
- El navegador necesita internet para comunicarse con Supabase.
