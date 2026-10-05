// =========================================================
// EDGE FUNCTION: brief-api
// Recibe briefs, archivos y mensajes; administra la bandeja.
// La service role key SOLO se usa en el servidor.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 30;

/* =========================================================
   MEJORA 07 — PLANES Y PRECIOS VALIDADOS EN SERVIDOR.
   No se confían los importes enviados por el navegador: el servidor
   usa estos valores para calcular el subtotal real y generar el TXT.
========================================================= */
const MAIN_PLANS: Record<string, { name: string; price: number }> = {
  catalogo_30: { name: "Página de catálogos (hasta 30 productos)", price: 35000 },
  dinamica_50: { name: "Página dinámica (hasta 50 productos)", price: 112000 },
  catalogo_carrito_90: { name: "Página de catálogos con carrito (hasta 90 productos)", price: 70000 },
};

const MAINTENANCE_PLANS: Record<string, { name: string; price: number }> = {
  sin_mantenimiento: { name: "No por ahora", price: 0 },
  actualizacion_no_dinamica: { name: "Mantenimiento de página no dinámica", price: 15000 },
  mantenimiento_dinamica: { name: "Mantenimiento de página dinámica", price: 95000 },
};

const formatARS = (value: number) =>
  `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ARS`;

const textValue = (value: unknown) => {
  if (Array.isArray(value)) return value.length ? value.map(item => String(item)).join(", ") : "No indicado";
  const text = String(value ?? "").trim();
  return text || "No indicado";
};

function buildBriefTxt(brief: Record<string, unknown>) {
  const planes = (brief.planes && typeof brief.planes === "object" ? brief.planes : {}) as Record<string, unknown>;
  const main = textValue(planes.plan_principal || brief.plan_principal);
  const maintenance = textValue(planes.plan_mantenimiento || brief.plan_mantenimiento);
  const mainPrice = Number(planes.precio_plan_principal ?? 0) || 0;
  const maintenancePrice = Number(planes.precio_plan_mantenimiento ?? 0) || 0;
  const subtotal = Number(planes.subtotal ?? brief.subtotal ?? (mainPrice + maintenancePrice)) || 0;

  const lines: string[] = [
    "VEXA — SOLICITUD DE PÁGINA WEB",
    "================================",
    `Fecha de envío: ${new Date().toLocaleString("es-AR")}`,
    "",
    "PLANES ELEGIDOS",
    "---------------",
    `Plan principal: ${main}`,
    `Precio del plan principal: ${formatARS(mainPrice)}`,
    `Mantenimiento: ${maintenance}`,
    `Precio del mantenimiento base: ${formatARS(maintenancePrice)}`,
    `SUBTOTAL: ${formatARS(subtotal)}`,
    "",
    "DATOS DEL NEGOCIO",
    "-----------------",
    `Nombre del negocio: ${textValue(brief.marca)}`,
    `Contacto: ${textValue(brief.contacto)}`,
    `Email: ${textValue(brief.email)}`,
    `Actividad o rubro: ${textValue(brief.rubro)}`,
    `Descripción: ${textValue(brief.descripcion)}`,
    `Clientes: ${textValue(brief.publico)}`,
    "",
    "OBJETIVOS Y ESTILO",
    "------------------",
    `Qué quiere conseguir: ${textValue(brief.objetivos)}`,
    `Estilo elegido: ${textValue(brief.estilo)}`,
    `Página de referencia: ${textValue(brief.referencias)}`,
    `Colores o estilo deseado: ${textValue(brief.colores)}`,
    "",
    "PRODUCTOS",
    "---------",
  ];

  const products = Array.isArray(brief.productos) ? brief.productos as Array<Record<string, unknown>> : [];
  if (!products.length) {
    lines.push("No se cargaron productos en el formulario.");
  } else {
    products.forEach((product, index) => {
      lines.push(
        `Producto ${Number(product.numero || index + 1)}:`,
        `  Nombre: ${textValue(product.nombre)}`,
        `  Precio: ${textValue(product.precio)}`,
        `  Categoría: ${textValue(product.categoria)}`,
        `  Código: ${textValue(product.sku)}`,
        `  Descripción: ${textValue(product.descripcion)}`,
        `  Notas: ${textValue(product.notas)}`,
        "",
      );
    });
  }

  lines.push(
    "REDES Y CONTACTO",
    "----------------",
    `Instagram: ${textValue(brief.instagram)}`,
    `Facebook: ${textValue(brief.facebook)}`,
    `TikTok: ${textValue(brief.tiktok)}`,
    `YouTube: ${textValue(brief.youtube)}`,
    `Email comercial: ${textValue(brief.email_comercial)}`,
    `Otro canal: ${textValue(brief.otro_canal)}`,
    `Canal preferido: ${textValue(brief.canal_prioritario)}`,
    "",
    "DETALLES FINALES",
    "----------------",
    `Logo: ${textValue(brief.logo)}`,
    `Colores y letras: ${textValue(brief.identidad)}`,
    `Secciones deseadas: ${textValue(brief.secciones)}`,
    `Fecha importante: ${textValue(brief.plazo)}`,
    `Notas finales: ${textValue(brief.notas)}`,
    `Confirmación: ${brief.confirmacion ? "Confirmado" : "No indicado"}`,
    "",
    "NOTA",
    "----",
    "Este archivo contiene la información escrita del formulario. Las imágenes y videos enviados se guardan por separado y se incluyen en el ZIP de la conversación.",
    "",
    "Fin de la solicitud.",
  );

  return lines.join("\n");
}

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

function checkFiles(files: File[]) {
  if (files.length > MAX_FILES_PER_REQUEST) throw new Error(`Máximo ${MAX_FILES_PER_REQUEST} archivos por envío.`);
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) throw new Error(`El archivo ${file.name} supera 25 MB.`);
  }
}

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

      const incomingPlans = (brief.planes && typeof brief.planes === "object" ? brief.planes : {}) as Record<string, unknown>;
      const mainId = String(incomingPlans.plan_principal_id || brief.plan_principal_id || "").trim();
      const maintenanceId = String(incomingPlans.plan_mantenimiento_id || brief.plan_mantenimiento_id || "sin_mantenimiento").trim() || "sin_mantenimiento";
      const mainPlan = MAIN_PLANS[mainId];
      const maintenancePlan = MAINTENANCE_PLANS[maintenanceId];
      if (!mainPlan) return json({ error: "Elegí un plan principal válido." }, 400);
      if (!maintenancePlan) return json({ error: "Elegí un mantenimiento válido." }, 400);

      const subtotal = mainPlan.price + maintenancePlan.price;
      brief.planes = {
        plan_principal_id: mainId,
        plan_principal: mainPlan.name,
        precio_plan_principal: mainPlan.price,
        plan_mantenimiento_id: maintenanceId,
        plan_mantenimiento: maintenancePlan.name,
        precio_plan_mantenimiento: maintenancePlan.price,
        subtotal,
      };
      brief.plan_principal = mainPlan.name;
      brief.plan_mantenimiento = maintenancePlan.name;
      brief.subtotal = subtotal;
      brief.enviado_en = new Date().toISOString();

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
        content: `Nueva solicitud · Plan principal: ${mainPlan.name} · Mantenimiento: ${maintenancePlan.name} · Subtotal: ${formatARS(subtotal)}`,
      }).select("id").single();
      if (messageError) throw messageError;

      const safeBusiness = business.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "cliente";
      const briefTxt = new File(
        [buildBriefTxt(brief)],
        `formulario-${safeBusiness}.txt`,
        { type: "text/plain;charset=utf-8" },
      );

      // MEJORA 07: el TXT se guarda como adjunto de la conversación.
      // Así aparece en la bandeja y también entra automáticamente en el ZIP.
      const uploaded = await uploadAttachments(db, conversation.id, message.id, [briefTxt, ...files]);
      return json({ ok: true, conversationId: conversation.id, uploaded: uploaded.length, subtotal });
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

    // ---------------------------------------------------------
    // ADMIN: ELIMINAR UNA CONVERSACIÓN COMPLETA.
    // Solo llega hasta acá después de requireAdmin(req).
    // Borra adjuntos del bucket privado y después los registros
    // de adjuntos, mensajes y conversación para evitar que la
    // bandeja se llene de consultas que ya no necesitás.
    // ---------------------------------------------------------
    if (req.method === "DELETE" && action === "conversations") {
      const conversationId = new URL(req.url).searchParams.get("conversation_id")?.trim();
      if (!conversationId) return json({ error: "Falta conversation_id." }, 400);

      const { data: conversation, error: conversationError } = await db.from("conversations")
        .select("id").eq("id", conversationId).single();
      if (conversationError || !conversation) return json({ error: "Conversación no encontrada." }, 404);

      const { data: attachments, error: attachmentReadError } = await db.from("attachments")
        .select("id,storage_path").eq("conversation_id", conversationId);
      if (attachmentReadError) throw attachmentReadError;

      const storagePaths = (attachments || [])
        .map(file => file.storage_path)
        .filter((path): path is string => Boolean(path));

      // Eliminamos primero los objetos físicos para que no queden
      // imágenes/videos/TXT abandonados ocupando espacio en Storage.
      if (storagePaths.length) {
        const { error: storageError } = await db.storage.from("client-files").remove(storagePaths);
        if (storageError) throw storageError;
      }

      const { error: attachmentDeleteError } = await db.from("attachments")
        .delete().eq("conversation_id", conversationId);
      if (attachmentDeleteError) throw attachmentDeleteError;

      const { error: messageDeleteError } = await db.from("messages")
        .delete().eq("conversation_id", conversationId);
      if (messageDeleteError) throw messageDeleteError;

      const { error: conversationDeleteError } = await db.from("conversations")
        .delete().eq("id", conversationId);
      if (conversationDeleteError) throw conversationDeleteError;

      return json({ ok: true, deletedConversationId: conversationId });
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
