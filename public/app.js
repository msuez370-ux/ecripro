'use strict';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

const STATE = {
  book: { title: 'Mon ebook', author: '', subtitle: '', description: '', lang: 'fr' },
  chapters: [
    { id: 1, title: 'Avant-propos', content: '' },
    { id: 2, title: 'Chapitre 1', content: '' },
  ],
  activeChapterId: 1,
  nextChapterId: 3,
  currentPage: 0,
  pvMode: 'kindle',
  aiOpen: true,
  focusMode: false,
  isDirty: false,
  currentFilename: null,
  lang: 'fr',
  aiMessages: [],
  spellErrors: [],
};

const WORDS_TARGET        = 20000;
const WORDS_PER_KDP_PAGE  = 280;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadJSZip();
  renderChapterList();
  loadChapter(STATE.activeChapterId);
  bindKeyboard();

  // Auto-save toutes les 60 secondes
  setInterval(() => { if (STATE.isDirty) saveBook(true); }, 60000);
});

function loadJSZip() {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  document.head.appendChild(s);
}

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 's')     { e.preventDefault(); saveBook(); }
    if (mod && e.key === 'f')     { e.preventDefault(); toggleFindBar(); }
    if (e.key === 'F11')          { e.preventDefault(); toggleFocusMode(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); insertPageBreak(); }
  });
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
  });
}

// ═══════════════════════════════════════════════════════════
// CHAPITRES
// ═══════════════════════════════════════════════════════════

function renderChapterList() {
  const list = document.getElementById('chapter-list');
  list.innerHTML = STATE.chapters.map((ch, idx) => {
    const words = countWords(ch.content || '');
    return `<div class="chapter-item ${ch.id === STATE.activeChapterId ? 'active' : ''}"
                 onclick="loadChapter(${ch.id})">
      <span class="ch-num">${String(idx + 1).padStart(2,'0')}</span>
      <span class="ch-title">${esc(ch.title || 'Sans titre')}</span>
      <span class="ch-words">${words}m</span>
      ${STATE.chapters.length > 1
        ? `<button class="ch-del" onclick="event.stopPropagation();deleteChapter(${ch.id})">✕</button>`
        : ''}
    </div>`;
  }).join('');
  updateStats();
}

function loadChapter(id) {
  syncEditorToState();
  STATE.activeChapterId = id;
  STATE.currentPage = 0;
  const ch = getActive();
  if (!ch) return;
  document.getElementById('chapter-title-input').value = ch.title || '';
  document.getElementById('editor-content').innerHTML  = ch.content || '';
  renderChapterList();
  updatePreview();
  updateWordCount();
  closeSpellPanel();
}

function getActive() {
  return STATE.chapters.find(c => c.id === STATE.activeChapterId);
}

function syncEditorToState() {
  const ch = getActive();
  if (!ch) return;
  ch.title   = document.getElementById('chapter-title-input').value || '';
  ch.content = document.getElementById('editor-content').innerHTML  || '';
}

function onTitleChange() {
  const ch = getActive();
  if (ch) ch.title = document.getElementById('chapter-title-input').value;
  document.getElementById('book-title-display').textContent = ch?.title || 'Sans titre';
  renderChapterList();
  updatePreview();
  markDirty();
}

function onContentChange() {
  const ch = getActive();
  if (ch) ch.content = document.getElementById('editor-content').innerHTML;
  updatePreview();
  updateWordCount();
  markDirty();
}

function addChapter() {
  document.getElementById('new-chapter-name').value = `Chapitre ${STATE.chapters.length + 1}`;
  showModal('modal-add-chapter');
  setTimeout(() => {
    const i = document.getElementById('new-chapter-name');
    i.focus(); i.select();
  }, 80);
}

function confirmAddChapter() {
  const title = document.getElementById('new-chapter-name').value.trim()
    || `Chapitre ${STATE.chapters.length + 1}`;
  const ch = { id: STATE.nextChapterId++, title, content: '' };
  STATE.chapters.push(ch);
  closeModal('modal-add-chapter');
  renderChapterList();
  loadChapter(ch.id);
  showToast('Chapitre créé');
}

function deleteChapter(id) {
  if (STATE.chapters.length <= 1) return showToast('Impossible de supprimer le dernier chapitre');
  const ch = STATE.chapters.find(c => c.id === id);
  if (!confirm(`Supprimer "${ch?.title}" ?`)) return;
  STATE.chapters = STATE.chapters.filter(c => c.id !== id);
  if (STATE.activeChapterId === id) STATE.activeChapterId = STATE.chapters[0].id;
  renderChapterList();
  loadChapter(STATE.activeChapterId);
  markDirty();
}

// ═══════════════════════════════════════════════════════════
// ÉDITEUR
// ═══════════════════════════════════════════════════════════

function execFmt(cmd) {
  document.execCommand(cmd, false, null);
  document.getElementById('editor-content').focus();
}

function insertBlock(tag) {
  const sel   = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const el    = document.createElement(tag);
  el.textContent = sel.toString() || ' ';
  range.deleteContents();
  range.insertNode(el);
  const r = document.createRange();
  r.setStartAfter(el); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
  onContentChange();
}

function insertPageBreak() {
  const editor = document.getElementById('editor-content');
  editor.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const div   = document.createElement('div');
  div.className = 'page-break-marker';
  div.setAttribute('contenteditable', 'false');
  div.textContent = '⊞ Saut de page';
  range.deleteContents();
  range.insertNode(div);
  const p   = document.createElement('p');
  p.innerHTML = '<br>';
  div.after(p);
  const r = document.createRange();
  r.setStart(p, 0); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
  onContentChange();
  showToast('Saut de page inséré');
}

function changeFontSize(s)   { document.getElementById('editor-content').style.fontSize   = s + 'px'; }
function changeFontFamily(f) { document.getElementById('editor-content').style.fontFamily = f; }

function onEditorKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    insertPageBreak();
  }
}

function updateWordCount() {
  const ch    = getActive();
  const words = countWords(ch?.content || '');
  document.getElementById('word-count-editor').textContent = words + ' mots';
}

function countWords(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').filter(Boolean).length : 0;
}

function updateStats() {
  let total = 0;
  STATE.chapters.forEach(ch => { total += countWords(ch.content || ''); });
  const pages = Math.ceil(total / WORDS_PER_KDP_PAGE) || 0;
  document.getElementById('meta-words-total').textContent = total.toLocaleString('fr-FR');
  document.getElementById('meta-pages').textContent       = pages;
  document.getElementById('meta-chapters').textContent    = STATE.chapters.length;
  const pct = Math.min(100, (total / WORDS_TARGET) * 100);
  document.getElementById('progress-fill').style.width   = pct + '%';
  document.getElementById('progress-label').textContent  =
    `${total.toLocaleString('fr-FR')} / ${WORDS_TARGET.toLocaleString('fr-FR')} mots`;
}

// ═══════════════════════════════════════════════════════════
// CORRECTEUR ORTHOGRAPHIQUE — appel serveur /api/spellcheck
// ═══════════════════════════════════════════════════════════

async function runSpellCheck() {
  const btn    = document.getElementById('spell-btn');
  btn.textContent = '⏳';
  btn.className   = 'tb-btn spell-btn running';

  const editor = document.getElementById('editor-content');
  const text   = editor.innerText || '';
  const words  = [...new Set(
    (text.match(/[a-zA-ZÀ-ÿ\u00C0-\u024F'-]{2,}/g) || [])
  )];

  if (!words.length) {
    btn.textContent = 'abc✓';
    btn.className   = 'tb-btn spell-btn';
    showToast('Aucun texte à vérifier');
    return;
  }

  try {
    const res    = await fetch('/api/spellcheck', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ words, lang: STATE.lang }),
    });
    const result = await res.json();

    STATE.spellErrors = result.errors || [];
    btn.textContent   = STATE.spellErrors.length === 0 ? 'abc✓' : `abc✗ (${STATE.spellErrors.length})`;
    btn.className     = `tb-btn spell-btn ${STATE.spellErrors.length === 0 ? 'clean' : 'has-errors'}`;

    if (STATE.spellErrors.length === 0) {
      showToast('✓ Aucune erreur détectée');
      return;
    }

    highlightSpellErrors(editor, STATE.spellErrors, result.suggestions);
    showSpellPanel(STATE.spellErrors, result.suggestions);

  } catch (err) {
    btn.textContent = 'abc✓';
    btn.className   = 'tb-btn spell-btn';
    showToast('Erreur correcteur — serveur inaccessible');
  }
}

function highlightSpellErrors(editor, errors, suggestions) {
  // Supprimer les anciens highlights
  editor.querySelectorAll('.spell-err').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
  editor.normalize();

  const errorSet = new Set(errors.map(w => w.toLowerCase()));

  function walkText(node) {
    if (node.nodeType === 3) {
      const parts = node.textContent.split(/(\b[a-zA-ZÀ-ÿ\u00C0-\u024F'-]{2,}\b)/g);
      if (parts.length <= 1) return;
      let hasErr = false;
      const frag = document.createDocumentFragment();
      parts.forEach(part => {
        if (errorSet.has(part.toLowerCase())) {
          hasErr = true;
          const span  = document.createElement('span');
          span.className = 'spell-err';
          span.textContent = part;
          const sugs  = suggestions[part] || [];
          if (sugs.length) {
            span.title  = 'Suggestions : ' + sugs.join(', ');
            span.onclick = () => showWordMenu(span, part, sugs);
          }
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });
      if (hasErr) node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === 1 && node.tagName !== 'SPAN') {
      Array.from(node.childNodes).forEach(walkText);
    }
  }
  walkText(editor);
}

function showWordMenu(span, word, suggestions) {
  document.querySelectorAll('.spell-word-menu').forEach(m => m.remove());
  if (!suggestions.length) return;

  const menu = document.createElement('div');
  menu.className  = 'spell-word-menu';
  const rect      = span.getBoundingClientRect();
  menu.style.cssText = `position:fixed;background:white;border:1px solid #e0dbd0;
    border-radius:8px;padding:5px;z-index:999;min-width:150px;
    box-shadow:0 4px 18px rgba(0,0,0,0.14);
    top:${rect.bottom + 5}px;left:${rect.left}px;`;

  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;color:#aaa;padding:3px 8px 4px;';
  hdr.textContent   = `"${word}" →`;
  menu.appendChild(hdr);

  suggestions.slice(0, 5).forEach(sug => {
    const btn = document.createElement('div');
    btn.style.cssText = 'padding:6px 10px;font-size:13px;cursor:pointer;border-radius:5px;color:#27ae60;';
    btn.textContent   = sug;
    btn.onmouseover   = () => btn.style.background = '#f0fdf4';
    btn.onmouseleave  = () => btn.style.background = '';
    btn.onclick       = () => {
      span.replaceWith(document.createTextNode(sug));
      menu.remove();
      onContentChange();
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

function showSpellPanel(errors, suggestions) {
  const panel = document.getElementById('spell-panel');
  const list  = document.getElementById('spell-list');
  document.getElementById('spell-count-label').textContent =
    `${errors.length} erreur${errors.length > 1 ? 's' : ''} détectée${errors.length > 1 ? 's' : ''}`;

  list.innerHTML = errors.slice(0, 30).map(word => {
    const sugs = (suggestions[word] || []).slice(0, 4);
    const sugH = sugs.length
      ? sugs.map(s => `<span class="spell-sug" onclick="replaceSpellWord('${esc(word)}','${esc(s)}')">${esc(s)}</span>`).join('')
      : '<span style="color:#aaa;font-size:11px;">pas de suggestion</span>';
    return `<div class="spell-item">
      <span class="spell-word">${esc(word)}</span>
      <span class="spell-arrow">→</span>
      ${sugH}
    </div>`;
  }).join('');

  panel.style.display = 'flex';
}

function replaceSpellWord(orig, replacement) {
  const editor = document.getElementById('editor-content');
  editor.querySelectorAll('.spell-err').forEach(span => {
    if (span.textContent === orig) span.replaceWith(document.createTextNode(replacement));
  });
  onContentChange();
  STATE.spellErrors = STATE.spellErrors.filter(e => e !== orig);
  if (!STATE.spellErrors.length) {
    closeSpellPanel();
    const btn = document.getElementById('spell-btn');
    btn.textContent = 'abc✓'; btn.className = 'tb-btn spell-btn clean';
  } else {
    document.getElementById('spell-count-label').textContent = `${STATE.spellErrors.length} erreur${STATE.spellErrors.length > 1 ? 's' : ''}`;
  }
}

function closeSpellPanel() {
  document.getElementById('spell-panel').style.display = 'none';
  document.getElementById('editor-content').querySelectorAll('.spell-err').forEach(span => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
  document.getElementById('editor-content').normalize();
}

// ═══════════════════════════════════════════════════════════
// FIND / REPLACE
// ═══════════════════════════════════════════════════════════

function toggleFindBar() {
  const bar = document.getElementById('find-bar');
  if (bar.style.display === 'none') {
    bar.style.display = 'flex';
    document.getElementById('find-input').focus();
  } else {
    closeFindBar();
  }
}

function closeFindBar() {
  document.getElementById('find-bar').style.display = 'none';
}

function doFind() {
  const q = document.getElementById('find-input').value;
  if (!q) { document.getElementById('find-count').textContent = ''; return; }
  const text   = document.getElementById('editor-content').innerText;
  const regex  = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const count  = (text.match(regex) || []).length;
  document.getElementById('find-count').textContent = count ? `${count} résultat${count > 1 ? 's' : ''}` : 'Aucun résultat';
}

function doReplace() {
  const find    = document.getElementById('find-input').value;
  const replace = document.getElementById('replace-input').value;
  if (!find) return;
  const editor  = document.getElementById('editor-content');
  const regex   = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  editor.innerHTML = editor.innerHTML.replace(regex, replace);
  onContentChange(); doFind();
}

function doReplaceAll() {
  const find    = document.getElementById('find-input').value;
  const replace = document.getElementById('replace-input').value;
  if (!find) return;
  const editor  = document.getElementById('editor-content');
  const regex   = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const before  = editor.innerHTML;
  const count   = (before.match(regex) || []).length;
  editor.innerHTML = before.replace(regex, replace);
  onContentChange();
  showToast(`${count} remplacement${count > 1 ? 's' : ''} effectué${count > 1 ? 's' : ''}`);
  closeFindBar();
}

// ═══════════════════════════════════════════════════════════
// APERÇU
// ═══════════════════════════════════════════════════════════

function updatePreview() {
  const ch    = getActive();
  if (!ch) return;
  const title = ch.title || 'Sans titre';
  const html  = ch.content || '';
  const text  = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);

  // Pagination
  const pages = [];
  for (let i = 0; i < words.length; i += WORDS_PER_KDP_PAGE)
    pages.push(words.slice(i, i + WORDS_PER_KDP_PAGE).join(' '));
  if (!pages.length) pages.push('');
  const total    = pages.length;
  const pageText = pages[STATE.currentPage] || '';

  // Kindle — innerHTML pour afficher les couvertures graphiques
  const isCover = html && (html.includes('position:absolute') || html.trim().startsWith('<div style'));
  if (isCover && STATE.currentPage === 0) {
    document.getElementById('kv-title').textContent  = '';
    document.getElementById('kv-body').innerHTML     = html;
    document.getElementById('kv-body').style.padding = '0';
  } else {
    document.getElementById('kv-title').textContent  = title;
    document.getElementById('kv-body').innerHTML     = pageText
      ? '<p>' + pageText.replace(/\n/g, '</p><p>') + '</p>'
      : '<em style="color:#aaa;font-style:italic;">Commencez à écrire…</em>';
    document.getElementById('kv-body').style.padding = '';
  }
  document.getElementById('kv-page').textContent        = `${STATE.currentPage + 1} / ${total}`;
  document.getElementById('page-nav-label').textContent = `${STATE.currentPage + 1} / ${total}`;

  // A5
  document.getElementById('a5-header').textContent   = title;
  document.getElementById('a5-body').innerHTML       = pageText ? '<p>' + pageText + '</p>' : '';
  document.getElementById('a5-page-num').textContent = STATE.currentPage + 1;

  // Web
  document.getElementById('web-preview').innerHTML  =
    `<h2 style="margin-bottom:12px;">${esc(title)}</h2>${html || '<em>Commencez à écrire…</em>'}`;

  document.getElementById('book-title-display').textContent = STATE.book.title || title;
}

function setPvMode(mode, btn) {
  STATE.pvMode = mode;
  document.querySelectorAll('.pv-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pv-kindle').style.display = mode === 'kindle' ? 'block' : 'none';
  document.getElementById('pv-a5').style.display     = mode === 'a5'     ? 'block' : 'none';
  document.getElementById('pv-web').style.display    = mode === 'web'    ? 'block' : 'none';
}

function prevPage() {
  if (STATE.currentPage > 0) { STATE.currentPage--; updatePreview(); }
}

function nextPage() {
  const ch    = getActive();
  const words = countWords(ch?.content || '');
  const total = Math.max(1, Math.ceil(words / WORDS_PER_KDP_PAGE));
  if (STATE.currentPage < total - 1) { STATE.currentPage++; updatePreview(); }
}

// ═══════════════════════════════════════════════════════════
// VUES
// ═══════════════════════════════════════════════════════════

function setView(mode, btn) {
  document.querySelectorAll('.vt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const sidebar  = document.getElementById('sidebar');
  const editor   = document.getElementById('editor-pane');
  const preview  = document.getElementById('preview-pane');
  document.body.classList.remove('focus-mode');

  if (mode === 'split') {
    sidebar.style.display  = '';
    editor.style.display   = '';
    preview.style.display  = '';
    preview.style.width    = '';
  } else if (mode === 'focus') {
    toggleFocusMode();
  } else if (mode === 'preview') {
    sidebar.style.display  = 'none';
    editor.style.display   = 'none';
    preview.style.display  = '';
    preview.style.width    = '100%';
  }
}

function toggleFocusMode() {
  STATE.focusMode = !STATE.focusMode;
  document.body.classList.toggle('focus-mode', STATE.focusMode);
  if (STATE.focusMode) showToast('Mode focus — appuyez sur F11 pour quitter');
}

// ═══════════════════════════════════════════════════════════
// ASSISTANT IA
// ═══════════════════════════════════════════════════════════

function toggleAI() {
  STATE.aiOpen = !STATE.aiOpen;
  document.getElementById('ai-panel').classList.toggle('closed', !STATE.aiOpen);
  document.getElementById('btn-ai').classList.toggle('active', STATE.aiOpen);
}

function aiQuick(prompt) {
  if (!STATE.aiOpen) toggleAI();
  document.getElementById('ai-textarea').value = prompt;
  sendAI();
}

async function sendAI() {
  const textarea = document.getElementById('ai-textarea');
  const userMsg  = textarea.value.trim();
  if (!userMsg) return;
  textarea.value = '';

  syncEditorToState();
  const ch           = getActive();
  const selectedText = window.getSelection().toString().trim();
  const contextText  = selectedText
    ? `\n\n[Texte sélectionné:\n"${selectedText.slice(0, 600)}"]`
    : ch
      ? `\n\n[Chapitre: "${ch.title}"\nExtrait: ${(ch.content || '').replace(/<[^>]+>/g,' ').trim().slice(0, 500)}]`
      : '';

  const langNames = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', pt: 'portugais' };

  addAIMsg(userMsg, 'user');
  STATE.aiMessages.push({ role: 'user', content: userMsg + contextText });

  const typing = document.getElementById('ai-typing');
  typing.classList.add('show');
  scrollAI();

  try {
    const system = `Tu es un assistant d'écriture expert pour auteurs d'ebooks, spécialisé dans la publication Amazon KDP. Tu réponds en ${langNames[STATE.lang] || 'français'}. Tu es concis, bienveillant et précis. Tu aides à corriger, améliorer, expliquer, générer des idées, analyser le style et rédiger des descriptions KDP.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system,
        messages:   STATE.aiMessages.slice(-10),
      }),
    });

    const data  = await response.json();
    const reply = data.content?.map(b => b.text || '').join('') || 'Désolé, je n\'ai pas pu répondre.';
    STATE.aiMessages.push({ role: 'assistant', content: reply });
    typing.classList.remove('show');
    addAIMsg(reply, 'bot');
  } catch {
    typing.classList.remove('show');
    addAIMsg('Erreur de connexion. Vérifiez votre accès internet.', 'bot');
  }
}

function addAIMsg(text, role) {
  const c    = document.getElementById('ai-messages');
  const div  = document.createElement('div');
  div.className = `ai-msg ${role}`;
  const inner   = document.createElement('div');
  inner.className   = 'ai-msg-content';
  inner.innerHTML   = esc(text).replace(/\n/g, '<br>');
  div.appendChild(inner);
  c.appendChild(div);
  scrollAI();
}

function scrollAI() {
  const c = document.getElementById('ai-messages');
  setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50);
}

// ═══════════════════════════════════════════════════════════
// LANGUE
// ═══════════════════════════════════════════════════════════

function changeLang(val) {
  STATE.lang      = val;
  STATE.book.lang = val;
  showToast(`Langue : ${val.toUpperCase()}`);
}

// ═══════════════════════════════════════════════════════════
// SAUVEGARDE SERVEUR
// ═══════════════════════════════════════════════════════════

function markDirty() {
  STATE.isDirty = true;
  document.getElementById('unsaved-dot').classList.add('show');
}

function markClean() {
  STATE.isDirty = false;
  document.getElementById('unsaved-dot').classList.remove('show');
}

async function saveBook(silent = false) {
  syncEditorToState();

  // Générer un nom de fichier basé sur le titre
  if (!STATE.currentFilename) {
    const safe = (STATE.book.title || 'mon-ebook')
      .replace(/[^a-zA-Z0-9\sÀ-ÿ-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 40);
    STATE.currentFilename = safe + '-' + Date.now() + '.ecripro';
  }

  const data = {
    version:  '1.0',
    savedAt:  new Date().toISOString(),
    book:     STATE.book,
    chapters: STATE.chapters,
    lang:     STATE.lang,
  };

  try {
    const res = await fetch('/api/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename: STATE.currentFilename, content: JSON.stringify(data, null, 2) }),
    });
    const result = await res.json();
    if (result.ok) {
      markClean();
      if (!silent) showToast('✓ Sauvegardé sur le serveur');
    } else {
      showToast('Erreur sauvegarde : ' + result.error);
    }
  } catch {
    // Fallback : téléchargement local
    downloadText(JSON.stringify(data, null, 2), STATE.currentFilename);
    markClean();
    if (!silent) showToast('✓ Téléchargé en local (serveur indisponible)');
  }
}

// ─── Bibliothèque ─────────────────────────────────────────

async function openSavesModal() {
  showModal('modal-saves');
  const list = document.getElementById('saves-list');
  list.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px;">Chargement…</p>';

  try {
    const res   = await fetch('/api/saves');
    const saves = await res.json();

    if (!saves.length) {
      list.innerHTML = '<div class="saves-empty">Aucun livre sauvegardé pour l\'instant.<br>Écrivez et sauvegardez votre premier livre !</div>';
      return;
    }

    list.innerHTML = saves.map(s => `
      <div class="saves-item" onclick="loadSave('${esc(s.name)}')">
        <div>
          <div class="saves-item-name">${esc(s.name.replace('.ecripro','').replace(/-\d+$/,'').replace(/-/g,' '))}</div>
          <div class="saves-item-meta">${formatDate(s.modified)} · ${(s.size/1024).toFixed(1)} Ko</div>
        </div>
        <button class="saves-item-del" onclick="event.stopPropagation();deleteSave('${esc(s.name)}')" title="Supprimer">🗑</button>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<div class="saves-empty">Impossible de charger la bibliothèque</div>';
  }
}

async function loadSave(filename) {
  if (STATE.isDirty && !confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) return;
  try {
    const res    = await fetch('/api/saves/' + encodeURIComponent(filename));
    const result = await res.json();
    if (!result.ok) return showToast('Erreur : ' + result.error);
    const data   = JSON.parse(result.content);
    STATE.book           = data.book || STATE.book;
    STATE.chapters       = data.chapters || [];
    STATE.lang           = data.lang || 'fr';
    STATE.currentFilename = filename;
    STATE.activeChapterId = STATE.chapters[0]?.id || 1;
    STATE.nextChapterId   = Math.max(...STATE.chapters.map(c => c.id), 0) + 1;
    document.getElementById('lang-select').value = STATE.lang;
    document.getElementById('book-title-display').textContent = STATE.book.title || 'Sans titre';
    renderChapterList();
    loadChapter(STATE.activeChapterId);
    closeModal('modal-saves');
    markClean();
    showToast('✓ Livre chargé : ' + STATE.book.title);
  } catch (e) {
    showToast('Erreur de chargement');
  }
}

async function deleteSave(filename) {
  if (!confirm(`Supprimer "${filename}" définitivement ?`)) return;
  try {
    await fetch('/api/saves/' + encodeURIComponent(filename), { method: 'DELETE' });
    openSavesModal();
    showToast('Livre supprimé');
  } catch {
    showToast('Erreur suppression');
  }
}

function newBook() {
  if (STATE.isDirty && !confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) return;
  STATE.book            = { title: 'Mon ebook', author: '', subtitle: '', description: '', lang: 'fr' };
 STATE.chapters        = [
    { id: 1, title: 'Chapitre 1', content: '' },
  ];
  STATE.activeChapterId = 1;
  STATE.nextChapterId   = 2;;
  STATE.currentFilename = null;
  closeModal('modal-saves');
  renderChapterList();
  loadChapter(1);
  markClean();
  showToast('Nouveau livre créé');
}
// ═══════════════════════════════════════════════════════════
// IMPORT FICHIER LOCAL .ecripro
// ═══════════════════════════════════════════════════════════

function importLocalFile() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.ecripro,application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (STATE.isDirty && !confirm('Des modifications non sauvegardées seront perdues. Continuer ?')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.chapters || !Array.isArray(data.chapters)) {
          return showToast('Fichier invalide — aucun chapitre trouvé');
        }
        STATE.book            = data.book  || STATE.book;
        STATE.chapters        = data.chapters;
        STATE.lang            = data.lang  || 'fr';
        STATE.currentFilename = file.name;
        STATE.activeChapterId = STATE.chapters[0]?.id || 1;
        STATE.nextChapterId   = Math.max(...STATE.chapters.map(c => c.id), 0) + 1;
        STATE.currentPage     = 0;
        const langSel = document.getElementById('lang-select');
        if (langSel) langSel.value = STATE.lang;
        document.getElementById('book-title-display').textContent = STATE.book.title || 'Sans titre';
        renderChapterList();
        STATE.activeChapterId = STATE.chapters[0]?.id || 1;
        const firstCh = STATE.chapters[0];
        document.getElementById('chapter-title-input').value = firstCh?.title || '';
        document.getElementById('editor-content').innerHTML  = firstCh?.content || '';
        updatePreview();
        updateWordCount();
        markClean();
        showToast(`✓ "${STATE.book.title}" chargé — ${STATE.chapters.length} chapitres`);
      } catch (err) {
        showToast('Erreur lecture fichier : ' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  };
  input.click();
}
// ═══════════════════════════════════════════════════════════
// EXPORT EPUB
// ═══════════════════════════════════════════════════════════

function triggerExportEpub() {
  syncEditorToState();
  document.getElementById('exp-title').value  = STATE.book.title  || '';
  document.getElementById('exp-author').value = STATE.book.author || '';
  document.getElementById('exp-lang').value   = STATE.book.lang   || 'fr';
  document.getElementById('exp-desc').value   = STATE.book.description || '';
  showModal('modal-export');
}

async function doExportEpub() {
  const title  = document.getElementById('exp-title').value.trim()  || 'Mon ebook';
  const author = document.getElementById('exp-author').value.trim() || 'Auteur';
  const lang   = document.getElementById('exp-lang').value          || 'fr';
  const desc   = document.getElementById('exp-desc').value.trim();

  closeModal('modal-export');

  if (!window.JSZip) {
    showToast('JSZip en cours de chargement, réessayez dans quelques secondes…');
    return;
  }

  showToast('Génération EPUB en cours…');

  try {
    const blob   = await EpubBuilder.build({ title, author, lang, description: desc,
      subtitle: STATE.book.subtitle || '', chapters: STATE.chapters });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    const safe   = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    a.href       = url;
    a.download   = safe + '.epub';
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ EPUB téléchargé — prêt pour Amazon KDP !');
  } catch (err) {
    showToast('Erreur EPUB : ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// INFOS DU LIVRE
// ═══════════════════════════════════════════════════════════

function openBookSettings() {
  document.getElementById('book-meta-title').value    = STATE.book.title    || '';
  document.getElementById('book-meta-author').value   = STATE.book.author   || '';
  document.getElementById('book-meta-subtitle').value = STATE.book.subtitle || '';
  document.getElementById('book-meta-desc').value     = STATE.book.description || '';
  showModal('modal-book-settings');
}

function saveBookMeta() {
  STATE.book.title       = document.getElementById('book-meta-title').value.trim();
  STATE.book.author      = document.getElementById('book-meta-author').value.trim();
  STATE.book.subtitle    = document.getElementById('book-meta-subtitle').value.trim();
  STATE.book.description = document.getElementById('book-meta-desc').value.trim();
  document.getElementById('book-title-display').textContent = STATE.book.title || 'Sans titre';
  closeModal('modal-book-settings');
  markDirty();
  showToast('Informations mises à jour');
}

// ═══════════════════════════════════════════════════════════
// HELPERS UI
// ═══════════════════════════════════════════════════════════

function showModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function showToast(msg, duration = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), duration);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
  } catch { return dateStr; }
}
function importBook(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);

      // Vérifier que c'est un fichier valide
      if (!data.chapters || !Array.isArray(data.chapters)) {
        showToast('❌ Fichier invalide — ce n\'est pas un .ecripro');
        return;
      }

      // Charger le livre
      STATE.book           = data.book || { title: file.name, author: '', subtitle: '', description: '', lang: 'fr' };
      STATE.chapters       = data.chapters;
      STATE.lang           = data.lang || 'fr';
      STATE.currentFilename = null; // sera sauvegardé comme nouveau
      STATE.activeChapterId = STATE.chapters[0]?.id || 1;
      STATE.nextChapterId   = Math.max(...STATE.chapters.map(c => c.id), 0) + 1;

      document.getElementById('lang-select').value         = STATE.lang;
      document.getElementById('book-title-display').textContent = STATE.book.title || 'Sans titre';

      renderChapterList();
      loadChapter(STATE.activeChapterId);
      closeModal('modal-saves');
      markDirty();
      showToast('✓ Livre importé : ' + STATE.book.title + ' (' + STATE.chapters.length + ' chapitres)');

    } catch(err) {
      showToast('❌ Erreur lecture fichier : ' + err.message);
    }
  };
  reader.readAsText(file);

  // Reset l'input pour pouvoir réimporter le même fichier
  event.target.value = '';
}