// =========================================================
// EDGE FUNCTION: brief-api
// Recibe briefs, archivos y mensajes; administra la bandeja.
// La service role key SOLO se usa en el servidor.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =========================================================
// 01. CONFIGURACIÓN HTTP: permisos CORS y límites de archivos.
// =========================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 30;

// =========================================================
// 02. UTILIDADES Y ACCESO A DATOS: respuestas y conexión segura.
// =========================================================
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const getDb = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Faltan secretos de Supabase.");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const getAdminEmail = () => (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();

// =========================================================
// 03. SEGURIDAD: valida que la petición pertenezca al administrador.
// =========================================================
async function requireAdmin(req: Request) {
  const bearer = req.headers.get("Authorization") || "";
  const token = bearer.replace(/^Bearer\s+/i, "");
  if (!token) throw new Response(JSON.stringify({ error: "Iniciá sesión como administrador." }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const db = getDb();
  const { data, error } = await db.auth.getUser(token);
  const email = data.user?.email?.toLowerCase() || "";
  if (error || !data.user || !getAdminEmail() || email !== getAdminEmail()) {
    throw new Response(JSON.stringify({ error: "Acceso denegado." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return data.user;
}

// =========================================================
// 04. VALIDACIÓN: limita la cantidad y el tamaño de los archivos.
// =========================================================
function checkFiles(files: File[]) {
  if (files.length > MAX_FILES_PER_REQUEST) throw new Error(`Máximo ${MAX_FILES_PER_REQUEST} archivos por envío.`);
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) throw new Error(`El archivo ${file.name} supera 25 MB.`);
  }
}

// =========================================================
// 05. ARCHIVOS: sube adjuntos al almacenamiento privado y registra sus datos.
// =========================================================
async function uploadAttachments(db: ReturnType<typeof getDb>, conversationId: string, messageId: string, files: File[]) {
  const uploaded: Array<{ id: string; name: string; path: string; type: string }> = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const path = `${conversationId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from("client-files").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: attachment, error: attachmentError } = await db.from("attachments").insert({
      conversation_id: conversationId,
      message_id: messageId,
      file_name: file.name,
      storage_path: path,
      content_type: file.type || null,
    }).select("id").single();
    if (attachmentError) throw attachmentError;

    uploaded.push({ id: attachment.id, name: file.name, path, type: file.type });
  }
  return uploaded;
}

// =========================================================
// 06. API PRINCIPAL: enruta las solicitudes entrantes del formulario y chat.
// =========================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = getDb();
    const { pathname } = new URL(req.url);
    const action = pathname.split("/").filter(Boolean).pop() || "";

    // ---------------------------------------------------------
    // PÚBLICO: CREAR UNA CONVERSACIÓN.
    // El conversationId también funciona como un token largo y
    // difícil de adivinar para que el cliente pueda continuar.
    // ---------------------------------------------------------
    if (req.method === "POST" && action === "submit") {
      const form = await req.formData();
      const briefRaw = form.get("brief");
      if (typeof briefRaw !== "string") return json({ error: "Falta el brief." }, 400);

      let brief: Record<string, unknown>;
      try {
        brief = JSON.parse(briefRaw);
      } catch {
        return json({ error: "El brief no tiene un formato válido." }, 400);
      }

      const name = String(brief.contacto || "").trim();
      const email = String(brief.email || "").trim();
      const business = String(brief.marca || "").trim();
      if (!name || !email || !business) return json({ error: "Completá nombre, email y negocio." }, 400);

      const files = [...form.entries()]
        .filter(([, value]) => value instanceof File && value.size)
        .map(([, value]) => value as File);
      checkFiles(files);

      const { data: conversation, error: insertError } = await db.from("conversations").insert({
        client_name: name,
        client_email: email,
        business_name: business,
        brief,
      }).select("id,client_name,client_email,business_name").single();
      if (insertError) throw insertError;

      const { data: message, error: messageError } = await db.from("messages").insert({
        conversation_id: conversation.id,
        sender: "client",
        content: "Brief inicial enviado. Revisá los datos y archivos adjuntos.",
      }).select("id").single();
      if (messageError) throw messageError;

      const uploaded = await uploadAttachments(db, conversation.id, message.id, files);
      return json({ ok: true, conversationId: conversation.id, uploaded: uploaded.length });
    }

    // ---------------------------------------------------------
    // PÚBLICO: LEER MENSAJES DEL CLIENTE.
    // Se requiere el mismo UUID de la conversación como token.
    // ---------------------------------------------------------
    if (req.method === "GET" && action === "messages") {
      const url = new URL(req.url);
      const conversationId = url.searchParams.get("conversation_id");
      const clientToken = url.searchParams.get("client_token");
      const bearer = req.headers.get("Authorization") || "";

      let isAdmin = false;
      if (bearer) {
        try { await requireAdmin(req); isAdmin = true; } catch (_) { isAdmin = false; }
      }
      if (!isAdmin && (!conversationId || !clientToken || clientToken !== conversationId)) {
        return json({ error: "No autorizado." }, 401);
      }

      if (!conversationId) return json({ error: "Falta conversation_id." }, 400);
      const { data: conversation, error: conversationError } = await db.from("conversations")
        .select("id,client_name,client_email,business_name,created_at")
        .eq("id", conversationId).single();
      if (conversationError) return json({ error: "Conversación no encontrada." }, 404);

      const [{ data: messages, error: messageError }, { data: attachments, error: attachmentError }] = await Promise.all([
        db.from("messages").select("*").eq("conversation_id", conversationId).order("created_at"),
        db.from("attachments").select("*").eq("conversation_id", conversationId).order("created_at"),
      ]);
      if (messageError) throw messageError;
      if (attachmentError) throw attachmentError;

      const files = await Promise.all((attachments || []).map(async (attachment) => {
        const { data } = await db.storage.from("client-files").createSignedUrl(attachment.storage_path, 60 * 10);
        return { ...attachment, signed_url: data?.signedUrl || null };
      }));

      return json({ conversation, messages: messages || [], attachments: files });
    }

    // ---------------------------------------------------------
    // PÚBLICO: RESPUESTA DEL CLIENTE.
    // El conversationId funciona como token del cliente.
    // ---------------------------------------------------------
    if (req.method === "POST" && action === "client-reply") {
      const form = await req.formData();
      const conversationId = String(form.get("conversation_id") || "").trim();
      const clientToken = String(form.get("client_token") || "").trim();
      const content = String(form.get("content") || "").trim();
      if (!conversationId || !clientToken || clientToken !== conversationId) return json({ error: "No autorizado." }, 401);

      const { data: conversation, error: conversationError } = await db.from("conversations")
        .select("id").eq("id", conversationId).single();
      if (conversationError || !conversation) return json({ error: "Conversación no encontrada." }, 404);

      const files = [...form.values()]
        .filter(value => value instanceof File && value.size)
        .map(value => value as File);
      if (!content && !files.length) return json({ error: "Falta el mensaje." }, 400);
      checkFiles(files);

      const { data: message, error: messageError } = await db.from("messages").insert({
        conversation_id: conversationId,
        sender: "client",
        content,
      }).select("*").single();
      if (messageError) throw messageError;
      await uploadAttachments(db, conversationId, message.id, files);
      return json({ ok: true, message });
    }

    // ---------------------------------------------------------
    // RESTO: SOLO ADMINISTRADOR AUTENTICADO.
    // ---------------------------------------------------------
    await requireAdmin(req);

    if (req.method === "GET" && action === "conversations") {
      const { data, error } = await db.from("conversations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ conversations: data || [] });
    }

    if (req.method === "POST" && action === "reply") {
      const form = await req.formData();
      const conversationId = String(form.get("conversation_id") || "").trim();
      const content = String(form.get("content") || "").trim();
      if (!conversationId) return json({ error: "Falta conversation_id." }, 400);
      if (!content && ![...form.values()].some(value => value instanceof File && value.size)) return json({ error: "Falta el mensaje." }, 400);

      const files = [...form.values()].filter(value => value instanceof File && value.size).map(value => value as File);
      checkFiles(files);
      const { data: message, error: messageError } = await db.from("messages").insert({
        conversation_id: conversationId,
        sender: "admin",
        content,
      }).select("*").single();
      if (messageError) throw messageError;

      await uploadAttachments(db, conversationId, message.id, files);
      return json({ message });
    }

    if (req.method === "GET" && action === "download-links") {
      const conversationId = new URL(req.url).searchParams.get("conversation_id");
      if (!conversationId) return json({ error: "Falta conversation_id." }, 400);
      const { data, error } = await db.from("attachments")
        .select("file_name,storage_path,content_type")
        .eq("conversation_id", conversationId);
      if (error) throw error;

      const files = await Promise.all((data || []).map(async (file) => {
        const { data: signed, error: signedError } = await db.storage.from("client-files").createSignedUrl(file.storage_path, 60 * 10);
        if (signedError) throw signedError;
        return {...file, url:signed.signedUrl};
      }));
      return json({ files });
    }

    return json({ error: "Endpoint no encontrado." }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("brief-api error", error);
    return json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, 500);
  }
});
