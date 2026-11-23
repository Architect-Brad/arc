// ─────────────────────────────────────────────────────────────────────────────
// arc_render — standalone ANSI markdown renderer (arc --pipe / --render)
//
// stdin / files → block parser → renderer → ANSI → stdout
//
// Brings up in ~1-5ms and renders at native speed. Mirrors the TS pipeline
// (parser.ts → renderer.ts → inline.ts → table.ts → theme.ts) closely enough
// to look the same on your terminal.
// ─────────────────────────────────────────────────────────────────────────────

#![allow(clippy::too_many_arguments)]

use std::io::{self, BufRead, Write};
use std::process;

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const RST: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const ITAL: &str = "\x1b[3m";
const UNDL: &str = "\x1b[4m";
const STRK: &str = "\x1b[9m";

fn fg(r: u8, g: u8, b: u8) -> String { format!("\x1b[38;2;{};{};{}m", r, g, b) }
fn bg(r: u8, g: u8, b: u8) -> String { format!("\x1b[48;2;{};{};{}m", r, g, b) }

// Palette — matches src/theme.ts
const VIOLET:      (u8, u8, u8) = (139, 92, 246);
const VIOLET_L:    (u8, u8, u8) = (167, 139, 250);
const VIOLET_F:    (u8, u8, u8) = (196, 181, 253);
const SLATE_L:     (u8, u8, u8) = (226, 232, 240);
const SLATE:       (u8, u8, u8) = (148, 163, 184);
const SLATE_D:     (u8, u8, u8) = (100, 116, 139);
const CODE_BG:     (u8, u8, u8) = (15, 15, 30);
const CODE_BORDER: (u8, u8, u8) = (55, 48, 107);
const INLINE_BG:   (u8, u8, u8) = (30, 27, 75);
const INLINE_TEXT: (u8, u8, u8) = (167, 139, 250);
const QUOTE_BAR:   (u8, u8, u8) = (124, 58, 237);
const QUOTE_TEXT:  (u8, u8, u8) = (148, 163, 184);
const LINK_COLOR:  (u8, u8, u8) = (96, 165, 250);
const BULLET:      (u8, u8, u8) = (139, 92, 246);
const HR_COLOR:    (u8, u8, u8) = (71, 85, 105);
const TABLE_HEAD:  (u8, u8, u8) = (139, 92, 246);
const TABLE_BORDER:(u8, u8, u8) = (55, 48, 107);

// Syntax highlighting palette
const SYN_KW:  (u8, u8, u8) = (197, 165, 197);
const SYN_STR: (u8, u8, u8) = (152, 195, 121);
const SYN_CMT: (u8, u8, u8) = (92, 99, 112);
const SYN_NUM: (u8, u8, u8) = (229, 192, 123);
const SYN_FN:  (u8, u8, u8) = (97, 175, 239);
const SYN_TY:  (u8, u8, u8) = (230, 160, 100);
const SYN_OP:  (u8, u8, u8) = (86, 182, 194);
const SYN_PL:  (u8, u8, u8) = (187, 187, 187);

fn s_fg(c: (u8, u8, u8)) -> String { fg(c.0, c.1, c.2) }
fn s_bg(c: (u8, u8, u8)) -> String { bg(c.0, c.1, c.2) }

fn strip_ansi(s: &str) -> String {
    let bytes = s.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        if bytes[i] == 0x1b && i + 1 < n {
            if bytes[i + 1] == b'[' {
                i += 2;
                while i < n { let b = bytes[i]; i += 1; if (0x40..=0x7e).contains(&b) { break; } }
                continue;
            }
            if bytes[i + 1] == b']' {
                i += 2;
                while i < n {
                    if bytes[i] == 0x07 { i += 1; break; }
                    if bytes[i] == 0x1b && i + 1 < n && bytes[i + 1] == b'\\' { i += 2; break; }
                    i += 1;
                }
                continue;
            }
            i += 2;
            continue;
        }
        let clen = utf8_len(bytes[i]);
        if i + clen <= n { out.push_str(&s[i..i + clen]); }
        i += clen;
    }
    out
}

fn visible_length(s: &str) -> usize { strip_ansi(s).chars().count() }

fn utf8_len(b: u8) -> usize {
    if b < 0x80 { 1 } else if b < 0xE0 { 2 } else if b < 0xF0 { 3 } else { 4 }
}

fn pad_end(s: &str, width: usize) -> String {
    let v = visible_length(s);
    if v >= width { s.to_string() } else { format!("{}{}", s, " ".repeat(width - v)) }
}

fn is_punct(c: char) -> bool {
    matches!(c, '!'|'"'|'#'|'$'|'%'|'&'|'\''|'('|')'|'*'|'+'|','|'-'|'.'|'/'|':'|';'|'<'|'='|'>'|'?'|'@'|'['|'\\'|']'|'^'|'_'|'`'|'{'|'|'|'}'|'~')
}

// ── Syntax highlighter (ported from main.rs) ─────────────────────────────────

fn keywords_for(lang: &str) -> &'static [&'static str] {
    match lang {
        "javascript" | "js" => &[
            "const","let","var","function","class","return","if","else","for","while",
            "do","switch","case","break","continue","new","delete","typeof","instanceof",
            "in","of","import","export","default","from","async","await","try","catch",
            "finally","throw","void","this","super","static","null","undefined","true",
            "false","yield","debugger",
        ],
        "typescript" | "ts" => &[
            "const","let","var","function","class","return","if","else","for","while",
            "import","export","async","await","type","interface","enum","implements",
            "declare","abstract","readonly","keyof","infer","never","unknown","any",
            "null","undefined","true","false","this","super","static","from","default",
            "extends","new","throw","typeof","in","of","as","namespace","module",
        ],
        "python" | "py" => &[
            "def","class","return","if","elif","else","for","while","with","as",
            "import","from","in","not","and","or","is","lambda","try","except",
            "finally","raise","pass","break","continue","global","nonlocal","del",
            "yield","assert","True","False","None","async","await","self","cls",
        ],
        "rust" | "rs" => &[
            "fn","let","mut","pub","use","mod","struct","enum","impl","trait","for",
            "while","if","else","match","return","self","Self","super","crate","const",
            "static","type","where","ref","move","async","await","dyn","box","loop",
            "break","continue","true","false","Some","None","Ok","Err","extern","unsafe",
        ],
        "go" => &[
            "func","var","const","type","struct","interface","map","chan","go","select",
            "defer","return","if","else","for","range","switch","case","break","continue",
            "fallthrough","goto","import","package","nil","true","false","iota","make",
            "new","len","cap","append","copy","delete","close","panic","recover",
        ],
        "bash" | "sh" | "shell" => &[
            "if","then","else","elif","fi","for","while","do","done","case","esac",
            "function","return","local","export","echo","cd","ls","mkdir","rm","cp",
            "mv","cat","grep","sed","awk","find","source","unset","readonly","declare",
            "in","select","until","break","continue","read","exit","true","false",
        ],
        "c" | "cpp" | "c++" => &[
            "int","char","float","double","long","short","unsigned","signed","void",
            "struct","union","enum","typedef","return","if","else","for","while","do",
            "switch","case","break","continue","goto","sizeof","const","static","extern",
            "register","volatile","inline","auto","true","false","nullptr","NULL",
            "class","public","private","protected","namespace","template","typename",
            "virtual","override","new","delete","this",
        ],
        "java" => &[
            "public","private","protected","class","interface","extends","implements",
            "return","if","else","for","while","do","switch","case","break","continue",
            "new","import","package","static","final","void","null","true","false",
            "this","super","abstract","synchronized","volatile","try","catch","finally",
            "throw","throws","instanceof","enum","record","var",
        ],
        "sql" => &[
            "SELECT","FROM","WHERE","JOIN","LEFT","RIGHT","INNER","OUTER","CROSS",
            "ON","AS","AND","OR","NOT","IN","IS","NULL","ORDER","BY","GROUP","HAVING",
            "LIMIT","OFFSET","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE",
            "TABLE","INDEX","DROP","ALTER","ADD","COLUMN","PRIMARY","KEY","FOREIGN",
            "REFERENCES","DISTINCT","COUNT","SUM","AVG","MAX","MIN","COALESCE","CASE",
            "WHEN","THEN","ELSE","END","WITH","UNION","ALL","EXISTS","LIKE","BETWEEN",
        ],
        _ => &[],
    }
}

fn resolve_lang(lang: &str) -> &'static str {
    match lang.to_lowercase().as_str() {
        "js" => "javascript",
        "ts" => "typescript",
        "py" => "python",
        "rs" => "rust",
        "sh" | "shell" => "bash",
        "cpp" | "c++" => "c",
        "c" => "c",
        "go" => "go",
        "java" => "java",
        "sql" => "sql",
        "javascript" => "javascript",
        "typescript" => "typescript",
        "python" => "python",
        "rust" => "rust",
        "bash" => "bash",
        _ => "plain",
    }
}

fn highlight_line(line: &str, lang: &str) -> String {
    let lang = resolve_lang(lang);
    let kws  = keywords_for(lang);

    let mut out = String::with_capacity(line.len() * 5);
    out.push_str(&s_fg(SYN_PL));

    let bytes = line.as_bytes();
    let n     = bytes.len();
    let mut i = 0;

    let is_id  = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let is_dig = |c: u8| c.is_ascii_digit();

    let single_comment: Option<&[u8]> = match lang {
        "javascript" | "typescript" | "rust" | "go" | "c" | "java" | "cpp" => Some(b"//"),
        "python" | "bash" | "ruby" => Some(b"#"),
        "sql" => Some(b"--"),
        _ => None,
    };

    while i < n {
        if let Some(prefix) = single_comment {
            if bytes[i..].starts_with(prefix) {
                out.push_str(&s_fg(SYN_CMT));
                out.push_str(DIM);
                out.push_str(&line[i..]);
                out.push_str(RST);
                return out;
            }
        }

        if bytes[i] == b'"' || bytes[i] == b'\'' || (bytes[i] == b'`' && matches!(lang, "javascript" | "typescript")) {
            let q = bytes[i];
            let start = i;
            i += 1;
            while i < n {
                if bytes[i] == b'\\' { i += 2; continue; }
                if bytes[i] == q    { i += 1; break; }
                i += 1;
            }
            out.push_str(&s_fg(SYN_STR));
            out.push_str(&line[start..i]);
            out.push_str(&s_fg(SYN_PL));
            continue;
        }

        if i + 1 < n && bytes[i] == b'0' && (bytes[i + 1] == b'x' || bytes[i + 1] == b'X') {
            let start = i;
            i += 2;
            while i < n && bytes[i].is_ascii_hexdigit() { i += 1; }
            out.push_str(&s_fg(SYN_NUM));
            out.push_str(&line[start..i]);
            out.push_str(&s_fg(SYN_PL));
            continue;
        }

        if is_dig(bytes[i]) || (bytes[i] == b'.' && i + 1 < n && is_dig(bytes[i + 1])) {
            let start = i;
            while i < n && (is_dig(bytes[i]) || bytes[i] == b'.' || bytes[i] == b'e' || bytes[i] == b'E' ||
                            bytes[i] == b'f' || bytes[i] == b'u' || bytes[i] == b'l' || bytes[i] == b'L') { i += 1; }
            out.push_str(&s_fg(SYN_NUM));
            out.push_str(&line[start..i]);
            out.push_str(&s_fg(SYN_PL));
            continue;
        }

        if is_id(bytes[i]) && !is_dig(bytes[i]) {
            let start = i;
            while i < n && is_id(bytes[i]) { i += 1; }
            let word = &line[start..i];

            if kws.contains(&word) {
                out.push_str(&s_fg(SYN_KW));
                out.push_str(word);
                out.push_str(&s_fg(SYN_PL));
            } else if word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                out.push_str(&s_fg(SYN_TY));
                out.push_str(word);
                out.push_str(&s_fg(SYN_PL));
            } else if i < n && bytes[i] == b'(' {
                out.push_str(&s_fg(SYN_FN));
                out.push_str(word);
                out.push_str(&s_fg(SYN_PL));
            } else {
                out.push_str(word);
            }
            continue;
        }

        if b"+-*/%=<>&|^~!?:".contains(&bytes[i]) {
            out.push_str(&s_fg(SYN_OP));
            out.push(bytes[i] as char);
            out.push_str(&s_fg(SYN_PL));
            i += 1;
            continue;
        }

        let clen = utf8_len(bytes[i]);
        if i + clen <= n { out.push_str(&line[i..i + clen]); }
        i += clen;
    }

    out.push_str(RST);
    out
}

fn highlight(code: &str, lang: &str) -> String {
    let mut out = String::with_capacity(code.len() * 5);
    let mut first = true;
    for line in code.split('\n') {
        if !first { out.push('\n'); }
        first = false;
        out.push_str(&highlight_line(line, lang));
    }
    out
}

// ── Inline renderer (ported from inline.ts) ──────────────────────────────────

fn inline_code(t: &str) -> String {
    format!("{}{} {} {}{}", s_bg(INLINE_BG), s_fg(INLINE_TEXT), t, "", RST)
}

fn link_text(label: &str, url: &str) -> String {
    format!("{}{}{}{}{} ({}){}", UNDL, s_fg(LINK_COLOR), label, RST, s_fg(SLATE_D), url, RST)
}

fn emoji(code: &str) -> Option<&'static str> {
    match code {
        ":warning:" => Some("⚠"),
        ":check:" => Some("✓"),
        ":x:" => Some("✗"),
        ":rocket:" => Some("🚀"),
        ":fire:" => Some("🔥"),
        ":star:" => Some("⭐"),
        ":bulb:" => Some("💡"),
        ":wrench:" => Some("🔧"),
        ":bug:" => Some("🐛"),
        ":tada:" => Some("🎉"),
        ":eyes:" => Some("👀"),
        ":wave:" => Some("👋"),
        ":thumbsup:" => Some("👍"),
        ":heart:" => Some("❤"),
        ":zap:" => Some("⚡"),
        ":lock:" => Some("🔒"),
        ":key:" => Some("🔑"),
        ":link:" => Some("🔗"),
        ":memo:" => Some("📝"),
        ":books:" => Some("📚"),
        ":gear:" => Some("⚙"),
        ":white_check_mark:" => Some("✅"),
        ":heavy_check_mark:" => Some("✓"),
        _ => None,
    }
}

fn strip_html(s: &str) -> String {
    let bytes = s.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    const TAGS: &[&str] = &[
        "details","summary","div","span","section","article","aside","nav",
        "header","footer","figure","figcaption","main",
    ];
    while i < n {
        if bytes[i] == b'<' {
            if s[i..].starts_with("<!--") {
                if let Some(end) = s[i + 4..].find("-->") {
                    i += 4 + end + 3;
                    continue;
                }
            }
            let mut j = i + 1;
            if j < n && bytes[j] == b'/' { j += 1; }
            let name_start = j;
            while j < n && bytes[j].is_ascii_alphanumeric() { j += 1; }
            let name = &s[name_start..j];
            if !name.is_empty() && TAGS.iter().any(|t| t.eq_ignore_ascii_case(name)) {
                while j < n && bytes[j] != b'>' { j += 1; }
                if j < n { j += 1; }
                i = j;
                continue;
            }
        }
        let clen = utf8_len(bytes[i]);
        if i + clen <= n { out.push_str(&s[i..i + clen]); }
        i += clen;
    }
    out
}

fn consume_code(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut ticks = 0;
    let mut i = start;
    while i < chars.len() && chars[i] == '`' { ticks += 1; i += 1; }
    let delim: String = "`".repeat(ticks);
    let rest: String = chars[i..].iter().collect();
    if let Some(byte_off) = rest.find(&delim) {
        // rest.find returns a BYTE offset — convert to char index before
        // indexing into `chars` (multi-byte chars shift everything)
        let off = rest[..byte_off].chars().count();
        if chars.get(i + off + ticks) == Some(&'`') { return None; }
        let content: String = chars[i..i + off].iter().collect::<String>().trim().to_string();
        return Some((content, i + off + ticks));
    }
    None
}

fn consume_span(chars: &[char], start: usize, dlen: usize) -> Option<(String, usize)> {
    let i = start + dlen;
    if i >= chars.len() { return None; }
    if chars[i] == ' ' { return None; }
    let rest: String = chars[i..].iter().collect();
    let delim: String = std::iter::repeat(chars[start]).take(dlen).collect();
    let byte_off = rest.find(&delim)?;
    let close = i + rest[..byte_off].chars().count();
    if close == i { return None; }
    if chars[close - 1] == ' ' { return None; }
    if dlen == 1 && chars[i..close].contains(&'\n') { return None; }
    Some((chars[i..close].iter().collect(), close + dlen))
}

struct ConsumedLink { label: String, href: String, end: usize }

fn consume_link(chars: &[char], start: usize) -> Option<ConsumedLink> {
    if chars[start] != '[' { return None; }
    let mut i = start + 1;
    let mut depth = 1;
    let mut label_end: Option<usize> = None;
    while i < chars.len() {
        match chars[i] {
            '[' => depth += 1,
            ']' => { depth -= 1; if depth == 0 { label_end = Some(i); break; } }
            '\\' => { i += 1; }
            _ => {}
        }
        i += 1;
    }
    let label_end = label_end?;
    let label: String = chars[start + 1..label_end].iter().collect();

    // Inline link [label](url) or [label](url "title")
    if chars.get(label_end + 1) == Some(&'(') {
        let mut close_p = label_end + 2;
        while close_p < chars.len() && chars[close_p] != ')' { close_p += 1; }
        if close_p >= chars.len() { return None; }
        let inner: String = chars[label_end + 2..close_p].iter().collect();
        let href = strip_title(&inner);
        return Some(ConsumedLink { label, href, end: close_p + 1 });
    }

    // Reference link [label][ref]
    if chars.get(label_end + 1) == Some(&'[') {
        let mut close_r = label_end + 2;
        while close_r < chars.len() && chars[close_r] != ']' { close_r += 1; }
        if close_r >= chars.len() { return None; }
        let href: String = chars[label_end + 2..close_r].iter().collect();
        let href = if href.is_empty() { label.clone() } else { href };
        return Some(ConsumedLink { label, href, end: close_r + 1 });
    }

    None
}

fn strip_title(inner: &str) -> String {
    let s = inner.trim();
    if s.len() < 2 || !s.ends_with('"') { return s.to_string(); }
    let body = &s[..s.len() - 1];
    if let Some(open) = body.rfind('"') {
        let before = &body[..open];
        if !before.ends_with(' ') { return s.to_string(); }
        return before.trim_end().to_string();
    }
    s.to_string()
}

fn is_email_start(s: &str) -> bool {
    let mut ok = false;
    for c in s.chars() {
        if c == '@' { return ok; }
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-') { ok = true; } else { return false; }
    }
    false
}

fn process_inline(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(text.len() * 2);
    let mut i = 0;

    while i < n {
        let c = chars[i];

        // Escape
        if c == '\\' && i + 1 < n && is_punct(chars[i + 1]) {
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }

        // Inline code
        if c == '`' {
            if let Some((content, end)) = consume_code(&chars, i) {
                out.push_str(&inline_code(&content));
                i = end;
                continue;
            }
        }

        // Math $...$
        if c == '$' && (i + 1 >= n || chars[i + 1] != '$') {
            if let Some(close) = chars[i + 1..].iter().position(|&x| x == '$') {
                let close_abs = i + 1 + close;
                if close > 0 {
                    let expr: String = chars[i + 1..i + 1 + close].iter().collect();
                    out.push_str(&format!("{}{}⟨{}⟩{}", s_fg(VIOLET_F), DIM, expr, RST));
                    i = close_abs + 1;
                    continue;
                }
            }
        }

        // Image ![alt](url)
        if c == '!' && chars.get(i + 1) == Some(&'[') {
            if let Some(link) = consume_link(&chars, i + 1) {
                out.push_str(&format!("{}{}[img: {}]{}", s_fg(SLATE_D), DIM, link.label, RST));
                i = link.end;
                continue;
            }
        }

        // Link [label](url) / [label][ref]
        if c == '[' {
            if let Some(link) = consume_link(&chars, i) {
                let label = process_inline(&link.label);
                out.push_str(&link_text(&label, &link.href));
                i = link.end;
                continue;
            }
        }

        // Autolink <http://...> / <email>
        if c == '<' {
            if let Some(close_off) = chars[i + 1..].iter().position(|&x| x == '>') {
                let close = i + 1 + close_off;
                if close > i + 1 {
                    let inner: String = chars[i + 1..close].iter().collect();
                    if inner.starts_with("http://") || inner.starts_with("https://") || is_email_start(&inner) {
                        out.push_str(&link_text(&inner, &inner));
                        i = close + 1;
                        continue;
                    }
                }
            }
        }

        // Emoji shortcode :name:
        if c == ':' {
            if let Some(close_off) = chars[i + 1..].iter().position(|&x| x == ':') {
                let close = i + 1 + close_off;
                if close_off >= 1 && close < i + 30 {
                    let code: String = chars[i..=close].iter().collect();
                    if let Some(e) = emoji(&code) {
                        out.push_str(e);
                        i = close + 1;
                        continue;
                    }
                }
            }
        }

        // ***bolditalic*** / ___bolditalic___
        if (c == '*' || c == '_')
            && chars.get(i + 1) == Some(&c) && chars.get(i + 2) == Some(&c) {
            if let Some((content, end)) = consume_span(&chars, i, 3) {
                out.push_str(&format!("{}{}{}{}{}", BOLD, ITAL, s_fg(VIOLET_F), process_inline(&content), RST));
                i = end;
                continue;
            }
        }

        // **bold** / __bold__
        if (c == '*' || c == '_') && chars.get(i + 1) == Some(&c) {
            if let Some((content, end)) = consume_span(&chars, i, 2) {
                out.push_str(&format!("{}{}{}{}", BOLD, s_fg(SLATE_L), process_inline(&content), RST));
                i = end;
                continue;
            }
        }

        // *italic* / _italic_
        if c == '*' || (c == '_' && (i == 0 || chars[i - 1].is_whitespace())) {
            if let Some((content, end)) = consume_span(&chars, i, 1) {
                out.push_str(&format!("{}{}{}{}", ITAL, s_fg(SLATE), process_inline(&content), RST));
                i = end;
                continue;
            }
        }

        // ~~strike~~
        if c == '~' && chars.get(i + 1) == Some(&'~') {
            if let Some((content, end)) = consume_span(&chars, i, 2) {
                out.push_str(&format!("{}{}{}{}", STRK, s_fg(SLATE_D), process_inline(&content), RST));
                i = end;
                continue;
            }
        }

        // ==highlight==
        if c == '=' && chars.get(i + 1) == Some(&'=') {
            if let Some((content, end)) = consume_span(&chars, i, 2) {
                out.push_str(&format!("{}{}{}{}{}", s_bg((80, 60, 10)), s_fg((250, 204, 21)), content, RST, ""));
                i = end;
                continue;
            }
        }

        // [[kbd]]
        if c == '[' && chars.get(i + 1) == Some(&'[') {
            let prev = if i > 0 { chars[i - 1] } else { '\0' };
            if prev != '!' && prev != ']' && prev != '[' {
                if let Some(close_off) = chars[i + 2..].iter().position(|&x| x == ']') {
                    let close = i + 2 + close_off;
                    // need matching [[ ]] pair
                    if chars.get(close + 1) == Some(&']') {
                        let key: String = chars[i + 2..close].iter().collect();
                        if key.chars().count() <= 20 && !key.contains('\n') {
                            out.push_str(&format!("{}{}{}{}", s_bg((30, 27, 60)), s_fg(VIOLET_F), key, RST));
                            i = close + 2;
                            continue;
                        }
                    }
                }
            }
        }

        // Default char
        out.push(c);
        i += 1;
    }

    out
}

fn render_inline(text: &str) -> String {
    let stripped = strip_html(text);
    process_inline(&stripped)
}

// ── Block-level parser (ported from parser.ts) ───────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: usize, text: String },
    Code { lang: String, code: String, kind: CodeKind },
    Blockquote { text: String },
    ListItem { text: String, ordered: bool, index: usize, depth: usize },
    Hr,
    Table { headers: Vec<String>, rows: Vec<Vec<String>>, align: Vec<Option<Align>> },
    Paragraph { text: String },
    Blank,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CodeKind { Code, Mermaid, Svg, Chartjs }

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Align { Left, Center, Right }

const HTML_BLOCK_TAGS: &[&str] = &[
    "details","summary","div","section","article","aside","nav","header","footer","figure","main",
];

fn is_html_block_tag(line: &str) -> bool {
    let t = line.trim();
    if !t.starts_with('<') { return false; }
    let mut j = 1;
    if t.as_bytes().get(j).map(|&b| b == b'/').unwrap_or(false) { j += 1; }
    let start = j;
    while j < t.len() && t.as_bytes()[j].is_ascii_alphanumeric() { j += 1; }
    let name = &t[start..j];
    if name.is_empty() || !HTML_BLOCK_TAGS.iter().any(|x| x.eq_ignore_ascii_case(name)) { return false; }
    t[j..].trim_start().starts_with('>') || t[j..].starts_with(' ') || t[j..].starts_with('/')
}

pub struct BlockAccumulator {
    in_code: bool,
    code_lang: String,
    code_lines: Vec<String>,
    in_table: bool,
    table_headers: Vec<String>,
    table_align: Vec<Option<Align>>,
    table_rows: Vec<Vec<String>>,
    list_index: usize,
}

impl BlockAccumulator {
    pub fn new() -> Self {
        Self {
            in_code: false, code_lang: String::new(), code_lines: vec![],
            in_table: false, table_headers: vec![], table_align: vec![], table_rows: vec![],
            list_index: 0,
        }
    }

    pub fn feed(&mut self, line: &str) -> Vec<Block> {
        // Code fence open
        if !self.in_code {
            if let Some(caps) = match_fence(line) {
                self.in_code = true;
                self.code_lang = caps.to_lowercase();
                self.code_lines.clear();
                return vec![];
            }
        }
        // Code fence close
        if self.in_code && line.starts_with("```") {
            return vec![self.take_code_block()];
        }
        if self.in_code {
            self.code_lines.push(line.to_string());
            return vec![];
        }
        // HTML block tags — strip silently
        if is_html_block_tag(line) { return vec![]; }
        // HTML comments
        if line.trim_start().starts_with("<!--") { return vec![]; }
        // Blank
        if line.trim().is_empty() {
            let mut out = vec![];
            if let Some(t) = self.take_table_block() { out.push(t); }
            self.list_index = 0;
            out.push(Block::Blank);
            return out;
        }
        // HR
        {
            let t = line.trim();
            if t == "---" || t == "===" || t == "***" || t == "___" {
                return vec![Block::Hr];
            }
        }
        // Headings
        if let Some((level, text)) = match_heading(line) {
            let mut out = vec![];
            if let Some(t) = self.take_table_block() { out.push(t); }
            out.push(Block::Heading { level, text });
            return out;
        }
        // Blockquote
        if let Some(text) = match_blockquote(line) {
            return vec![Block::Blockquote { text }];
        }
        // Unordered list
        if let Some((text, depth)) = match_ul(line) {
            return vec![Block::ListItem { text, ordered: false, index: 0, depth }];
        }
        // Ordered list
        if let Some((text, index, depth)) = match_ol(line) {
            self.list_index = index;
            return vec![Block::ListItem { text, ordered: true, index, depth }];
        }
        // Table
        if line.contains('|') {
            let cells = split_table_row(line);
            if !cells.is_empty() {
                if cells.iter().all(|c| is_separator_cell(c)) {
                    self.table_align = cells.iter().map(|c| {
                        let t = c.trim();
                        let mut a: Option<Align> = None;
                        if t.starts_with(':') && t.ends_with(':') { a = Some(Align::Center); }
                        else if t.ends_with(':') { a = Some(Align::Right); }
                        else if t.starts_with(':') { a = Some(Align::Left); }
                        a
                    }).collect();
                    return vec![];
                }
                if !self.in_table {
                    self.in_table = true;
                    self.table_headers = cells;
                    self.table_rows.clear();
                    return vec![];
                } else {
                    self.table_rows.push(cells);
                    return vec![];
                }
            }
        }
        // Flush table if we hit a non-table line
        let mut out = vec![];
        if let Some(t) = self.take_table_block() { out.push(t); }
        out.push(Block::Paragraph { text: line.to_string() });
        out
    }

    pub fn flush(&mut self) -> Vec<Block> {
        let mut out = vec![];
        if self.in_code {
            out.push(self.take_code_block());
        }
        if let Some(t) = self.take_table_block() { out.push(t); }
        out
    }

    fn take_code_block(&mut self) -> Block {
        let lang = self.code_lang.to_lowercase();
        let kind = match lang.as_str() {
            "mermaid" => CodeKind::Mermaid,
            "svg"     => CodeKind::Svg,
            "chartjs" | "chart" => CodeKind::Chartjs,
            _ => CodeKind::Code,
        };
        let code = self.code_lines.join("\n");
        self.in_code = false;
        self.code_lines.clear();
        Block::Code { lang, code, kind }
    }

    fn take_table_block(&mut self) -> Option<Block> {
        if !self.in_table && self.table_headers.is_empty() && self.table_rows.is_empty() {
            return None;
        }
        self.in_table = false;
        Some(Block::Table {
            headers: std::mem::take(&mut self.table_headers),
            rows:    std::mem::take(&mut self.table_rows),
            align:   std::mem::take(&mut self.table_align),
        })
    }
}

fn match_fence(line: &str) -> Option<String> {
    let t = line.trim_start();
    if !t.starts_with("```") { return None; }
    let rest = &t[3..];
    let lang: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    Some(lang)
}

fn match_heading(line: &str) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let mut level = 0;
    while level < bytes.len() && bytes[level] == b'#' { level += 1; }
    if level == 0 || level > 6 { return None; }
    if bytes.get(level) == Some(&b' ') {
        let text = line[level + 1..].trim_end_matches(['\r', '\n']).trim().to_string();
        Some((level, text))
    } else {
        None
    }
}

fn match_blockquote(line: &str) -> Option<String> {
    if !line.starts_with('>') { return None; }
    let rest = if line[1..].starts_with(' ') { &line[2..] } else { &line[1..] };
    Some(rest.trim_end().to_string())
}

fn match_ul(line: &str) -> Option<(String, usize)> {
    let indent = line.chars().take_while(|c| *c == ' ').count();
    let rest = line.trim_start();
    for prefix in ["- ", "* ", "+ "] {
        if let Some(text) = rest.strip_prefix(prefix) {
            return Some((text.trim_end().to_string(), indent / 2));
        }
    }
    None
}

fn match_ol(line: &str) -> Option<(String, usize, usize)> {
    let indent = line.chars().take_while(|c| *c == ' ').count();
    let rest = line.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { return None; }
    let after = &rest[digits.len()..];
    if after.starts_with(". ") {
        let index: usize = digits.parse().unwrap_or(1);
        let text = after[2..].trim_end().to_string();
        return Some((text, index, indent / 2));
    }
    None
}

fn split_table_row(line: &str) -> Vec<String> {
    let mut s = line.trim();
    if s.starts_with('|') { s = &s[1..]; }
    if s.ends_with('|')   { s = &s[..s.len() - 1]; }
    s.split('|').map(|c| c.trim().to_string()).collect()
}

fn is_separator_cell(c: &str) -> bool {
    let t = c.trim();
    !t.is_empty() && t.contains('-') && t.chars().all(|c| c == '-' || c == ':')
}

// ── Table renderer (ported from table.ts) ─────────────────────────────────────

fn align_cell(text: &str, width: usize, align: Option<Align>) -> String {
    let vis = visible_length(text);
    if vis >= width { return text.to_string(); }
    let pad = width - vis;
    match align {
        Some(Align::Right)  => format!("{}{}", " ".repeat(pad), text),
        Some(Align::Center) => {
            let left = pad / 2;
            let right = pad - left;
            format!("{}{}{}", " ".repeat(left), text, " ".repeat(right))
        }
        _ => format!("{}{}", text, " ".repeat(pad)),
    }
}

fn calc_col_widths(headers: &[String], rows: &[Vec<String>], term_width: usize, max_col_width: usize) -> (Vec<usize>, bool) {
    let cols = headers.len();
    let mut natural: Vec<usize> = Vec::with_capacity(cols);
    for i in 0..cols {
        let mut max_len = visible_length(&headers[i]);
        for r in rows {
            if let Some(cell) = r.get(i) {
                max_len = max_len.max(visible_length(cell));
            }
        }
        // Match src/table.ts: min(maxColWidth, longest + 2). The +2 belongs
        // inside the cap — applying it outside yields 42-wide columns for
        // 40-char cells, shifting word-wrap positions by one word.
        natural.push((max_len + 2).min(max_col_width));
    }
    let border_overhead = cols + 1;
    let total_natural: usize = natural.iter().sum::<usize>() + border_overhead;
    if total_natural <= term_width {
        return (natural, false);
    }
    let budget = term_width - border_overhead;
    let min_w = 6;
    let mut widths = natural.clone();
    let mut total: usize = widths.iter().sum();
    while total > budget {
        let max_idx = widths.iter().enumerate().max_by_key(|(_, &w)| w).map(|(i, _)| i).unwrap_or(0);
        if widths[max_idx] <= min_w { break; }
        widths[max_idx] = widths[max_idx].saturating_sub(1).max(min_w);
        total = widths.iter().sum();
    }
    (widths.clone(), total + border_overhead > term_width)
}

fn wrap_cell_text(text: &str, max_w: usize) -> Vec<String> {
    if text.chars().count() <= max_w { return vec![text.to_string()]; }
    let words: Vec<&str> = text.split(' ').collect();
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in words {
        if cur.is_empty() { cur = word.to_string(); }
        else if cur.chars().count() + 1 + word.chars().count() <= max_w {
            cur.push(' ');
            cur.push_str(word);
        } else {
            lines.push(std::mem::take(&mut cur));
            cur = word.to_string();
        }
    }
    if !cur.is_empty() { lines.push(cur); }
    if lines.is_empty() { lines.push(text.chars().take(max_w).collect()); }
    lines
}

fn render_cell_lines(raw: &str, width: usize, align: Option<Align>, is_header: bool) -> Vec<String> {
    let plain = strip_ansi(&render_inline(raw));
    // src/table.ts uses `width - 2` with no floor. For a zero-content column
    // the natural width is 2, so inner is 0; clamping to 1 would inject a
    // stray space into every cell of that column.
    let inner = width.saturating_sub(2);
    let color = if is_header { format!("{}{}", s_fg(TABLE_HEAD), BOLD) } else { s_fg(SLATE_L) };
    wrap_cell_text(&plain, inner)
        .into_iter()
        .map(|line| format!(" {}{}{}{}", color, align_cell(&line, inner, align), RST, " "))
        .collect()
}

fn border_row(widths: &[usize], left: &str, mid: &str, right: &str, fill: &str) -> String {
    let cells: Vec<String> = widths.iter().map(|w| fill.repeat(*w)).collect();
    format!("{}{}{}{}{}", s_fg(TABLE_BORDER), left, cells.join(mid), right, RST)
}

fn render_multiline_row(cells: &[String], widths: &[usize], aligns: &[Option<Align>], is_header: bool) -> Vec<String> {
    let pipe = format!("{}│{}", s_fg(TABLE_BORDER), RST);
    let cell_ls: Vec<Vec<String>> = cells.iter().enumerate()
        .map(|(i, c)| render_cell_lines(c, widths[i], aligns.get(i).copied().flatten(), is_header))
        .collect();
    let max_len = cell_ls.iter().map(|l| l.len()).max().unwrap_or(1).max(1);
    let mut lines: Vec<String> = Vec::with_capacity(max_len);
    for li in 0..max_len {
        let parts: Vec<String> = cell_ls.iter().enumerate()
            .map(|(i, l)| l.get(li).cloned().unwrap_or_else(|| " ".repeat(widths[i])))
            .collect();
        lines.push(format!("{}{}{}{}", s_fg(TABLE_BORDER), "│", parts.join(&pipe), format!("{}│{}", s_fg(TABLE_BORDER), RST)));
    }
    lines
}

pub fn render_table(headers: &[String], rows: &[Vec<String>], aligns_in: &[Option<Align>], term_width: usize) -> Vec<String> {
    if headers.is_empty() { return vec![]; }
    // normalize aligns
    let mut aligns: Vec<Option<Align>> = aligns_in.to_vec();
    while aligns.len() < headers.len() { aligns.push(None); }

    let (widths, truncated) = calc_col_widths(headers, rows, term_width.saturating_sub(2).max(20), 40);
    let mut lines: Vec<String> = Vec::new();

    // Top border
    lines.push(border_row(&widths, "╭", "┬", "╮", "─"));
    // Header
    lines.extend(render_multiline_row(headers, &widths, &aligns, true));
    // Header separator
    lines.push(border_row(&widths, "├", "┼", "┤", "─"));
    // Body
    for (ri, row) in rows.iter().enumerate() {
        let cells: Vec<String> = (0..headers.len()).map(|i| row.get(i).cloned().unwrap_or_default()).collect();
        lines.extend(render_multiline_row(&cells, &widths, &aligns, false));
        if ri + 1 < rows.len() {
            lines.push(border_row(&widths, "├", "┼", "┤", "╌"));
        }
    }
    // Bottom
    lines.push(border_row(&widths, "╰", "┴", "╯", "─"));
    if truncated {
        lines.push(format!("  {}← columns compressed to fit terminal ({} cols){}", s_fg(SLATE_D), term_width, RST));
    }
    lines
}

// ── Block renderer ────────────────────────────────────────────────────────────

fn render_special_fence(kind: &str, code: &str, width: usize) -> Vec<String> {
    let labels: &[(&str, &str)] = &[
        ("mermaid", "◈ Mermaid Diagram"),
        ("svg",     "◈ SVG Graphic"),
        ("chartjs", "◈ Chart.js Chart"),
    ];
    let hints: &[(&str, &str)] = &[
        ("mermaid", "paste into mermaid.live to render"),
        ("svg",     "open as .svg in browser"),
        ("chartjs", "paste into chartjs.org to render"),
    ];
    let label = labels.iter().find(|(k, _)| *k == kind).map(|(_, l)| *l).unwrap_or(kind);
    let hint  = hints.iter().find(|(k, _)| *k == kind).map(|(_, h)| *h).unwrap_or("");

    let mut lines = Vec::new();
    lines.push(format!("{}╭─ {} {} {}{}", s_fg(VIOLET), label, "─".repeat(width.saturating_sub(label.chars().count() + 7).max(0)), "╮", RST));
    lines.push(format!("{}│{} {}{}{}{}", s_fg(VIOLET), RST, s_fg(SLATE_D), hint, RST, ""));
    for cl in code.lines().take(20) {
        let padded = pad_end(&cl.chars().take(width.saturating_sub(6)).collect::<String>(), width.saturating_sub(6));
        lines.push(format!("{}│{}  {}{}{}{}", s_fg(VIOLET), RST, s_fg((199, 210, 254)), padded, RST, ""));
    }
    lines.push(format!("{}╰{}╯{}", s_fg(VIOLET), "─".repeat(width.saturating_sub(4)), RST));
    lines
}

pub fn render_block(block: &Block, width: usize) -> Vec<String> {
    match block {
        Block::Blank => vec![String::new()],
        // src/renderer.ts calls theme.hr(WIDTH()-2), and theme.hr itself
        // subtracts 2 more: the visible bar is WIDTH()-4.
        Block::Hr => vec![format!("{}{}{}", s_fg(HR_COLOR), "─".repeat(width.saturating_sub(4)), RST)],
        Block::Heading { level, text } => {
            let styled = match level {
                1 => format!("{}{}{}{}", s_fg(VIOLET), BOLD, render_inline(text), RST),
                2 => format!("{}{}{}{}", s_fg(VIOLET_L), BOLD, render_inline(text), RST),
                3 => format!("{}{}{}{}", s_fg(VIOLET_F), BOLD, render_inline(text), RST),
                4 => format!("{}{}{}", s_fg(VIOLET_F), render_inline(text), RST),
                5 => format!("{}{}{}{}", s_fg(SLATE), BOLD, render_inline(text), RST),
                _ => format!("{}{}{}", s_fg(SLATE_D), render_inline(text), RST),
            };
            if *level == 1 {
                let bar = format!("{}{}{}{}", s_fg(VIOLET), "═".repeat(width.saturating_sub(2)), "", RST);
                vec![bar.clone(), format!("  {}", styled), bar]
            } else if *level == 2 {
                let bar = format!("{}{}{}", s_fg(VIOLET_L), "─".repeat(width.saturating_sub(2)), RST);
                vec![format!("  {}", styled), bar]
            } else {
                vec![format!("  {}", styled)]
            }
        }
        Block::Paragraph { text } => vec![format!("{}{}{}", s_fg(SLATE_L), render_inline(text), RST)],
        Block::Blockquote { text } => vec![format!("{}▌{} {}{}{}{}",
            s_fg(QUOTE_BAR), RST, ITAL, s_fg(QUOTE_TEXT), render_inline(text), RST)],
        Block::ListItem { text, ordered, index, depth } => {
            let pad = "  ".repeat(*depth);
            let bullet = if *ordered {
                format!("{}{}.{}", s_fg(VIOLET), index, RST)
            } else {
                format!("{}●{}", s_fg(BULLET), RST)
            };
            vec![format!("{}{} {}{}", pad, bullet, render_inline(text), RST)]
        }
        Block::Code { lang, code, kind } => {
            match kind {
                CodeKind::Mermaid => render_special_fence("mermaid", code, width),
                CodeKind::Svg     => render_special_fence("svg", code, width),
                CodeKind::Chartjs => render_special_fence("chartjs", code, width),
                CodeKind::Code    => {
                    let mut lines = Vec::new();
                    // Top border
                    let label = if lang.is_empty() { String::new() } else { format!(" {} ", lang) };
                    let bar = "─".repeat(width.saturating_sub(visible_length(&label) + 4));
                    lines.push(format!("{}╭{}{}{}{}{}{}", s_fg(CODE_BORDER), s_fg(VIOLET), BOLD, label, RST, s_fg(CODE_BORDER), format!("{}╮{}", bar, RST)));
                    // Code body
                    for hl in highlight(code, lang).lines() {
                        let truncated = if visible_length(hl) > width.saturating_sub(4) {
                            format!("{}…", hl.chars().take(width.saturating_sub(5)).collect::<String>())
                        } else {
                            hl.to_string()
                        };
                        let padded = pad_end(&truncated, width.saturating_sub(4));
                        lines.push(format!("{}│{}{} {}{} {}{}{}", s_fg(CODE_BORDER), RST, s_bg(CODE_BG), padded, RST, s_fg(CODE_BORDER), "│", RST));
                    }
                    // Bottom border
                    lines.push(format!("{}╰{}╯{}", s_fg(CODE_BORDER), "─".repeat(width.saturating_sub(4)), RST));
                    lines
                }
            }
        }
        Block::Table { headers, rows, align } => render_table(headers, rows, align, width),
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn width() -> usize {
    std::env::var("COLUMNS").ok().and_then(|v| v.parse().ok()).unwrap_or(100).min(140).max(40)
}

fn render_stream<R: BufRead>(reader: R, w: &mut dyn Write) -> io::Result<()> {
    let term_width = width();
    let mut acc = BlockAccumulator::new();
    for line in reader.lines() {
        let line = line?;
        for block in acc.feed(&line) {
            for l in render_block(&block, term_width) {
                writeln!(w, "{}", l)?;
            }
        }
    }
    for block in acc.flush() {
        for l in render_block(&block, term_width) {
            writeln!(w, "{}", l)?;
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!("arc-render — render markdown as ANSI\n\nUsage: arc-render [file.md]...\n       cat file.md | arc-render");
        process::exit(0);
    }

    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout().lock());

    if args.is_empty() {
        if let Err(e) = render_stream(stdin.lock(), &mut out) {
            eprintln!("arc-render: {}", e);
            process::exit(1);
        }
    } else {
        for file in args {
            match std::fs::File::open(&file) {
                Ok(f) => {
                    if let Err(e) = render_stream(io::BufReader::new(f), &mut out) {
                        eprintln!("arc-render: {}: {}", file, e);
                        process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("arc-render: {}: {}", file, e);
                    process::exit(1);
                }
            }
        }
    }
    let _ = out.flush();

    let _ = out.flush();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── helpers ────────────────────────────────────────────────────────────────

    /// Render a slice of input lines through the block accumulator at a fixed
    /// width, including the end-of-input flush.
    fn blocks(lines: &[&str]) -> Vec<Block> {
        let mut acc = BlockAccumulator::new();
        let mut out = Vec::new();
        for line in lines {
            out.extend(acc.feed(line));
        }
        out.extend(acc.flush());
        out
    }

    fn inline(s: &str) -> String { render_inline(s) }

    fn rendered(lines: &[&str], width: usize) -> Vec<String> {
        blocks(lines)
            .iter()
            .flat_map(|b| render_block(b, width))
            .collect()
    }

    fn visible(lines: &[&str], width: usize) -> Vec<String> {
        rendered(lines, width)
            .iter()
            .map(|s| strip_ansi(s))
            .collect()
    }

    fn heading(level: usize, text: &str) -> Block {
        Block::Heading { level, text: text.to_string() }
    }

    fn code(lang: &str, code: &str, kind: CodeKind) -> Block {
        Block::Code { lang: lang.to_string(), code: code.to_string(), kind }
    }

    const W: usize = 40;

    // ── ANSI helpers ───────────────────────────────────────────────────────────

    #[test]
    fn strip_ansi_removes_sgr_and_osc_sequences() {
        assert_eq!(strip_ansi("\x1b[1m\x1b[38;2;1;2;3mhi\x1b[0m"), "hi");
        assert_eq!(strip_ansi("\x1b]0;title\x07body"), "body");
        assert_eq!(strip_ansi("\x1b]0;title\x1b\\body"), "body");
    }

    #[test]
    fn visible_length_ignores_ansi_but_counts_chars() {
        assert_eq!(visible_length(&format!("{}abc{}", fg(1, 2, 3), RST)), 3);
        assert_eq!(visible_length("日本語"), 3);
        assert_eq!(visible_length("🚀"), 1);
    }

    #[test]
    fn pad_end_uses_visible_width() {
        assert_eq!(pad_end(&format!("{}ab{}", BOLD, RST), 5), format!("{}ab{}   ", BOLD, RST));
        assert_eq!(pad_end("日本語", 5), "日本語  ");
        assert_eq!(pad_end("abcdef", 3), "abcdef");
    }

    // ── Headings: each level and its divider behavior ──────────────────────────

    #[test]
    fn heading_h1_has_bar_above_and_below() {
        let b = heading(1, "Title");
        let out = render_block(&b, W);
        let bar = format!("{}{}{}", s_fg(VIOLET), "═".repeat(W - 2), RST);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], bar);
        assert_eq!(out[2], bar);
        assert_eq!(out[1], format!("  {}{}{}{}{}", s_fg(VIOLET), BOLD, "Title", RST, ""));
    }

    #[test]
    fn heading_h2_has_bar_below_only() {
        let out = render_block(&heading(2, "Section"), W);
        let bar = format!("{}{}{}", s_fg(VIOLET_L), "─".repeat(W - 2), RST);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], format!("  {}{}{}{}", s_fg(VIOLET_L), BOLD, "Section", RST));
        assert_eq!(out[1], bar);
    }

    #[test]
    fn heading_h3_has_no_divider_bar() {
        let out = render_block(&heading(3, "Sub"), W);
        assert_eq!(out, vec![format!("  {}{}{}{}", s_fg(VIOLET_F), BOLD, "Sub", RST)]);
    }

    #[test]
    fn heading_h4_has_no_divider_bar() {
        let out = render_block(&heading(4, "SubSub"), W);
        assert_eq!(out, vec![format!("  {}{}{}", s_fg(VIOLET_F), "SubSub", RST)]);
    }

    #[test]
    fn heading_h5_has_no_divider_bar() {
        let out = render_block(&heading(5, "Five"), W);
        assert_eq!(out, vec![format!("  {}{}{}{}", s_fg(SLATE), BOLD, "Five", RST)]);
    }

    #[test]
    fn heading_h6_has_no_divider_bar() {
        let out = render_block(&heading(6, "Six"), W);
        assert_eq!(out, vec![format!("  {}{}{}", s_fg(SLATE_D), "Six", RST)]);
    }

    #[test]
    fn heading_divider_widths_scale_with_terminal() {
        for width in [40usize, 80, 100, 140] {
            let h1 = render_block(&heading(1, "X"), width);
            assert_eq!(visible_length(&h1[0]), width - 2);
            assert!(h1[0].contains('═'));
            let h2 = render_block(&heading(2, "X"), width);
            assert_eq!(visible_length(&h2[1]), width - 2);
            assert!(h2[1].contains('─'));
        }
    }

    #[test]
    fn heading_inline_formatting_is_rendered() {
        let out = render_block(&heading(2, "A `code` and **bold**"), W);
        assert!(out[0].starts_with(&format!("  {}{}", s_fg(VIOLET_L), BOLD)));
        assert!(out[0].contains(&inline_code("code")));
        assert!(out[0].contains(&format!("{}{}{}{}", BOLD, s_fg(SLATE_L), "bold", RST)));
    }

    #[test]
    fn heading_parser_accepts_one_to_six_hashes() {
        for level in 1..=6 {
            let line = format!("{} Title", "#".repeat(level));
            match blocks(&[&line]).into_iter().find(|b| matches!(b, Block::Heading { .. })) {
                Some(Block::Heading { level: l, text }) => {
                    assert_eq!(l, level);
                    assert_eq!(text, "Title");
                }
                other => panic!("expected heading, got {:?}", other),
            }
        }
    }

    #[test]
    fn heading_parser_rejects_seven_hashes_and_missing_space() {
        assert!(matches!(blocks(&["####### seven"])[0], Block::Paragraph { .. }));
        assert!(matches!(blocks(&["#nospace"])[0], Block::Paragraph { .. }));
    }

    // ── Code fences: open/close, unclosed flush, languages ─────────────────────

    #[test]
    fn fence_open_close_emits_single_code_block() {
        let out = blocks(&["```rust", "fn main() {}", "```"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], code("rust", "fn main() {}", CodeKind::Code));
    }

    #[test]
    fn fence_unclosed_flushed_at_eof() {
        let out = blocks(&["```py", "print('hi')"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], code("py", "print('hi')", CodeKind::Code));
    }

    #[test]
    fn fence_language_is_lowercased() {
        let out = blocks(&["```RUST", "let x = 1;", "```"]);
        assert_eq!(out[0], code("rust", "let x = 1;", CodeKind::Code));
    }

    #[test]
    fn fence_without_language_is_plain_code() {
        let out = blocks(&["```", "plain text", "```"]);
        assert_eq!(out[0], code("", "plain text", CodeKind::Code));
    }

    #[test]
    fn fence_body_ignores_markdown_syntax() {
        let inner = ["# not a heading", "| a | b |", "> not a quote", "---"];
        let mut lines = vec!["```"];
        lines.extend_from_slice(&inner);
        lines.push("```");
        let expected = inner.join("\n");
        assert_eq!(blocks(&lines)[0], code("", &expected, CodeKind::Code));
    }

    #[test]
    fn fence_close_requires_triple_backtick_prefix() {
        let out = blocks(&["```", "`` not a close", "```"]);
        assert_eq!(out[0], code("", "`` not a close", CodeKind::Code));
    }

    #[test]
    fn fence_multiple_blocks_in_one_stream() {
        let out = blocks(&["```js", "a", "```", "text", "```py", "b", "```"]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], code("js", "a", CodeKind::Code));
        assert!(matches!(out[1], Block::Paragraph { .. }));
        assert_eq!(out[2], code("py", "b", CodeKind::Code));
    }

    // ── Special mermaid / svg / chartjs fences ─────────────────────────────────

    #[test]
    fn fence_mermaid_is_special_kind() {
        assert_eq!(blocks(&["```mermaid", "graph TD", "```"])[0],
                   code("mermaid", "graph TD", CodeKind::Mermaid));
    }

    #[test]
    fn fence_svg_is_special_kind() {
        assert_eq!(blocks(&["```svg", "<svg/>", "```"])[0],
                   code("svg", "<svg/>", CodeKind::Svg));
    }

    #[test]
    fn fence_chartjs_and_chart_aliases() {
        for lang in ["chartjs", "chart"] {
            let out = blocks(&[&format!("```{}", lang), "{}", "```"]);
            assert_eq!(out[0], code(lang, "{}", CodeKind::Chartjs));
        }
    }

    #[test]
    fn special_fence_shows_label_hint_and_borders() {
        let out = rendered(&["```mermaid", "graph TD; A-->B", "```"], W);
        let plain = visible(&["```mermaid", "graph TD; A-->B", "```"], W);
        assert!(plain[0].contains("Mermaid Diagram"));
        assert!(plain[1].contains("paste into mermaid.live to render"));
        assert!(plain[2].contains("graph TD; A-->B"));
        // Top border is W-1 (it has a leading "╭─ " and trailing " ╮"),
        // bottom border is W-2 (`╰` + (W-4) rule + `╯`) — matches src/renderer.ts.
        assert_eq!(visible_length(&plain[0]), W - 1);
        assert_eq!(visible_length(&plain[plain.len() - 1]), W - 2);
        assert!(out.iter().all(|l| l.contains("\x1b[")));
    }

    #[test]
    fn special_fence_svg_and_chartjs_labels() {
        let svg = visible(&["```svg", "<svg/>", "```"], W);
        assert!(svg[0].contains("SVG Graphic"));
        assert!(svg[1].contains("open as .svg in browser"));
        let chart = visible(&["```chartjs", "{}", "```"], W);
        assert!(chart[0].contains("Chart.js Chart"));
        assert!(chart[1].contains("paste into chartjs.org to render"));
    }

    #[test]
    fn special_fence_clips_code_to_twenty_lines() {
        let mut lines = vec!["```mermaid".to_string()];
        for i in 0..25 {
            lines.push(format!("line{}", i));
        }
        lines.push("```".to_string());
        let refs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
        let out = rendered(&refs, W);
        let body: Vec<&String> = out.iter().skip(2).take_while(|l| !l.contains('╰')).collect();
        assert_eq!(body.len(), 20);
        assert!(body[19].contains("line19"));
        assert!(!body.iter().any(|l| l.contains("line20")));
    }

    // ── Syntax highlighting ────────────────────────────────────────────────────

    #[test]
    fn highlight_keywords_and_numbers() {
        let h = highlight_line("const x = 42;", "js");
        assert!(h.contains(&format!("{}const{}", s_fg(SYN_KW), s_fg(SYN_PL))));
        assert!(h.contains(&format!("{}42{}", s_fg(SYN_NUM), s_fg(SYN_PL))));
        assert!(h.contains(&format!("{}={}", s_fg(SYN_OP), s_fg(SYN_PL))));
        assert!(h.ends_with(RST));
    }

    #[test]
    fn highlight_strings() {
        let h = highlight_line("let s = \"hi\";", "js");
        assert!(h.contains(&format!("{}\"hi\"{}", s_fg(SYN_STR), s_fg(SYN_PL))));
    }

    #[test]
    fn highlight_comment_consumes_rest_of_line() {
        let h = highlight_line("let x = 1; // note", "rust");
        assert!(h.contains(&format!("{}{}// note{}", s_fg(SYN_CMT), DIM, RST)));
        assert!(h.ends_with(RST));
    }

    #[test]
    fn highlight_hex_number() {
        let h = highlight_line("0xDEADbeef", "c");
        assert!(h.contains(&format!("{}0xDEADbeef{}", s_fg(SYN_NUM), s_fg(SYN_PL))));
    }

    #[test]
    fn highlight_function_call_and_type() {
        let f = highlight_line("doWork(", "ts");
        assert!(f.contains(&format!("{}doWork{}", s_fg(SYN_FN), s_fg(SYN_PL))));
        let t = highlight_line("MyType", "rs");
        assert!(t.contains(&format!("{}MyType{}", s_fg(SYN_TY), s_fg(SYN_PL))));
    }

    #[test]
    fn highlight_language_aliases_resolve() {
        assert_eq!(resolve_lang("js"), "javascript");
        assert_eq!(resolve_lang("TS"), "typescript");
        assert_eq!(resolve_lang("py"), "python");
        assert_eq!(resolve_lang("rs"), "rust");
        assert_eq!(resolve_lang("sh"), "bash");
        assert_eq!(resolve_lang("shell"), "bash");
        assert_eq!(resolve_lang("cpp"), "c");
        assert_eq!(resolve_lang("c++"), "c");
        assert_eq!(resolve_lang("go"), "go");
        assert_eq!(resolve_lang("java"), "java");
        assert_eq!(resolve_lang("sql"), "sql");
        assert_eq!(resolve_lang("wat"), "plain");
    }

    #[test]
    fn highlight_unknown_language_is_plain() {
        let h = highlight_line("const x = 1;", "brainfuck");
        assert!(h.starts_with(&s_fg(SYN_PL)));
        assert!(!h.contains(&s_fg(SYN_KW)));
        assert_eq!(strip_ansi(&h), "const x = 1;");
    }

    #[test]
    fn highlight_multiline_joins_highlighted_lines() {
        let h = highlight("alpha\nbeta", "plain");
        assert!(h.contains('\n'));
        assert_eq!(h.matches(&s_fg(SYN_PL)).count(), 2);
        assert_eq!(h.matches(RST).count(), 2);
    }

    #[test]
    fn highlight_multibyte_input_does_not_panic() {
        let h = highlight_line("let s = \"日本語 🚀\"; // 注釈", "rust");
        assert!(h.contains("日本語 🚀"));
        assert!(h.contains("注釈"));
    }

    #[test]
    fn code_block_render_has_bordered_body() {
        let out = rendered(&["```", "hello", "```"], W);
        assert_eq!(out.len(), 3);
        assert!(out[0].contains('╭') && out[0].contains('╮'));
        assert!(out[1].contains('│') && out[1].contains("hello"));
        assert!(out[2].contains('╰') && out[2].contains('╯'));
        assert_eq!(visible_length(&out[1]), W);
    }

    // ── Inline spans ───────────────────────────────────────────────────────────

    #[test]
    fn inline_bold() {
        assert_eq!(inline("**bold**"), format!("{}{}{}{}", BOLD, s_fg(SLATE_L), "bold", RST));
        assert_eq!(inline("__bold__"), inline("**bold**"));
    }

    #[test]
    fn inline_italic() {
        assert_eq!(inline("*it*"), format!("{}{}{}{}", ITAL, s_fg(SLATE), "it", RST));
        assert_eq!(inline("_it_"), inline("*it*"));
    }

    #[test]
    fn inline_bold_italic() {
        assert_eq!(inline("***both***"),
                   format!("{}{}{}{}{}", BOLD, ITAL, s_fg(VIOLET_F), "both", RST));
        assert_eq!(inline("___both___"), inline("***both***"));
    }

    #[test]
    fn inline_strike() {
        assert_eq!(inline("~~gone~~"), format!("{}{}{}{}", STRK, s_fg(SLATE_D), "gone", RST));
    }

    #[test]
    fn inline_code_span() {
        assert_eq!(inline("`code`"), inline_code("code"));
        assert_eq!(inline("  ` spaced `  "), format!("  {}  ", inline_code("spaced")));
    }

    #[test]
    fn inline_link_inline_and_reference() {
        let expected = format!("{}{}{}{}{} ({}){}", UNDL, s_fg(LINK_COLOR), "label", RST,
                               s_fg(SLATE_D), "http://x", RST);
        assert_eq!(inline("[label](http://x)"), expected);
        assert_eq!(inline("[label][ref]"),
                   format!("{}{}{}{}{} ({}){}", UNDL, s_fg(LINK_COLOR), "label", RST,
                           s_fg(SLATE_D), "ref", RST));
    }

    #[test]
    fn inline_link_with_title() {
        assert_eq!(inline("[label](http://x \"title\")"),
                   format!("{}{}{}{}{} ({}){}", UNDL, s_fg(LINK_COLOR), "label", RST,
                           s_fg(SLATE_D), "http://x", RST));
    }

    #[test]
    fn inline_image_renders_as_label() {
        assert_eq!(inline("![alt](http://x.png)"),
                   format!("{}{}[img: {}]{}", s_fg(SLATE_D), DIM, "alt", RST));
    }

    #[test]
    fn inline_autolinks() {
        assert_eq!(inline("<https://example.com>"), link_text("https://example.com", "https://example.com"));
        assert_eq!(inline("<a@b.com>"), link_text("a@b.com", "a@b.com"));
        assert_eq!(inline("<not a url>"), "<not a url>");
    }

    #[test]
    fn inline_math() {
        assert_eq!(inline("$x^2 + y^2$"),
                   format!("{}{}⟨{}⟩{}", s_fg(VIOLET_F), DIM, "x^2 + y^2", RST));
    }

    #[test]
    fn inline_kbd() {
        assert_eq!(inline("[[Ctrl+C]]"),
                   format!("{}{}{}{}", bg(30, 27, 60), s_fg(VIOLET_F), "Ctrl+C", RST));
    }

    #[test]
    fn inline_highlight() {
        assert_eq!(inline("==marked=="),
                   format!("{}{}{}{}", bg(80, 60, 10), fg(250, 204, 21), "marked", RST));
    }

    #[test]
    fn inline_emoji_shortcodes() {
        assert_eq!(inline(":rocket:"), "🚀");
        assert_eq!(inline(":warning:"), "⚠");
        assert_eq!(inline(":white_check_mark:"), "✅");
        assert_eq!(inline(":unknown_emoji:"), ":unknown_emoji:");
    }

    #[test]
    fn inline_escapes_punctuation() {
        assert_eq!(inline("\\*not italic\\*"), "*not italic*");
        assert_eq!(inline("\\`not code\\`"), "`not code`");
    }

    #[test]
    fn inline_nested_formatting() {
        let out = inline("**bold and `code`**");
        assert!(out.starts_with(&format!("{}{}", BOLD, s_fg(SLATE_L))));
        assert!(out.contains(&inline_code("code")));
        assert!(out.ends_with(RST));
    }

    #[test]
    fn inline_unclosed_span_stays_literal() {
        assert_eq!(inline("**unclosed"), "**unclosed");
        assert_eq!(inline("`unclosed"), "`unclosed");
    }

    #[test]
    fn inline_span_space_rules() {
        // No space directly after the opener or before the closer.
        assert_eq!(inline("** spaced **"), "** spaced **");
        assert_eq!(inline("~~ spaced ~~"), "~~ spaced ~~");
    }

    #[test]
    fn inline_html_tags_and_comments_stripped() {
        assert_eq!(inline("<div>hello</div>"), "hello");
        assert_eq!(inline("a <!-- hidden --> b"), "a  b");
        assert_eq!(inline("<span class='x'>hi</span>"), "hi");
    }

    // ── Explicit multi-byte regressions (the String::find panic case) ─────────

    #[test]
    fn regression_multibyte_inline_code_span() {
        // `rest.find()` returns a BYTE offset; using it as a char index into
        // the Vec<char> used to index past the end and panic.
        assert_eq!(inline("`日本語`"), inline_code("日本語"));
        assert_eq!(inline("`éclair`"), inline_code("éclair"));
        assert_eq!(inline("`🚀rocket`"), inline_code("🚀rocket"));
    }

    #[test]
    fn regression_multibyte_emphasis_span() {
        // Same bug class in consume_span.
        assert_eq!(inline("**日本語**"),
                   format!("{}{}{}{}", BOLD, s_fg(SLATE_L), "日本語", RST));
        assert_eq!(inline("*élan*"), format!("{}{}{}{}", ITAL, s_fg(SLATE), "élan", RST));
    }

    #[test]
    fn regression_multibyte_prefix_before_delimiters() {
        let out = inline("日本語 `code` と **太字**");
        assert!(out.contains(&inline_code("code")));
        assert!(out.contains(&format!("{}{}{}{}", BOLD, s_fg(SLATE_L), "太字", RST)));
        assert!(out.contains("日本語"));
        assert!(out.contains("と"));
    }

    #[test]
    fn regression_multibyte_in_links_and_math() {
        assert!(inline("[ラベル](http://例え)").contains("ラベル"));
        assert!(inline("$α + β$").contains("α + β"));
    }

    // ── Tables ─────────────────────────────────────────────────────────────────

    fn table_from(rows: &[&str]) -> Block {
        blocks(rows).into_iter()
            .find(|b| matches!(b, Block::Table { .. }))
            .unwrap_or_else(|| panic!("no table in {:?}", rows))
    }

    #[test]
    fn table_separator_rows_detect_alignments() {
        let t = table_from(&["| L | C | R | N |", "|:---|:---:|---:|---|", "| a | b | c | d |"]);
        match t {
            Block::Table { align, headers, rows } => {
                assert_eq!(align, vec![Some(Align::Left), Some(Align::Center),
                                       Some(Align::Right), None]);
                assert_eq!(headers, vec!["L", "C", "R", "N"]);
                assert_eq!(rows, vec![vec!["a", "b", "c", "d"]]);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn table_without_separator_has_no_alignments() {
        let t = table_from(&["| A | B |", "| 1 | 2 |"]);
        match t {
            Block::Table { align, rows, .. } => {
                assert_eq!(align, Vec::<Option<Align>>::new());
                assert_eq!(rows, vec![vec!["1", "2"]]);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn table_flushed_on_blank_heading_and_eof() {
        for terminator in ["", "## Next", "paragraph"] {
            let b = blocks(&["| A |", "| --- |", "| x |", terminator]);
            assert!(b.iter().any(|x| matches!(x, Block::Table { .. })),
                    "terminator {:?} did not flush table", terminator);
        }
    }

    #[test]
    fn table_render_structure_and_borders() {
        let out = visible(&["| A | B |", "| --- | --- |", "| x | y |"], W);
        assert!(out[0].starts_with('╭') && out[0].contains('┬') && out[0].ends_with('╮'));
        assert!(out[2].starts_with('├') && out[2].contains('┼') && out[2].ends_with('┤'));
        assert!(out[out.len() - 1].starts_with('╰') && out[out.len() - 1].contains('┴'));
        assert!(out.iter().any(|l| l.contains('│') && l.contains('x')));
    }

    #[test]
    fn table_multiline_wrap_creates_extra_display_rows() {
        let long = "this is a very long cell that must wrap onto several display lines";
        let out = visible(&[&format!("| Head |",), "| --- |", &format!("| {} |", long)], 30);
        // One header row + separator + several wrapped data rows + borders.
        assert!(out.len() > 5, "expected wrapped rows, got {:#?}", out);
        let data: Vec<&String> = out.iter().filter(|l| l.contains('│')).collect();
        assert!(data.len() >= 3);
        assert!(data.iter().any(|l| l.contains("this is a very long cell")));
    }

    #[test]
    fn table_multibyte_content_uses_char_width() {
        let out = visible(&["| 見出し |", "| --- |", "| 日本語テスト |"], W);
        let border = &out[0];
        let width = border.chars().count();
        assert!(width <= W);
        assert!(out.iter().any(|l| l.contains("日本語テスト")));
        // Multiple rows still share the same border width.
        assert!(out.iter().filter(|l| l.starts_with('╭') || l.starts_with('╰'))
                    .all(|l| l.chars().count() == width));
    }

    #[test]
    fn table_alignments_pad_correctly() {
        let out = visible(&["| LEFT | CENTER | RIGHT |", "|:--|:-:|--:|", "| a | b | c |"], 40);
        let row = out.iter().find(|l| l.contains('│') && l.contains('a')).unwrap();
        // Left cell content butts against its left border, padded on the right.
        assert!(row.starts_with("│ a"));
        // Centered cell has padding on both sides.
        assert!(row.contains("│   b"));
        // Right cell content sits flush against its right border.
        assert!(row.trim_end_matches('│').trim_end().ends_with('c'));
    }

    #[test]
    fn table_empty_headers_render_nothing() {
        assert!(render_table(&[], &[], &[], W).is_empty());
    }

    #[test]
    fn table_narrow_width_adds_compression_notice() {
        // Eight wide columns cannot fit even at their 6-char minimum, so
        // calc_col_widths reports `truncated` and the renderer emits a notice.
        let header = "| H0 | H1 | H2 | H3 | H4 | H5 | H6 | H7 |";
        let sep = "| --- | --- | --- | --- | --- | --- | --- | --- |";
        let row = "| 0000000000 | 1111111111 | 2222222222 | 3333333333 | 4444444444 | 5555555555 | 6666666666 | 7777777777 |";
        let out = visible(&[header, sep, row], 40);
        assert!(out.iter().any(|l| l.contains("columns compressed to fit terminal")),
                "got {:#?}", out);
    }

    #[test]
    fn table_short_rows_are_padded_with_empty_cells() {
        let t = table_from(&["| A | B | C |", "| --- | --- | --- |", "| 1 |"]);
        match t {
            Block::Table { rows, .. } => assert_eq!(rows, vec![vec!["1"]]),
            _ => unreachable!(),
        }
        // Rendering must not panic when a row has fewer cells than headers.
        let out = visible(&["| A | B | C |", "| --- | --- | --- |", "| 1 |"], W);
        assert!(out.len() >= 5);
    }

    // ── Other block types ──────────────────────────────────────────────────────

    #[test]
    fn blockquote_render() {
        let out = rendered(&["> a quote"], W);
        assert_eq!(out, vec![format!("{}▌{} {}{}{}{}", s_fg(QUOTE_BAR), RST,
                                    ITAL, s_fg(QUOTE_TEXT), "a quote", RST)]);
    }

    #[test]
    fn unordered_and_ordered_lists() {
        let out = blocks(&["- alpha", "  - nested", "3. third"]);
        match (&out[0], &out[1], &out[2]) {
            (Block::ListItem { text: a, ordered: false, depth: 0, .. },
             Block::ListItem { text: b, ordered: false, depth: 1, .. },
             Block::ListItem { text: c, ordered: true, index: 3, depth: 0 }) => {
                assert_eq!((a.as_str(), b.as_str(), c.as_str()), ("alpha", "nested", "third"));
            }
            other => panic!("unexpected blocks: {:?}", other),
        }
    }

    #[test]
    fn hr_all_variants_render_width_minus_four() {
        for marker in ["---", "===", "***", "___"] {
            let out = rendered(&[marker], W);
            assert_eq!(out.len(), 1);
            let v = strip_ansi(&out[0]);
            assert_eq!(v, "─".repeat(W - 4), "marker {} gave {:?}", marker, v);
        }
    }

    #[test]
    fn blank_and_paragraph_blocks() {
        let out = blocks(&["hello", "", "world"]);
        assert_eq!(out.len(), 3);
        assert!(matches!(out[0], Block::Paragraph { .. }));
        assert!(matches!(out[1], Block::Blank));
        assert!(matches!(out[2], Block::Paragraph { .. }));
        assert_eq!(render_block(&Block::Blank, W), vec![String::new()]);
    }

    #[test]
    fn html_block_tags_and_comments_are_discarded() {
        let out = blocks(&["<details>", "<summary>Title</summary>", "<!-- hidden -->",
                           "visible", "</details>"]);
        assert_eq!(out.len(), 1);
        assert!(matches!(out[0], Block::Paragraph { .. }));
    }

    // ── End-to-end stream rendering ────────────────────────────────────────────

    #[test]
    fn render_stream_flushes_unclosed_fence() {
        let input = b"before\n```rust\nfn main() {}\n";
        let mut output = Vec::new();
        render_stream(io::BufReader::new(&input[..]), &mut output).unwrap();
        let text = String::from_utf8(output).unwrap();
        let plain = strip_ansi(&text);
        assert!(plain.contains("before"));
        assert!(plain.contains("fn main() {}"));
        assert!(plain.contains('╭') && plain.contains('╰'));
        assert!(text.ends_with('\n'));
    }

    #[test]
    fn render_stream_renders_all_block_types() {
        let input = b"# Title\n\n> quote\n\n- item\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph TD\n```\n";
        let mut output = Vec::new();
        render_stream(io::BufReader::new(&input[..]), &mut output).unwrap();
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("Title"));
        assert!(text.contains("quote"));
        assert!(text.contains("item"));
        assert!(text.contains("Mermaid Diagram"));
        assert!(text.contains('╭') && text.contains('╮'));
    }
}
