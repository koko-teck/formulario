/* =========================================================
   ARCHIVO: app.js
   FUNCIÓN: conecta el formulario y la bandeja con Supabase.
   - Los briefs se guardan en el servidor.
   - Los archivos van al bucket privado client-files.
   - El administrador inicia sesión con Supabase Auth.
   - El cliente puede seguir la conversación desde su navegador.
   - La bandeja privada se actualiza automáticamente.
========================================================= */

const APP_CONFIG = {
  supabaseUrl: 'https://fuojhhwntbnbqzhawuqm.supabase.co',
  supabasePublishableKey: 'sb_publishable_Ime3oA6aEjRsRkWaNFjpEA_Y8OnE_qJ',
  functionUrl: 'https://fuojhhwntbnbqzhawuqm.supabase.co/functions/v1/brief-api',
  clientConversationKey: 'briefClientConversationId',
  pollMs: 5000
};

const supabaseClient = window.supabase.createClient(
  APP_CONFIG.supabaseUrl,
  APP_CONFIG.supabasePublishableKey
);

let currentThreadId = null;
let allThreadsCache = [];
let productCount = 0;
let adminPoll = null;
let clientPoll = null;
let clientConversationId = localStorage.getItem(APP_CONFIG.clientConversationKey) || null;

const el = {
  clientView: document.getElementById('clientView'),
  clientChatView: document.getElementById('clientChatView'),
  inboxView: document.getElementById('inboxView'),
  briefForm: document.getElementById('briefForm'),
  productsList: document.getElementById('productsList'),
  addProduct: document.getElementById('addProduct'),
  brandFiles: document.getElementById('brandFiles'),
  brandPreviews: document.getElementById('brandPreviews'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  adminButton: document.getElementById('adminButton'),
  backToForm: document.getElementById('backToForm'),
  chatSearch: document.getElementById('chatSearch'),
  chatList: document.getElementById('chatList'),
  emptyChat: document.getElementById('emptyChat'),
  activeChat: document.getElementById('activeChat'),
  chatAvatar: document.getElementById('chatAvatar'),
  chatName: document.getElementById('chatName'),
  chatMeta: document.getElementById('chatMeta'),
  messageArea: document.getElementById('messageArea'),
  replyForm: document.getElementById('replyForm'),
  replyText: document.getElementById('replyText'),
  replyFiles: document.getElementById('replyFiles'),
  attachReply: document.getElementById('attachReply'),
  downloadZip: document.getElementById('downloadZip'),
  successModal: document.getElementById('successModal'),
  closeModal: document.getElementById('closeModal'),
  openInboxFromModal: document.getElementById('openInboxFromModal'),
  clientChatTitle: document.getElementById('clientChatTitle'),
  clientChatMeta: document.getElementById('clientChatMeta'),
  clientMessageArea: document.getElementById('clientMessageArea'),
  clientReplyForm: document.getElementById('clientReplyForm'),
  clientReplyText: document.getElementById('clientReplyText'),
  clientReplyFiles: document.getElementById('clientReplyFiles'),
  clientAttachReply: document.getElementById('clientAttachReply'),
  closeClientChat: document.getElementById('closeClientChat')
};

function apiError(data, fallback='Ocurrió un error.') {
  return new Error(data?.error || fallback);
}

async function readJsonResponse(response) {
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw apiError(data, `Error ${response.status}`);
  return data || {};
}

async function getAdminToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.access_token || null;
}

async function adminFetch(path, options={}) {
  let token = await getAdminToken();
  if (!token) throw new Error('Iniciá sesión como administrador.');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${APP_CONFIG.functionUrl}${path}`, {...options, headers});
  if (response.status === 401) {
    await supabaseClient.auth.refreshSession();
    token = await getAdminToken();
    if (!token) throw new Error('La sesión del administrador expiró.');
    headers.set('Authorization', `Bearer ${token}`);
    return readJsonResponse(await fetch(`${APP_CONFIG.functionUrl}${path}`, {...options, headers}));
  }
  return readJsonResponse(response);
}

async function publicFetch(path, options={}) {
  const response = await fetch(`${APP_CONFIG.functionUrl}${path}`, options);
  return readJsonResponse(response);
}

function setConnection(ok, text) {
  const badge = document.getElementById('connectionBadge');
  if (!badge) return;
  badge.innerHTML = `<i></i> ${escapeHtml(text)}`;
  badge.classList.toggle('is-error', !ok);
}

function addProduct() {
  productCount += 1;
  const number = productCount;
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.product = String(number);
  card.innerHTML = `
    <div class="product-top">
      <strong>Producto ${number}</strong>
      <button type="button" class="remove-button">Quitar</button>
    </div>
    <div class="grid-2">
      <label class="field"><span>Nombre del producto</span><input data-key="nombre" placeholder="Nombre tal como debe aparecer"></label>
      <label class="field"><span>Precio</span><input data-key="precio" placeholder="Ej. $25.000 o consultar"></label>
      <label class="field"><span>Categoría / colección</span><input data-key="categoria" placeholder="Ej. Temporada otoño"></label>
      <label class="field"><span>Código o SKU <small>(si corresponde)</small></span><input data-key="sku" placeholder="Ej. CAM-001"></label>
    </div>
    <label class="field"><span>Descripción y características</span><textarea data-key="descripcion" placeholder="Materiales, medidas, colores, beneficios, talles o variantes…"></textarea></label>
    <div class="field">
      <span class="field-label">Fotos y videos de este producto</span>
      <div class="file-box">
        <div class="file-box-icon">▧</div>
        <div><strong>Seleccionar archivos</strong><p>Podés elegir varias imágenes y videos.</p></div>
        <label class="file-button">Elegir<input data-key="archivos" type="file" multiple accept="image/*,video/*"></label>
      </div>
      <div class="preview-grid"></div>
    </div>
    <label class="field"><span>Disponibilidad / variantes / notas</span><input data-key="notas" placeholder="Stock, talles, colores disponibles, etc."></label>
  `;

  card.querySelector('.remove-button').addEventListener('click', () => {
    card.remove();
    renumberProducts();
    updateProgress();
  });

  const fileInput = card.querySelector('input[type=file]');
  fileInput.addEventListener('change', () => {
    previewFiles(fileInput, card.querySelector('.preview-grid'));
    updateProgress();
  });

  card.querySelectorAll('input:not([type=file]),textarea').forEach(input => input.addEventListener('input', updateProgress));
  el.productsList.appendChild(card);
  renumberProducts();
  updateProgress();
}

function renumberProducts() {
  const cards = [...document.querySelectorAll('.product-card')];
  cards.forEach((card, index) => {
    card.dataset.product = String(index + 1);
    card.querySelector('.product-top strong').textContent = `Producto ${index + 1}`;
  });
  productCount = cards.length;
}

function previewFiles(input, target) {
  target.innerHTML = '';
  [...input.files].forEach(file => {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      wrap.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      wrap.appendChild(video);
    } else {
      wrap.textContent = '📄';
      wrap.style.display = 'grid';
      wrap.style.placeItems = 'center';
      wrap.style.fontSize = '24px';
    }
    const name = document.createElement('span');
    name.className = 'preview-name';
    name.textContent = file.name;
    wrap.appendChild(name);
    target.appendChild(wrap);
  });
}

function updateProgress() {
  const fields = [...el.briefForm.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=radio]),textarea,select')].filter(field => field.name);
  const filled = fields.filter(field => String(field.value || '').trim()).length;
  const checkboxCount = el.briefForm.querySelectorAll('input[type=checkbox]:checked').length;
  const total = fields.length + 5;
  const pct = Math.min(100, Math.round(((filled + checkboxCount) / Math.max(total, 1)) * 100));
  el.progressFill.style.width = `${pct}%`;
  el.progressText.textContent = `${pct}% completado`;
}

function collectFormData() {
  const formData = new FormData(el.briefForm);
  const data = {};
  const repeated = new Set(['objetivos', 'estilo', 'secciones']);
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    if (repeated.has(key)) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(value);
    } else data[key] = value;
  }
  return data;
}

function collectProducts() {
  return [...document.querySelectorAll('.product-card')].map((card, index) => {
    const product = {numero:index + 1, datos:{}, files:[]};
    card.querySelectorAll('[data-key]').forEach(field => {
      const key = field.dataset.key;
      if (field.type === 'file') product.files = [...field.files];
      else product.datos[key] = field.value;
    });
    return product;
  });
}

function collectBrandFiles() {
  return [...el.brandFiles.files];
}

function buildBrief(data, products, brandFiles) {
  return {
    ...data,
    productos: products.map(product => ({
      numero: product.numero,
      ...product.datos,
      archivos: product.files.map(file => ({name:file.name, type:file.type, size:file.size}))
    })),
    archivos_generales: brandFiles.map(file => ({name:file.name, type:file.type, size:file.size}))
  };
}

async function submitBrief() {
  if (!el.briefForm.reportValidity()) {
    el.briefForm.querySelector(':invalid')?.scrollIntoView({behavior:'smooth', block:'center'});
    return null;
  }

  const data = collectFormData();
  const products = collectProducts();
  const brandFiles = collectBrandFiles();
  const payload = new FormData();
  payload.append('brief', JSON.stringify(buildBrief(data, products, brandFiles)));
  brandFiles.forEach(file => payload.append('file', file, file.name));
  products.forEach(product => product.files.forEach(file => payload.append(`producto_${product.numero}`, file, file.name)));

  setConnection(true, 'Enviando al servidor…');
  const result = await publicFetch('/submit', {method:'POST', body:payload});
  if (!result.conversationId) throw new Error('El servidor no devolvió el identificador de conversación.');

  clientConversationId = result.conversationId;
  localStorage.setItem(APP_CONFIG.clientConversationKey, clientConversationId);
  setConnection(true, 'Servidor conectado');
  return result;
}

function resetBriefForm() {
  el.briefForm.reset();
  el.productsList.innerHTML = '';
  productCount = 0;
  el.brandPreviews.innerHTML = '';
  addProduct();
  updateProgress();
}

function showClientChat() {
  if (!clientConversationId) return;
  stopPolling(adminPoll);
  stopPolling(clientPoll);
  el.clientView.classList.add('hidden');
  el.inboxView.classList.add('hidden');
  el.clientChatView.classList.remove('hidden');
  loadClientChat();
  clientPoll = setInterval(loadClientChat, APP_CONFIG.pollMs);
  history.replaceState(null, '', `#chat=${encodeURIComponent(clientConversationId)}`);
}

async function loadClientChat() {
  if (!clientConversationId) return;
  try {
    const data = await publicFetch(`/messages?conversation_id=${encodeURIComponent(clientConversationId)}&client_token=${encodeURIComponent(clientConversationId)}`);
    const name = data?.conversation?.client_name || 'Cliente';
    const business = data?.conversation?.business_name || 'Conversación';
    el.clientChatTitle.textContent = business;
    el.clientChatMeta.textContent = name;
    renderRemoteMessages(el.clientMessageArea, data.messages || [], data.attachments || [], 'client');
  } catch (error) {
    console.error(error);
  }
}

async function sendClientReply(event) {
  event.preventDefault();
  if (!clientConversationId) return;
  const text = el.clientReplyText.value.trim();
  const files = [...el.clientReplyFiles.files];
  if (!text && !files.length) return;

  const body = new FormData();
  body.append('conversation_id', clientConversationId);
  body.append('client_token', clientConversationId);
  body.append('content', text);
  files.forEach(file => body.append('file', file, file.name));

  const result = await publicFetch('/client-reply', {method:'POST', body});
  if (!result.ok) throw new Error('No se pudo enviar el mensaje.');
  el.clientReplyText.value = '';
  el.clientReplyFiles.value = '';
  await loadClientChat();
}

function openAdmin() {
  supabaseClient.auth.getSession().then(({data}) => {
    if (data.session) {
      showInbox();
      return;
    }
    const email = prompt('Correo del administrador:');
    if (!email) return;
    const password = prompt('Contraseña del administrador:');
    if (!password) return;
    signInAdmin(email, password);
  });
}

async function signInAdmin(email, password) {
  try {
    setConnection(true, 'Iniciando sesión…');
    const {error} = await supabaseClient.auth.signInWithPassword({email:email.trim(), password});
    if (error) throw error;
    setConnection(true, 'Servidor conectado');
    await showInbox();
  } catch (error) {
    console.error(error);
    alert(`No se pudo iniciar sesión: ${error.message || 'revisá el correo y la contraseña.'}`);
  }
}

async function showInbox() {
  const token = await getAdminToken();
  if (!token) {
    openAdmin();
    return;
  }
  stopPolling(adminPoll);
  stopPolling(clientPoll);
  el.clientView.classList.add('hidden');
  el.clientChatView.classList.add('hidden');
  el.inboxView.classList.remove('hidden');
  history.replaceState(null, '', '#inbox');
  await refreshConversations();
  adminPoll = setInterval(refreshConversations, APP_CONFIG.pollMs);
}

async function refreshConversations() {
  try {
    const data = await adminFetch('/conversations');
    allThreadsCache = data.conversations || [];
    renderChatList(el.chatSearch.value);
    if (currentThreadId) await openThread(currentThreadId, false);
    setConnection(true, 'Servidor conectado');
  } catch (error) {
    console.error(error);
    setConnection(false, 'Sin conexión');
  }
}

function renderChatList(filter='') {
  const query = filter.trim().toLowerCase();
  const visible = allThreadsCache.filter(thread => {
    const haystack = `${thread.client_name || ''} ${thread.business_name || ''} ${thread.client_email || ''}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  el.chatList.innerHTML = '';
  if (!visible.length) {
    el.chatList.innerHTML = '<div class="empty-list">No hay conversaciones todavía.</div>';
    return;
  }

  visible.forEach(thread => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `chat-item ${thread.id === currentThreadId ? 'active' : ''}`;
    const name = thread.client_name || 'Cliente';
    const initial = name.trim().charAt(0).toUpperCase() || 'C';
    item.innerHTML = `
      <div class="chat-avatar">${escapeHtml(initial)}</div>
      <div class="chat-preview"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(thread.business_name || thread.client_email || 'Conversación')}</span></div>
      <div class="chat-time">${formatListTime(thread.created_at)}</div>`;
    item.addEventListener('click', () => openThread(thread.id));
    el.chatList.appendChild(item);
  });
}

async function openThread(threadId, redrawList=true) {
  currentThreadId = threadId;
  try {
    const data = await adminFetch(`/messages?conversation_id=${encodeURIComponent(threadId)}`);
    const thread = data.conversation || allThreadsCache.find(item => item.id === threadId) || {};
    el.emptyChat.classList.add('hidden');
    el.activeChat.classList.remove('hidden');
    el.chatName.textContent = thread.client_name || 'Cliente';
    el.chatMeta.textContent = `${thread.business_name || 'Negocio'}${thread.client_email ? ` · ${thread.client_email}` : ''}`;
    el.chatAvatar.textContent = (thread.client_name || 'C').trim().charAt(0).toUpperCase();
    renderRemoteMessages(el.messageArea, data.messages || [], data.attachments || [], 'admin');
    if (redrawList) renderChatList(el.chatSearch.value);
  } catch (error) {
    console.error(error);
    alert(error.message || 'No se pudo abrir la conversación.');
  }
}

function renderRemoteMessages(target, messages, attachments, perspective) {
  target.innerHTML = '';
  const grouped = new Map();
  (attachments || []).forEach(file => {
    const key = file.message_id || 'orphan';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(file);
  });

  messages.forEach(message => {
    const row = document.createElement('div');
    const mine = perspective === 'admin' ? message.sender === 'admin' : message.sender === 'client';
    row.className = `message-row ${mine ? 'outgoing' : 'incoming'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (message.content) {
      const text = document.createElement('div');
      text.textContent = message.content;
      bubble.appendChild(text);
    }

    const files = grouped.get(message.id) || [];
    files.forEach(file => {
      const chip = document.createElement('a');
      chip.className = 'file-chip';
      chip.href = file.signed_url || '#';
      chip.target = '_blank';
      chip.rel = 'noopener noreferrer';
      chip.textContent = `📎 ${file.file_name}`;
      bubble.appendChild(chip);
    });

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = `${mine && perspective === 'admin' ? 'Vos · ' : ''}${formatClock(message.created_at)}`;
    bubble.appendChild(meta);
    row.appendChild(bubble);
    target.appendChild(row);
  });
  requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });
}

async function sendReply(event) {
  event.preventDefault();
  if (!currentThreadId) return;
  const text = el.replyText.value.trim();
  const files = [...el.replyFiles.files];
  if (!text && !files.length) return;
  const body = new FormData();
  body.append('conversation_id', currentThreadId);
  body.append('content', text);
  files.forEach(file => body.append('file', file, file.name));
  try {
    await adminFetch('/reply', {method:'POST', body});
    el.replyText.value = '';
    el.replyFiles.value = '';
    await openThread(currentThreadId);
  } catch (error) {
    console.error(error);
    alert(error.message || 'No se pudo enviar el mensaje.');
  }
}

async function downloadThreadZip() {
  if (!currentThreadId) return;
  try {
    const data = await adminFetch(`/download-links?conversation_id=${encodeURIComponent(currentThreadId)}`);
    const files = data.files || [];
    if (!files.length) {
      alert('Esta conversación no tiene archivos para descargar.');
      return;
    }
    const entries = [];
    for (const file of files) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`No se pudo descargar ${file.file_name}.`);
      const buffer = new Uint8Array(await response.arrayBuffer());
      entries.push({
        name: `${safeSegment(file.file_name)}`,
        data: buffer,
        crc: crc32(buffer)
      });
    }
    const zip = buildZip(entries);
    const blob = new Blob([zip], {type:'application/zip'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const thread = allThreadsCache.find(item => item.id === currentThreadId);
    link.download = `${safeSegment(thread?.business_name || 'cliente')}-${currentThreadId}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    alert(error.message || 'No se pudo preparar el ZIP.');
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach(entry => {
    const nameBytes = encoder.encode(entry.name);
    const local = new Uint8Array(30 + nameBytes.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, entry.crc, true); view.setUint32(18, entry.data.length, true); view.setUint32(22, entry.data.length, true);
    view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(entry.data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true); cv.setUint32(16, entry.crc, true);
    cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46); centralParts.push(central); offset += local.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return concatUint8Arrays([...localParts, ...centralParts, end]);
}
function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total); let cursor = 0;
  parts.forEach(part => {out.set(part, cursor); cursor += part.length;});
  return out;
}

function stopPolling(handle) {
  if (handle) clearInterval(handle);
}

function showForm() {
  stopPolling(adminPoll); stopPolling(clientPoll);
  el.inboxView.classList.add('hidden');
  el.clientChatView.classList.add('hidden');
  el.clientView.classList.remove('hidden');
  history.replaceState(null, '', '#form');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function safeSegment(value) {
  return String(value || 'archivo').replace(/[^a-zA-Z0-9ÁÉÍÓÚáéíóúÑñ _.-]/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'archivo';
}
function formatClock(date) { return new Intl.DateTimeFormat('es-AR', {hour:'2-digit', minute:'2-digit'}).format(new Date(date)); }
function formatListTime(date) { const d=new Date(date), now=new Date(); if(d.toDateString()===now.toDateString()) return formatClock(date); return new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit'}).format(d); }

el.briefForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitBrief();
    el.successModal.classList.remove('hidden');
    resetBriefForm();
  } catch (error) {
    console.error(error);
    setConnection(false, 'Error de conexión');
    alert(error.message || 'No se pudo enviar el formulario.');
  }
});

el.addProduct.addEventListener('click', addProduct);
el.brandFiles.addEventListener('change', () => { previewFiles(el.brandFiles, el.brandPreviews); updateProgress(); });
el.adminButton.addEventListener('click', openAdmin);
el.backToForm.addEventListener('click', showForm);
el.chatSearch.addEventListener('input', () => renderChatList(el.chatSearch.value));
el.replyForm.addEventListener('submit', sendReply);
el.attachReply.addEventListener('click', () => el.replyFiles.click());
el.downloadZip.addEventListener('click', downloadThreadZip);
el.closeModal.addEventListener('click', () => el.successModal.classList.add('hidden'));
el.openInboxFromModal.addEventListener('click', async () => { el.successModal.classList.add('hidden'); showClientChat(); });
el.clientReplyForm.addEventListener('submit', async event => {
  try { await sendClientReply(event); } catch (error) { console.error(error); alert(error.message || 'No se pudo enviar el mensaje.'); }
});
el.clientAttachReply.addEventListener('click', () => el.clientReplyFiles.click());
el.closeClientChat.addEventListener('click', showForm);

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) setConnection(true, 'Servidor conectado');
});

(async function init() {
  try {
    addProduct();
    updateProgress();
    setConnection(true, 'Servidor conectado');
    const hash = location.hash;
    if (hash.startsWith('#chat=')) {
      clientConversationId = decodeURIComponent(hash.slice(6));
      localStorage.setItem(APP_CONFIG.clientConversationKey, clientConversationId);
      showClientChat();
    } else if (hash === '#inbox') {
      const token = await getAdminToken();
      if (token) await showInbox();
      else showForm();
    } else if (clientConversationId) {
      // El chat queda disponible con el botón de la ventana de confirmación.
    }
  } catch (error) {
    console.error(error);
    setConnection(false, 'Sin conexión');
  }
})();
