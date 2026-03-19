/**
 * e-Fatura XSLT Düzenleyici v1.0
 * Copyright (c) 2025 Emre CIRIK
 * Tüm hakları saklıdır. İzinsiz kopyalanması ve dağıtılması yasaktır.
 */

// ---- Durum Değişkenleri ----
let currentXml = null;
let currentXmlFileName = '';
let currentXsltFileName = '';
let pendingImageType = null; // 'logo' veya 'signature'
let pendingDropCm = null;
let pendingDropPos = null;
let pendingInsideTargetLine = null; // sağ tık ile içine resim ekleme
let dropIndicatorLineHandle = null;
let selectedImageAlign = 'left';
let inspectHighlightLines = [];
let autoSaveTimer = null;
const AUTO_SAVE_KEY = 'efatura_xslt_autosave';
const AUTO_SAVE_XML_KEY = 'efatura_xml_autosave';
const AUTO_SAVE_META_KEY = 'efatura_autosave_meta';
const AUTO_SAVE_INTERVAL = 15000; // 15 saniye

// ---- CodeMirror Editörleri ----
const editorConfig = {
    mode: 'xml',
    theme: 'dracula',
    lineNumbers: true,
    lineWrapping: true,
    autoCloseTags: true,
    matchTags: { bothTags: true },
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: true
};

const cmEditor = CodeMirror.fromTextArea(document.getElementById('xsltEditor'), editorConfig);
const cmSplit = CodeMirror.fromTextArea(document.getElementById('xsltEditorSplit'), editorConfig);

// Editörleri senkronize et (undo geçmişini koruyarak)
let _syncingEditors = false;
cmEditor.on('change', () => {
    if (_syncingEditors) return;
    if (cmSplit.getValue() !== cmEditor.getValue()) {
        _syncingEditors = true;
        cmSplit.setValue(cmEditor.getValue());
        _syncingEditors = false;
    }
});
cmSplit.on('change', () => {
    if (_syncingEditors) return;
    if (cmEditor.getValue() !== cmSplit.getValue()) {
        _syncingEditors = true;
        cmEditor.setValue(cmSplit.getValue());
        _syncingEditors = false;
    }
});

// İmleç pozisyon takibi
cmEditor.on('cursorActivity', () => {
    const pos = cmEditor.getCursor();
    document.getElementById('cursorPos').textContent = `Satır: ${pos.line + 1}, Sütun: ${pos.ch + 1}`;
    // Kullanıcı imleci hareket ettirince inspect vurgusunu temizle
    if (typeof clearInspectHighlight === 'function' && inspectHighlightLines && inspectHighlightLines.length > 0) {
        clearInspectHighlight(cmEditor);
    }
});

// Varsayılan XSLT şablonunu yükle (sadece örnek XSLT seçili değilse)
if (!document.getElementById('sampleXsltSelect').value) {
    cmEditor.setValue(getDefaultXslt());
}

// ---- Örnek Dosya Yükleme ----
function loadSampleXslt(key) {
    if (!key || !SAMPLE_DATA[key]) return;
    cmEditor.setValue(SAMPLE_DATA[key]);
    currentXsltFileName = key + '.xslt';
    setStatus('Örnek XSLT yüklendi: ' + currentXsltFileName);
}

function loadSampleXml(key) {
    if (!key || !SAMPLE_DATA[key]) return;
    currentXml = SAMPLE_DATA[key];
    currentXmlFileName = key + '.xml';
    setStatus('Örnek XML yüklendi: ' + currentXmlFileName);
}

document.getElementById('sampleXsltSelect').addEventListener('change', function () {
    loadSampleXslt(this.value);
    autoPreviewIfReady();
});

document.getElementById('sampleXmlSelect').addEventListener('change', function () {
    loadSampleXml(this.value);
    autoPreviewIfReady();
});

// Sayfa yüklendiğinde: açılır menüler tarayıcı tarafından doldurulmuşsa yükle
(function initSampleFiles() {
    const xsltKey = document.getElementById('sampleXsltSelect').value;
    const xmlKey = document.getElementById('sampleXmlSelect').value;
    if (xsltKey) loadSampleXslt(xsltKey);
    if (xmlKey) loadSampleXml(xmlKey);
    if (xsltKey || xmlKey) autoPreviewIfReady();
})();

function autoPreviewIfReady() {
    if (!cmEditor.getValue().trim() || !currentXml) return;
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) return;
    const tab = activeTab.getAttribute('data-tab');
    if (tab === 'preview') doPreview('previewFrame');
    else if (tab === 'split') doPreview('previewFrameSplit');
}

// ---- Dosya Yükleme ----
document.getElementById('xsltFileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    currentXsltFileName = file.name;
    document.getElementById('sampleXsltSelect').value = '';
    const reader = new FileReader();
    reader.onload = function (ev) {
        cmEditor.setValue(ev.target.result);
        setStatus('XSLT yüklendi: ' + file.name);
    };
    reader.readAsText(file, 'UTF-8');
});

document.getElementById('xmlFileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    currentXmlFileName = file.name;
    document.getElementById('sampleXmlSelect').value = '';
    const reader = new FileReader();
    reader.onload = function (ev) {
        currentXml = ev.target.result;
        setStatus('XML yüklendi: ' + file.name);
    };
    reader.readAsText(file, 'UTF-8');
});

// ---- Araç Çubuğu Butonları ----
document.getElementById('btnNewXslt').addEventListener('click', function () {
    cmEditor.setValue(getDefaultXslt());
    currentXsltFileName = 'yeni.xslt';
    setStatus('Yeni XSLT oluşturuldu');
});

document.getElementById('btnPreview').addEventListener('click', function () {
    doPreview();
});

document.getElementById('btnSave').addEventListener('click', function () {
    const xsltContent = cmEditor.getValue();
    const blob = new Blob([xsltContent], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentXsltFileName || 'fatura.xslt';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('XSLT kaydedildi: ' + (currentXsltFileName || 'fatura.xslt'));
    // Kaydet sonrası otomatik kayıt verisini temizle
    clearAutoSave();
});

// ---- Geri Al / İleri Al ----
document.getElementById('btnUndo').addEventListener('click', function () {
    cmEditor.undo();
    cmEditor.focus();
    setTimeout(() => doPreview(), 200);
});
document.getElementById('btnRedo').addEventListener('click', function () {
    cmEditor.redo();
    cmEditor.focus();
    setTimeout(() => doPreview(), 200);
});

// ---- Otomatik Kayıt (localStorage) ----
function doAutoSave() {
    try {
        const xsltContent = cmEditor.getValue();
        if (!xsltContent || !xsltContent.trim()) return;
        localStorage.setItem(AUTO_SAVE_KEY, xsltContent);
        if (currentXml) localStorage.setItem(AUTO_SAVE_XML_KEY, currentXml);
        localStorage.setItem(AUTO_SAVE_META_KEY, JSON.stringify({
            date: new Date().toISOString(),
            xsltFile: currentXsltFileName || '',
            xmlFile: currentXmlFileName || ''
        }));
        const now = new Date();
        const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const el = document.getElementById('autoSaveStatus');
        if (el) el.textContent = '💾 ' + timeStr;
    } catch (e) {
        // localStorage dolu veya erişilemiyor
        console.warn('Otomatik kayıt başarısız:', e);
    }
}

function clearAutoSave() {
    localStorage.removeItem(AUTO_SAVE_KEY);
    localStorage.removeItem(AUTO_SAVE_XML_KEY);
    localStorage.removeItem(AUTO_SAVE_META_KEY);
    const el = document.getElementById('autoSaveStatus');
    if (el) el.textContent = '';
}

function startAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(doAutoSave, AUTO_SAVE_INTERVAL);
}

// Editör her değiştiğinde de kaydet (debounce ile)
let autoSaveDebounce = null;
cmEditor.on('change', function () {
    if (autoSaveDebounce) clearTimeout(autoSaveDebounce);
    autoSaveDebounce = setTimeout(doAutoSave, 3000);
});

// Sayfa kapatılırken son kayıt
window.addEventListener('beforeunload', function () {
    doAutoSave();
});

// Sayfa yüklendiğinde kurtarma kontrolü
(function checkAutoSaveRecovery() {
    try {
        const saved = localStorage.getItem(AUTO_SAVE_KEY);
        const metaStr = localStorage.getItem(AUTO_SAVE_META_KEY);
        if (!saved || !saved.trim()) return;
        const meta = metaStr ? JSON.parse(metaStr) : {};
        const d = meta.date ? new Date(meta.date) : null;
        const dateStr = d ? d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'Bilinmeyen tarih';
        const fileStr = meta.xsltFile ? ' — ' + meta.xsltFile : '';

        const bar = document.getElementById('recoveryBar');
        const dateEl = document.getElementById('recoveryDate');
        if (!bar) return;
        dateEl.textContent = dateStr + fileStr;
        bar.style.display = 'flex';

        document.getElementById('btnRecoveryRestore').addEventListener('click', function () {
            cmEditor.setValue(saved);
            if (meta.xsltFile) currentXsltFileName = meta.xsltFile;
            const savedXml = localStorage.getItem(AUTO_SAVE_XML_KEY);
            if (savedXml) {
                currentXml = savedXml;
                if (meta.xmlFile) currentXmlFileName = meta.xmlFile;
            }
            bar.style.display = 'none';
            setStatus('Otomatik kayıttan geri yüklendi: ' + dateStr);
            clearAutoSave();
            autoPreviewIfReady();
        });

        document.getElementById('btnRecoveryDiscard').addEventListener('click', function () {
            clearAutoSave();
            bar.style.display = 'none';
            setStatus('Otomatik kayıt silindi');
        });
    } catch (e) {
        console.warn('Kurtarma kontrolü başarısız:', e);
    }
})();

// Otomatik kayıt zamanlayıcısını başlat
startAutoSave();

// ---- Alan Kontrol Checkbox'ları ----
// Regex özel karakterlerini kaçır
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Şablon bloklarının XSLT'deki ayırt edici işaretçileri
const TEMPLATE_MARKERS = {
    'supplier-block': 'AccountingSupplierParty',
    'customer-block': 'AccountingCustomerParty',
    'invoice-header': 'Fatura Başlık',
    'invoice-lines': 'InvoiceLine',
    'tax-totals': 'TaxSubtotal',
    'notes-section': 'cbc:Note',
    'bank-accounts': 'PaymentMeans'
};

// Şablon yorum eşleştirme anahtarları (kaldırma için)
const TEMPLATE_COMMENT_KEYS = {
    'supplier-block': 'Gönderici',
    'customer-block': 'Alıcı',
    'invoice-header': 'Fatura Başlık',
    'invoice-lines': 'Fatura Kalemleri',
    'tax-totals': 'Vergi Toplamları',
    'notes-section': 'Notlar',
    'bank-accounts': 'Banka Hesap'
};

// XSLT içinde xpath alanı var mı? (bağlam doğrulamalı)
function isFieldInXslt(xpath, content) {
    if (!content || !xpath) return false;
    // Tam yol doğrudan geçiyorsa kesin var
    if (content.includes(xpath)) return true;
    const key = xpath.replace(/^n1:Invoice\//, '');
    if (content.includes(key)) return true;

    // Kısmi yol eşleşmesi: satır bazında bağlam kontrolü yap
    const parts = key.split('/');
    if (parts.length < 2) return false;

    const lines = content.split('\n');
    for (let suffLen = 1; suffLen < parts.length; suffLen++) {
        const suffix = parts.slice(suffLen).join('/');
        if (!content.includes(suffix)) continue;

        for (let i = 0; i < lines.length; i++) {
            // Çok satırlı value-of desteği: select= sonraki satırda olabilir
            const combined = getCombinedTag(lines, i);
            if (!combined.includes(suffix)) continue;
            if (!/select\s*=/.test(combined)) continue;
            if (!/value-of/.test(combined)) continue;
            if (verifyXpathContextFromLines(lines, i, xpath)) return true;
        }
    }
    return false;
}

// İki satırı birleştir (çok satırlı etiketler için)
function getCombinedTag(lines, i) {
    let text = lines[i] || '';
    // Satır '>' ile bitmiyorsa veya '/>' ile bitmiyorsa, sonraki satırı da ekle
    if (i + 1 < lines.length && !text.trim().endsWith('>')) {
        text += ' ' + (lines[i + 1] || '');
    }
    return text;
}

// Satır dizisi üzerinde for-each bağlam doğrulama
function verifyXpathContextFromLines(lines, lineNum, fullXpath) {
    const combined = getCombinedTag(lines, lineNum);
    const selectOnLine = extractSelectValue(combined);
    if (!selectOnLine) return false;

    let contextParts = [];
    let depth = 0;
    for (let i = lineNum - 1; i >= Math.max(0, lineNum - 100); i--) {
        const lt = lines[i] || '';
        if (!lt.trim()) continue;
        // for-each(?!-) deseni for-each-group'u hariç tutar
        const closes = (lt.match(/<\/xsl:for-each(?!-)/g) || []).length;
        const opens = (lt.match(/<xsl:for-each(?!-)/g) || []).length;
        depth += closes - opens;
        if (depth < 0) {
            // Çok satırlı for-each: select= sonraki satırda olabilir
            const ltCombined = getCombinedTag(lines, i);
            const feMatch = ltCombined.match(/for-each\s+select=["']([^"']+)["']/);
            if (feMatch) contextParts.unshift(feMatch[1]);
            depth = 0;
        }
    }

    const builtPath = [...contextParts, selectOnLine].join('/');
    const builtKey = builtPath.replace(/^n1:Invoice\//, '');
    const fullKey = fullXpath.replace(/^n1:Invoice\//, '');

    return builtPath === fullXpath || builtKey === fullKey ||
           fullXpath.endsWith(builtPath) || fullXpath.endsWith(builtKey) ||
           builtPath.endsWith(fullKey);
}

// XSLT içinde şablon bloğu var mı?
function isTemplateInXslt(template, content) {
    const marker = TEMPLATE_MARKERS[template];
    if (!marker) return false;
    return content.includes(marker);
}

// Checkbox'ları butonların yanına dinamik ekle
function initFieldCheckboxes() {
    document.querySelectorAll('.insert-btn[data-xpath], .insert-btn[data-template], .insert-btn[data-type]').forEach(btn => {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'field-check';
        cb.title = 'XSLT içinde mevcut';

        btn.parentElement.insertBefore(wrapper, btn);
        wrapper.appendChild(cb);
        wrapper.appendChild(btn);

        btn._fieldCheck = cb;
        cb._fieldBtn = btn;

        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('dragstart', function (e) { e.stopPropagation(); e.preventDefault(); });
        cb.addEventListener('change', function (e) {
            e.stopPropagation();
            handleFieldCheckChange(btn, this.checked);
        });
    });
}

// Tüm checkbox'ları XSLT içeriğiyle senkronize et
let _syncingCheckboxes = false;
function syncFieldCheckboxes() {
    _syncingCheckboxes = true;
    const content = cmEditor.getValue();

    document.querySelectorAll('.insert-btn[data-xpath]').forEach(btn => {
        if (btn._fieldCheck) btn._fieldCheck.checked = isFieldInXslt(btn.getAttribute('data-xpath'), content);
    });
    document.querySelectorAll('.insert-btn[data-template]').forEach(btn => {
        if (btn._fieldCheck) btn._fieldCheck.checked = isTemplateInXslt(btn.getAttribute('data-template'), content);
    });
    document.querySelectorAll('.insert-btn[data-type]').forEach(btn => {
        if (!btn._fieldCheck) return;
        const type = btn.getAttribute('data-type');
        if (type === 'logo') btn._fieldCheck.checked = content.includes('Firma Logosu');
        else if (type === 'signature') btn._fieldCheck.checked = content.includes('Firma İmzası');
    });

    _syncingCheckboxes = false;
}

// Checkbox değiştiğinde
function handleFieldCheckChange(btn, checked) {
    if (_syncingCheckboxes) return;

    if (checked) {
        // İşaretlendi → alanı ekle (buton tıklaması gibi)
        btn._fieldCheck.checked = false; // Sync düzeltecek
        btn.click();
        return;
    }

    // İşaret kaldırıldı → XSLT'den sil
    const xpath = btn.getAttribute('data-xpath');
    const template = btn.getAttribute('data-template');
    const type = btn.getAttribute('data-type');

    if (xpath) {
        removeXpathFromXslt(xpath);
    } else if (template) {
        removeTemplateFromXslt(template);
    } else if (type === 'logo' || type === 'signature') {
        removeImageFromXslt(type);
    }

    cmEditor.focus();
    setTimeout(() => {
        doPreview();
        syncFieldCheckboxes();
    }, 200);
}

// XSLT'den xpath alanını kaldır
function removeXpathFromXslt(xpath) {
    const cm = cmEditor;
    const key = xpath.replace(/^n1:Invoice\//, '');
    let removed = false;

    // Tüm olası alt yolları oluştur (tam yol, key, ve giderek kısalan sonekler)
    const parts = key.split('/');
    const candidates = [xpath, key];
    for (let i = 1; i < parts.length; i++) {
        candidates.push(parts.slice(i).join('/'));
    }

    for (let i = cm.lineCount() - 1; i >= 0; i--) {
        const line = cm.getLine(i);
        if (!line) continue;

        // Çok satırlı etiket desteği: select= sonraki satırda olabilir
        const nextLine = (i + 1 < cm.lineCount()) ? cm.getLine(i + 1) : '';
        const combined = line + ' ' + nextLine;
        const isMultiLine = !line.includes('select=') && nextLine.includes('select=') && /value-of/.test(line);

        const searchText = isMultiLine ? combined : line;
        if (!/select\s*=/.test(searchText)) continue;

        // Satırda hangi aday yolun eşleştiğini bul
        let matchedCandidate = null;
        for (const cand of candidates) {
            if (searchText.includes(cand)) { matchedCandidate = cand; break; }
        }
        if (!matchedCandidate) continue;

        // Kısmi yol ise (for-each bağlamı kontrolü gerekir)
        if (matchedCandidate !== xpath && matchedCandidate !== key) {
            if (!verifyXpathContext(cm, i, xpath)) continue;
        }

        const trimmed = line.trim();
        if (/^<xsl:value-of/.test(trimmed) || isMultiLine) {
            // value-of satırını (ve çok satırlı ise sonraki satırı da) tamamen sil
            const endLine = isMultiLine ? i + 2 : i + 1;
            cm.replaceRange('', { line: i, ch: 0 }, { line: endLine, ch: 0 });
            removed = true;
        } else {
            // Satır içinden value-of etiketini çıkar
            let newLine = line;
            for (const cand of candidates) {
                const re = new RegExp(`\\s*<xsl:value-of\\s+select=["']${escapeRegExp(cand)}["']\\s*/>`, 'g');
                newLine = newLine.replace(re, '');
            }
            if (newLine !== line) {
                if (newLine.trim() === '') {
                    cm.replaceRange('', { line: i, ch: 0 }, { line: i + 1, ch: 0 });
                } else {
                    cm.replaceRange(newLine, { line: i, ch: 0 }, { line: i, ch: line.length });
                }
                removed = true;
            }
        }
    }

    if (removed) setStatus('Alan kaldırıldı');
}

// value-of satırının for-each bağlamını doğrula (yanlış bağlamdan silmeyi önle)
function verifyXpathContext(cm, lineNum, fullXpath) {
    // Çok satırlı etiket desteği
    const line = cm.getLine(lineNum);
    const nextLine = (lineNum + 1 < cm.lineCount()) ? cm.getLine(lineNum + 1) : '';
    const combined = line + ' ' + nextLine;
    const selectOnLine = extractSelectValue(combined);
    if (!selectOnLine) return false;

    // Geriye doğru for-each select'leri topla (iç içe bağlam)
    let contextParts = [];
    let depth = 0;
    for (let i = lineNum - 1; i >= Math.max(0, lineNum - 100); i--) {
        const lt = cm.getLine(i);
        if (!lt) continue;

        // for-each(?!-) deseni for-each-group'u hariç tutar
        const closes = (lt.match(/<\/xsl:for-each(?!-)/g) || []).length;
        const opens = (lt.match(/<xsl:for-each(?!-)/g) || []).length;
        depth += closes - opens;

        if (depth < 0) {
            // Bu for-each bizi kapsıyor - select bu satırda veya sonraki satırda olabilir
            let feMatch = lt.match(/for-each\s+select=["']([^"']+)["']/);
            if (!feMatch) {
                const ltNext = (i + 1 < cm.lineCount()) ? cm.getLine(i + 1) : '';
                feMatch = (lt + ' ' + ltNext).match(/for-each\s+select=["']([^"']+)["']/);
            }
            if (feMatch) {
                contextParts.unshift(feMatch[1]);
            }
            depth = 0;
        }
    }

    // Bağlam yollarını birleştir: for-each-select + value-of-select
    const builtPath = [...contextParts, selectOnLine].join('/');
    const builtKey = builtPath.replace(/^n1:Invoice\//, '');
    const fullKey = fullXpath.replace(/^n1:Invoice\//, '');

    return builtPath === fullXpath || builtKey === fullKey ||
           fullXpath.endsWith(builtPath) || fullXpath.endsWith(builtKey) ||
           builtPath.endsWith(fullKey);
}

// select="..." değerini çıkar
function extractSelectValue(line) {
    if (!line) return null;
    const m = line.match(/select=["']([^"']+)["']/);
    return m ? m[1] : null;
}

// XSLT'den şablon bloğunu kaldır (yorum + blok)
function removeTemplateFromXslt(template) {
    const commentKey = TEMPLATE_COMMENT_KEYS[template];
    if (!commentKey) return;
    const cm = cmEditor;
    let startLine = -1;

    // Yorum satırını bul
    for (let i = 0; i < cm.lineCount(); i++) {
        const line = cm.getLine(i);
        if (line && line.includes('<!--') && line.includes(commentKey)) {
            startLine = i;
            break;
        }
    }

    if (startLine < 0) {
        // Yorum bulunamadı, marker ile blok ara
        const marker = TEMPLATE_MARKERS[template];
        for (let i = 0; i < cm.lineCount(); i++) {
            const line = cm.getLine(i);
            if (line && line.includes(marker)) {
                const range = findBlockRange(cm, i);
                cm.replaceRange('', { line: range.from, ch: 0 }, { line: range.to + 1, ch: 0 });
                setStatus('Şablon bloğu kaldırıldı');
                return;
            }
        }
        return;
    }

    // Yorumdan sonraki ilk anlamlı satırı bul
    let blockStart = startLine + 1;
    while (blockStart < cm.lineCount() && !cm.getLine(blockStart).trim()) blockStart++;
    if (blockStart >= cm.lineCount()) {
        cm.replaceRange('', { line: startLine, ch: 0 }, { line: startLine + 1, ch: 0 });
        return;
    }

    // Tüm etiketleri sayarak blok sonunu bul (xsl: dahil)
    let endLine = blockStart;
    let depth = 0;
    const openRe = /<(?!\/|!|\?)[a-zA-Z:][^>]*(?<!\/)>/g;
    const closeRe = /<\/[a-zA-Z:][^>]*>/g;

    for (let i = blockStart; i < cm.lineCount(); i++) {
        const lt = cm.getLine(i);
        depth += (lt.match(openRe) || []).length;
        depth -= (lt.match(closeRe) || []).length;
        if (depth <= 0 && i >= blockStart) {
            endLine = i;
            break;
        }
    }

    cm.replaceRange('', { line: startLine, ch: 0 }, { line: endLine + 1, ch: 0 });
    setStatus('Şablon bloğu kaldırıldı: ' + commentKey);
}

// XSLT'den logo/imza kaldır
function removeImageFromXslt(type) {
    const cm = cmEditor;
    const altText = type === 'logo' ? 'Firma Logosu' : 'Firma İmzası';

    for (let i = cm.lineCount() - 1; i >= 0; i--) {
        const line = cm.getLine(i);
        if (!line || !line.includes(altText)) continue;

        // Hizalama div'i varsa onu da sil
        if (i > 0) {
            const prevLine = cm.getLine(i - 1);
            if (prevLine && /^\s*<div\s+style=/.test(prevLine) && /text-align/.test(prevLine)) {
                const nextLine = cm.getLine(i + 1);
                if (nextLine && nextLine.trim() === '</div>') {
                    cm.replaceRange('', { line: i - 1, ch: 0 }, { line: i + 2, ch: 0 });
                    setStatus(altText + ' kaldırıldı');
                    return;
                }
            }
        }
        cm.replaceRange('', { line: i, ch: 0 }, { line: i + 1, ch: 0 });
        setStatus(altText + ' kaldırıldı');
        return;
    }
}

// Checkbox'ları başlat ve ilk senkronizasyonu yap
initFieldCheckboxes();
syncFieldCheckboxes();

// Editör değiştikçe checkbox'ları güncelle (debounce)
let checkboxSyncDebounce = null;
cmEditor.on('change', function () {
    if (checkboxSyncDebounce) clearTimeout(checkboxSyncDebounce);
    checkboxSyncDebounce = setTimeout(syncFieldCheckboxes, 500);
});

// ---- Sekme Geçişi ----
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(tab + '-view').classList.add('active');

    if (tab === 'editor') {
        setTimeout(() => cmEditor.refresh(), 10);
    } else if (tab === 'split') {
        setTimeout(() => {
            cmSplit.setValue(cmEditor.getValue());
            cmSplit.refresh();
        }, 10);
        doPreview('previewFrameSplit');
    } else if (tab === 'preview') {
        doPreview('previewFrame');
    }
}

// ---- Bölüm Aç/Kapa ----
function toggleSection(header) {
    const body = header.nextElementSibling;
    body.classList.toggle('collapsed');
    header.innerHTML = (body.classList.contains('collapsed') ? '&#9654; ' : '&#9660; ') +
        header.textContent.trim();
}

// ---- Ekleme Butonları ----
document.querySelectorAll('.insert-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        const xpath = this.getAttribute('data-xpath');
        const type = this.getAttribute('data-type');
        const template = this.getAttribute('data-template');
        const spacer = this.getAttribute('data-spacer');

        if (type === 'logo' || type === 'signature') {
            pendingImageType = type;
            pendingDropCm = null;
            pendingDropPos = null;
            openImageDialog(type);
            return;
        }

        if (template) {
            insertTemplate(template);
            return;
        }

        if (spacer) {
            insertSpacer(spacer);
            return;
        }

        if (xpath) {
            insertXpathAtCursor(xpath);
        }
    });
});

function insertXpathAtCursor(xpath) {
    const snippet = `<xsl:value-of select="${xpath}"/>`;
    const cm = getActiveCM();
    const cursor = cm.getCursor();
    cm.replaceRange(snippet, cursor);
    cm.focus();
    setStatus('XPath eklendi: ' + xpath);
    setTimeout(() => doPreview(), 200);
}

function getSpacerSnippet(height) {
    if (height === 'div') return '<div>&#160;</div>';
    return `<div style="height:${height}px;">&#160;</div>`;
}

function insertSpacer(size) {
    if (size === 'div') {
        const cm = getActiveCM();
        cm.replaceRange(getSpacerSnippet('div'), cm.getCursor());
        cm.focus();
        setStatus('Boş div eklendi');
        setTimeout(() => doPreview(), 200);
        return;
    }
    let h = parseInt(size, 10);
    if (size === 'custom' || isNaN(h)) {
        const input = prompt('Boşluk yüksekliğini piksel olarak girin:', '30');
        if (!input) return;
        h = parseInt(input, 10);
        if (isNaN(h) || h <= 0) { alert('Geçerli bir sayı girin.'); return; }
    }
    const cm = getActiveCM();
    cm.replaceRange(getSpacerSnippet(h), cm.getCursor());
    cm.focus();
    setStatus(`Boş alan eklendi (${h}px)`);
    setTimeout(() => doPreview(), 200);
}

function getActiveCM() {
    const splitView = document.getElementById('split-view');
    if (splitView.classList.contains('active')) return cmSplit;
    return cmEditor;
}

// ---- Resim Diyaloğu ----
document.getElementById('imageFileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        document.getElementById('imagePreview').src = ev.target.result;
        document.getElementById('imagePreviewContainer').style.display = 'block';
    };
    reader.readAsDataURL(file);
});

document.getElementById('btnInsertImage').addEventListener('click', function () {
    const imgSrc = document.getElementById('imagePreview').src;
    if (!imgSrc || imgSrc === window.location.href) {
        alert('Lütfen bir görsel seçin.');
        return;
    }
    const width = document.getElementById('imageWidth').value || 150;
    const height = document.getElementById('imageHeight').value || 80;

    const altText = pendingImageType === 'logo' ? 'Firma Logosu' :
                    pendingImageType === 'signature' ? 'Firma İmzası' : 'Görsel';
    const alignStyle = selectedImageAlign === 'center' ? 'text-align:center;' :
                       selectedImageAlign === 'right' ? 'text-align:right;' : '';
    let snippet = `<img src="${imgSrc}" alt="${altText}" style="width:${width}px; height:${height}px;" />`;
    if (alignStyle) {
        snippet = `<div style="${alignStyle}">${snippet}</div>`;
    }

    const cm = pendingDropCm || getActiveCM();

    // Değiştirme modu: mevcut img etiketini değiştir
    if (pendingImageType === 'replace' && pendingReplaceImageLine != null) {
        const line = pendingReplaceImageLine;
        cm.replaceRange(snippet + '\n',
            { line: line, ch: 0 },
            { line: line + 1, ch: 0 }
        );
        cm.focus();
        document.getElementById('imageDialog').style.display = 'none';
        pendingReplaceImageLine = null;
        pendingImageType = null;
        setStatus('Resim değiştirildi');
        setTimeout(() => doPreview(), 200);
        return;
    }

    // İçine ekleme modu (sağ tık menüsünden)
    if (pendingInsideTargetLine != null) {
        const insLine = pendingInsideTargetLine;
        const insertAt = ensureOpenTag(cm, insLine);
        cm.replaceRange(snippet + '\n', { line: insertAt, ch: 0 });
        cm.setCursor({ line: insertAt, ch: 0 });
        cm.focus();
        document.getElementById('imageDialog').style.display = 'none';
        pendingInsideTargetLine = null;
        pendingDropCm = null;
        pendingDropPos = null;
        setStatus(altText + ' eklendi (içine)');
        setTimeout(() => doPreview(), 200);
        return;
    }

    const pos = pendingDropPos || cm.getCursor();
    if (pendingDropPos) {
        // Sürükle-bırak: yeni satır olarak ekle
        cm.replaceRange(snippet + '\n', { line: pos.line, ch: 0 });
        cm.setCursor({ line: pos.line, ch: 0 });
    } else {
        cm.replaceRange(snippet, pos);
    }
    cm.focus();
    document.getElementById('imageDialog').style.display = 'none';
    pendingDropCm = null;
    pendingDropPos = null;
    setStatus(altText + ' eklendi');
    setTimeout(() => doPreview(), 200);
});

document.getElementById('btnCancelImage').addEventListener('click', function () {
    document.getElementById('imageDialog').style.display = 'none';
    pendingDropCm = null;
    pendingDropPos = null;
    pendingInsideTargetLine = null;
});

// ---- XSLT Önizleme ----
let inspectMode = false;
let pendingPreviewDropLine = null;

// Önizleme eşleştirmesi için HTML elementlerine data-xl (XSLT satır) nitelikleri ekle
function addLineMarkers(xsltStr) {
    const lines = xsltStr.split('\n');
    const result = [];
    let inCdata = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // CDATA blokları içindeki satırları atla (script içeriğini bozar)
        if (inCdata) {
            if (line.indexOf(']]>') !== -1) inCdata = false;
            result.push(line);
            continue;
        }
        if (line.indexOf('<![CDATA[') !== -1) {
            // Aynı satırda kapanmıyorsa CDATA moduna gir
            if (line.indexOf(']]>') === -1) inCdata = true;
            result.push(line);
            continue;
        }
        // Sadece düz HTML etiketlerini işaretle (xsl: namespace hariç)
        line = line.replace(/<(table|div|td|th|tr|p|h[1-6]|img|span|strong|hr|ul|ol|li|body)\b((?:(?!data-xl)[^>])*?)>/gi,
            (match, tag, rest) => {
                if (rest.includes('data-xl')) return match;
                return '<' + tag + ' data-xl="' + i + '"' + rest + '>';
            }
        );
        result.push(line);
    }
    return result.join('\n');
}

// Önizleme HTML'ine inspect, sürükle-bırak ve sağ tık menü için etkileşimli CSS/JS enjekte et
function getPreviewInjectionCode(frameId) {
    const css = `<style id="xl-inspect-css">
[data-xl]{transition:outline .12s,background .15s}
[data-xl].xl-hover{outline:2px solid #2196F3!important;outline-offset:1px;background:rgba(33,150,243,.06)!important;cursor:pointer}
[data-xl].xl-selected{outline:2px solid #f44336!important;outline-offset:1px;background:rgba(244,67,54,.08)!important}
.xl-drop-bar{height:3px;background:#2196F3;margin:2px 0;border-radius:2px;pointer-events:none;animation:xlp .8s infinite alternate}
@keyframes xlp{from{opacity:.5}to{opacity:1}}
[data-xl].xl-drop-preview{outline:2px dashed #4CAF50!important;outline-offset:2px;background:rgba(76,175,80,.08)!important}
.xl-ctx-menu{position:fixed;z-index:99999;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 6px 20px rgba(0,0,0,.5);font-family:sans-serif;font-size:13px;color:#cdd6f4;}
.xl-ctx-menu .xl-ctx-item{padding:7px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;}
.xl-ctx-menu .xl-ctx-item:hover{background:#313244;}
.xl-ctx-menu .xl-ctx-sep{height:1px;background:#45475a;margin:4px 0;}
.xl-ctx-menu .xl-ctx-item .xl-ctx-icon{width:16px;text-align:center;flex-shrink:0;}
.xl-ctx-sub{position:relative;}
.xl-ctx-sub>.xl-ctx-submenu{display:none;position:absolute;left:100%;top:-4px;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 6px 20px rgba(0,0,0,.5);font-family:sans-serif;font-size:13px;color:#cdd6f4;max-height:320px;overflow-y:auto;}
.xl-ctx-sub:hover>.xl-ctx-submenu{display:block;}
.xl-ctx-sub>.xl-ctx-item::after{content:'\u25B8';margin-left:auto;opacity:.6;font-size:10px;}
.xl-ctx-submenu .xl-ctx-item{padding:6px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;}
.xl-ctx-submenu .xl-ctx-item:hover{background:#313244;}
.xl-ctx-submenu .xl-ctx-sep{height:1px;background:#45475a;margin:4px 0;}
.xl-ctx-submenu .xl-ctx-item .xl-ctx-icon{width:16px;text-align:center;flex-shrink:0;}
.xl-ctx-color-swatch{width:14px;height:14px;border-radius:3px;border:1px solid #585b70;display:inline-block;vertical-align:middle;}
[data-xl].xl-dragging{opacity:.4;outline:2px dashed #f9e2af!important;}
[data-xl].xl-drag-over-top{border-top:3px solid #f9e2af!important;}
[data-xl].xl-drag-over-bottom{border-bottom:3px solid #f9e2af!important;}
[data-xl].xl-drop-inside{outline:2px dashed #4fc3f7!important;outline-offset:1px;background:rgba(79,195,247,.15)!important}
</style>`;

    const js = `<script>
(function(){
  var inspOn=false,lastH=null,selEl=null,dropBar=null,ctxMenu=null,dragSrcEl=null;
  window.addEventListener('message',function(e){
    if(!e.data||!e.data.xlAction) return;
    var a=e.data.xlAction;
    if(a==='setInspect'){
      inspOn=e.data.value;
      document.querySelectorAll('[data-xl]').forEach(function(el){el.draggable=inspOn;});
    }
    if(a==='showDropAt') showDrop(e.data.x,e.data.y);
    if(a==='clearDrop') clearDrop();
    if(a==='doDrop') doDrop(e.data.x,e.data.y,e.data.dropData);
    if(a==='highlightLine') hlLine(e.data.line);
  });

  /* ---- Sürükleyerek eleman sıralama (inspect modu) ---- */
  document.addEventListener('dragstart',function(e){
    if(!inspOn) return;
    var el=fxl(e.target);
    if(!el) return;
    dragSrcEl=el;
    el.classList.add('xl-dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',el.getAttribute('data-xl'));
  });
  document.addEventListener('dragover',function(e){
    if(!inspOn||!dragSrcEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    document.querySelectorAll('.xl-drag-over-top,.xl-drag-over-bottom').forEach(function(x){x.classList.remove('xl-drag-over-top','xl-drag-over-bottom');});
    var el=fxl(document.elementFromPoint(e.clientX,e.clientY));
    if(!el||el===dragSrcEl) return;
    var r=el.getBoundingClientRect();
    if(e.clientY<r.top+r.height/2) el.classList.add('xl-drag-over-top');
    else el.classList.add('xl-drag-over-bottom');
  });
  document.addEventListener('drop',function(e){
    if(!inspOn||!dragSrcEl) return;
    e.preventDefault();
    document.querySelectorAll('.xl-drag-over-top,.xl-drag-over-bottom,.xl-dragging').forEach(function(x){x.classList.remove('xl-drag-over-top','xl-drag-over-bottom','xl-dragging');});
    var el=fxl(document.elementFromPoint(e.clientX,e.clientY));
    if(!el||el===dragSrcEl){dragSrcEl=null;return;}
    var srcLine=parseInt(dragSrcEl.getAttribute('data-xl'));
    var tgtLine=parseInt(el.getAttribute('data-xl'));
    var r=el.getBoundingClientRect();
    var after=e.clientY>=r.top+r.height/2;
    dragSrcEl=null;
    parent.postMessage({action:'ctxMove',srcLine:srcLine,tgtLine:tgtLine,after:after,frameId:'${frameId}'},'*');
  });
  document.addEventListener('dragend',function(){
    document.querySelectorAll('.xl-drag-over-top,.xl-drag-over-bottom,.xl-dragging').forEach(function(x){x.classList.remove('xl-drag-over-top','xl-drag-over-bottom','xl-dragging');});
    dragSrcEl=null;
  });
  document.addEventListener('mousemove',function(e){
    if(!inspOn) return;
    var el=fxl(e.target);
    if(el===lastH) return;
    if(lastH) lastH.classList.remove('xl-hover');
    lastH=el;
    if(el) el.classList.add('xl-hover');
  });
  document.addEventListener('click',function(e){
    if(ctxMenu&&ctxMenu.contains(e.target)) return;
    hideCtx();
    if(!inspOn) return;
    e.preventDefault(); e.stopPropagation();
    var el=fxl(e.target);
    if(!el) return;
    if(selEl) selEl.classList.remove('xl-selected');
    selEl=el; el.classList.add('xl-selected');
    parent.postMessage({action:'inspect',line:parseInt(el.getAttribute('data-xl')),frameId:'${frameId}'},'*');
  },true);

  /* ---- Sağ Tık Menü ---- */
  document.addEventListener('contextmenu',function(e){
    e.preventDefault();
    hideCtx();
    var el=fxl(e.target);
    if(!el) return;
    var line=parseInt(el.getAttribute('data-xl'));
    var tagName=el.tagName;
    var isImg=tagName==='IMG'||!!el.querySelector('img');
    var isTable=tagName==='TABLE'||tagName==='TR'||tagName==='TD'||tagName==='TH';
    ctxMenu=document.createElement('div');
    ctxMenu.className='xl-ctx-menu';
    /* Sil */
    addItem('\\u274C','Bu Alan\\u0131 Sil',function(){parent.postMessage({action:'ctxDelete',line:line,frameId:'${frameId}'},'*');hideCtx();});
    addSep();
    /* Alan ekle */
    addItem('\\u2795','Alan Ekle',function(){parent.postMessage({action:'ctxAddField',line:line,after:true,frameId:'${frameId}'},'*');hideCtx();});
    /* Tablo ekle */
    addItem('\\u2637','Tablo Ekle',function(){parent.postMessage({action:'ctxAddTable',line:line,after:true,frameId:'${frameId}'},'*');hideCtx();});
    /* İçine ekle seçenekleri */
    addSep();
    addItem('\\u{1F5BC}','\\u0130\\u00e7ine Resim Ekle',function(){parent.postMessage({action:'ctxInsertImageInside',line:line,tag:tagName,frameId:'${frameId}'},'*');hideCtx();});
    addItem('\\u2795','\\u0130\\u00e7ine Div Ekle',function(){parent.postMessage({action:'ctxInsertDivInside',line:line,tag:tagName,frameId:'${frameId}'},'*');hideCtx();});
    /* Resim değiştir */
    if(isImg){
      addSep();
      addItem('\\u{1F5BC}','Resmi De\\u011Fi\\u015Ftir',function(){parent.postMessage({action:'ctxReplaceImage',line:line,frameId:'${frameId}'},'*');hideCtx();});
    }
    /* Tablo düzenle */
    if(isTable){
      addSep();
      addItem('\\u25A4','Tabloya Sat\\u0131r Ekle',function(){parent.postMessage({action:'ctxInsertRowInside',line:line,tag:tagName,frameId:'${frameId}'},'*');hideCtx();});
      addItem('\\u270E','Tablo \\u00D6zelliklerini D\\u00FCzenle',function(){parent.postMessage({action:'ctxEditTable',line:line,frameId:'${frameId}'},'*');hideCtx();});
    }
    /* ---- Stil Alt Menüsü ---- */
    addSep();
    var styleSub=addSub('\\u{1F3A8}','Stil');
    addSubItem(styleSub,'\\u25C0','Sola Yasla',function(){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'text-align',value:'left',frameId:'${frameId}'},'*');hideCtx();});
    addSubItem(styleSub,'\\u25AC','Ortala',function(){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'text-align',value:'center',frameId:'${frameId}'},'*');hideCtx();});
    addSubItem(styleSub,'\\u25B6','Sa\\u011Fa Yasla',function(){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'text-align',value:'right',frameId:'${frameId}'},'*');hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u2194','Geni\\u015Flik %100',function(){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'width',value:'100%',frameId:'${frameId}'},'*');hideCtx();});
    addSubItem(styleSub,'\\u{1F4CF}','Geni\\u015Flik Ayarla',function(){var v=prompt('Geni\\u015Flik de\\u011Feri (\\u00F6rn: 200px, 50%, auto):','100%');if(v){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'width',value:v,frameId:'${frameId}'},'*');}hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u{1D401}','Kal\\u0131n',function(){parent.postMessage({action:'ctxStyleToggle',line:line,tag:tagName,prop:'font-weight',value:'bold',frameId:'${frameId}'},'*');hideCtx();});
    addSubItem(styleSub,'\\u{1D43C}','\\u0130talik',function(){parent.postMessage({action:'ctxStyleToggle',line:line,tag:tagName,prop:'font-style',value:'italic',frameId:'${frameId}'},'*');hideCtx();});
    addSubItem(styleSub,'\\u0055','Alt\\u0131 \\u00C7izili',function(){parent.postMessage({action:'ctxStyleToggle',line:line,tag:tagName,prop:'text-decoration',value:'underline',frameId:'${frameId}'},'*');hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u{1F524}','Yaz\\u0131 Boyutu',function(){var v=prompt('Yaz\\u0131 boyutu (\\u00F6rn: 12px, 14pt, 1.2em):','12px');if(v){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'font-size',value:v,frameId:'${frameId}'},'*');}hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u{1F3A8}','Arka Plan Rengi',function(){pickColor(el.style.backgroundColor,function(c){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'background-color',value:c,frameId:'${frameId}'},'*');});hideCtx();});
    addSubItem(styleSub,'\\u{1F58C}','Yaz\\u0131 Rengi',function(){pickColor(el.style.color,function(c){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'color',value:c,frameId:'${frameId}'},'*');});hideCtx();});
    addSubItem(styleSub,'\\u{1F4E6}','Kenar\\u0131k Rengi',function(){pickColor('',function(c){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'border',value:'1px solid '+c,frameId:'${frameId}'},'*');});hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u21A7','\\u0130\\u00E7 Bo\\u015Fluk (padding)',function(){var v=prompt('Padding de\\u011Feri (\\u00F6rn: 4px, 8px 12px):','4px');if(v){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'padding',value:v,frameId:'${frameId}'},'*');}hideCtx();});
    addSubItem(styleSub,'\\u21A5','D\\u0131\\u015F Bo\\u015Fluk (margin)',function(){var v=prompt('Margin de\\u011Feri (\\u00F6rn: 4px, 8px 12px):','4px');if(v){parent.postMessage({action:'ctxStyle',line:line,tag:tagName,prop:'margin',value:v,frameId:'${frameId}'},'*');}hideCtx();});
    addSubSep(styleSub);
    addSubItem(styleSub,'\\u{1F6AB}','Stili Temizle',function(){parent.postMessage({action:'ctxStyleClear',line:line,tag:tagName,frameId:'${frameId}'},'*');hideCtx();});
    /* Konum */
    var px=e.clientX,py=e.clientY;
    ctxMenu.style.left=px+'px';ctxMenu.style.top=py+'px';
    document.body.appendChild(ctxMenu);
    var r=ctxMenu.getBoundingClientRect();
    if(r.right>window.innerWidth) ctxMenu.style.left=(px-r.width)+'px';
    if(r.bottom>window.innerHeight) ctxMenu.style.top=(py-r.height)+'px';
    /* submenu taşma kontrolü */
    setTimeout(function(){var subs=ctxMenu.querySelectorAll('.xl-ctx-submenu');for(var si=0;si<subs.length;si++){var sr=subs[si].getBoundingClientRect();if(sr.right>window.innerWidth){subs[si].style.left='auto';subs[si].style.right='100%';}}},0);
    function addItem(icon,text,fn){var d=document.createElement('div');d.className='xl-ctx-item';d.innerHTML='<span class=\"xl-ctx-icon\">'+icon+'</span>'+text;d.addEventListener('click',fn);ctxMenu.appendChild(d);}
    function addSep(){var d=document.createElement('div');d.className='xl-ctx-sep';ctxMenu.appendChild(d);}
    function addSub(icon,text){var wrap=document.createElement('div');wrap.className='xl-ctx-sub';var hdr=document.createElement('div');hdr.className='xl-ctx-item';hdr.innerHTML='<span class=\"xl-ctx-icon\">'+icon+'</span>'+text;wrap.appendChild(hdr);var sub=document.createElement('div');sub.className='xl-ctx-submenu';wrap.appendChild(sub);ctxMenu.appendChild(wrap);return sub;}
    function addSubItem(sub,icon,text,fn){var d=document.createElement('div');d.className='xl-ctx-item';d.innerHTML='<span class=\"xl-ctx-icon\">'+icon+'</span>'+text;d.addEventListener('click',fn);sub.appendChild(d);}
    function addSubSep(sub){var d=document.createElement('div');d.className='xl-ctx-sep';sub.appendChild(d);}
  });
  document.addEventListener('scroll',function(){hideCtx();});
  function hideCtx(){if(ctxMenu&&ctxMenu.parentNode){ctxMenu.parentNode.removeChild(ctxMenu);ctxMenu=null;}}

  /* Renk seçici yardımcısı */
  var _clrInp=document.createElement('input');_clrInp.type='color';_clrInp.style.cssText='position:fixed;opacity:0;pointer-events:none;top:0;left:0;width:0;height:0;';document.body.appendChild(_clrInp);
  function pickColor(cur,cb){_clrInp.value=cur||'#000000';_clrInp.oninput=null;_clrInp.onchange=function(){cb(_clrInp.value);};_clrInp.click();}

  /* Boş alana bırakma için en yakın data-xl elementini bul */
  function findNearestXl(x,y){
    var els=document.querySelectorAll('[data-xl]');
    if(!els.length) return null;
    var best=null,bestDist=Infinity;
    for(var i=0;i<els.length;i++){
      var r=els[i].getBoundingClientRect();
      var cy=r.top+r.height/2;
      var dist=Math.abs(y-cy);
      if(dist<bestDist){bestDist=dist;best=els[i];}
    }
    if(!best) return null;
    var br=best.getBoundingClientRect();
    return {el:best,after:y>=br.top+br.height/2};
  }
  function showDrop(x,y){
    clearDrop();
    var el=fxl(document.elementFromPoint(x,y));
    if(!el){var n=findNearestXl(x,y);if(n) el=n.el;}
    if(!el) return;
    var tag=el.tagName.toLowerCase();
    if(tag==='td'||tag==='th'){
      el.classList.add('xl-drop-inside');
      return;
    }
    el.classList.add('xl-drop-preview');
    if(!dropBar){dropBar=document.createElement('div');dropBar.className='xl-drop-bar';}
    var r=el.getBoundingClientRect();
    if(y>r.top+r.height/2){
      el.nextSibling?el.parentNode.insertBefore(dropBar,el.nextSibling):el.parentNode.appendChild(dropBar);
    } else {
      el.parentNode.insertBefore(dropBar,el);
    }
  }
  function clearDrop(){
    document.querySelectorAll('.xl-drop-preview').forEach(function(e){e.classList.remove('xl-drop-preview');});
    document.querySelectorAll('.xl-drop-inside').forEach(function(e){e.classList.remove('xl-drop-inside');});
    if(dropBar&&dropBar.parentNode) dropBar.parentNode.removeChild(dropBar);
  }
  function doDrop(x,y,dd){
    clearDrop();
    var el=fxl(document.elementFromPoint(x,y));
    var after=true;
    var inside=false;
    if(el){
      var tag=el.tagName.toLowerCase();
      if(tag==='td'||tag==='th'){
        inside=true;
      } else {
        var r=el.getBoundingClientRect();
        after=y>r.top+r.height/2;
      }
    } else {
      var n=findNearestXl(x,y);
      if(!n||!n.el){parent.postMessage({action:'dropFail',frameId:'${frameId}'},'*');return;}
      el=n.el;after=n.after;
    }
    parent.postMessage({action:'dropOk',line:parseInt(el.getAttribute('data-xl')),after:after,inside:inside,dropData:dd,frameId:'${frameId}'},'*');
  }
  function fxl(el){while(el&&el!==document.body&&el!==document.documentElement){if(el.getAttribute&&el.getAttribute('data-xl'))return el;el=el.parentElement;}return null;}
  function hlLine(ln){
    if(selEl) selEl.classList.remove('xl-selected');
    var el=document.querySelector('[data-xl="'+ln+'"]');
    if(el){selEl=el;el.classList.add('xl-selected');el.scrollIntoView({behavior:'smooth',block:'center'});}
  }
})();
<\/script>`;

    return { css, js };
}

function doPreview(frameId) {
    frameId = frameId || (document.getElementById('split-view').classList.contains('active') ? 'previewFrameSplit' : 'previewFrame');
    const frame = document.getElementById(frameId);

    const xsltStr = cmEditor.getValue();
    if (!xsltStr.trim()) {
        setStatus('XSLT içeriği boş!');
        if (frame) frame.srcdoc = '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:#888;background:#f5f5f5;"><div style="text-align:center;"><p style="font-size:48px;margin:0;">📄</p><p>XSLT içeriği boş. Lütfen bir XSLT şablonu yükleyin veya seçin.</p></div></body></html>';
        return;
    }

    if (!currentXml) {
        setStatus('Önizleme için bir XML (UBL) dosyası yükleyin.');
        if (frame) frame.srcdoc = '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:#888;background:#f5f5f5;"><div style="text-align:center;"><p style="font-size:48px;margin:0;">📋</p><p>Önizleme için bir XML (UBL) dosyası yükleyin veya seçin.</p></div></body></html>';
        return;
    }

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(currentXml, 'application/xml');
        if (xmlDoc.querySelector('parsererror')) {
            const xmlErr = xmlDoc.querySelector('parsererror').textContent;
            setStatus('XML ayrıştırma hatası!');
            frame.srcdoc = '<html><body><h2 style="color:red;">XML Ayrıştırma Hatası</h2><pre>' +
                escapeHtml(xmlErr) + '</pre></body></html>';
            return;
        }

        // Satır işaretçilerini XSLT 2.0 temizliğinden ÖNCE ekle ki data-xl değerleri editör satırlarıyla eşleşsin
        const markedXslt0 = addLineMarkers(xsltStr);

        // Tarayıcı sadece XSLT 1.0 destekler - version="2.0" kaldırılıyor
        let markedXslt = markedXslt0.replace(/version\s*=\s*"2\.0"/g, 'version="1.0"');
        // XSLT 2.0'a özgü character-map'i kaldır
        markedXslt = markedXslt.replace(/<xsl:character-map[\s\S]*?<\/xsl:character-map>/g, '');
        // use-character-maps niteliğini kaldır
        markedXslt = markedXslt.replace(/\s*use-character-maps\s*=\s*"[^"]*"/g, '');

        const xsltDoc = parser.parseFromString(markedXslt, 'application/xml');
        if (xsltDoc.querySelector('parsererror')) {
            const errorText = xsltDoc.querySelector('parsererror').textContent;
            setStatus('XSLT ayrıştırma hatası: ' + errorText.substring(0, 100));
            frame.srcdoc = '<html><body><h2 style="color:red;">XSLT Ayrıştırma Hatası</h2><pre>' +
                escapeHtml(errorText) + '</pre><hr/><h3>XSLT Kaynak:</h3><pre>' +
                escapeHtml(xsltStr.substring(0, 2000)) + '</pre></body></html>';
            return;
        }

        const processor = new XSLTProcessor();
        processor.importStylesheet(xsltDoc);
        const result = processor.transformToDocument(xmlDoc);

        const serializer = new XMLSerializer();
        let html = serializer.serializeToString(result);

        // XMLSerializer, <script> içindeki JS kodunu XML-escape yapar (&lt; &gt; vb.)
        // srcdoc HTML olarak parse edildiğinde script içeriğinin ham metin olması gerekir
        html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, function(_m, attrs, content) {
            var unescaped = content
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
            return '<script' + attrs + '>' + unescaped + '<\/script>';
        });
        // XMLSerializer'ın HTML elementlerine eklediği gereksiz xmlns niteliklerini temizle
        html = html.replace(/ xmlns=""/g, '');

        // Self-closing non-void HTML elementlerini open/close çiftine dönüştür
        // Tarayıcı HTML'de <td/> gibi etiketleri düzgün işleyemez (açık etiket olarak yorumlar)
        html = html.replace(/<(table|tbody|thead|tfoot|div|td|th|tr|p|h[1-6]|span|strong|ul|ol|li|body|a|b|i|u|em|label|section|article|header|footer|nav|main|aside|figure|figcaption)\b([^>]*)\/>/gi,
            '<$1$2></$1>');

        // Önizlemeye inspect ve sürükle-bırak etkileşimi enjekte et
        const injection = getPreviewInjectionCode(frameId);
        if (html.includes('</head>')) {
            html = html.replace('</head>', injection.css + '</head>');
        } else {
            html = injection.css + html;
        }
        if (html.includes('</body>')) {
            html = html.replace('</body>', injection.js + '</body>');
        } else {
            html += injection.js;
        }

        frame.srcdoc = html;
        frame.onload = function () {
            if (frame.contentWindow) {
                frame.contentWindow.postMessage({ xlAction: 'setInspect', value: inspectMode }, '*');
            }
        };
        setStatus('Önizleme güncellendi');
    } catch (err) {
        setStatus('Dönüştürme hatası: ' + err.message);
        frame.srcdoc = '<html><body><h2 style="color:red;">Hata</h2><pre>' +
            escapeHtml(err.message) + '</pre></body></html>';
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Şablon Ekleme ----
function getTemplateSnippet(name) {
    let snippet = '';

    switch (name) {
        case 'supplier-block':
            snippet = `
<!-- === Gönderici (Satıcı) Bilgileri === -->
<table border="0" width="100%">
  <xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
    <tr><td><strong><xsl:value-of select="cac:PartyName/cbc:Name"/></strong></td></tr>
    <tr><td><xsl:value-of select="cac:PostalAddress/cbc:StreetName"/><xsl:text> No:</xsl:text><xsl:value-of select="cac:PostalAddress/cbc:BuildingNumber"/></td></tr>
    <tr><td><xsl:value-of select="cac:PostalAddress/cbc:CitySubdivisionName"/>/<xsl:value-of select="cac:PostalAddress/cbc:CityName"/></td></tr>
    <tr><td>Vergi Dairesi: <xsl:value-of select="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/></td></tr>
    <xsl:for-each select="cac:PartyIdentification">
      <tr><td><xsl:value-of select="cbc:ID/@schemeID"/>: <xsl:value-of select="cbc:ID"/></td></tr>
    </xsl:for-each>
    <xsl:if test="cac:Contact/cbc:Telephone">
      <tr><td>Tel: <xsl:value-of select="cac:Contact/cbc:Telephone"/></td></tr>
    </xsl:if>
    <xsl:if test="cac:Contact/cbc:ElectronicMail">
      <tr><td>E-Posta: <xsl:value-of select="cac:Contact/cbc:ElectronicMail"/></td></tr>
    </xsl:if>
  </xsl:for-each>
</table>`;
            break;

        case 'customer-block':
            snippet = `
<!-- === Alıcı (Müşteri) Bilgileri === -->
<table border="0" width="100%">
  <xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
    <tr><td><strong>SAYIN</strong></td></tr>
    <tr><td>
      <xsl:choose>
        <xsl:when test="cac:PartyName"><xsl:value-of select="cac:PartyName/cbc:Name"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="cac:Person/cbc:FirstName"/><xsl:text> </xsl:text><xsl:value-of select="cac:Person/cbc:FamilyName"/></xsl:otherwise>
      </xsl:choose>
    </td></tr>
    <tr><td><xsl:value-of select="cac:PostalAddress/cbc:StreetName"/></td></tr>
    <tr><td><xsl:value-of select="cac:PostalAddress/cbc:CitySubdivisionName"/>/<xsl:value-of select="cac:PostalAddress/cbc:CityName"/></td></tr>
    <xsl:for-each select="cac:PartyIdentification">
      <tr><td><xsl:value-of select="cbc:ID/@schemeID"/>: <xsl:value-of select="cbc:ID"/></td></tr>
    </xsl:for-each>
    <xsl:if test="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name">
      <tr><td>Vergi Dairesi: <xsl:value-of select="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/></td></tr>
    </xsl:if>
  </xsl:for-each>
</table>`;
            break;

        case 'invoice-header':
            snippet = `
<!-- === Fatura Başlık Bilgileri === -->
<table border="1" cellpadding="4" cellspacing="0" width="100%">
  <tr>
    <td><strong>Fatura No</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:ID"/></td>
  </tr>
  <tr>
    <td><strong>Fatura Tarihi</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:IssueDate"/></td>
  </tr>
  <tr>
    <td><strong>Fatura Tipi</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:InvoiceTypeCode"/></td>
  </tr>
  <tr>
    <td><strong>Senaryo</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:ProfileID"/></td>
  </tr>
  <tr>
    <td><strong>ETTN</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:UUID"/></td>
  </tr>
  <tr>
    <td><strong>Para Birimi</strong></td>
    <td><xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/></td>
  </tr>
</table>`;
            break;

        case 'invoice-lines':
            snippet = `
<!-- === Fatura Kalemleri === -->
<table border="1" cellpadding="3" cellspacing="0" width="100%" style="border-collapse:collapse;">
  <tr style="background:#eee; font-weight:bold;">
    <td>#</td>
    <td>Mal/Hizmet</td>
    <td>Miktar</td>
    <td>Birim Fiyat</td>
    <td>İskonto</td>
    <td>KDV Oranı</td>
    <td>KDV Tutarı</td>
    <td>Tutar</td>
  </tr>
  <xsl:for-each select="n1:Invoice/cac:InvoiceLine">
    <tr>
      <td><xsl:value-of select="cbc:ID"/></td>
      <td><xsl:value-of select="cac:Item/cbc:Name"/></td>
      <td><xsl:value-of select="cbc:InvoicedQuantity"/><xsl:text> </xsl:text><xsl:value-of select="cbc:InvoicedQuantity/@unitCode"/></td>
      <td><xsl:value-of select="cac:Price/cbc:PriceAmount"/></td>
      <td>
        <xsl:for-each select="cac:AllowanceCharge[cbc:ChargeIndicator='false']">
          <xsl:value-of select="cbc:Amount"/>
        </xsl:for-each>
      </td>
      <td>%<xsl:value-of select="cac:TaxTotal/cac:TaxSubtotal/cbc:Percent"/></td>
      <td><xsl:value-of select="cac:TaxTotal/cbc:TaxAmount"/></td>
      <td><xsl:value-of select="cbc:LineExtensionAmount"/></td>
    </tr>
  </xsl:for-each>
</table>`;
            break;

        case 'tax-totals':
            snippet = `
<!-- === Vergi Toplamları === -->
<table border="1" cellpadding="3" cellspacing="0" style="border-collapse:collapse; float:right; width:40%;">
  <xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
    <tr>
      <td><xsl:value-of select="cac:TaxCategory/cac:TaxScheme/cbc:Name"/>
        <xsl:if test="cbc:Percent"> (%<xsl:value-of select="cbc:Percent"/>)</xsl:if>
      </td>
      <td style="text-align:right;"><xsl:value-of select="cbc:TaxAmount"/></td>
    </tr>
  </xsl:for-each>
  <tr style="font-weight:bold;">
    <td>Mal/Hizmet Toplamı</td>
    <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount"/></td>
  </tr>
  <tr style="font-weight:bold;">
    <td>Vergiler Dahil Toplam</td>
    <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"/></td>
  </tr>
  <tr style="font-weight:bold; font-size:1.1em;">
    <td>Ödenecek Tutar</td>
    <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount"/></td>
  </tr>
</table>`;
            break;

        case 'notes-section':
            snippet = `
<!-- === Notlar === -->
<xsl:if test="n1:Invoice/cbc:Note">
  <table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse; margin-top:10px;">
    <tr style="background:#eee;"><td><strong>Notlar</strong></td></tr>
    <xsl:for-each select="n1:Invoice/cbc:Note">
      <tr><td><xsl:value-of select="."/></td></tr>
    </xsl:for-each>
  </table>
</xsl:if>`;
            break;

        case 'bank-accounts':
            snippet = `
<!-- === Banka Hesap Bilgileri === -->
<xsl:if test="n1:Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount">
  <table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse; margin-top:10px;">
    <tr style="background:#eee; font-weight:bold;">
      <td>Banka</td>
      <td>Şube</td>
      <td>IBAN</td>
      <td>Hesap No</td>
      <td>Para Birimi</td>
    </tr>
    <xsl:for-each select="n1:Invoice/cac:PaymentMeans">
      <tr>
        <td><xsl:value-of select="cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cac:FinancialInstitution/cbc:Name"/></td>
        <td><xsl:value-of select="cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:Name"/></td>
        <td><xsl:value-of select="cac:PayeeFinancialAccount/cbc:ID"/></td>
        <td><xsl:value-of select="cbc:PaymentMeansCode"/></td>
        <td><xsl:value-of select="cac:PayeeFinancialAccount/cbc:CurrencyCode"/></td>
      </tr>
    </xsl:for-each>
  </table>
</xsl:if>`;
            break;
    }

    return snippet;
}

function insertTemplate(name) {
    const cm = getActiveCM();
    const snippet = getTemplateSnippet(name);
    if (snippet) {
        cm.replaceRange(snippet, cm.getCursor());
        cm.focus();
        setStatus('Şablon eklendi: ' + name);
        setTimeout(() => doPreview(), 200);
    }
}

// ---- Durum Çubuğu ----
function setStatus(msg) {
    document.getElementById('statusText').textContent = msg;
}

// ---- Sürükle Bırak ----
(function initDragDrop() {
    document.querySelectorAll('.insert-btn').forEach(btn => {
        btn.setAttribute('draggable', 'true');
        btn.addEventListener('dragstart', function (e) {
            const data = {};
            if (this.dataset.xpath) { data.type = 'xpath'; data.value = this.dataset.xpath; data.label = this.textContent.trim(); }
            else if (this.dataset.template) { data.type = 'template'; data.value = this.dataset.template; data.label = this.textContent.trim(); }
            else if (this.dataset.spacer) { data.type = 'spacer'; data.value = this.dataset.spacer; data.label = this.textContent.trim(); }
            else if (this.dataset.type) { data.type = this.dataset.type; data.label = this.textContent.trim(); }
            else return;

            e.dataTransfer.setData('text/plain', JSON.stringify(data));
            e.dataTransfer.effectAllowed = 'copy';
            this.classList.add('dragging');
            document.querySelectorAll('.CodeMirror').forEach(el => el.classList.add('cm-awaiting-drop'));
        });

        btn.addEventListener('dragend', function () {
            this.classList.remove('dragging');
            document.querySelectorAll('.CodeMirror').forEach(el => el.classList.remove('cm-awaiting-drop', 'cm-drop-target'));
            clearDropIndicator();
        });
    });

    function setupCmDropZone(cm) {
        const wrap = cm.getWrapperElement();

        wrap.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            wrap.classList.add('cm-drop-target');
            wrap.classList.remove('cm-awaiting-drop');
            const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
            cm.setCursor(pos);
            showDropIndicator(cm, pos.line);
        });

        wrap.addEventListener('dragleave', function () {
            wrap.classList.remove('cm-drop-target');
            clearDropIndicator();
        });

        wrap.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            wrap.classList.remove('cm-drop-target');
            clearDropIndicator();

            const raw = e.dataTransfer.getData('text/plain');
            if (!raw) return;
            let data;
            try { data = JSON.parse(raw); } catch { return; }

            const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');

            if (data.type === 'xpath') {
                const snippet = `<xsl:value-of select="${data.value}"/>`;
                cm.replaceRange(snippet, pos);
                cm.focus();
                setStatus('Sürükle-bırak ile eklendi: ' + (data.label || ''));
                setTimeout(() => doPreview(), 200);
            } else if (data.type === 'template') {
                const snippet = getTemplateSnippet(data.value);
                if (snippet) {
                    cm.replaceRange(snippet, pos);
                    cm.focus();
                    setStatus('Şablon sürükle-bırak ile eklendi: ' + (data.label || data.value));
                    setTimeout(() => doPreview(), 200);
                }
            } else if (data.type === 'logo' || data.type === 'signature') {
                pendingImageType = data.type;
                pendingDropCm = cm;
                pendingDropPos = pos;
                openImageDialog(data.type);
            } else if (data.type === 'spacer') {
                if (data.value === 'div') {
                    cm.replaceRange(getSpacerSnippet('div'), pos);
                    cm.focus();
                    setStatus('Boş div sürükle-bırak ile eklendi');
                    setTimeout(() => doPreview(), 200);
                    return;
                }
                let h = parseInt(data.value, 10);
                if (data.value === 'custom' || isNaN(h)) {
                    const input = prompt('Boşluk yüksekliğini piksel olarak girin:', '30');
                    if (!input) return;
                    h = parseInt(input, 10);
                    if (isNaN(h) || h <= 0) return;
                }
                cm.replaceRange(getSpacerSnippet(h), pos);
                cm.focus();
                setStatus(`Boş alan sürükle-bırak ile eklendi (${h}px)`);
                setTimeout(() => doPreview(), 200);
            }
        });
    }

    setupCmDropZone(cmEditor);
    setupCmDropZone(cmSplit);
})();

function showDropIndicator(cm, line) {
    clearDropIndicator();
    dropIndicatorLineHandle = cm.addLineClass(line, 'wrap', 'cm-drop-line');
}

function clearDropIndicator() {
    if (dropIndicatorLineHandle != null) {
        cmEditor.removeLineClass(dropIndicatorLineHandle, 'wrap', 'cm-drop-line');
        cmSplit.removeLineClass(dropIndicatorLineHandle, 'wrap', 'cm-drop-line');
        dropIndicatorLineHandle = null;
    }
}

function openImageDialog(type) {
    document.getElementById('imageDialogTitle').textContent =
        type === 'logo' ? 'Firma Logosu Yükle' : 'Firma İmzası Yükle';
    document.getElementById('imageDialog').style.display = 'flex';
    document.getElementById('imagePreviewContainer').style.display = 'none';
    document.getElementById('imageFileInput').value = '';
    selectedImageAlign = 'left';
    document.querySelectorAll('.align-btn').forEach(b => b.classList.toggle('active', b.dataset.align === 'left'));
}

// ---- Hizalama Seçici ----
document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        selectedImageAlign = this.dataset.align;
        document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    });
});

// ---- Düzen Rehberi ----
document.getElementById('btnLayoutGuide').addEventListener('click', function () {
    document.getElementById('layoutGuide').style.display = 'flex';
});

document.getElementById('btnCloseGuide').addEventListener('click', function () {
    document.getElementById('layoutGuide').style.display = 'none';
});

document.getElementById('layoutGuide').addEventListener('click', function (e) {
    if (e.target === this) this.style.display = 'none';
});

document.querySelectorAll('[data-guide-tpl]').forEach(cell => {
    cell.addEventListener('click', function () {
        const tplName = this.dataset.guideTpl;
        insertTemplate(tplName);
        document.getElementById('layoutGuide').style.display = 'none';
    });
});

document.querySelectorAll('[data-guide-action]').forEach(cell => {
    cell.addEventListener('click', function () {
        const action = this.dataset.guideAction;
        document.getElementById('layoutGuide').style.display = 'none';
        if (action === 'logo' || action === 'signature') {
            pendingImageType = action;
            pendingDropCm = null;
            pendingDropPos = null;
            openImageDialog(action);
        }
    });
});

// ---- İnceleme Modu Açma/Kapama ----
document.getElementById('btnInspect').addEventListener('click', function () {
    inspectMode = !inspectMode;
    this.classList.toggle('active', inspectMode);
    ['previewFrame', 'previewFrameSplit'].forEach(fid => {
        const f = document.getElementById(fid);
        if (f && f.contentWindow) {
            f.contentWindow.postMessage({ xlAction: 'setInspect', value: inspectMode }, '*');
        }
    });
    setStatus(inspectMode ? 'Inspect modu açık — Önizlemede bir elemana tıklayın' : 'Inspect modu kapatıldı');
});

// ---- Önizleme iframe'lerinden gelen mesajlar ----
window.addEventListener('message', function (e) {
    if (!e.data || !e.data.action) return;

    if (e.data.action === 'inspect') {
        const line = e.data.line;
        // Kullanıcı hem editörü hem önizlemeyi görsün diye bölünmüş görünüme geç
        const currentTab = document.querySelector('.tab.active');
        if (currentTab && currentTab.dataset.tab === 'preview') {
            switchTab('split');
        }
        const cm = getActiveCM();
        // Açılış etiketinden kapanış etiketine kadar tüm bloğu seç
        const blockRange = findBlockRange(cm, line);
        // Önceki inspect vurgularını temizle
        clearInspectHighlight(cm);
        // Tüm bloğu satır işaretleriyle vurgula
        inspectHighlightLines = [];
        for (let i = blockRange.from; i <= blockRange.to; i++) {
            inspectHighlightLines.push(cm.addLineClass(i, 'wrap', 'cm-inspect-line'));
        }
        cm.setCursor({ line: blockRange.from, ch: 0 });
        cm.scrollIntoView({ line: blockRange.from, ch: 0 }, 100);
        cm.setSelection(
            { line: blockRange.from, ch: 0 },
            { line: blockRange.to, ch: cm.getLine(blockRange.to).length }
        );
        cm.focus();
        setStatus('Editörde satır ' + (blockRange.from + 1) + '-' + (blockRange.to + 1) + ' seçildi (Inspect)');
    }

    if (e.data.action === 'dropOk') {
        handlePreviewDrop(e.data.line, e.data.after, e.data.dropData, e.data.inside);
    }

    // ---- Sağ tık menü: Eleman sil ----
    if (e.data.action === 'ctxDelete') {
        const line = e.data.line;
        const range = findBlockRange(cmEditor, line);
        cmEditor.replaceRange('', { line: range.from, ch: 0 }, { line: range.to + 1, ch: 0 });
        cmEditor.focus();
        setStatus('Satır ' + (range.from + 1) + '-' + (range.to + 1) + ' silindi');
        setTimeout(() => doPreview(), 200);
    }

    // ---- Sağ tık menü: Konuma alan ekle ----
    if (e.data.action === 'ctxAddField') {
        pendingCtxInsertLine = e.data.line;
        pendingCtxInsertAfter = e.data.after;
        document.getElementById('fieldPickerDialog').style.display = 'flex';
    }

    // ---- Sağ tık menü: Tablo ekle ----
    if (e.data.action === 'ctxAddTable') {
        pendingCtxInsertLine = e.data.line;
        pendingCtxInsertAfter = e.data.after;
        document.getElementById('tableDialog').style.display = 'flex';
    }

    // ---- Sağ tık menü: Resim değiştir ----
    if (e.data.action === 'ctxReplaceImage') {
        pendingReplaceImageLine = e.data.line;
        openImageReplaceDialog(e.data.line);
    }

    // ---- Sağ tık menü: İçine resim ekle ----
    if (e.data.action === 'ctxInsertImageInside') {
        pendingImageType = 'logo';
        pendingDropCm = cmEditor;
        pendingInsideTargetLine = resolveTagLine(cmEditor, e.data.line, e.data.tag);
        openImageDialog('logo');
    }

    // ---- Sağ tık menü: İçine div ekle ----
    if (e.data.action === 'ctxInsertDivInside') {
        const cm = cmEditor;
        const line = resolveTagLine(cm, e.data.line, e.data.tag);
        const lineText = cm.getLine(line) || '';
        // Self-closing etiketi aç, içine div ekle
        const insertLine = ensureOpenTag(cm, line);
        const indent = lineText.match(/^(\s*)/)[1] + '\t';
        const snippet = indent + '<div style="">\u00a0</div>';
        cm.replaceRange(snippet + '\n', { line: insertLine, ch: 0 });
        cm.setCursor({ line: insertLine, ch: 0 });
        cm.focus();
        setStatus('Div eklendi (satır ' + (line + 2) + ')');
        setTimeout(() => doPreview(), 200);
    }

    // ---- Sağ tık menü: Tabloya satır ekle ----
    if (e.data.action === 'ctxInsertRowInside') {
        const cm = cmEditor;
        const line = resolveTagLine(cm, e.data.line, e.data.tag);
        const lineText = cm.getLine(line) || '';
        const tag = lineText.trim().toLowerCase();
        // Hedef table, tbody veya tr satırını bul
        let tableOpenLine = line;
        // Eğer td/th ise, tr'yi bul; tr ise, orada kal; table ise tbody/table aç
        if (tag.startsWith('<td') || tag.startsWith('<th')) {
            // tr'nin açılış satırını bul (yukarı git)
            for (let i = line - 1; i >= 0; i--) {
                if (cm.getLine(i).trim().toLowerCase().startsWith('<tr')) { tableOpenLine = i; break; }
            }
        } else if (tag.startsWith('<tr')) {
            tableOpenLine = line;
        } else if (tag.startsWith('<table') || tag.startsWith('<tbody')) {
            tableOpenLine = line;
        }
        // Mevcut tr bloğunun kapanışını bul ve sonrasına yeni tr ekle
        const range = findBlockRange(cm, tableOpenLine);
        const insertAt = range.to + 1;
        // Mevcut tr içindeki td sayısını say
        let tdCount = 0;
        for (let i = range.from; i <= range.to; i++) {
            const lt = cm.getLine(i) || '';
            const tds = lt.match(/<(td|th)\b/gi);
            if (tds) tdCount += tds.length;
        }
        if (tdCount < 1) tdCount = 1;
        const indent = lineText.match(/^(\s*)/)[1];
        let rowSnippet = indent + '<tr>\n';
        for (let c = 0; c < tdCount; c++) {
            rowSnippet += indent + '\t<td>\u00a0</td>\n';
        }
        rowSnippet += indent + '</tr>';
        cm.replaceRange(rowSnippet + '\n', { line: insertAt, ch: 0 });
        cm.setCursor({ line: insertAt, ch: 0 });
        cm.focus();
        setStatus('Tabloya yeni satır eklendi (satır ' + (insertAt + 1) + ')');
        setTimeout(() => doPreview(), 200);
    }

    // ---- Sağ tık menü: Tablo özelliklerini düzenle ----
    if (e.data.action === 'ctxEditTable') {
        pendingTableEditLine = e.data.line;
        openTableEditDialog(e.data.line);
    }

    // ---- Sağ tık menü: Stil uygula ----
    if (e.data.action === 'ctxStyle') {
        const cm = cmEditor;
        const line = resolveTagLine(cm, e.data.line, e.data.tag);
        modifyStyleAttr(cm, line, e.data.prop, e.data.value);
        cm.focus();
        setStatus('Stil güncellendi: ' + e.data.prop + ': ' + e.data.value);
        setTimeout(() => doPreview(), 200);
    }

    // ---- Sağ tık menü: Stil toggle (kalın/italik/altı çizili) ----
    if (e.data.action === 'ctxStyleToggle') {
        const cm = cmEditor;
        const line = resolveTagLine(cm, e.data.line, e.data.tag);
        const lineText = cm.getLine(line) || '';
        const styleMatch = lineText.match(/style\s*=\s*"([^"]*)"/i);
        const currentStyle = styleMatch ? styleMatch[1] : '';
        // Eğer zaten bu değer varsa, kaldır
        const prop = e.data.prop;
        const val = e.data.value;
        const re = new RegExp(prop.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*' + val.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
        if (re.test(currentStyle)) {
            // Kaldır
            modifyStyleAttr(cm, line, prop, null);
            setStatus('Stil kaldırıldı: ' + prop);
        } else {
            modifyStyleAttr(cm, line, prop, val);
            setStatus('Stil uygulandı: ' + prop + ': ' + val);
        }
        cm.focus();
        setTimeout(() => doPreview(), 200);
    }

    // ---- Sağ tık menü: Stili temizle ----
    if (e.data.action === 'ctxStyleClear') {
        const cm = cmEditor;
        const line = resolveTagLine(cm, e.data.line, e.data.tag);
        const lineText = cm.getLine(line) || '';
        // style="..." attribute'unu tamamen kaldır
        const newText = lineText.replace(/\s*style\s*=\s*"[^"]*"/gi, '');
        if (newText !== lineText) {
            cm.replaceRange(newText, { line: line, ch: 0 }, { line: line, ch: lineText.length });
        }
        cm.focus();
        setStatus('Stil temizlendi');
        setTimeout(() => doPreview(), 200);
    }

    // ---- Eleman sıralama: bloğu srcLine'dan tgtLine'a taşı ----
    if (e.data.action === 'ctxMove') {
        const srcRange = findBlockRange(cmEditor, e.data.srcLine);
        const tgtRange = findBlockRange(cmEditor, e.data.tgtLine);

        // Kaynak blok metnini al
        const srcText = cmEditor.getRange(
            { line: srcRange.from, ch: 0 },
            { line: srcRange.to + 1, ch: 0 }
        );

        // Ekleme noktasını belirle (hedef bloğun önüne veya arkasına)
        let insertLine = e.data.after ? tgtRange.to + 1 : tgtRange.from;

        // Önce kaynak bloğu sil, kaynak hedeften önceyse ekleme satırını ayarla
        cmEditor.operation(function () {
            // Kaynak hedeften önceyse, kaynağı silince hedef yukarı kayar
            if (srcRange.from < insertLine) {
                const removedLines = srcRange.to - srcRange.from + 1;
                cmEditor.replaceRange('', { line: srcRange.from, ch: 0 }, { line: srcRange.to + 1, ch: 0 });
                insertLine -= removedLines;
            } else {
                // Kaynak hedeften sonraysa, kaynağı sil sonra ekle
                cmEditor.replaceRange('', { line: srcRange.from, ch: 0 }, { line: srcRange.to + 1, ch: 0 });
            }
            cmEditor.replaceRange(srcText, { line: insertLine, ch: 0 });
        });

        cmEditor.setCursor({ line: insertLine, ch: 0 });
        cmEditor.focus();
        setStatus('Eleman taşındı: satır ' + (srcRange.from + 1) + ' → ' + (insertLine + 1));
        setTimeout(() => doPreview(), 200);
    }
});

// ---- XSLT kaynağında style attribute'u düzenleme yardımcısı ----
// value=null ise ilgili özelliği kaldırır
function modifyStyleAttr(cm, line, prop, value) {
    const lineText = cm.getLine(line);
    if (!lineText) return;

    // Mevcut style attribute'unu bul
    const styleMatch = lineText.match(/style\s*=\s*"([^"]*)"/i);

    if (value === null) {
        // Özelliği kaldır
        if (!styleMatch) return;
        let styles = styleMatch[1];
        // prop:value çiftini kaldır
        const re = new RegExp(prop.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:[^;]*;?\\s*', 'gi');
        styles = styles.replace(re, '').trim().replace(/;$/, '').trim();
        let newText;
        if (styles.length === 0) {
            // style boşsa attribute'u kaldır
            newText = lineText.replace(/\s*style\s*=\s*"[^"]*"/i, '');
        } else {
            newText = lineText.replace(/style\s*=\s*"[^"]*"/i, 'style="' + styles + '"');
        }
        cm.replaceRange(newText, { line: line, ch: 0 }, { line: line, ch: lineText.length });
        return;
    }

    if (styleMatch) {
        // Mevcut style var, property'i güncelle veya ekle
        let styles = styleMatch[1];
        const propRe = new RegExp('(^|;\\s*)' + prop.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:[^;]*', 'i');
        if (propRe.test(styles)) {
            // Mevcut property'i güncelle
            styles = styles.replace(propRe, function (m, prefix) {
                return prefix + prop + ':' + value;
            });
        } else {
            // Yeni property ekle
            styles = styles.replace(/;?\s*$/, '');
            styles = styles ? styles + '; ' + prop + ':' + value : prop + ':' + value;
        }
        const newText = lineText.replace(/style\s*=\s*"[^"]*"/i, 'style="' + styles + '"');
        cm.replaceRange(newText, { line: line, ch: 0 }, { line: line, ch: lineText.length });
    } else {
        // style attribute yok, ekle (ilk > işaretinden önce)
        // Self-closing tag kontrolü: /> önce ekle
        let newText;
        if (/\/>/.test(lineText)) {
            newText = lineText.replace(/(\s*)\/>/, ' style="' + prop + ':' + value + '"$1/>');
        } else if (/>/.test(lineText)) {
            newText = lineText.replace(/>/, ' style="' + prop + ':' + value + '">');
        } else {
            // Satırda > yok - etiketin devamı başka satırdadır
            newText = lineText + ' style="' + prop + ':' + value + '"';
        }
        cm.replaceRange(newText, { line: line, ch: 0 }, { line: line, ch: lineText.length });
    }
}

function handlePreviewDrop(srcLine, insertAfter, dropData, insertInside) {
    const cm = cmEditor;
    let targetLine = srcLine;

    if (insertInside) {
        // Self-closing etiketi aç, td/th içine ekle
        targetLine = ensureOpenTag(cm, srcLine);
    } else if (insertAfter) {
        // srcLine'dan başlayan elementin/bloğun kapanış etiketini bul
        const lineText = cm.getLine(srcLine) || '';
        let depth = (lineText.match(/<(?!\/|xsl:)[a-zA-Z][^>]*(?<!\/)>/g) || []).length;
        depth -= (lineText.match(/<\/(?!xsl:)[a-zA-Z][^>]*>/g) || []).length;
        if (depth > 0) {
            for (let i = srcLine + 1; i < cm.lineCount(); i++) {
                const lt = cm.getLine(i);
                depth += (lt.match(/<(?!\/|xsl:)[a-zA-Z][^>]*(?<!\/)>/g) || []).length;
                depth -= (lt.match(/<\/(?!xsl:)[a-zA-Z][^>]*>/g) || []).length;
                if (depth <= 0) { targetLine = i; break; }
            }
        }
        targetLine++;
    }

    let snippet = '';
    if (dropData.type === 'xpath') {
        snippet = '<xsl:value-of select="' + dropData.value + '"/>';
    } else if (dropData.type === 'template') {
        snippet = getTemplateSnippet(dropData.value) || '';
    } else if (dropData.type === 'logo' || dropData.type === 'signature') {
        pendingImageType = dropData.type;
        pendingPreviewDropLine = targetLine;
        pendingDropCm = cm;
        pendingDropPos = { line: targetLine, ch: 0 };
        openImageDialog(dropData.type);
        return;
    } else if (dropData.type === 'spacer') {
        if (dropData.value === 'div') {
            snippet = getSpacerSnippet('div');
        } else {
            let h = parseInt(dropData.value, 10);
            if (dropData.value === 'custom' || isNaN(h)) {
                const input = prompt('Boşluk yüksekliğini piksel olarak girin:', '30');
                if (!input) return;
                h = parseInt(input, 10);
                if (isNaN(h) || h <= 0) return;
            }
            snippet = getSpacerSnippet(h);
        }
    }

    if (snippet) {
        cm.replaceRange(snippet + '\n', { line: targetLine, ch: 0 });
        cm.setCursor({ line: targetLine, ch: 0 });
        cm.focus();
        setStatus('Önizlemeden eklendi: ' + (dropData.label || dropData.type));
        setTimeout(() => doPreview(), 200);
    }
}

// ---- Önizleme Sürükleme Katmanı ----
(function initPreviewOverlays() {
    function setup(overlayId, frameId) {
        const overlay = document.getElementById(overlayId);
        const frame = document.getElementById(frameId);
        if (!overlay || !frame) return;

        overlay.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            this.classList.add('drop-hover');
            const rect = frame.getBoundingClientRect();
            if (frame.contentWindow) {
                frame.contentWindow.postMessage({
                    xlAction: 'showDropAt',
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                }, '*');
            }
        });

        overlay.addEventListener('dragleave', function () {
            this.classList.remove('drop-hover');
            if (frame.contentWindow) frame.contentWindow.postMessage({ xlAction: 'clearDrop' }, '*');
        });

        overlay.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('drop-hover');
            hideOverlays();
            const raw = e.dataTransfer.getData('text/plain');
            if (!raw) return;
            let data;
            try { data = JSON.parse(raw); } catch { return; }
            const rect = frame.getBoundingClientRect();
            if (frame.contentWindow) {
                frame.contentWindow.postMessage({
                    xlAction: 'doDrop',
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    dropData: data
                }, '*');
            }
        });
    }

    setup('previewDropOverlay', 'previewFrame');
    setup('previewDropOverlaySplit', 'previewFrameSplit');

    // Herhangi bir sürükleme başlayınca katmanları göster
    document.addEventListener('dragstart', function () {
        document.querySelectorAll('.preview-drop-overlay').forEach(o => o.classList.add('active'));
    });
    document.addEventListener('dragend', function () {
        hideOverlays();
    });

    function hideOverlays() {
        document.querySelectorAll('.preview-drop-overlay').forEach(o => o.classList.remove('active', 'drop-hover'));
        ['previewFrame', 'previewFrameSplit'].forEach(fid => {
            const f = document.getElementById(fid);
            if (f && f.contentWindow) f.contentWindow.postMessage({ xlAction: 'clearDrop' }, '*');
        });
    }
})();

// ---- İnceleme Vurgulama Durumu ----
function clearInspectHighlight(cm) {
    cm = cm || cmEditor;
    inspectHighlightLines.forEach(h => {
        cm.removeLineClass(h, 'wrap', 'cm-inspect-line');
    });
    // cmSplit'te de temizle
    inspectHighlightLines.forEach(h => {
        try { cmSplit.removeLineClass(h, 'wrap', 'cm-inspect-line'); } catch(e) {}
    });
    inspectHighlightLines = [];
}

// ---- Sağ Tık Menü Durumu ----
let pendingCtxInsertLine = null;
let pendingCtxInsertAfter = true;
let pendingReplaceImageLine = null;
let pendingTableEditLine = null;

// ---- Editörde Blok Aralığı Bulma ----
// Verilen satır numarasından açılış→kapanış etiketi aralığını bul
function findBlockRange(cm, line) {
    const startLine = line;
    const lineText = cm.getLine(startLine) || '';

    // Kendini kapatan etiket veya alt elemanı olmayan tek satır
    if (/<[^>]*\/>\s*$/.test(lineText.trim())) {
        return { from: startLine, to: startLine };
    }

    // Kapanış etiketini bulmak için etiket derinliğini say
    let depth = 0;
    const openRe = /<(?!\/|!|xsl:|\?)[a-zA-Z][^>]*(?<!\/)>/g;
    const closeRe = /<\/(?!xsl:)[a-zA-Z][^>]*>/g;

    for (let i = startLine; i < cm.lineCount(); i++) {
        const lt = cm.getLine(i);
        const opens = (lt.match(openRe) || []).length;
        const closes = (lt.match(closeRe) || []).length;
        if (i === startLine) {
            depth = opens - closes;
            if (depth <= 0) return { from: startLine, to: startLine };
        } else {
            depth += opens - closes;
            if (depth <= 0) return { from: startLine, to: i };
        }
    }
    return { from: startLine, to: startLine };
}

// Önizlemedeki data-xl satırında doğru etiketi bul
// Aynı satırda birden fazla eleman varsa (ör. xsl:if ile sarmalı) yakın satırlarda ara
function resolveTagLine(cm, line, tagName) {
    if (!tagName) return line;
    const tag = tagName.toLowerCase();
    const lineText = (cm.getLine(line) || '').trim().toLowerCase();
    // Satır beklenen etiketi içeriyor mu?
    if (lineText.indexOf('<' + tag) !== -1) return line;
    // Yakın satırlarda ara (±5)
    for (let dist = 1; dist <= 5; dist++) {
        for (const d of [line - dist, line + dist]) {
            if (d < 0 || d >= cm.lineCount()) continue;
            const lt = (cm.getLine(d) || '').trim().toLowerCase();
            if (lt.indexOf('<' + tag) !== -1) return d;
        }
    }
    return line;
}

// Self-closing veya tek satır etiketi aç: içine eleman eklenebilmesi için
function ensureOpenTag(cm, line) {
    const lineText = cm.getLine(line) || '';
    const trimmed = lineText.trimEnd();
    const indent = lineText.match(/^(\s*)/)[1];

    // Durum 1: Self-closing etiket → <tag .../> → <tag ...>\n</tag>
    if (/\/>\s*$/.test(trimmed)) {
        const tagMatch = trimmed.match(/<([\w:-]+)/);
        const tagName = tagMatch ? tagMatch[1] : 'td';
        const newOpen = trimmed.replace(/\s*\/>$/, '>');
        cm.replaceRange(
            newOpen + '\n' + indent + '</' + tagName + '>',
            { line: line, ch: 0 },
            { line: line, ch: lineText.length }
        );
        return line + 1;
    }

    // Durum 2: Tek satırda açılıp kapanan etiket → <tag>içerik</tag>
    const singleLine = trimmed.match(/^(\s*<[\w:-]+\b[^>]*>)(.*?)(<\/[\w:-]+>)\s*$/);
    if (singleLine && singleLine[2] !== undefined) {
        const openPart = singleLine[1];
        const content = singleLine[2].trim();
        const closePart = singleLine[3];
        const parts = content
            ? openPart + '\n' + indent + '\t' + content + '\n' + indent + closePart
            : openPart + '\n' + indent + closePart;
        cm.replaceRange(parts,
            { line: line, ch: 0 },
            { line: line, ch: lineText.length }
        );
        return line + 1;
    }

    // Durum 3: Zaten çok satırlı açık etiket
    return line + 1;
}

// ---- Alan Seçici Diyaloğu ----
(function initFieldPicker() {
    const dialog = document.getElementById('fieldPickerDialog');
    if (!dialog) return;

    dialog.addEventListener('click', function (e) {
        if (e.target === dialog) dialog.style.display = 'none';
    });

    document.getElementById('btnCloseFieldPicker').addEventListener('click', function () {
        dialog.style.display = 'none';
    });

    document.querySelectorAll('.field-picker-item').forEach(btn => {
        btn.addEventListener('click', function () {
            const xpath = this.dataset.xpath;
            if (!xpath || pendingCtxInsertLine == null) return;
            const cm = cmEditor;
            const range = findBlockRange(cm, pendingCtxInsertLine);
            let targetLine = pendingCtxInsertAfter ? range.to + 1 : range.from;
            const snippet = `<xsl:value-of select="${xpath}"/>`;
            cm.replaceRange(snippet + '\n', { line: targetLine, ch: 0 });
            cm.focus();
            dialog.style.display = 'none';
            setStatus('Alan eklendi: ' + (this.textContent || xpath));
            setTimeout(() => doPreview(), 200);
        });
    });
})();

// ---- Tablo Diyaloğu ----
(function initTableDialog() {
    const dialog = document.getElementById('tableDialog');
    if (!dialog) return;

    dialog.addEventListener('click', function (e) {
        if (e.target === dialog) dialog.style.display = 'none';
    });

    document.getElementById('btnCancelTable').addEventListener('click', function () {
        dialog.style.display = 'none';
    });

    document.getElementById('btnInsertTable').addEventListener('click', function () {
        if (this._editRange) return; // edit mode handled separately

        const rows = parseInt(document.getElementById('tblRows').value) || 3;
        const cols = parseInt(document.getElementById('tblCols').value) || 3;
        const borderWidth = document.getElementById('tblBorder').value || '1';
        const borderColor = document.getElementById('tblBorderColor').value || '#000000';
        const cellPad = document.getElementById('tblPadding').value || '4';
        const headerBg = document.getElementById('tblHeaderBg').value || '#eeeeee';
        const headerColor = document.getElementById('tblHeaderColor').value || '#000000';
        const cellBg = document.getElementById('tblCellBg').value || '#ffffff';
        const cellColor = document.getElementById('tblCellColor').value || '#000000';
        const hasHeader = document.getElementById('tblHasHeader').checked;
        const tableWidth = document.getElementById('tblWidth').value || '100%';

        let snippet = `\n<table border="${borderWidth}" cellpadding="${cellPad}" cellspacing="0" width="${tableWidth}" style="border-collapse:collapse; border-color:${borderColor};">`;

        if (hasHeader) {
            snippet += `\n  <tr style="background:${headerBg}; color:${headerColor}; font-weight:bold;">`;
            for (let c = 0; c < cols; c++) {
                snippet += `\n    <td>Başlık ${c + 1}</td>`;
            }
            snippet += `\n  </tr>`;
        }

        const dataRows = hasHeader ? rows - 1 : rows;
        for (let r = 0; r < dataRows; r++) {
            snippet += `\n  <tr style="background:${cellBg}; color:${cellColor};">`;
            for (let c = 0; c < cols; c++) {
                snippet += `\n    <td>&#160;</td>`;
            }
            snippet += `\n  </tr>`;
        }
        snippet += `\n</table>\n`;

        const cm = cmEditor;
        if (pendingCtxInsertLine != null) {
            const range = findBlockRange(cm, pendingCtxInsertLine);
            const targetLine = pendingCtxInsertAfter ? range.to + 1 : range.from;
            cm.replaceRange(snippet, { line: targetLine, ch: 0 });
        } else {
            cm.replaceRange(snippet, cm.getCursor());
        }
        cm.focus();
        dialog.style.display = 'none';
        setStatus('Tablo eklendi');
        setTimeout(() => doPreview(), 200);
    });
})();

// ---- Tablo Düzenleme Diyaloğu ----
function openTableEditDialog(line) {
    const cm = cmEditor;
    const range = findBlockRange(cm, line);
    const blockText = [];
    for (let i = range.from; i <= range.to; i++) {
        blockText.push(cm.getLine(i));
    }
    const text = blockText.join('\n');

    // Mevcut nitelikleri oku
    const borderMatch = text.match(/border="([^"]*)"/);
    const cellpadMatch = text.match(/cellpadding="([^"]*)"/);
    const widthMatch = text.match(/width="([^"]*)"/);
    const borderColorMatch = text.match(/border-color:\s*([^;"]+)/);

    // Tablo diyaloğunu mevcut değerlerle doldur
    document.getElementById('tblBorder').value = borderMatch ? borderMatch[1] : '1';
    document.getElementById('tblPadding').value = cellpadMatch ? cellpadMatch[1] : '4';
    document.getElementById('tblWidth').value = widthMatch ? widthMatch[1] : '100%';
    if (borderColorMatch) document.getElementById('tblBorderColor').value = borderColorMatch[1].trim();

    // Satır/sütun sayısını hesapla
    const trCount = (text.match(/<tr[\s>]/gi) || []).length;
    const firstTrMatch = text.match(/<tr[\s>][\s\S]*?<\/tr>/i);
    const tdCount = firstTrMatch ? (firstTrMatch[0].match(/<t[dh][\s>]/gi) || []).length : 3;
    document.getElementById('tblRows').value = trCount || 3;
    document.getElementById('tblCols').value = tdCount || 3;

    // Ekle butonunu "Güncelle" moduna geçir
    const btn = document.getElementById('btnInsertTable');
    btn.textContent = 'Güncelle';
    btn._editRange = range;

    pendingCtxInsertLine = null; // signal edit mode

    document.getElementById('tableDialog').style.display = 'flex';

    // Kapatınca buton metnini eski haline getir
    const restoreBtn = function () {
        btn.textContent = 'Tablo Ekle';
        btn._editRange = null;
    };
    document.getElementById('btnCancelTable').addEventListener('click', restoreBtn, { once: true });
}

// Tablo düzenleme modunu desteklemek için tıklama olayını yeniden tanımla
(function patchTableInsertForEdit() {
    const btn = document.getElementById('btnInsertTable');
    if (!btn) return;
    const origClick = btn.onclick;

    btn.addEventListener('click', function () {
        if (!btn._editRange) return; // normal insert handled by initTableDialog

        const range = btn._editRange;
        const cm = cmEditor;

        const rows = parseInt(document.getElementById('tblRows').value) || 3;
        const cols = parseInt(document.getElementById('tblCols').value) || 3;
        const borderWidth = document.getElementById('tblBorder').value || '1';
        const borderColor = document.getElementById('tblBorderColor').value || '#000000';
        const cellPad = document.getElementById('tblPadding').value || '4';
        const headerBg = document.getElementById('tblHeaderBg').value || '#eeeeee';
        const headerColor = document.getElementById('tblHeaderColor').value || '#000000';
        const cellBg = document.getElementById('tblCellBg').value || '#ffffff';
        const cellColor = document.getElementById('tblCellColor').value || '#000000';
        const hasHeader = document.getElementById('tblHasHeader').checked;
        const tableWidth = document.getElementById('tblWidth').value || '100%';

        // Mevcut hücre içeriklerini oku
        const blockText = [];
        for (let i = range.from; i <= range.to; i++) blockText.push(cm.getLine(i));
        const existingCells = [];
        const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let m;
        while ((m = cellRe.exec(blockText.join('\n'))) !== null) {
            existingCells.push(m[1].trim());
        }

        let snippet = `<table border="${borderWidth}" cellpadding="${cellPad}" cellspacing="0" width="${tableWidth}" style="border-collapse:collapse; border-color:${borderColor};">`;
        let cellIdx = 0;

        if (hasHeader) {
            snippet += `\n  <tr style="background:${headerBg}; color:${headerColor}; font-weight:bold;">`;
            for (let c = 0; c < cols; c++) {
                const content = existingCells[cellIdx] !== undefined ? existingCells[cellIdx] : 'Başlık ' + (c + 1);
                snippet += `\n    <td>${content}</td>`;
                cellIdx++;
            }
            snippet += `\n  </tr>`;
        }

        const dataRows = hasHeader ? rows - 1 : rows;
        for (let r = 0; r < dataRows; r++) {
            snippet += `\n  <tr style="background:${cellBg}; color:${cellColor};">`;
            for (let c = 0; c < cols; c++) {
                const content = existingCells[cellIdx] !== undefined ? existingCells[cellIdx] : '&#160;';
                snippet += `\n    <td>${content}</td>`;
                cellIdx++;
            }
            snippet += `\n  </tr>`;
        }
        snippet += `\n</table>`;

        cm.replaceRange(snippet + '\n',
            { line: range.from, ch: 0 },
            { line: range.to + 1, ch: 0 }
        );
        cm.focus();
        document.getElementById('tableDialog').style.display = 'none';
        btn.textContent = 'Tablo Ekle';
        btn._editRange = null;
        setStatus('Tablo güncellendi');
        setTimeout(() => doPreview(), 200);
    });
})();

// ---- Resim Değiştirme Diyaloğu ----
function openImageReplaceDialog(line) {
    const cm = cmEditor;
    const lineText = cm.getLine(line) || '';

    // Mevcut genişlik/yükseklik varsa al
    const wMatch = lineText.match(/width[:\s]*(\d+)/i);
    const hMatch = lineText.match(/height[:\s]*(\d+)/i);

    pendingImageType = 'replace';
    pendingReplaceImageLine = line;
    document.getElementById('imageDialogTitle').textContent = 'Resmi Değiştir';
    document.getElementById('imageDialog').style.display = 'flex';
    document.getElementById('imagePreviewContainer').style.display = 'none';
    document.getElementById('imageFileInput').value = '';
    if (wMatch) document.getElementById('imageWidth').value = wMatch[1];
    if (hMatch) document.getElementById('imageHeight').value = hMatch[1];
}

// ---- Varsayılan XSLT Şablonu ----
function getDefaultXslt() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
    xmlns:n1="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
    exclude-result-prefixes="cac cbc n1 ext">

  <xsl:decimal-format name="european" decimal-separator="," grouping-separator="." NaN=""/>
  <xsl:output method="html" indent="yes" encoding="UTF-8"/>
  <xsl:variable name="XML" select="/"/>

  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <title>e-Fatura</title>
        <style type="text/css">
          body { font-family: Tahoma, Arial, sans-serif; font-size: 11px; color: #333; margin: 20px; }
          h1 { font-size: 1.4em; text-align: center; color: #000; }
          table { border-spacing: 0; }
          .header-table { width: 100%; margin-bottom: 10px; }
          .info-table { border: 1px solid #999; border-collapse: collapse; }
          .info-table td { border: 1px solid #999; padding: 4px 8px; }
          .info-table th { border: 1px solid #999; padding: 4px 8px; background: #f0f0f0; text-align: left; }
          .line-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .line-table td, .line-table th { border: 1px solid #000; padding: 3px 6px; }
          .line-table th { background: #e0e0e0; }
          .totals-table { float: right; width: 40%; border-collapse: collapse; margin-top: 10px; }
          .totals-table td { border: 1px solid #000; padding: 4px 8px; }
          .section { margin-top: 15px; }
          .bold { font-weight: bold; }
          hr { border: 1px solid #000; margin: 5px 0; }
        </style>
      </head>
      <body>
        <xsl:for-each select="$XML">
          <table class="header-table">
            <tr valign="top">
              <!-- Sol: Gönderici Bilgileri -->
              <td width="40%">
                <hr/>
                <xsl:for-each select="n1:Invoice/cac:AccountingSupplierParty/cac:Party">
                  <strong><xsl:value-of select="cac:PartyName/cbc:Name"/></strong><br/>
                  <xsl:for-each select="cac:Person">
                    <xsl:value-of select="cbc:FirstName"/><xsl:text> </xsl:text>
                    <xsl:value-of select="cbc:FamilyName"/><br/>
                  </xsl:for-each>
                  <xsl:value-of select="cac:PostalAddress/cbc:StreetName"/>
                  <xsl:if test="cac:PostalAddress/cbc:BuildingNumber">
                    <xsl:text> No:</xsl:text><xsl:value-of select="cac:PostalAddress/cbc:BuildingNumber"/>
                  </xsl:if><br/>
                  <xsl:value-of select="cac:PostalAddress/cbc:CitySubdivisionName"/>/<xsl:value-of select="cac:PostalAddress/cbc:CityName"/><br/>
                  <xsl:if test="cac:Contact/cbc:Telephone">Tel: <xsl:value-of select="cac:Contact/cbc:Telephone"/><br/></xsl:if>
                  <xsl:if test="cac:Contact/cbc:Telefax">Fax: <xsl:value-of select="cac:Contact/cbc:Telefax"/><br/></xsl:if>
                  <xsl:if test="cac:Contact/cbc:ElectronicMail">E-Posta: <xsl:value-of select="cac:Contact/cbc:ElectronicMail"/><br/></xsl:if>
                  <xsl:if test="cbc:WebsiteURI">Web: <xsl:value-of select="cbc:WebsiteURI"/><br/></xsl:if>
                  Vergi Dairesi: <xsl:value-of select="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/><br/>
                  <xsl:for-each select="cac:PartyIdentification">
                    <xsl:value-of select="cbc:ID/@schemeID"/>: <xsl:value-of select="cbc:ID"/><br/>
                  </xsl:for-each>
                </xsl:for-each>
                <hr/>
              </td>

              <!-- Orta: Logo ve Başlık -->
              <td width="20%" align="center" valign="middle">
                <!-- Firma logosu buraya eklenebilir -->
                <h1>e-FATURA</h1>
              </td>

              <!-- Sağ: Fatura Bilgileri -->
              <td width="40%" align="right">
                <table class="info-table">
                  <tr><th>Özelleştirme No</th><td><xsl:value-of select="n1:Invoice/cbc:CustomizationID"/></td></tr>
                  <tr><th>Senaryo</th><td><xsl:value-of select="n1:Invoice/cbc:ProfileID"/></td></tr>
                  <tr><th>Fatura Tipi</th><td><xsl:value-of select="n1:Invoice/cbc:InvoiceTypeCode"/></td></tr>
                  <tr><th>Fatura No</th><td><xsl:value-of select="n1:Invoice/cbc:ID"/></td></tr>
                  <tr><th>Fatura Tarihi</th><td><xsl:value-of select="n1:Invoice/cbc:IssueDate"/></td></tr>
                  <tr><th>ETTN</th><td style="font-size:10px;"><xsl:value-of select="n1:Invoice/cbc:UUID"/></td></tr>
                  <tr><th>Para Birimi</th><td><xsl:value-of select="n1:Invoice/cbc:DocumentCurrencyCode"/></td></tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Alıcı Bilgileri -->
          <div class="section">
            <table class="info-table" width="50%">
              <tr><th colspan="2">SAYIN (Alıcı)</th></tr>
              <xsl:for-each select="n1:Invoice/cac:AccountingCustomerParty/cac:Party">
                <xsl:if test="cac:PartyName">
                  <tr><th>Ad</th><td><xsl:value-of select="cac:PartyName/cbc:Name"/></td></tr>
                </xsl:if>
                <xsl:if test="cac:Person">
                  <tr><th>Ad Soyad</th><td><xsl:value-of select="cac:Person/cbc:FirstName"/><xsl:text> </xsl:text><xsl:value-of select="cac:Person/cbc:FamilyName"/></td></tr>
                </xsl:if>
                <tr><th>Adres</th><td>
                  <xsl:value-of select="cac:PostalAddress/cbc:StreetName"/>
                  <xsl:text> </xsl:text>
                  <xsl:value-of select="cac:PostalAddress/cbc:CitySubdivisionName"/>/<xsl:value-of select="cac:PostalAddress/cbc:CityName"/>
                </td></tr>
                <xsl:for-each select="cac:PartyIdentification">
                  <tr><th><xsl:value-of select="cbc:ID/@schemeID"/></th><td><xsl:value-of select="cbc:ID"/></td></tr>
                </xsl:for-each>
                <xsl:if test="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name">
                  <tr><th>Vergi Dairesi</th><td><xsl:value-of select="cac:PartyTaxScheme/cac:TaxScheme/cbc:Name"/></td></tr>
                </xsl:if>
              </xsl:for-each>
            </table>
          </div>

          <!-- Fatura Kalemleri -->
          <div class="section">
            <table class="line-table">
              <tr>
                <th>#</th>
                <th>Mal/Hizmet</th>
                <th>Miktar</th>
                <th>Birim Fiyat</th>
                <th>İskonto</th>
                <th>KDV %</th>
                <th>KDV Tutarı</th>
                <th>Mal Hizmet Tutarı</th>
              </tr>
              <xsl:for-each select="n1:Invoice/cac:InvoiceLine">
                <tr>
                  <td><xsl:value-of select="cbc:ID"/></td>
                  <td><xsl:value-of select="cac:Item/cbc:Name"/></td>
                  <td style="text-align:right;"><xsl:value-of select="cbc:InvoicedQuantity"/><xsl:text> </xsl:text><xsl:value-of select="cbc:InvoicedQuantity/@unitCode"/></td>
                  <td style="text-align:right;"><xsl:value-of select="cac:Price/cbc:PriceAmount"/></td>
                  <td style="text-align:right;">
                    <xsl:for-each select="cac:AllowanceCharge[cbc:ChargeIndicator='false']">
                      <xsl:value-of select="cbc:Amount"/>
                    </xsl:for-each>
                  </td>
                  <td style="text-align:right;">%<xsl:value-of select="cac:TaxTotal/cac:TaxSubtotal/cbc:Percent"/></td>
                  <td style="text-align:right;"><xsl:value-of select="cac:TaxTotal/cbc:TaxAmount"/></td>
                  <td style="text-align:right;"><xsl:value-of select="cbc:LineExtensionAmount"/></td>
                </tr>
              </xsl:for-each>
            </table>
          </div>

          <!-- Vergiler ve Toplamlar -->
          <div class="section" style="overflow:auto;">
            <!-- Notlar (Sol) -->
            <xsl:if test="n1:Invoice/cbc:Note">
              <div style="float:left; width:55%;">
                <table class="info-table" width="100%">
                  <tr><th>Notlar</th></tr>
                  <xsl:for-each select="n1:Invoice/cbc:Note">
                    <tr><td><xsl:value-of select="."/></td></tr>
                  </xsl:for-each>
                </table>
              </div>
            </xsl:if>

            <!-- Toplamlar (Sağ) -->
            <table class="totals-table">
              <xsl:for-each select="n1:Invoice/cac:TaxTotal/cac:TaxSubtotal">
                <tr>
                  <td>
                    <xsl:value-of select="cac:TaxCategory/cac:TaxScheme/cbc:Name"/>
                    <xsl:if test="cbc:Percent"> (%<xsl:value-of select="cbc:Percent"/>)</xsl:if>
                  </td>
                  <td style="text-align:right;"><xsl:value-of select="cbc:TaxAmount"/></td>
                </tr>
              </xsl:for-each>
              <tr class="bold">
                <td>Mal/Hizmet Toplamı</td>
                <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount"/></td>
              </tr>
              <xsl:if test="n1:Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount">
                <tr>
                  <td>Toplam İskonto</td>
                  <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount"/></td>
                </tr>
              </xsl:if>
              <tr class="bold">
                <td>Vergiler Dahil Toplam</td>
                <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"/></td>
              </tr>
              <tr class="bold" style="font-size:1.2em;">
                <td>Ödenecek Tutar</td>
                <td style="text-align:right;"><xsl:value-of select="n1:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount"/></td>
              </tr>
            </table>
          </div>

          <!-- Ödeme Bilgileri -->
          <xsl:if test="n1:Invoice/cac:PaymentTerms">
            <div class="section" style="clear:both;">
              <table class="info-table" width="50%">
                <tr><th colspan="2">Ödeme Bilgileri</th></tr>
                <xsl:if test="n1:Invoice/cac:PaymentTerms/cbc:Note">
                  <tr><th>Koşul</th><td><xsl:value-of select="n1:Invoice/cac:PaymentTerms/cbc:Note"/></td></tr>
                </xsl:if>
                <xsl:if test="n1:Invoice/cac:PaymentTerms/cbc:PaymentDueDate">
                  <tr><th>Vade Tarihi</th><td><xsl:value-of select="n1:Invoice/cac:PaymentTerms/cbc:PaymentDueDate"/></td></tr>
                </xsl:if>
              </table>
            </div>
          </xsl:if>

          <!-- İmza alanı -->
          <div class="section" style="clear:both; margin-top:30px; text-align:right;">
            <!-- Firma imzası buraya eklenebilir -->
          </div>

        </xsl:for-each>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;
}
