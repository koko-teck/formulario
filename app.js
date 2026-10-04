/* =========================================================
   ARCHIVO: app.js
   FUNCIÓN: lógica completa de la demo.
   1) Maneja el formulario.
   2) Guarda conversaciones y archivos en IndexedDB.
   3) Construye la bandeja estilo WhatsApp.
   4) Permite responder mensajes.
   5) Permite descargar todos los archivos como ZIP.

   NOTA IMPORTANTE:
   Esta versión todavía es DEMO LOCAL. IndexedDB guarda los
   datos en el navegador de la computadora donde se usa.
   Cuando montemos el servidor, estas mismas funciones se
   reemplazarán por llamadas al backend y los archivos quedarán
   disponibles desde cualquier dispositivo.
========================================================= */

/* =========================================================
   CONFIGURACIÓN GENERAL DE LA DEMO.
========================================================= */
const APP_CONFIG = {
  dbName: 'estudioWebMensajeriaDB',
  dbVersion: 1,
  threadStore: 'threads',
  fileStore: 'files',
  adminPin: 'Marcos41001431'
};

/* =========================================================
   VARIABLES DE ESTADO DE LA INTERFAZ.
========================================================= */
let currentThreadId = null;
let allThreadsCache = [];
let productCount = 0;
let dbPromise = null;

/* =========================================================
   REFERENCIAS A LOS ELEMENTOS HTML.
========================================================= */
const el = {
  clientView: document.getElementById('clientView'),
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
  openInboxFromModal: document.getElementById('openInboxFromModal')
};

/* =========================================================
   INICIALIZA LA BASE LOCAL INDEXEDDB.
========================================================= */
function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const request = indexedDB.open(APP_CONFIG.dbName, APP_CONFIG.dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if(!db.objectStoreNames.contains(APP_CONFIG.threadStore)){
        const store = db.createObjectStore(APP_CONFIG.threadStore,{keyPath:'id'});
        store.createIndex('updatedAt','updatedAt');
      }
      if(!db.objectStoreNames.contains(APP_CONFIG.fileStore)){
        const store = db.createObjectStore(APP_CONFIG.fileStore,{keyPath:'id'});
        store.createIndex('threadId','threadId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/* =========================================================
   EJECUTA UNA OPERACIÓN READ/WRITE SOBRE UNA STORE.
========================================================= */
function dbTransaction(storeName,mode,callback){
  return openDB().then(db=>new Promise((resolve,reject)=>{
    const tx = db.transaction(storeName,mode);
    const store = tx.objectStore(storeName);
    let request = null;
    let directResult;
    try{
      directResult = callback(store);
      if(directResult && typeof directResult.onsuccess === 'object' && 'result' in directResult){
        request = directResult;
      }else if(directResult && 'onsuccess' in directResult && 'result' in directResult){
        request = directResult;
      }
    }catch(error){ reject(error); return; }

    let requestResult;
    if(request){
      request.onsuccess = () => { requestResult = request.result; };
      request.onerror = () => reject(request.error);
    }else{
      requestResult = directResult;
    }

    tx.oncomplete = () => resolve(request ? requestResult : directResult);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('La transacción fue cancelada.'));
  }));
}

/* =========================================================
   AGREGA UN PRODUCTO AL FORMULARIO.
========================================================= */
function addProduct(){
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

  /* El botón quitar elimina solamente este producto. */
  card.querySelector('.remove-button').addEventListener('click',()=>{
    card.remove();
    renumberProducts();
    updateProgress();
  });

  /* La selección de archivos activa las miniaturas. */
  const fileInput = card.querySelector('input[type=file]');
  fileInput.addEventListener('change',()=>{
    previewFiles(fileInput,card.querySelector('.preview-grid'));
    updateProgress();
  });

  /* Cada cambio de texto recalcula el porcentaje. */
  card.querySelectorAll('input:not([type=file]),textarea').forEach(input=>input.addEventListener('input',updateProgress));

  el.productsList.appendChild(card);
  renumberProducts();
  updateProgress();
}

/* =========================================================
   VUELVE A NUMERAR LOS PRODUCTOS DESPUÉS DE QUITAR UNO.
========================================================= */
function renumberProducts(){
  const cards = [...document.querySelectorAll('.product-card')];
  cards.forEach((card,index)=>{
    card.dataset.product = String(index + 1);
    card.querySelector('.product-top strong').textContent = `Producto ${index + 1}`;
  });
  productCount = cards.length;
}

/* =========================================================
   CREA PREVISUALIZACIONES LOCALES DE LOS ARCHIVOS.
========================================================= */
function previewFiles(input,target){
  target.innerHTML = '';
  [...input.files].forEach(file=>{
    const wrap = document.createElement('div');
    wrap.className = 'preview';

    if(file.type.startsWith('image/')){
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      wrap.appendChild(img);
    }else if(file.type.startsWith('video/')){
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      wrap.appendChild(video);
    }else{
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

/* =========================================================
   CALCULA EL PORCENTAJE DEL FORMULARIO.
========================================================= */
function updateProgress(){
  const fields = [...el.briefForm.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=radio]),textarea,select')]
    .filter(field=>field.name);
  const filled = fields.filter(field=>String(field.value || '').trim()).length;
  const checkboxCount = el.briefForm.querySelectorAll('input[type=checkbox]:checked').length;
  const total = fields.length + 5;
  const pct = Math.min(100,Math.round(((filled + checkboxCount) / Math.max(total,1))*100));
  el.progressFill.style.width = `${pct}%`;
  el.progressText.textContent = `${pct}% completado`;
}

/* =========================================================
   RECOGE LOS DATOS NORMALES DEL FORMULARIO.
========================================================= */
function collectFormData(){
  const formData = new FormData(el.briefForm);
  const data = {};
  const repeated = new Set(['objetivos','estilo','secciones']);

  for(const [key,value] of formData.entries()){
    if(value instanceof File) continue;
    if(repeated.has(key)){
      if(!Array.isArray(data[key])) data[key] = [];
      data[key].push(value);
    }else{
      data[key] = value;
    }
  }
  return data;
}

/* =========================================================
   LEE TODOS LOS PRODUCTOS Y SUS ARCHIVOS.
========================================================= */
function collectProducts(){
  return [...document.querySelectorAll('.product-card')].map((card,index)=>{
    const product = {numero:index+1,datos:{},files:[]};
    card.querySelectorAll('[data-key]').forEach(field=>{
      const key = field.dataset.key;
      if(field.type === 'file'){
        product.files = [...field.files].map(file=>({
          name:file.name,
          type:file.type,
          size:file.size,
          file
        }));
      }else{
        product.datos[key] = field.value;
      }
    });
    return product;
  });
}

/* =========================================================
   LEE LOS ARCHIVOS GENERALES DEL NEGOCIO.
========================================================= */
function collectBrandFiles(){
  return [...el.brandFiles.files].map(file=>({
    name:file.name,
    type:file.type,
    size:file.size,
    file
  }));
}

/* =========================================================
   CONSTRUYE UN RESUMEN LEGIBLE PARA EL CHAT.
========================================================= */
function buildBriefSummary(data,products,brandFiles){
  return {
    title:`Nuevo brief · ${data.marca || 'Cliente sin nombre'}`,
    subtitle:`${data.contacto || 'Contacto'} · ${data.rubro || 'Rubro no indicado'}`,
    preview:`${products.length} producto(s) · ${brandFiles.length} archivo(s) generales`,
    details:data,
    products:products.map(product=>({numero:product.numero,...product.datos,files:product.files.map(file=>({name:file.name,type:file.type,size:file.size}))}))
  };
}

/* =========================================================
   GUARDA UNA NUEVA CONVERSACIÓN Y SUS ARCHIVOS.
========================================================= */
async function saveNewThread(){
  const form = el.briefForm;
  if(!form.reportValidity()){
    form.querySelector(':invalid')?.scrollIntoView({behavior:'smooth',block:'center'});
    return null;
  }

  const data = collectFormData();
  const products = collectProducts();
  const brandFiles = collectBrandFiles();
  const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const createdAt = new Date().toISOString();

  const fileRecords = [];
  brandFiles.forEach(file=>fileRecords.push({
    id:`file_${crypto.randomUUID()}`,
    threadId,
    context:'general',
    name:file.name,
    type:file.type || 'application/octet-stream',
    size:file.size,
    blob:file.file
  }));
  products.forEach(product=>product.files.forEach(file=>fileRecords.push({
    id:`file_${crypto.randomUUID()}`,
    threadId,
    context:`producto_${product.numero}`,
    name:file.name,
    type:file.type || 'application/octet-stream',
    size:file.size,
    blob:file.file
  })));

  const thread = {
    id:threadId,
    createdAt,
    updatedAt:createdAt,
    unread:true,
    client:{
      name:data.contacto || data.marca || 'Cliente',
      business:data.marca || 'Negocio sin nombre',
      email:data.email || ''
    },
    messages:[
      {
        id:`msg_${crypto.randomUUID()}`,
        side:'incoming',
        kind:'brief',
        createdAt,
        text:`${data.contacto || 'El cliente'} envió un nuevo formulario de proyecto.`,
        summary:buildBriefSummary(data,products,brandFiles)
      }
    ]
  };

  await saveThread(thread);
  for(const fileRecord of fileRecords) await saveFile(fileRecord);
  return thread;
}

/* =========================================================
   GUARDA LA CONVERSACIÓN EN INDEXEDDB.
========================================================= */
function saveThread(thread){
  return dbTransaction(APP_CONFIG.threadStore,'readwrite',store=>store.put(thread));
}

/* =========================================================
   GUARDA UN ARCHIVO EN INDEXEDDB.
========================================================= */
function saveFile(file){
  return dbTransaction(APP_CONFIG.fileStore,'readwrite',store=>store.put(file));
}

/* =========================================================
   OBTIENE TODAS LAS CONVERSACIONES.
========================================================= */
function getThreads(){
  return dbTransaction(APP_CONFIG.threadStore,'readonly',store=>store.getAll()).then(threads=>threads.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)));
}

/* =========================================================
   OBTIENE LOS ARCHIVOS DE UNA CONVERSACIÓN.
========================================================= */
function getFilesByThread(threadId){
  return dbTransaction(APP_CONFIG.fileStore,'readonly',store=>{
    const index = store.index('threadId');
    return index.getAll(threadId);
  });
}

/* =========================================================
   ENCUENTRA UNA CONVERSACIÓN POR SU ID.
========================================================= */
async function getThreadById(threadId){
  return dbTransaction(APP_CONFIG.threadStore,'readonly',store=>store.get(threadId));
}

/* =========================================================
   RENDERIZA LA LISTA DE CONVERSACIONES.
========================================================= */
function renderChatList(filter=''){
  const query = filter.trim().toLowerCase();
  const visible = allThreadsCache.filter(thread=>{
    const haystack = `${thread.client.name} ${thread.client.business} ${thread.client.email}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  el.chatList.innerHTML = '';
  if(!visible.length){
    el.chatList.innerHTML = '<div class="empty-list">No hay conversaciones todavía.</div>';
    return;
  }

  visible.forEach(thread=>{
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `chat-item ${thread.id===currentThreadId ? 'active':''}`;
    const name = thread.client.name || 'Cliente';
    const initial = name.trim().charAt(0).toUpperCase() || 'C';
    const preview = thread.messages.at(-1)?.text || 'Nueva conversación';
    item.innerHTML = `
      <div class="chat-avatar">${escapeHtml(initial)}</div>
      <div class="chat-preview"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(thread.client.business || preview)}</span></div>
      <div class="chat-time">${formatListTime(thread.updatedAt)}</div>
    `;
    item.addEventListener('click',()=>openThread(thread.id));
    el.chatList.appendChild(item);
  });
}

/* =========================================================
   ABRE UNA CONVERSACIÓN EN EL PANEL DERECHO.
========================================================= */
async function openThread(threadId){
  currentThreadId = threadId;
  const thread = await getThreadById(threadId);
  if(!thread) return;

  if(thread.unread){
    thread.unread = false;
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
  }

  el.emptyChat.classList.add('hidden');
  el.activeChat.classList.remove('hidden');
  el.chatName.textContent = thread.client.name || 'Cliente';
  el.chatMeta.textContent = `${thread.client.business || 'Negocio'}${thread.client.email ? ` · ${thread.client.email}` : ''}`;
  el.chatAvatar.textContent = (thread.client.name || 'C').trim().charAt(0).toUpperCase();
  renderMessages(thread);
  allThreadsCache = await getThreads();
  renderChatList(el.chatSearch.value);
}

/* =========================================================
   RENDERIZA LOS MENSAJES DE LA CONVERSACIÓN ACTIVA.
========================================================= */
function renderMessages(thread){
  el.messageArea.innerHTML = '';
  thread.messages.forEach(message=>{
    const row = document.createElement('div');
    row.className = `message-row ${message.side==='outgoing' ? 'outgoing' : 'incoming'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if(message.kind === 'brief'){
      bubble.appendChild(buildBriefMessage(message));
    }else if(message.kind === 'file'){
      const title = document.createElement('div');
      title.className = 'bubble-title';
      title.textContent = message.text || 'Archivo adjunto';
      bubble.appendChild(title);
      (message.fileIds || []).forEach(fileId=>{
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        chip.innerHTML = `<span>📎</span><span>${escapeHtml(message.fileNames?.find(x=>x.id===fileId)?.name || 'Archivo')}</span>`;
        bubble.appendChild(chip);
      });
    }else{
      bubble.textContent = message.text || '';
    }

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = `${message.side==='outgoing' ? 'Vos · ' : ''}${formatClock(message.createdAt)}`;
    bubble.appendChild(meta);
    row.appendChild(bubble);
    el.messageArea.appendChild(row);
  });

  requestAnimationFrame(()=>{el.messageArea.scrollTop = el.messageArea.scrollHeight;});
}

/* =========================================================
   GENERA EL MENSAJE VISUAL DEL BRIEF.
========================================================= */
function buildBriefMessage(message){
  const fragment = document.createDocumentFragment();
  const summary = message.summary;

  const title = document.createElement('div');
  title.className = 'bubble-title';
  title.textContent = summary.title;
  fragment.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.style.color = 'var(--muted)';
  subtitle.style.fontSize = '11px';
  subtitle.textContent = summary.subtitle;
  fragment.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  const important = ['marca','email','rubro','publico','descripcion','canal_prioritario','logo','identidad','plazo'];
  important.forEach(key=>{
    const value = summary.details?.[key];
    if(!value) return;
    const item = document.createElement('div');
    item.className = 'detail-item';
    const small = document.createElement('small');
    small.textContent = key.replaceAll('_',' ');
    const strong = document.createElement('strong');
    strong.textContent = Array.isArray(value) ? value.join(', ') : String(value);
    item.append(small,strong);
    grid.appendChild(item);
  });
  fragment.appendChild(grid);

  const arrays = ['objetivos','estilo','secciones'];
  arrays.forEach(key=>{
    const value = summary.details?.[key];
    if(!Array.isArray(value) || !value.length) return;
    const block = document.createElement('div');
    block.className = 'detail-item';
    block.style.marginTop = '8px';
    const small = document.createElement('small');
    small.textContent = key;
    const strong = document.createElement('strong');
    strong.textContent = value.join(' · ');
    block.append(small,strong);
    fragment.appendChild(block);
  });

  if(summary.products?.length){
    const productsTitle = document.createElement('div');
    productsTitle.className = 'detail-item';
    productsTitle.style.marginTop = '8px';
    const small = document.createElement('small');
    small.textContent = 'productos';
    const strong = document.createElement('strong');
    strong.textContent = summary.products.map(p=>p.nombre).filter(Boolean).join(' · ') || `${summary.products.length} productos`;
    productsTitle.append(small,strong);
    fragment.appendChild(productsTitle);
  }

  return fragment;
}

/* =========================================================
   ENVÍA UNA RESPUESTA DE TEXTO Y/O ARCHIVOS DESDE EL CHAT.
========================================================= */
async function sendReply(event){
  event.preventDefault();
  if(!currentThreadId) return;

  const text = el.replyText.value.trim();
  const files = [...el.replyFiles.files];
  if(!text && !files.length) return;

  const thread = await getThreadById(currentThreadId);
  if(!thread) return;

  const now = new Date().toISOString();
  const message = {
    id:`msg_${crypto.randomUUID()}`,
    side:'outgoing',
    kind:files.length ? 'file' : 'text',
    createdAt:now,
    text:text || `Se adjuntaron ${files.length} archivo(s).`,
    fileIds:[],
    fileNames:[]
  };

  for(const file of files){
    const record = {
      id:`file_${crypto.randomUUID()}`,
      threadId:currentThreadId,
      context:'respuesta',
      name:file.name,
      type:file.type || 'application/octet-stream',
      size:file.size,
      blob:file
    };
    await saveFile(record);
    message.fileIds.push(record.id);
    message.fileNames.push({id:record.id,name:record.name});
  }

  thread.messages.push(message);
  thread.updatedAt = now;
  await saveThread(thread);

  el.replyText.value = '';
  el.replyFiles.value = '';
  await openThread(currentThreadId);
}

/* =========================================================
   DESCARGA TODOS LOS ARCHIVOS DEL CHAT COMO ZIP.
   Se implementa un ZIP STORE puro para evitar otra librería.
========================================================= */
async function downloadThreadZip(){
  if(!currentThreadId) return;
  const thread = await getThreadById(currentThreadId);
  const files = await getFilesByThread(currentThreadId);
  if(!thread || !files.length){
    alert('Esta conversación no tiene archivos para descargar.');
    return;
  }

  const entries = [];
  for(const file of files){
    const buffer = new Uint8Array(await file.blob.arrayBuffer());
    entries.push({
      name: `${safeSegment(thread.client.business || 'cliente')}/${safeSegment(file.context || 'archivos')}/${file.name}`,
      data: buffer,
      crc: crc32(buffer)
    });
  }

  const zip = buildZip(entries);
  const blob = new Blob([zip],{type:'application/zip'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeSegment(thread.client.business || 'cliente')}-${thread.id}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* =========================================================
   GENERA CRC32 PARA CADA ARCHIVO DEL ZIP.
========================================================= */
const CRC_TABLE = (()=>{
  const table = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c=((c&1)?(0xedb88320^(c>>>1)):(c>>>1));
    table[n]=c>>>0;
  }
  return table;
})();
function crc32(data){
  let crc = 0xffffffff;
  for(const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* =========================================================
   ESCRIBE UN ZIP SIN COMPRESIÓN, COMPATIBLE CON WINDOWS/MAC.
========================================================= */
function buildZip(entries){
  const encoder = new TextEncoder();
  const localParts=[];
  const centralParts=[];
  let offset=0;

  entries.forEach(entry=>{
    const nameBytes=encoder.encode(entry.name);
    const local=new Uint8Array(30+nameBytes.length+entry.data.length);
    const view=new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true);
    view.setUint16(4,20,true);
    view.setUint16(6,0x800,true);
    view.setUint16(8,0,true);
    view.setUint16(10,0,true);
    view.setUint16(12,0,true);
    view.setUint32(14,entry.crc,true);
    view.setUint32(18,entry.data.length,true);
    view.setUint32(22,entry.data.length,true);
    view.setUint16(26,nameBytes.length,true);
    view.setUint16(28,0,true);
    local.set(nameBytes,30);
    local.set(entry.data,30+nameBytes.length);
    localParts.push(local);

    const central=new Uint8Array(46+nameBytes.length);
    const cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);
    cv.setUint16(4,20,true);
    cv.setUint16(6,20,true);
    cv.setUint16(8,0x800,true);
    cv.setUint16(10,0,true);
    cv.setUint16(12,0,true);
    cv.setUint16(14,0,true);
    cv.setUint32(16,entry.crc,true);
    cv.setUint32(20,entry.data.length,true);
    cv.setUint32(24,entry.data.length,true);
    cv.setUint16(28,nameBytes.length,true);
    cv.setUint16(30,0,true);
    cv.setUint16(32,0,true);
    cv.setUint16(34,0,true);
    cv.setUint16(36,0,true);
    cv.setUint32(38,0,true);
    cv.setUint32(42,offset,true);
    central.set(nameBytes,46);
    centralParts.push(central);
    offset += local.length;
  });

  const centralSize=centralParts.reduce((sum,part)=>sum+part.length,0);
  const end=new Uint8Array(22);
  const ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);
  ev.setUint16(4,0,true);
  ev.setUint16(6,0,true);
  ev.setUint16(8,entries.length,true);
  ev.setUint16(10,entries.length,true);
  ev.setUint32(12,centralSize,true);
  ev.setUint32(16,offset,true);
  ev.setUint16(20,0,true);

  return concatUint8Arrays([...localParts,...centralParts,end]);
}
function concatUint8Arrays(parts){
  const total=parts.reduce((sum,part)=>sum+part.length,0);
  const out=new Uint8Array(total);
  let cursor=0;
  parts.forEach(part=>{out.set(part,cursor);cursor+=part.length;});
  return out;
}

/* =========================================================
   CONTROLA EL ACCESO AL PANEL PRIVADO CON UN PIN DE DEMO.
========================================================= */
async function openAdmin(){
  const pin = prompt('Ingresá el PIN del panel privado de DEMO:');
  if(pin !== APP_CONFIG.adminPin){
    if(pin !== null) alert('PIN incorrecto.');
    return;
  }
  await showInbox();
}

/* =========================================================
   MUESTRA LA BANDEJA Y CARGA LAS CONVERSACIONES.
========================================================= */
async function showInbox(){
  el.clientView.classList.add('hidden');
  el.inboxView.classList.remove('hidden');
  history.replaceState(null,'','#inbox');
  allThreadsCache = await getThreads();
  renderChatList(el.chatSearch.value);
}

/* =========================================================
   VUELVE A LA VISTA DEL FORMULARIO.
========================================================= */
function showForm(){
  el.inboxView.classList.add('hidden');
  el.clientView.classList.remove('hidden');
  history.replaceState(null,'','#form');
}

/* =========================================================
   ESCAPA TEXTO PARA EVITAR INYECTAR HTML EN LA BANDEJA.
========================================================= */
function escapeHtml(value){
  return String(value ?? '').replace(/[&<>'"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}

/* =========================================================
   LIMPIA NOMBRES DE ARCHIVO/CARPETAS PARA EL ZIP.
========================================================= */
function safeSegment(value){
  return String(value || 'archivo').replace(/[^a-zA-Z0-9ÁÉÍÓÚáéíóúÑñ _.-]/g,'-').replace(/\s+/g,'-').slice(0,80) || 'archivo';
}

/* =========================================================
   FORMATEA LA HORA PARA LAS BURBUJAS.
========================================================= */
function formatClock(date){
  return new Intl.DateTimeFormat('es-AR',{hour:'2-digit',minute:'2-digit'}).format(new Date(date));
}

/* =========================================================
   FORMATEA LA HORA/FECHA PARA LA LISTA DE CHATS.
========================================================= */
function formatListTime(date){
  const d=new Date(date);
  const now=new Date();
  if(d.toDateString()===now.toDateString()) return formatClock(date);
  return new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit'}).format(d);
}

/* =========================================================
   ESCUCHA EL EVENTO DE ENVÍO DEL FORMULARIO.
========================================================= */
el.briefForm.addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const thread = await saveNewThread();
    if(!thread) return;
    el.successModal.classList.remove('hidden');
    el.briefForm.reset();
    el.productsList.innerHTML='';
    productCount=0;
    el.brandPreviews.innerHTML='';
    addProduct();
    updateProgress();
  }catch(error){
    console.error(error);
    alert('No se pudo guardar el envío en esta demo local. Revisá el espacio disponible del navegador.');
  }
});

/* =========================================================
   EVENTOS DE BOTONES DE LA INTERFAZ.
========================================================= */
el.addProduct.addEventListener('click',addProduct);
el.brandFiles.addEventListener('change',()=>{
  previewFiles(el.brandFiles,el.brandPreviews);
  updateProgress();
});
el.adminButton.addEventListener('click',openAdmin);
el.backToForm.addEventListener('click',showForm);
el.chatSearch.addEventListener('input',()=>renderChatList(el.chatSearch.value));
el.replyForm.addEventListener('submit',sendReply);
el.attachReply.addEventListener('click',()=>el.replyFiles.click());
el.downloadZip.addEventListener('click',downloadThreadZip);
el.closeModal.addEventListener('click',()=>el.successModal.classList.add('hidden'));
el.openInboxFromModal.addEventListener('click',async()=>{
  el.successModal.classList.add('hidden');
  await showInbox();
  if(allThreadsCache[0]) await openThread(allThreadsCache[0].id);
});

/* =========================================================
   SINCRONIZA PESTAÑAS ABIERTAS MEDIANTE BroadcastChannel.
   Esto hace que dos pestañas del mismo navegador vean los
   cambios más rápidamente en la demo local.
========================================================= */
const syncChannel = 'BroadcastChannel' in window ? new BroadcastChannel('estudioWebSync') : null;
if(syncChannel){
  syncChannel.onmessage = async event=>{
    if(event.data?.type === 'refresh'){ 
      allThreadsCache = await getThreads();
      if(!el.inboxView.classList.contains('hidden')) renderChatList(el.chatSearch.value);
      if(currentThreadId) openThread(currentThreadId);
    }
  };
}

/* =========================================================
   INFORMA A OTRAS PESTAÑAS CUANDO CAMBIA LA INFORMACIÓN.
========================================================= */
const originalSaveThread = saveThread;
saveThread = async thread=>{
  const result = await originalSaveThread(thread);
  syncChannel?.postMessage({type:'refresh'});
  return result;
};

/* =========================================================
   INICIALIZA LA PÁGINA.
   Se crea un producto inicial y se actualiza el progreso.
========================================================= */
(async function init(){
  try{
    await openDB();
    addProduct();
    updateProgress();
    if(location.hash === '#inbox'){
      await showInbox();
    }
  }catch(error){
    console.error(error);
    alert('Este navegador no permitió inicializar la base local. Usá Chrome, Edge o Firefox actualizado.');
  }
})();
