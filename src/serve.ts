// ─────────────────────────────────────────────────────────────────────────────
// serve.ts — arc serve: local web UI at http://localhost:7070
// Fixed: proper WebSocket frame parser handles fragmented TCP chunks
// ─────────────────────────────────────────────────────────────────────────────

import * as http   from 'http';
import * as crypto from 'crypto';
import { registry } from './backends/registry';
import { ArcMessage } from './backends/base';
import { ansi }      from './ansi';

const V  = ansi.fg(139,  92, 246);
const GR = ansi.fg(134, 239, 172);
const SD = ansi.fg(100, 116, 139);
const CY = ansi.fg(103, 232, 249);
const RE = ansi.fg(248, 113, 113);
const R  = ansi.reset;

// ── WebSocket helpers ─────────────────────────────────────────────────────────

function wsHandshake(req: http.IncomingMessage, socket: any): void {
  const key    = req.headers['sec-websocket-key'] as string;
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
}

function wsEncode(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8');
  const len     = payload.length;
  let   header: Buffer;
  if      (len < 126)   { header = Buffer.alloc(2);  header[0]=0x81; header[1]=len; }
  else if (len < 65536) { header = Buffer.alloc(4);  header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
  else                  { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
  return Buffer.concat([header, payload]);
}

// ── Frame accumulator — handles fragmented TCP delivery ───────────────────────
class WsFrameAccumulator {
  private buf = Buffer.alloc(0);

  feed(chunk: Buffer): string[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const messages: string[] = [];
    while (true) {
      const msg = this.tryDecode();
      if (msg === null) break;
      messages.push(msg);
    }
    return messages;
  }

  private tryDecode(): string | null {
    const b = this.buf;
    if (b.length < 2) return null;

    const masked = (b[1] & 0x80) !== 0;
    let   offset = 2;
    let   payLen = b[1] & 0x7f;

    if      (payLen === 126) { if (b.length < 4)  return null; payLen = b.readUInt16BE(2); offset = 4; }
    else if (payLen === 127) { if (b.length < 10) return null; payLen = Number(b.readBigUInt64BE(2)); offset = 10; }

    if (masked) offset += 4;

    const needed = offset + payLen;
    if (b.length < needed) return null; // frame not yet complete

    let data: Buffer;
    if (masked) {
      const mask = b.slice(offset - 4, offset);
      data = Buffer.alloc(payLen);
      for (let i = 0; i < payLen; i++) data[i] = b[offset + i] ^ mask[i % 4];
    } else {
      data = b.slice(offset, needed);
    }

    // Consume this frame from the buffer
    this.buf = b.slice(needed);

    // Only handle text frames (opcode 0x1) and continuation (0x0)
    // Ignore ping/pong/close for simplicity
    const opcode = b[0] & 0x0f;
    if (opcode === 0x8) return '__close__';  // close frame
    if (opcode !== 0x1 && opcode !== 0x0) return this.tryDecode(); // skip non-text

    return data.toString('utf8');
  }
}

// ── Web UI HTML (complete rewrite) ────────────────────────────────────────────

function buildHTML(models: Array<{id: string; name: string; backend: string}>): string {
  const modelOpts = models
    .map(m => `<option value="${m.backend}::${m.id}">${m.name} — ${m.backend}</option>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>arc — LLM Platform</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:#07060f;--bg2:#0f0d1c;--bg3:#16132a;--bg4:#1e1a35;
  --border:#2a2545;--border2:#3d3568;
  --v:#8b5cf6;--vl:#a78bfa;--vf:#c4b5fd;
  --sl:#e2e8f0;--sd:#64748b;--sdl:#94a3b8;
  --gr:#86efac;--cy:#67e8f9;--yw:#fde047;--re:#f87171;--or:#fb923c;
  --font:'JetBrains Mono','Fira Code','Cascadia Code',monospace;
  --radius:8px;
}

html,body{height:100%;overflow:hidden}
body{font-family:var(--font);font-size:13px;color:var(--sl);background:var(--bg);display:flex;flex-direction:column}

/* ── Header ── */
#hdr{
  display:flex;align-items:center;gap:12px;
  padding:10px 18px;border-bottom:1px solid var(--border);
  background:var(--bg2);flex-shrink:0;min-height:52px;
}
.logo{
  font-size:16px;font-weight:700;letter-spacing:3px;
  color:var(--v);display:flex;align-items:center;gap:6px;
}
.logo-mark{font-size:20px}
.logo-tag{color:var(--vl)}
.divider{width:1px;height:24px;background:var(--border);flex-shrink:0}
select{
  background:var(--bg3);color:var(--sl);border:1px solid var(--border);
  border-radius:6px;padding:5px 10px;font-family:var(--font);font-size:12px;
  cursor:pointer;outline:none;flex-shrink:0;max-width:280px;
}
select:focus{border-color:var(--v)}
.spacer{flex:1}
#conn{
  display:flex;align-items:center;gap:6px;
  font-size:11px;color:var(--sd);
}
.dot{width:7px;height:7px;border-radius:50%;background:var(--gr);box-shadow:0 0 5px var(--gr);flex-shrink:0;transition:all .3s}
.dot.off{background:var(--re);box-shadow:none}
#clr-btn{
  background:transparent;border:1px solid var(--border);color:var(--sd);
  border-radius:5px;padding:4px 10px;cursor:pointer;font-family:var(--font);font-size:11px;
}
#clr-btn:hover{border-color:var(--re);color:var(--re)}

/* ── Messages ── */
#chat{
  flex:1;overflow-y:auto;padding:24px 20px;
  display:flex;flex-direction:column;gap:0;
  scroll-behavior:smooth;
}
#chat::-webkit-scrollbar{width:5px}
#chat::-webkit-scrollbar-track{background:transparent}
#chat::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}

.msg{display:flex;flex-direction:column;gap:4px;padding:12px 0;border-bottom:1px solid var(--border)}
.msg:last-child{border-bottom:none}

.msg-meta{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--sd);margin-bottom:4px}
.msg-role{
  font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:10px;
  padding:1px 7px;border-radius:3px;
}
.msg.user .msg-role{color:var(--cy);border:1px solid #1a4a50;background:#061218}
.msg.arc  .msg-role{color:var(--vl);border:1px solid var(--border2);background:var(--bg3)}
.msg-time{color:var(--sd);font-size:10px}
.msg-model{color:var(--sd);font-size:10px}

.msg-body{
  line-height:1.75;padding:10px 14px;
  background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);
}
.msg.user .msg-body{border-left:2px solid var(--cy)}
.msg.arc  .msg-body{border-left:2px solid var(--v)}

/* Markdown */
.msg-body h1{color:var(--vl);font-size:1.25em;font-weight:700;margin:14px 0 6px;border-bottom:1px solid var(--border);padding-bottom:5px}
.msg-body h2{color:var(--vl);font-size:1.1em;font-weight:700;margin:12px 0 5px}
.msg-body h3{color:var(--v);font-size:1em;font-weight:700;margin:10px 0 4px}
.msg-body p{margin:6px 0}
.msg-body code{
  background:var(--bg3);color:var(--vf);padding:1px 5px;
  border-radius:3px;font-size:12px;border:1px solid var(--border)
}
.msg-body pre{
  background:#050410;border:1px solid var(--border2);border-radius:var(--radius);
  padding:14px;overflow-x:auto;margin:10px 0;position:relative;
}
.msg-body pre code{background:none;padding:0;color:#cdd6f4;border:none;font-size:12px}
.code-toolbar{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);
}
.code-lang{font-size:10px;color:var(--vf);letter-spacing:1px;text-transform:uppercase}
.code-actions{display:flex;gap:4px}
.code-btn{
  background:var(--bg3);border:1px solid var(--border);color:var(--sd);
  border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;
  font-family:var(--font);transition:all .15s;
}
.code-btn:hover{color:var(--vl);border-color:var(--v)}
.run-btn:hover{color:var(--gr);border-color:var(--gr)}
.msg-body blockquote{
  border-left:3px solid var(--v);padding:6px 12px;margin:8px 0;
  color:var(--sd);font-style:italic;background:var(--bg3);border-radius:0 4px 4px 0;
}
.msg-body table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
.msg-body th{
  background:var(--bg3);color:var(--vl);padding:7px 12px;
  border:1px solid var(--border);font-weight:700;text-align:left;
}
.msg-body td{padding:7px 12px;border:1px solid var(--border)}
.msg-body tr:nth-child(even) td{background:#0b0918}
.msg-body ul,.msg-body ol{padding-left:22px;margin:6px 0}
.msg-body li{margin:3px 0;color:var(--sl)}
.msg-body strong{color:var(--sl);font-weight:700}
.msg-body em{color:var(--sdl);font-style:italic}
.msg-body hr{border:none;border-top:1px solid var(--border);margin:12px 0}
.msg-body a{color:var(--cy);text-decoration:none}
.msg-body a:hover{text-decoration:underline}

/* Thinking */
.thinking{
  background:var(--bg);border:1px solid var(--border);
  border-left:2px solid var(--vf);border-radius:var(--radius);margin:8px 0;overflow:hidden;
}
.thinking-hdr{
  padding:6px 12px;font-size:10px;color:var(--sd);cursor:pointer;
  display:flex;align-items:center;gap:6px;user-select:none;
}
.thinking-hdr:hover{background:var(--bg3)}
.thinking-body{
  padding:8px 12px;font-size:11px;color:var(--sd);font-style:italic;
  display:none;border-top:1px solid var(--border);max-height:220px;overflow-y:auto;white-space:pre-wrap;
}
.thinking.open .thinking-body{display:block}

/* Stats */
.msg-stats{
  display:flex;gap:12px;font-size:10px;color:var(--sd);margin-top:6px;align-items:center;
}
.stat-chip{
  background:var(--bg3);border:1px solid var(--border);
  border-radius:3px;padding:1px 7px;
}
.stat-chip.tps{color:var(--cy)}
.stat-chip.time{color:var(--sd)}
.stat-chip.tok{color:var(--sdl)}

/* Streaming cursor */
@keyframes blink{50%{opacity:0}}
.cursor{
  display:inline-block;width:7px;height:13px;background:var(--v);
  vertical-align:middle;animation:blink .75s step-end infinite;
  margin-left:1px;border-radius:1px;
}

/* Empty state */
#empty{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:16px;color:var(--sd);
}
.empty-logo{font-size:32px;color:var(--v);letter-spacing:4px;font-weight:700}
.empty-sub{font-size:12px;color:var(--sd)}
.empty-tips{
  display:flex;flex-direction:column;gap:6px;font-size:11px;
  color:var(--border2);text-align:center;
}

/* ── Input ── */
#input-area{
  border-top:1px solid var(--border);background:var(--bg2);padding:12px 18px;flex-shrink:0;
}
#input-wrap{
  display:flex;align-items:flex-end;gap:8px;
  background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);
  padding:6px 8px 6px 14px;transition:border-color .15s;
}
#input-wrap:focus-within{border-color:var(--v)}
#prompt{
  flex:1;background:transparent;border:none;outline:none;color:var(--sl);
  font-family:var(--font);font-size:13px;resize:none;
  line-height:1.6;min-height:22px;max-height:180px;padding:2px 0;
}
#prompt::placeholder{color:var(--sd)}
#send{
  background:var(--v);color:#fff;border:none;border-radius:6px;
  padding:7px 14px;cursor:pointer;font-family:var(--font);font-size:12px;
  font-weight:700;white-space:nowrap;transition:background .15s;flex-shrink:0;
  display:flex;align-items:center;gap:6px;
}
#send:hover:not(:disabled){background:#7c3aed}
#send:disabled{background:var(--border);color:var(--sd);cursor:not-allowed}
.hints{
  display:flex;gap:14px;margin-top:7px;font-size:10px;color:var(--sd);
}
kbd{
  background:var(--bg3);border:1px solid var(--border2);border-radius:3px;
  padding:1px 5px;font-size:9px;font-family:var(--font);color:var(--sdl);
}
</style>
</head>
<body>

<div id="hdr">
  <div class="logo">
    <span class="logo-mark">◈</span>
    <span class="logo-tag">arc</span>
  </div>
  <div class="divider"></div>
  <select id="model-sel">${modelOpts}</select>
  <div class="spacer"></div>
  <button id="clr-btn">clear chat</button>
  <div class="divider"></div>
  <div id="conn">
    <div class="dot" id="dot"></div>
    <span id="conn-label">connecting…</span>
  </div>
</div>

<div id="chat">
  <div id="empty">
    <div class="empty-logo">◈ arc</div>
    <div class="empty-sub">LLM Platform — by The Architect</div>
    <div class="empty-tips">
      <div>Shift+Enter for newline · Ctrl+/ to clear</div>
      <div>Select a model above, then start typing</div>
    </div>
  </div>
</div>

<div id="input-area">
  <div id="input-wrap">
    <textarea id="prompt" placeholder="Message arc…" rows="1"></textarea>
    <button id="send" type="button">Send ↵</button>
  </div>
  <div class="hints">
    <span><kbd>Enter</kbd> send</span>
    <span><kbd>Shift+Enter</kbd> newline</span>
    <span><kbd>Ctrl+/</kbd> clear</span>
  </div>
</div>

<script>
const chatEl   = document.getElementById('chat');
const emptyEl  = document.getElementById('empty');
const promptEl = document.getElementById('prompt');
const sendEl   = document.getElementById('send');
const dotEl    = document.getElementById('dot');
const connEl   = document.getElementById('conn-label');
const modelEl  = document.getElementById('model-sel');
const clrEl    = document.getElementById('clr-btn');

let ws        = null;
let streaming = false;
let currentEl = null;  // current .msg-body div being streamed into
let rawBuf    = '';    // raw markdown being accumulated

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function ts(){
  return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function copyCodeBlock(id){
  const pre = document.getElementById(id);
  if (!pre) return;
  const encoded = pre.getAttribute('data-code');
  const text = encoded ? decodeURIComponent(escape(atob(encoded))) : (pre.querySelector('code')?.textContent || '');
  navigator.clipboard.writeText(text).then(() => {
    const btn = pre.querySelector('.code-btn');
    if (btn){ const orig=btn.textContent; btn.textContent='✓ copied'; setTimeout(()=>btn.textContent=orig,1500); }
  });
}
function saveCodeBlock(id){
  const pre = document.getElementById(id);
  if (!pre) return;
  const encoded = pre.getAttribute('data-code');
  const text = encoded ? decodeURIComponent(escape(atob(encoded))) : (pre.querySelector('code')?.textContent || '');
  const lang = pre.querySelector('.code-lang')?.textContent || 'txt';
  const extMap = {python:'py',javascript:'js',typescript:'ts',bash:'sh',shell:'sh',rust:'rs',go:'go',c:'c'};
  const ext = extMap[lang.toLowerCase()] || lang || 'txt';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:'text/plain'}));
  a.download = 'arc-code-'+Date.now()+'.'+ext;
  a.click();
}
function runCode(id){
  showToast('Run: copy this code and execute it in your terminal', 'var(--cy)');
}
// Connection health check - ping every 20s
let pingInterval = null;
function startPing(){
  clearInterval(pingInterval);
  pingInterval = setInterval(()=>{
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({type:'ping'}));
    }
  }, 20000);
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function md(raw){
  let s = raw;

  // Thinking blocks
  s = s.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_,c) =>
    '<div class="thinking"><div class="thinking-hdr" onclick="this.parentElement.classList.toggle(\'open\')">' +
    '<span style="color:var(--vf)">◦</span> thinking <span style="margin-left:auto">▾</span></div>' +
    '<div class="thinking-body">'+esc(c.trim())+'</div></div>'
  );

  // Fenced code blocks
  s = s.replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/gm, (_,lang,code) => {
    const id = 'c'+Math.random().toString(36).slice(2,8);
    const lbl = lang ? '<span style="color:var(--vf);font-size:10px">'+esc(lang)+'</span>' : '';
    return '<pre>'+lbl+'<button class="copy-btn" onclick="copyCode(\''+id+'\')">copy</button>' +
           '<code id="'+id+'">'+esc(code.trimEnd())+'</code></pre>';
  });

  // Inline code
  s = s.replace(/\`([^\`\n]+)\`/g, '<code>$1</code>');

  // Tables
  s = s.replace(/((?:\|.+\|\n)+)/gm, block => {
    const rows = block.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return block;
    const isSep = r => /^\|[\s|:-]+\|$/.test(r);
    const cells = r => r.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    const hdrs  = cells(rows[0]).map(h=>'<th>'+esc(h)+'</th>').join('');
    const body  = rows.slice(2).filter(r=>!isSep(r))
      .map(r => '<tr>'+cells(r).map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('');
    return '<table><thead><tr>'+hdrs+'</tr></thead><tbody>'+body+'</tbody></table>';
  });

  // Headings
  s = s.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,'<h1>$1</h1>');

  // Bold/italic/strike
  s = s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,'<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g,'<del>$1</del>');

  // Blockquote
  s = s.replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>');

  // HR
  s = s.replace(/^---+$/gm,'<hr>');

  // Links + images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Lists (unordered then ordered)
  s = s.replace(/^[-*+] (.+)$/gm,'<li>$1</li>');
  s = s.replace(/(<li>.*<\/li>\n?)+/gs, m=>'<ul>'+m+'</ul>');
  s = s.replace(/^\d+\. (.+)$/gm,'<li>$1</li>');

  // Paragraphs — double newlines between non-block elements
  s = s.split('\n\n').map(block => {
    if (/^<(h[1-6]|ul|ol|li|pre|table|blockquote|hr|div)/.test(block.trim())) return block;
    return '<p>'+block.replace(/\n/g,'<br>')+'</p>';
  }).join('\n');

  return s;
}

// ── Message DOM ───────────────────────────────────────────────────────────────

function addMsg(role, content, stats){
  if (emptyEl) emptyEl.style.display = 'none';

  const wrap  = document.createElement('div');
  wrap.className = 'msg ' + role;

  const meta  = document.createElement('div');
  meta.className = 'msg-meta';

  const roleEl = document.createElement('span');
  roleEl.className = 'msg-role';
  roleEl.textContent = role === 'user' ? 'you' : 'arc';

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = ts();

  if (role === 'arc') {
    const modelEl2 = document.createElement('span');
    modelEl2.className = 'msg-model';
    modelEl2.textContent = '· ' + (modelEl.selectedOptions[0]?.text.split('—')[0].trim() ?? '');
    meta.append(roleEl, timeEl, modelEl2);
  } else {
    meta.append(roleEl, timeEl);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = role === 'user' ? '<p>'+esc(content)+'</p>' : (content || '<span class="cursor"></span>');

  wrap.append(meta, body);

  if (stats) {
    const statsEl = document.createElement('div');
    statsEl.className = 'msg-stats';
    statsEl.innerHTML =
      '<span class="stat-chip tok">'+stats.tokens+' tok</span>' +
      '<span class="stat-chip time">'+stats.duration+'</span>' +
      '<span class="stat-chip tps">'+stats.tps+'</span>';
    wrap.appendChild(statsEl);
  }

  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
  return body;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect(){
  ws = new WebSocket('ws://' + location.host + '/ws');

  ws.onopen = () => {
    dotEl.classList.remove('off');
    connEl.textContent = 'connected';
    startPing();
  };
  ws.onclose = () => {
    dotEl.classList.add('off');
    connEl.textContent = 'reconnecting…';
    streaming = false;
    sendEl.disabled = false;
    sendEl.textContent = 'Send ↵';
    setTimeout(connect, 2000);
  };
  ws.onerror = () => {
    dotEl.classList.add('off');
    connEl.textContent = 'error';
  };

  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'pong') { connEl.textContent = 'connected (' + Math.round(Date.now() - (msg.ts||Date.now())) + 'ms)'; return; }
    if (msg.type === 'token') {
      rawBuf += msg.token;
      if (currentEl) {
        currentEl.innerHTML = md(rawBuf) + '<span class="cursor"></span>';
        // Auto-scroll only if near bottom
        const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
        if (nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
      }
    }
    else if (msg.type === 'done') {
      if (currentEl) {
        currentEl.innerHTML = md(rawBuf);
        // Append stats to parent .msg
        const statsEl = document.createElement('div');
        statsEl.className = 'msg-stats';
        statsEl.innerHTML =
          '<span class="stat-chip tok">'+msg.tokens+' tok</span>' +
          '<span class="stat-chip time">'+msg.duration+'</span>' +
          '<span class="stat-chip tps">'+msg.tps+'</span>';
        currentEl.parentElement?.appendChild(statsEl);
      }
      currentEl = null;
      rawBuf    = '';
      streaming = false;
      sendEl.disabled  = false;
      sendEl.textContent = 'Send ↵';
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    else if (msg.type === 'error') {
      if (currentEl) {
        currentEl.innerHTML = '<span style="color:var(--re)">✗ '+esc(msg.error)+'</span>';
      }
      currentEl = null;
      rawBuf    = '';
      streaming = false;
      sendEl.disabled  = false;
      sendEl.textContent = 'Send ↵';
    }
  };
}
connect();

// ── Send ──────────────────────────────────────────────────────────────────────

function doSend(){
  const text = promptEl.value.trim();
  if (!text) { promptEl.focus(); return; }
  if (streaming) { showToast('Wait for response to finish…'); return; }
  if (!ws || ws.readyState !== 1) {
    showToast('Not connected — reconnecting…', 'var(--re)');
    return;
  }

  // User bubble
  addMsg('user', text, null);

  // Arc bubble (streaming placeholder)
  currentEl = addMsg('arc', '', null);
  rawBuf    = '';

  streaming = true;
  sendEl.disabled   = true;
  sendEl.textContent = 'Streaming…';

  ws.send(JSON.stringify({ type:'chat', model: modelEl.value, text }));

  promptEl.value = '';
  promptEl.style.height = 'auto';
}

// ── Send handlers ────────────────────────────────────────────────────────────
function showToast(msg, color){
  let t = document.getElementById('toast');
  if (!t){ t = document.createElement('div'); t.id='toast';
    Object.assign(t.style, {
      position:'fixed',bottom:'80px',left:'50%',transform:'translateX(-50%)',
      background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'6px',
      padding:'8px 16px',fontSize:'12px',color:'var(--sd)',zIndex:'999',
      transition:'opacity .3s',pointerEvents:'none',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.color = color || 'var(--sd)';
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.style.opacity = '0', 2000);
}

sendEl.addEventListener('click', e => {
  e.preventDefault();
  doSend();
});

promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    doSend();
    return;
  }
  // Shift+Enter = newline (default textarea behaviour — do nothing)
  // Auto-resize
  requestAnimationFrame(() => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + 'px';
  });
});

clrEl.addEventListener('click', () => {
  chatEl.innerHTML = '';
  chatEl.appendChild(emptyEl);
  emptyEl.style.display = '';
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); clrEl.click(); return; }
  // Focus prompt on printable keys EXCEPT Enter (that belongs to promptEl)
  if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && e.key !== '\n' && document.activeElement !== promptEl) {
    promptEl.focus();
  }
});

promptEl.focus();
</script>
</body>
</html>`;
}

// ── WebSocket session ─────────────────────────────────────────────────────────

interface WsSession {
  socket:  any;
  history: ArcMessage[];
  acc:     WsFrameAccumulator;
}

function wsSend(session: WsSession, obj: object): void {
  try { session.socket.write(wsEncode(JSON.stringify(obj))); } catch { /* closed */ }
}

async function handleMessage(session: WsSession, raw: string): Promise<void> {
  if (raw === '__close__') return;
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'clear') { session.history = []; return; }
  if (msg.type === 'ping')  { wsSend(session, { type: 'pong', ts: Date.now() }); return; }
  if (msg.type !== 'chat')  return;

  const [backendId, modelId] = String(msg.model).split('::');
  const allModels = await registry.loadAllModels();
  const rm = allModels.find(m =>
    m.backend.info.id === backendId && m.model.id === modelId
  );

  if (!rm) {
    wsSend(session, { type:'error', error:`Model not found: ${msg.model}` });
    return;
  }

  session.history.push({ role:'user', content: msg.text });

  let   tokenCount = 0;
  let   full       = '';
  const start      = Date.now();

  try {
    await rm.backend.stream(rm.model, session.history, {
      onToken: (token) => {
        tokenCount++;
        full += token;
        wsSend(session, { type:'token', token });
      },
    });

    session.history.push({ role:'assistant', content: full.trim() });

    const ms  = Date.now() - start;
    const tps = (tokenCount / Math.max(ms / 1000, 0.001)).toFixed(1);
    const dur = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

    wsSend(session, { type:'done', tokens:tokenCount, tps:`${tps} tok/s`, duration:dur });
  } catch (err: any) {
    wsSend(session, { type:'error', error: err.message });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function serveMode(port = 7070, host = '127.0.0.1'): Promise<void> {
  console.log(`\n${V}◈ arc serve${R}  ${SD}Starting…${R}\n`);

  const { Spinner } = await import('./icons');
  const sp = new Spinner(undefined, 'Detecting backends…');
  sp.start();
  const allModels = await registry.loadAllModels();
  sp.stop();

  if (allModels.length === 0) {
    console.log(`  ${RE}✗${R} No models found. Install Ollama, llama-server, or llama-cli?\n`);
    return;
  }

  const modelList = allModels.map(m => ({ id:m.model.id, name:m.model.name, backend:m.backend.info.id }));
  const html      = buildHTML(modelList);
  const sessions  = new Map<any, WsSession>();

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    wsHandshake(req, socket);

    const session: WsSession = { socket, history:[], acc: new WsFrameAccumulator() };
    sessions.set(socket, session);

    socket.on('data', (chunk: Buffer) => {
      const messages = session.acc.feed(chunk);
      for (const msg of messages) {
        handleMessage(session, msg).catch(e => {
          wsSend(session, { type:'error', error: String(e.message) });
        });
      }
    });
    socket.on('close', () => sessions.delete(socket));
    socket.on('error', () => sessions.delete(socket));
  });

  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`  ${GR}✓${R} Running at ${CY}${url}${R}`);
    console.log(`  ${GR}✓${R} ${modelList.length} model${modelList.length !== 1 ? 's' : ''} available`);
    console.log(`  ${SD}Ctrl+C to stop${R}\n`);
    try {
      require('child_process').execSync(`xdg-open ${url} 2>/dev/null`, { stdio:'ignore' });
    } catch { /* ok */ }
  });

  await new Promise<void>(() => {
    process.on('SIGINT', () => {
      console.log(`\n  ${SD}arc serve stopped.${R}\n`);
      server.close();
      process.exit(0);
    });
  });
}
