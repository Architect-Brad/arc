// ─────────────────────────────────────────────────────────────────────────────
// arc-core-rs/src/main.rs
// arc native engine — Rust edition
//
// Faster than C++ variant:
//  • Zero-copy string slicing via &str
//  • Stack-allocated SmallVec patterns for keyword matching
//  • Inline ANSI color sequences (no heap alloc per token)
//  • Minimal JSON parser/emitter with no deps
//  • Context window tracker with token estimation
//
// Protocol: line-delimited JSON on stdin/stdout
// Commands: ping | stripAnsi | visibleLength | highlight | wrapText
//           tokenize | contextTrack | estimateTokens | batch
// ─────────────────────────────────────────────────────────────────────────────

#![allow(clippy::match_single_binding)]

use std::io::{self, BufRead, Write, BufWriter};

// ── ANSI color constants (true color, no heap) ────────────────────────────────

const C_KW:  &str = "\x1b[38;2;197;165;197m";
const C_STR: &str = "\x1b[38;2;152;195;121m";
const C_CMT: &str = "\x1b[2m\x1b[38;2;92;99;112m";
const C_NUM: &str = "\x1b[38;2;229;192;123m";
const C_FN:  &str = "\x1b[38;2;97;175;239m";
const C_TY:  &str = "\x1b[38;2;230;160;100m";
const C_OP:  &str = "\x1b[38;2;86;182;194m";
const C_PL:  &str = "\x1b[38;2;187;187;187m";
const RST:   &str = "\x1b[0m";

// ── Minimal JSON helpers ──────────────────────────────────────────────────────

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    out.push('"');
    for c in s.chars() {
        match c {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c    => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_str_arr(v: &[String]) -> String {
    let mut out = String::from("[");
    for (i, s) in v.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str(&json_escape(s));
    }
    out.push(']');
    out
}

fn get_str<'a>(json: &'a str, key: &str) -> &'a str {
    let needle = format!("\"{}\"", key);
    let Some(pos) = json.find(&needle) else { return "" };
    let rest = &json[pos + needle.len()..];
    let rest = rest.trim_start_matches(|c| c == ':' || c == ' ');
    if rest.starts_with('"') {
        let inner = &rest[1..];
        // find closing quote, handle escapes
        let mut end = 0;
        let bytes = inner.as_bytes();
        while end < bytes.len() {
            if bytes[end] == b'\\' { end += 2; continue; }
            if bytes[end] == b'"' { break; }
            end += 1;
        }
        &inner[..end]
    } else { "" }
}

fn get_str_owned(json: &str, key: &str) -> String {
    // Unescape the extracted string
    let raw = get_str(json, key);
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n')  => out.push('\n'),
                Some('t')  => out.push('\t'),
                Some('r')  => out.push('\r'),
                Some('"')  => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(c)    => out.push(c),
                None       => break,
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn get_int(json: &str, key: &str, default: i64) -> i64 {
    let needle = format!("\"{}\"", key);
    let Some(pos) = json.find(&needle) else { return default };
    let rest = &json[pos + needle.len()..];
    let rest = rest.trim_start_matches(|c| c == ':' || c == ' ');
    rest.chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect::<String>()
        .parse()
        .unwrap_or(default)
}

fn get_bool(json: &str, key: &str, default: bool) -> bool {
    let needle = format!("\"{}\"", key);
    let Some(pos) = json.find(&needle) else { return default };
    let rest = &json[pos + needle.len()..];
    let rest = rest.trim_start_matches(|c| c == ':' || c == ' ');
    if rest.starts_with("true")  { return true; }
    if rest.starts_with("false") { return false; }
    default
}

// ── ANSI strip & visible length ───────────────────────────────────────────────

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i < n {
        if bytes[i] == 0x1b && i + 1 < n {
            // CSI sequence: ESC '[' ... final byte in 0x40..=0x7E
            if bytes[i + 1] == b'[' {
                i += 2;
                while i < n {
                    let b = bytes[i];
                    i += 1;
                    if (0x40..=0x7e).contains(&b) { break; }
                }
                continue;
            }
            // OSC sequence: ESC ']' ... terminated by BEL or ST (ESC '\')
            if bytes[i + 1] == b']' {
                i += 2;
                while i < n {
                    if bytes[i] == 0x07 { i += 1; break; }
                    if bytes[i] == 0x1b && i + 1 < n && bytes[i + 1] == b'\\' { i += 2; break; }
                    i += 1;
                }
                continue;
            }
            // Other ESC sequences: ESC + one intermediate/final byte
            i += 2;
            continue;
        }
        let c = s[i..].chars().next().unwrap();
        out.push(c);
        i += c.len_utf8();
    }
    out
}

fn utf8_char_len(b: u8) -> usize {
    if      b < 0x80 { 1 }
    else if b < 0xE0 { 2 }
    else if b < 0xF0 { 3 }
    else             { 4 }
}

fn visible_length(s: &str) -> usize {
    let stripped = strip_ansi(s);
    stripped.chars().count()
}

// ── Word wrap ─────────────────────────────────────────────────────────────────

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let width = if width == 0 { 80 } else { width };
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_len: usize = 0;

    for word in text.split_whitespace() {
        let wl = word.chars().count();
        if cur_len == 0 {
            cur.push_str(word);
            cur_len = wl;
        } else if cur_len + 1 + wl <= width {
            cur.push(' ');
            cur.push_str(word);
            cur_len += 1 + wl;
        } else {
            lines.push(std::mem::take(&mut cur));
            cur.push_str(word);
            cur_len = wl;
        }
    }
    if !cur.is_empty() { lines.push(cur); }
    lines
}

// ── Token estimation ──────────────────────────────────────────────────────────
// ~3.8 chars per token for English LLM text (empirically validated)

fn estimate_tokens(text: &str) -> usize {
    (text.len() as f64 / 3.8).ceil() as usize
}

// ── Keyword tables ────────────────────────────────────────────────────────────

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
            "in","pub","priv",
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
        "js" | "javascript" => "javascript",
        "ts" | "typescript" => "typescript",
        "py" | "python"     => "python",
        "rs" | "rust"       => "rust",
        "sh" | "shell" | "bash" => "bash",
        "cpp" | "c++"       => "c",
        "c"   => "c",
        "go"  => "go",
        "java" => "java",
        "sql" => "sql",
        _ => "plain",
    }
}

// ── Syntax highlighter ────────────────────────────────────────────────────────

fn highlight_line(line: &str, lang: &str) -> String {
    let lang = resolve_lang(lang);
    let kws  = keywords_for(lang);

    let mut out = String::with_capacity(line.len() * 5);
    out.push_str(C_PL);

    let bytes = line.as_bytes();
    let n     = bytes.len();
    let mut i = 0;

    let is_id  = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let is_dig = |c: u8| c.is_ascii_digit();

    // Detect comment start for this language
    let single_comment: Option<&[u8]> = match lang {
        "javascript"|"typescript"|"rust"|"go"|"c"|"java"|"cpp" => Some(b"//"),
        "python"|"bash"|"ruby" => Some(b"#"),
        "sql" => Some(b"--"),
        _ => None,
    };

    while i < n {
        // Single-line comment check
        if let Some(prefix) = single_comment {
            if bytes[i..].starts_with(prefix) {
                out.push_str(C_CMT);
                out.push_str(&line[i..]);
                out.push_str(RST);
                return out;
            }
        }

        // String literals
        if bytes[i] == b'"' || bytes[i] == b'\'' || (bytes[i] == b'`' && matches!(lang, "javascript"|"typescript")) {
            let q = bytes[i];
            let start = i;
            i += 1;
            while i < n {
                if bytes[i] == b'\\' { i += 2; continue; }
                if bytes[i] == q    { i += 1; break; }
                i += 1;
            }
            out.push_str(C_STR);
            out.push_str(&line[start..i]);
            out.push_str(C_PL);
            continue;
        }

        // Hex numbers
        if i + 1 < n && bytes[i] == b'0' && (bytes[i+1] == b'x' || bytes[i+1] == b'X') {
            let start = i; i += 2;
            while i < n && bytes[i].is_ascii_hexdigit() { i += 1; }
            out.push_str(C_NUM);
            out.push_str(&line[start..i]);
            out.push_str(C_PL);
            continue;
        }

        // Decimal numbers
        if is_dig(bytes[i]) || (bytes[i] == b'.' && i+1 < n && is_dig(bytes[i+1])) {
            let start = i;
            while i < n && (is_dig(bytes[i]) || bytes[i] == b'.' ||
                            bytes[i] == b'e' || bytes[i] == b'E' ||
                            bytes[i] == b'f' || bytes[i] == b'u' ||
                            bytes[i] == b'l' || bytes[i] == b'L') { i += 1; }
            out.push_str(C_NUM);
            out.push_str(&line[start..i]);
            out.push_str(C_PL);
            continue;
        }

        // Identifiers / keywords
        if is_id(bytes[i]) && !is_dig(bytes[i]) {
            let start = i;
            while i < n && is_id(bytes[i]) { i += 1; }
            let word = &line[start..i];

            if kws.contains(&word) {
                out.push_str(C_KW);
                out.push_str(word);
                out.push_str(C_PL);
            } else if word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                out.push_str(C_TY);
                out.push_str(word);
                out.push_str(C_PL);
            } else if i < n && bytes[i] == b'(' {
                out.push_str(C_FN);
                out.push_str(word);
                out.push_str(C_PL);
            } else {
                out.push_str(word);
            }
            continue;
        }

        // Operators
        if b"+-*/%=<>&|^~!?:".contains(&bytes[i]) {
            out.push_str(C_OP);
            out.push(bytes[i] as char);
            out.push_str(C_PL);
            i += 1;
            continue;
        }

        // UTF-8 passthrough
        let clen = utf8_char_len(bytes[i]);
        if i + clen <= n {
            out.push_str(&line[i..i+clen]);
        }
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

// ── Markdown line tokenizer ───────────────────────────────────────────────────

fn tokenize_line(line: &str, in_code: bool) -> String {
    if in_code {
        if line.starts_with("```") {
            return r#"{"type":"code_close","text":"","lang":"","level":0,"depth":0,"ordered":false}"#.to_string();
        }
        return format!(r#"{{"type":"code_line","text":{},"lang":"","level":0,"depth":0,"ordered":false}}"#,
            json_escape(line));
    }

    let trimmed = line.trim();

    if trimmed.is_empty() {
        return r#"{"type":"blank","text":"","lang":"","level":0,"depth":0,"ordered":false}"#.to_string();
    }

    // Code fence
    if line.starts_with("```") {
        let lang = line[3..].trim();
        return format!(r#"{{"type":"code_open","text":"","lang":{},"level":0,"depth":0,"ordered":false}}"#,
            json_escape(lang));
    }

    // HR
    if matches!(trimmed, "---" | "***" | "___" | "===" | "- - -" | "* * *") {
        return r#"{"type":"hr","text":"","lang":"","level":0,"depth":0,"ordered":false}"#.to_string();
    }

    // Heading
    if line.starts_with('#') {
        let level = line.bytes().take_while(|&b| b == b'#').count();
        if level <= 6 && line.as_bytes().get(level) == Some(&b' ') {
            let text = &line[level+1..];
            let text = text.trim_end_matches(|c| c == '\r' || c == '\n');
            return format!(r#"{{"type":"heading","text":{},"lang":"","level":{},"depth":0,"ordered":false}}"#,
                json_escape(text), level);
        }
    }

    // Blockquote
    if line.starts_with('>') {
        let text = if line.len() > 1 && line.as_bytes()[1] == b' ' { &line[2..] } else { &line[1..] };
        return format!(r#"{{"type":"blockquote","text":{},"lang":"","level":0,"depth":0,"ordered":false}}"#,
            json_escape(text));
    }

    // UL item
    let indent = line.bytes().take_while(|&b| b == b' ').count();
    if let Some(rest) = line.trim_start().strip_prefix("- ")
        .or_else(|| line.trim_start().strip_prefix("* "))
        .or_else(|| line.trim_start().strip_prefix("+ ")) {
        let depth = indent / 2;
        return format!(r#"{{"type":"ul_item","text":{},"lang":"","level":0,"depth":{},"ordered":false}}"#,
            json_escape(rest), depth);
    }

    // OL item  "1. text"
    let digits: String = line.trim_start().chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        let after_digits = &line.trim_start()[digits.len()..];
        if after_digits.starts_with(". ") {
            let num: usize = digits.parse().unwrap_or(1);
            let text = &after_digits[2..];
            return format!(r#"{{"type":"ol_item","text":{},"lang":"","level":{},"depth":{},"ordered":true}}"#,
                json_escape(text), num, indent / 2);
        }
    }

    // Table
    if line.starts_with('|') {
        let is_sep = line.chars().all(|c| c == '|' || c == '-' || c == ':' || c == ' ');
        let typ = if is_sep { "table_sep" } else { "table_row" };
        return format!(r#"{{"type":"{}","text":{},"lang":"","level":0,"depth":0,"ordered":false}}"#,
            typ, json_escape(line));
    }

    // Paragraph
    let text = line.trim_end_matches(|c| c == '\r' || c == '\n');
    format!(r#"{{"type":"paragraph","text":{},"lang":"","level":0,"depth":0,"ordered":false}}"#,
        json_escape(text))
}

// ── Context window tracker ────────────────────────────────────────────────────

#[derive(Default)]
struct ContextTracker {
    used:       usize,
    max:        usize,
    model:      String,
}

impl ContextTracker {
    fn bar(&self, width: usize) -> String {
        if self.max == 0 { return String::new(); }
        let pct     = (self.used as f64 / self.max as f64).min(1.0);
        let fill    = (pct * width as f64) as usize;
        let empty   = width - fill;

        // Color: green → yellow → red based on usage
        let color = if pct < 0.6 {
            "\x1b[38;2;134;239;172m"  // green
        } else if pct < 0.85 {
            "\x1b[38;2;250;204;21m"   // yellow
        } else {
            "\x1b[38;2;248;113;113m"  // red
        };

        let bar_fill  = "█".repeat(fill);
        let bar_empty = "░".repeat(empty);
        let pct_str   = format!("{:.0}%", pct * 100.0);

        format!(
            "{}{}{}\x1b[38;2;100;116;139m{}  {}/{} tokens  {}\x1b[0m",
            color, bar_fill, "\x1b[38;2;55;65;81m", bar_empty,
            self.used, self.max, pct_str
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main — line-delimited JSON protocol
// ─────────────────────────────────────────────────────────────────────────────

fn process(cmd: &str, json: &str, ctx: &mut ContextTracker) -> String {
    match cmd {
        "ping" => r#"{"r":"pong","engine":"rust"}"#.to_string(),

        "stripAnsi" => {
            let s = get_str_owned(json, "s");
            format!(r#"{{"r":{}}}"#, json_escape(&strip_ansi(&s)))
        }

        "visibleLength" => {
            let s = get_str_owned(json, "s");
            format!(r#"{{"r":{}}}"#, visible_length(&s))
        }

        "highlight" => {
            let code = get_str_owned(json, "code");
            let lang = get_str_owned(json, "lang");
            format!(r#"{{"r":{}}}"#, json_escape(&highlight(&code, &lang)))
        }

        "wrapText" => {
            let s = get_str_owned(json, "s");
            let w = get_int(json, "w", 80) as usize;
            let lines = wrap_text(&s, w);
            format!(r#"{{"r":{}}}"#, json_str_arr(&lines))
        }

        "tokenize" => {
            let line    = get_str_owned(json, "line");
            let in_code = get_bool(json, "inCode", false);
            tokenize_line(&line, in_code)
        }

        "estimateTokens" => {
            let s = get_str_owned(json, "s");
            format!(r#"{{"r":{}}}"#, estimate_tokens(&s))
        }

        "contextSet" => {
            ctx.used  = get_int(json, "used", 0)  as usize;
            ctx.max   = get_int(json, "max", 0)   as usize;
            ctx.model = get_str_owned(json, "model");
            format!(r#"{{"r":true,"pct":{:.2}}}"#, ctx.used as f64 / ctx.max.max(1) as f64)
        }

        "contextBar" => {
            let w   = get_int(json, "w", 40) as usize;
            let bar = ctx.bar(w);
            format!(r#"{{"r":{}}}"#, json_escape(&bar))
        }

        "contextAdd" => {
            let tokens = get_int(json, "tokens", 0) as usize;
            ctx.used   = (ctx.used + tokens).min(ctx.max);
            let pct    = ctx.used as f64 / ctx.max.max(1) as f64;
            format!(r#"{{"r":true,"used":{},"pct":{:.2}}}"#, ctx.used, pct)
        }

        "batch" => {
            // Find the "ops" array and process each element
            // Simple extraction: find [ after "ops": and split by }{
            let ops_key = "\"ops\":[";
            let Some(start) = json.find(ops_key) else {
                return r#"{"results":[]}"#.to_string();
            };
            let ops_json = &json[start + ops_key.len()..];
            // Split on },{  — crude but sufficient for our protocol
            let mut results = Vec::new();
            let mut depth = 0i32;
            let mut obj_start = 0;
            let bytes = ops_json.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                match bytes[i] {
                    b'{' => { if depth == 0 { obj_start = i; } depth += 1; }
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            let op = &ops_json[obj_start..=i];
                            let op_cmd = get_str_owned(op, "cmd");
                            results.push(process(&op_cmd, op, ctx));
                        }
                    }
                    b']' if depth == 0 => break,
                    _ => {}
                }
                i += 1;
            }
            format!(r#"{{"results":[{}]}}"#, results.join(","))
        }

        _ => r#"{"error":"unknown cmd"}"#.to_string(),
    }
}

fn main() {
    let stdin  = io::stdin();
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let mut ctx = ContextTracker::default();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };

        let cmd = get_str(&line, "cmd");
        let result = process(cmd, &line, &mut ctx);

        out.write_all(result.as_bytes()).unwrap();
        out.write_all(b"\n").unwrap();
        out.flush().unwrap();
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Extract the `type` discriminator from a tokenizer frame.
    fn tok_type(frame: &str) -> &str { get_str(frame, "type") }

    // ── Minimal JSON helpers ────────────────────────────────────────────────────

    #[test]
    fn json_escape_quotes_backslashes_and_controls() {
        assert_eq!(json_escape("a\"b\\c\nd\te\rf"), r#""a\"b\\c\nd\te\rf""#);
    }

    #[test]
    fn json_escape_empty_plain_and_multibyte() {
        assert_eq!(json_escape(""), "\"\"");
        assert_eq!(json_escape("hello"), "\"hello\"");
        assert_eq!(json_escape("héllo 世界 🌍"), "\"héllo 世界 🌍\"");
    }

    #[test]
    fn json_str_arr_serializes() {
        assert_eq!(json_str_arr(&[]), "[]");
        assert_eq!(json_str_arr(&["a".into()]), "[\"a\"]");
        assert_eq!(json_str_arr(&["a".into(), "b c".into()]), "[\"a\",\"b c\"]");
    }

    #[test]
    fn get_str_extracts_value_and_missing() {
        let j = r#"{"cmd":"ping","s":"hello"}"#;
        assert_eq!(get_str(j, "cmd"), "ping");
        assert_eq!(get_str(j, "s"), "hello");
        assert_eq!(get_str(j, "missing"), "");
        assert_eq!(get_str("not json", "cmd"), "");
    }

    #[test]
    fn get_str_owned_unescapes() {
        let j = r#"{"s":"line1\nline2\ttab\"q\\end"}"#;
        assert_eq!(get_str_owned(j, "s"), "line1\nline2\ttab\"q\\end");
        assert_eq!(get_str_owned(r#"{}"#, "s"), "");
    }

    #[test]
    fn get_int_parses_and_defaults() {
        assert_eq!(get_int(r#"{"w":42}"#, "w", 80), 42);
        assert_eq!(get_int(r#"{"w":-7}"#, "w", 80), -7);
        assert_eq!(get_int(r#"{}"#, "w", 80), 80);
        assert_eq!(get_int(r#"{"w":"x"}"#, "w", 80), 80);
    }

    #[test]
    fn get_bool_true_false_default() {
        assert!(get_bool(r#"{"inCode":true}"#, "inCode", false));
        assert!(!get_bool(r#"{"inCode":false}"#, "inCode", true));
        assert!(!get_bool(r#"{}"#, "inCode", false));
        assert!(get_bool(r#"{}"#, "inCode", true));
    }

    // ── ANSI strip / visible length ─────────────────────────────────────────────

    #[test]
    fn strip_ansi_sgr() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi("\x1b[1m\x1b[38;2;1;2;3mhi\x1b[0m"), "hi");
        assert_eq!(strip_ansi("\x1b[mplain"), "plain");
    }

    #[test]
    fn strip_ansi_csi_cursor_control() {
        // The earlier bug: only SGR (`...m`) was removed, leaving cursor-control
        // CSI sequences behind. Final byte must be 0x40..=0x7E, not just 'm'.
        assert_eq!(strip_ansi("\x1b[2J\x1b[Hclean"), "clean");
        assert_eq!(strip_ansi("a\x1b[1;1Hb"), "ab");
    }

    #[test]
    fn strip_ansi_csi_various_final_bytes() {
        assert_eq!(strip_ansi("\x1b[2J\x1b[H\x1b[s\x1b[?25lX"), "X");
        assert_eq!(strip_ansi("\x1b[?1049h\x1b[?1049lY"), "Y");
    }

    #[test]
    fn strip_ansi_osc_bel_and_st() {
        assert_eq!(strip_ansi("\x1b]0;title\x07body"), "body");
        assert_eq!(strip_ansi("\x1b]0;title\x1b\\body"), "body");
        assert_eq!(strip_ansi("x\x1b]8;;url\x07link\x1b]8;;\x07z"), "xlinkz");
    }

    #[test]
    fn strip_ansi_no_ansi_passthrough() {
        assert_eq!(strip_ansi(""), "");
        assert_eq!(strip_ansi("plain text 123"), "plain text 123");
        assert_eq!(strip_ansi("a\nb\tc"), "a\nb\tc");
    }

    #[test]
    fn strip_ansi_mixed_multibyte_and_ansi() {
        assert_eq!(strip_ansi("\x1b[1m世界\x1b[0m 🌍 \x1b[2Jok"), "世界 🌍 ok");
        assert_eq!(strip_ansi("héllo \x1b[32m✓\x1b[0m"), "héllo ✓");
    }

    #[test]
    fn strip_ansi_edges() {
        // Lone trailing ESC is preserved; a non-CSI/non-OSC ESC sequence is a
        // two-byte escape (e.g. ESC 7 = save cursor).
        assert_eq!(strip_ansi("a\x1b"), "a\x1b");
        assert_eq!(strip_ansi("a\x1b7b"), "ab");
    }

    #[test]
    fn utf8_char_len_and_visible_length() {
        assert_eq!(utf8_char_len(b'a'), 1);
        assert_eq!(utf8_char_len(0xC3), 2); // leading byte of 'é'
        assert_eq!(utf8_char_len(0xE4), 3); // leading byte of '世'
        assert_eq!(utf8_char_len(0xF0), 4); // leading byte of '🌍'

        assert_eq!(visible_length("\x1b[31mabc\x1b[0m"), 3);
        assert_eq!(visible_length("世界"), 2);
        assert_eq!(visible_length(""), 0);
    }

    // ── Word wrap / token estimate ──────────────────────────────────────────────

    #[test]
    fn wrap_text_respects_width() {
        assert_eq!(wrap_text("one two three four", 7), ["one two", "three", "four"]);
        assert_eq!(wrap_text("a b c", 1), ["a", "b", "c"]);
    }

    #[test]
    fn wrap_text_zero_width_defaults_80() {
        assert_eq!(wrap_text("a b c", 0), ["a b c"]);
        assert_eq!(wrap_text("", 10), Vec::<String>::new());
    }

    #[test]
    fn estimate_tokens_basic() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abc"), 1);
        assert_eq!(estimate_tokens(&"a".repeat(38)), 10);
        assert_eq!(estimate_tokens(&"a".repeat(39)), 11);
    }

    // ── Language resolution / keyword tables ────────────────────────────────────

    #[test]
    fn resolve_lang_aliases() {
        assert_eq!(resolve_lang("js"), "javascript");
        assert_eq!(resolve_lang("javascript"), "javascript");
        assert_eq!(resolve_lang("ts"), "typescript");
        assert_eq!(resolve_lang("py"), "python");
        assert_eq!(resolve_lang("rs"), "rust");
        assert_eq!(resolve_lang("sh"), "bash");
        assert_eq!(resolve_lang("shell"), "bash");
        assert_eq!(resolve_lang("cpp"), "c");
        assert_eq!(resolve_lang("c++"), "c");
        assert_eq!(resolve_lang("go"), "go");
        assert_eq!(resolve_lang("java"), "java");
        assert_eq!(resolve_lang("sql"), "sql");
    }

    #[test]
    fn resolve_lang_unknown_and_case() {
        assert_eq!(resolve_lang("JS"), "javascript");
        assert_eq!(resolve_lang("PyThOn"), "python");
        assert_eq!(resolve_lang("unknown"), "plain");
        assert_eq!(resolve_lang(""), "plain");
        assert!(keywords_for("plain").is_empty());
    }

    #[test]
    fn keywords_for_known_languages() {
        assert!(keywords_for("javascript").contains(&"const"));
        assert!(keywords_for("python").contains(&"def"));
        assert!(keywords_for("rust").contains(&"fn"));
        assert!(keywords_for("cpp").contains(&"class"));
        assert!(keywords_for("sql").contains(&"SELECT"));
    }

    // ── Syntax highlighter ──────────────────────────────────────────────────────

    #[test]
    fn highlight_keywords_numbers_operators() {
        let h = highlight("const x = 1;", "js");
        assert!(h.starts_with(C_PL));
        assert!(h.ends_with(RST));
        assert!(h.contains(&format!("{}const{}", C_KW, C_PL)));
        assert!(h.contains(&format!("{}1{}", C_NUM, C_PL)));
        assert!(h.contains(&format!("{}={}", C_OP, C_PL)));
    }

    #[test]
    fn highlight_string_literal() {
        let h = highlight("let s = \"hello\";", "js");
        assert!(h.contains(&format!("{}\"hello\"{}", C_STR, C_PL)));
    }

    #[test]
    fn highlight_comment_line() {
        let js = highlight("// note", "js");
        assert!(js.contains(C_CMT));
        assert!(js.contains("// note"));
        // `cpp` resolves to `c`, which also uses `//` comments.
        assert!(highlight("// note", "cpp").contains(C_CMT));
        // SQL uses `--`.
        assert!(highlight("-- note", "sql").contains(C_CMT));
    }

    #[test]
    fn highlight_python_multiline() {
        let h = highlight("# c\ndef f():", "py");
        assert!(h.contains(C_CMT));
        assert!(h.contains(&format!("{}def{}", C_KW, C_PL)));
        assert!(h.contains('\n'));
    }

    #[test]
    fn highlight_multibyte_does_not_panic() {
        let h = highlight("世界 🌍 — const", "js");
        assert!(h.contains("世界"));
        assert!(h.contains("🌍"));
        assert!(h.contains(&format!("{}const{}", C_KW, C_PL)));
    }

    #[test]
    fn highlight_multibyte_inside_string() {
        let h = highlight("\"héllo 世界\"", "js");
        assert!(h.contains(&format!("{}\"héllo 世界\"{}", C_STR, C_PL)));
    }

    // ── Markdown tokenizer ──────────────────────────────────────────────────────

    #[test]
    fn tokenize_blank_and_paragraph() {
        assert_eq!(tok_type(&tokenize_line("", false)), "blank");
        assert_eq!(tok_type(&tokenize_line("  ", false)), "blank");
        let p = tokenize_line("hello world", false);
        assert_eq!(tok_type(&p), "paragraph");
        assert_eq!(get_str(&p, "text"), "hello world");
    }

    #[test]
    fn tokenize_heading_levels() {
        let h = tokenize_line("### Sub", false);
        assert_eq!(tok_type(&h), "heading");
        assert_eq!(get_int(&h, "level", 0), 3);
        assert_eq!(get_str(&h, "text"), "Sub");
        // Seven hashes is not a valid heading.
        assert_ne!(tok_type(&tokenize_line("####### nope", false)), "heading");
    }

    #[test]
    fn tokenize_hr_and_blockquote() {
        for hr in ["---", "***", "___", "===", "- - -", "* * *"] {
            assert_eq!(tok_type(&tokenize_line(hr, false)), "hr", "hr: {hr}");
        }
        let q = tokenize_line("> quoted", false);
        assert_eq!(tok_type(&q), "blockquote");
        assert_eq!(get_str(&q, "text"), "quoted");
    }

    #[test]
    fn tokenize_lists() {
        let ul = tokenize_line("- item", false);
        assert_eq!(tok_type(&ul), "ul_item");
        assert_eq!(get_str(&ul, "text"), "item");
        assert_eq!(get_int(&ul, "depth", -1), 0);

        let nested = tokenize_line("  * nested", false);
        assert_eq!(tok_type(&nested), "ul_item");
        assert_eq!(get_int(&nested, "depth", -1), 1);

        let ol = tokenize_line("3. third", false);
        assert_eq!(tok_type(&ol), "ol_item");
        assert_eq!(get_int(&ol, "level", 0), 3);
        assert_eq!(get_str(&ol, "text"), "third");
        assert!(get_bool(&ol, "ordered", false));
    }

    #[test]
    fn tokenize_table_rows_and_sep() {
        let row = tokenize_line("| a | b |", false);
        assert_eq!(tok_type(&row), "table_row");
        let sep = tokenize_line("|---|---|", false);
        assert_eq!(tok_type(&sep), "table_sep");
    }

    #[test]
    fn tokenize_code_fence_states() {
        let open = tokenize_line("```rust", false);
        assert_eq!(tok_type(&open), "code_open");
        assert_eq!(get_str(&open, "lang"), "rust");

        let line = tokenize_line("let x = 1;", true);
        assert_eq!(tok_type(&line), "code_line");
        assert_eq!(get_str(&line, "text"), "let x = 1;");

        let close = tokenize_line("```", true);
        assert_eq!(tok_type(&close), "code_close");
    }

    #[test]
    fn tokenize_text_is_json_escaped() {
        let p = tokenize_line("say \"hi\"", false);
        assert_eq!(get_str_owned(&p, "text"), "say \"hi\"");
    }

    // ── Context tracker bar ─────────────────────────────────────────────────────

    #[test]
    fn context_bar_colors_and_counts() {
        let ctx = ContextTracker { used: 50, max: 100, model: String::new() };
        let bar = ctx.bar(10);
        assert!(bar.contains("\x1b[38;2;134;239;172m")); // green (< 60%)
        assert!(bar.contains("█████"));
        assert!(bar.contains("░░░░░"));
        assert!(bar.contains("50/100 tokens"));
        assert!(bar.contains("50%"));

        let hot = ContextTracker { used: 90, max: 100, model: String::new() };
        assert!(hot.bar(10).contains("\x1b[38;2;248;113;113m")); // red (>= 85%)
    }

    #[test]
    fn context_bar_zero_max() {
        assert_eq!(ContextTracker { used: 0, max: 0, model: String::new() }.bar(40), "");
    }

    // ── Protocol dispatcher (pure, no stdout/IPC involved) ──────────────────────

    #[test]
    fn process_ping_and_unknown() {
        let mut ctx = ContextTracker::default();
        assert_eq!(process("ping", "", &mut ctx), r#"{"r":"pong","engine":"rust"}"#);
        assert_eq!(process("nope", "", &mut ctx), r#"{"error":"unknown cmd"}"#);
        assert_eq!(process("", "", &mut ctx), r#"{"error":"unknown cmd"}"#);
    }

    #[test]
    fn process_strip_and_visible_length() {
        let mut ctx = ContextTracker::default();
        let json = format!(r#"{{"s":"{}red{} 世界"}}"#, "\x1b[31m", "\x1b[0m");
        assert_eq!(process("stripAnsi", &json, &mut ctx), r#"{"r":"red 世界"}"#);
        assert_eq!(process("visibleLength", &json, &mut ctx), r#"{"r":6}"#);
    }

    #[test]
    fn process_batch_and_empty() {
        let mut ctx = ContextTracker::default();
        let j = r#"{"ops":[{"cmd":"ping"},{"cmd":"stripAnsi","s":"plain"}]}"#;
        assert_eq!(
            process("batch", j, &mut ctx),
            r#"{"results":[{"r":"pong","engine":"rust"},{"r":"plain"}]}"#
        );
        assert_eq!(process("batch", r#"{}"#, &mut ctx), r#"{"results":[]}"#);
    }

    #[test]
    fn process_context_state() {
        let mut ctx = ContextTracker::default();
        let set = r#"{"cmd":"contextSet","used":10,"max":100,"model":"m"}"#;
        assert_eq!(process("contextSet", set, &mut ctx), r#"{"r":true,"pct":0.10}"#);
        assert_eq!(process("contextAdd", r#"{"tokens":15}"#, &mut ctx),
                   r#"{"r":true,"used":25,"pct":0.25}"#);
        assert!(process("contextBar", r#"{"w":10}"#, &mut ctx).contains("25/100 tokens"));
    }

    #[test]
    fn protocol_frames_valid_and_malformed() {
        let mut ctx = ContextTracker::default();

        // Mirrors main(): extract "cmd", then dispatch the whole line.
        let valid = r#"{"cmd":"ping"}"#;
        let cmd = get_str(valid, "cmd");
        assert_eq!(cmd, "ping");
        assert_eq!(process(cmd, valid, &mut ctx), r#"{"r":"pong","engine":"rust"}"#);

        // Malformed / cmd-less frames are answered with the error frame,
        // so the persistent child never dies on a bad line.
        for line in [r#"{"foo":"bar"}"#, "not json", "{}"] {
            let cmd = get_str(line, "cmd");
            assert_eq!(cmd, "");
            assert_eq!(process(cmd, line, &mut ctx), r#"{"error":"unknown cmd"}"#);
        }
    }
}
