// ─────────────────────────────────────────────────────────────────────────────
// arc_core.cpp — arc native engine (standalone CLI, JSON protocol)
// Invoked by arc's TS layer for hot-path operations
//
// Protocol: read one JSON line from stdin, write one JSON line to stdout
// Commands:
//   {"cmd":"stripAnsi","s":"..."}          → {"r":"..."}
//   {"cmd":"visibleLength","s":"..."}      → {"r":42}
//   {"cmd":"highlight","code":"...","lang":"..."} → {"r":"...ansi..."}
//   {"cmd":"wrapText","s":"...","w":80}    → {"r":["line1","line2"]}
//   {"cmd":"tokenize","line":"...","inCode":false} → {"type":"...","text":"...",...}
//   {"cmd":"batch","ops":[...]}            → {"results":[...]}
//
// Build: g++ -std=c++17 -O3 -o arc_core arc_core.cpp
// ─────────────────────────────────────────────────────────────────────────────

#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <algorithm>
#include <unordered_map>
#include <cstring>

// ── Tiny JSON builder (no deps) ───────────────────────────────────────────────

static std::string json_str(const std::string& s) {
  std::string out = "\"";
  for (char c : s) {
    if      (c == '"')  out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else                out += c;
  }
  return out + "\"";
}

static std::string json_arr(const std::vector<std::string>& v) {
  std::string out = "[";
  for (size_t i = 0; i < v.size(); i++) {
    if (i) out += ",";
    out += json_str(v[i]);
  }
  return out + "]";
}

// ── Tiny JSON parser (key-value flat only, enough for our protocol) ───────────

struct JVal { std::string str; long num = 0; bool flag = false; bool is_num = false; bool is_bool = false; };

static std::string json_get_str(const std::string& json, const std::string& key) {
  std::string needle = "\"" + key + "\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return "";
  pos += needle.size();
  while (pos < json.size() && (json[pos]==' '||json[pos]==':')) pos++;
  if (pos >= json.size()) return "";
  if (json[pos] == '"') {
    pos++;
    std::string val;
    while (pos < json.size() && json[pos] != '"') {
      if (json[pos]=='\\' && pos+1<json.size()) {
        char esc = json[++pos];
        if      (esc=='n') val+='\n';
        else if (esc=='t') val+='\t';
        else if (esc=='r') val+='\r';
        else               val+=esc;
      } else {
        val += json[pos];
      }
      pos++;
    }
    return val;
  }
  return "";
}

static int json_get_int(const std::string& json, const std::string& key, int def = 0) {
  std::string needle = "\"" + key + "\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return def;
  pos += needle.size();
  while (pos < json.size() && (json[pos]==' '||json[pos]==':')) pos++;
  if (pos >= json.size() || !std::isdigit(json[pos])) return def;
  return std::stoi(json.substr(pos));
}

static bool json_get_bool(const std::string& json, const std::string& key, bool def = false) {
  std::string needle = "\"" + key + "\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return def;
  pos += needle.size();
  while (pos < json.size() && (json[pos]==' '||json[pos]==':')) pos++;
  if (pos + 4 <= json.size() && json.substr(pos,4)=="true") return true;
  if (pos + 5 <= json.size() && json.substr(pos,5)=="false") return false;
  return def;
}

// ── ANSI strip & measurement ──────────────────────────────────────────────────

static std::string strip_ansi(const std::string& s) {
  std::string out; out.reserve(s.size());
  size_t i = 0;
  while (i < s.size()) {
    if (s[i]=='\x1b' && i+1<s.size() && s[i+1]=='[') {
      i += 2;
      while (i < s.size() && s[i] != 'm') i++;
      i++;
    } else { out += s[i++]; }
  }
  return out;
}

static size_t visible_length(const std::string& s) {
  std::string st = strip_ansi(s);
  size_t len = 0, i = 0;
  while (i < st.size()) {
    unsigned char c = st[i];
    if      (c < 0x80) i += 1;
    else if (c < 0xE0) i += 2;
    else if (c < 0xF0) i += 3;
    else               i += 4;
    len++;
  }
  return len;
}

// ── Word wrap ─────────────────────────────────────────────────────────────────

static std::vector<std::string> wrap_text(const std::string& text, size_t w) {
  if (w == 0) w = 80;
  std::vector<std::string> lines;
  std::istringstream ss(text);
  std::string word, cur;
  size_t cl = 0;
  while (ss >> word) {
    size_t wl = visible_length(word);
    if (cl == 0) { cur = word; cl = wl; }
    else if (cl + 1 + wl <= w) { cur += ' '; cur += word; cl += 1 + wl; }
    else { lines.push_back(cur); cur = word; cl = wl; }
  }
  if (!cur.empty()) lines.push_back(cur);
  return lines;
}

// ── Syntax highlighter ────────────────────────────────────────────────────────

#define C_KW   "\x1b[38;2;197;165;197m"
#define C_STR  "\x1b[38;2;152;195;121m"
#define C_CMT  "\x1b[2m\x1b[38;2;92;99;112m"
#define C_NUM  "\x1b[38;2;229;192;123m"
#define C_FN   "\x1b[38;2;97;175;239m"
#define C_TY   "\x1b[38;2;230;160;100m"
#define C_OP   "\x1b[38;2;86;182;194m"
#define C_PL   "\x1b[38;2;187;187;187m"
#define RST    "\x1b[0m"

static const std::unordered_map<std::string, std::vector<std::string>> KWS = {
  {"javascript",{"const","let","var","function","class","return","if","else","for","while",
    "do","switch","case","break","continue","new","delete","typeof","instanceof","in","of",
    "import","export","default","from","async","await","try","catch","finally","throw",
    "void","this","super","static","null","undefined","true","false","yield"}},
  {"typescript",{"const","let","var","function","class","return","if","else","for","while",
    "import","export","async","await","type","interface","enum","implements","declare",
    "abstract","readonly","keyof","never","unknown","any","null","undefined","true","false",
    "this","super","static","from","default","extends","new","throw","typeof"}},
  {"python",{"def","class","return","if","elif","else","for","while","with","as","import",
    "from","in","not","and","or","is","lambda","try","except","finally","raise","pass",
    "break","continue","global","nonlocal","del","yield","True","False","None","async","await"}},
  {"rust",{"fn","let","mut","pub","use","mod","struct","enum","impl","trait","for","while",
    "if","else","match","return","self","Self","const","static","type","where","ref","move",
    "async","await","dyn","loop","break","continue","true","false","Some","None","Ok","Err"}},
  {"go",{"func","var","const","type","struct","interface","map","chan","go","select","defer",
    "return","if","else","for","range","switch","case","break","continue","import","package",
    "nil","true","false","make","new","len","cap","append"}},
  {"bash",{"if","then","else","elif","fi","for","while","do","done","case","esac","function",
    "return","local","export","echo","source","unset","readonly","declare","in","break"}},
  {"c",{"int","char","float","double","long","short","unsigned","void","struct","union","enum",
    "typedef","return","if","else","for","while","do","switch","case","break","continue",
    "sizeof","const","static","extern","NULL","true","false","nullptr"}},
  {"sql",{"SELECT","FROM","WHERE","JOIN","LEFT","RIGHT","INNER","ON","AS","AND","OR","NOT",
    "IN","IS","NULL","ORDER","BY","GROUP","HAVING","LIMIT","INSERT","INTO","VALUES","UPDATE",
    "SET","DELETE","CREATE","TABLE","DROP","ALTER","DISTINCT","COUNT","SUM","AVG","MAX","MIN"}},
};

static bool is_id(char c)  { return isalnum(c)||c=='_'; }
static bool is_dig(char c) { return c>='0'&&c<='9'; }

static std::string hl_line(const std::string& line, const std::string& lang) {
  std::string l = lang;
  std::transform(l.begin(),l.end(),l.begin(),::tolower);
  static const std::unordered_map<std::string,std::string> AL={
    {"js","javascript"},{"ts","typescript"},{"py","python"},
    {"rs","rust"},{"sh","bash"},{"shell","bash"},{"cpp","c"}};
  if (AL.count(l)) l = AL.at(l);

  const std::vector<std::string>* kws = nullptr;
  auto it = KWS.find(l); if (it!=KWS.end()) kws=&it->second;

  std::string out = C_PL;
  size_t i=0, N=line.size();

  while (i<N) {
    // Comments
    if (i+1<N&&line[i]=='/'&&line[i+1]=='/'&&(l=="javascript"||l=="typescript"||l=="rust"||l=="go"||l=="c"))
      { out+=C_CMT; out+=line.substr(i); out+=RST; break; }
    if (line[i]=='#'&&(l=="python"||l=="bash"))
      { out+=C_CMT; out+=line.substr(i); out+=RST; break; }
    if (i+1<N&&line[i]=='-'&&line[i+1]=='-'&&l=="sql")
      { out+=C_CMT; out+=line.substr(i); out+=RST; break; }
    // Strings
    if (line[i]=='"'||line[i]=='\'') {
      char q=line[i]; size_t j=i+1;
      while(j<N&&!(line[j]==q&&line[j-1]!='\\'))j++;
      if(j<N)j++;
      out+=C_STR; out+=line.substr(i,j-i); out+=C_PL; i=j; continue;
    }
    // Numbers
    if (is_dig(line[i])) {
      size_t j=i;
      while(j<N&&(is_dig(line[j])||line[j]=='.'||line[j]=='e'||line[j]=='x'||isalpha(line[j])))j++;
      out+=C_NUM; out+=line.substr(i,j-i); out+=C_PL; i=j; continue;
    }
    // Identifier / keyword
    if (is_id(line[i])&&!is_dig(line[i])) {
      size_t j=i; while(j<N&&is_id(line[j]))j++;
      std::string w=line.substr(i,j-i);
      bool kw=false;
      if(kws) for(auto& k:*kws) if(k==w){kw=true;break;}
      if(kw)              { out+=C_KW; out+=w; out+=C_PL; }
      else if(isupper(w[0])){ out+=C_TY; out+=w; out+=C_PL; }
      else if(j<N&&line[j]=='('){ out+=C_FN; out+=w; out+=C_PL; }
      else                       { out+=w; }
      i=j; continue;
    }
    // Operators
    if (std::string("+-*/%=<>&|^~!?:").find(line[i])!=std::string::npos)
      { out+=C_OP; out+=line[i]; out+=C_PL; i++; continue; }
    out+=line[i++];
  }
  out+=RST;
  return out;
}

static std::string highlight(const std::string& code, const std::string& lang) {
  std::string out, line;
  std::istringstream ss(code);
  bool first=true;
  while(std::getline(ss,line)) {
    if(!first) out+='\n'; first=false;
    out+=hl_line(line,lang);
  }
  return out;
}

// ── Markdown line tokenizer ───────────────────────────────────────────────────

static std::string tokenize_line(const std::string& line, bool in_code) {
  if (in_code) {
    if (line.size()>=3&&line.substr(0,3)=="```")
      return "{\"type\":\"code_close\",\"text\":\"\",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
    return "{\"type\":\"code_line\",\"text\":"+json_str(line)+",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
  }

  // Blank
  bool blank=true; for(char c:line) if(c!=' '&&c!='\t'){blank=false;break;}
  if(blank) return "{\"type\":\"blank\",\"text\":\"\",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";

  // Code fence
  if(line.size()>=3&&line.substr(0,3)=="```") {
    std::string lang=line.size()>3?line.substr(3):"";
    while(!lang.empty()&&(lang.back()=='\r'||lang.back()=='\n'||lang.back()==' '))lang.pop_back();
    return "{\"type\":\"code_open\",\"text\":\"\",\"lang\":"+json_str(lang)+",\"level\":0,\"depth\":0,\"ordered\":false}";
  }

  // HR
  { std::string t=line;
    while(!t.empty()&&(t.back()=='\r'||t.back()=='\n'||t.back()==' '))t.pop_back();
    if(t=="---"||t=="***"||t=="___"||t=="===")
      return "{\"type\":\"hr\",\"text\":\"\",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
  }

  // Heading
  if(!line.empty()&&line[0]=='#') {
    int lvl=0; while(lvl<(int)line.size()&&line[lvl]=='#')lvl++;
    if(lvl<=6&&lvl<(int)line.size()&&line[lvl]==' ') {
      std::string txt=line.substr(lvl+1);
      while(!txt.empty()&&(txt.back()=='\r'||txt.back()=='\n'))txt.pop_back();
      return "{\"type\":\"heading\",\"text\":"+json_str(txt)+",\"lang\":\"\",\"level\":"+std::to_string(lvl)+",\"depth\":0,\"ordered\":false}";
    }
  }

  // Blockquote
  if(!line.empty()&&line[0]=='>') {
    std::string txt=line.size()>1&&line[1]==' '?line.substr(2):line.substr(1);
    return "{\"type\":\"blockquote\",\"text\":"+json_str(txt)+",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
  }

  // UL item
  { size_t si=0; while(si<line.size()&&line[si]==' ')si++;
    if(si<line.size()&&(line[si]=='-'||line[si]=='*'||line[si]=='+')&&si+1<line.size()&&line[si+1]==' ') {
      std::string txt=line.substr(si+2);
      return "{\"type\":\"ul_item\",\"text\":"+json_str(txt)+",\"lang\":\"\",\"level\":0,\"depth\":"+std::to_string(si/2)+",\"ordered\":false}";
    }
  }

  // OL item
  { size_t si=0; while(si<line.size()&&line[si]==' ')si++;
    size_t ni=si; while(ni<line.size()&&is_dig(line[ni]))ni++;
    if(ni>si&&ni<line.size()&&line[ni]=='.'&&ni+1<line.size()&&line[ni+1]==' ') {
      int num=std::stoi(line.substr(si,ni-si));
      std::string txt=line.substr(ni+2);
      return "{\"type\":\"ol_item\",\"text\":"+json_str(txt)+",\"lang\":\"\",\"level\":"+std::to_string(num)+",\"depth\":"+std::to_string(si/2)+",\"ordered\":true}";
    }
  }

  // Table
  if(!line.empty()&&line[0]=='|') {
    bool sep=true; for(char c:line)if(c!='|'&&c!='-'&&c!=':'&&c!=' '){sep=false;break;}
    std::string t=sep?"table_sep":"table_row";
    return "{\"type\":\""+t+"\",\"text\":"+json_str(line)+",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
  }

  std::string txt=line;
  while(!txt.empty()&&(txt.back()=='\r'||txt.back()=='\n'))txt.pop_back();
  return "{\"type\":\"paragraph\",\"text\":"+json_str(txt)+",\"lang\":\"\",\"level\":0,\"depth\":0,\"ordered\":false}";
}

// ── Main loop (line-delimited JSON protocol) ──────────────────────────────────

int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) { std::cout << "{\"r\":null}\n"; std::cout.flush(); continue; }

    std::string cmd = json_get_str(line, "cmd");

    if (cmd == "stripAnsi") {
      std::cout << "{\"r\":" << json_str(strip_ansi(json_get_str(line,"s"))) << "}\n";
    } else if (cmd == "visibleLength") {
      std::cout << "{\"r\":" << visible_length(json_get_str(line,"s")) << "}\n";
    } else if (cmd == "highlight") {
      std::string code = json_get_str(line,"code");
      std::string lang = json_get_str(line,"lang");
      std::cout << "{\"r\":" << json_str(highlight(code,lang)) << "}\n";
    } else if (cmd == "wrapText") {
      std::string s = json_get_str(line,"s");
      int w = json_get_int(line,"w",80);
      auto lines = wrap_text(s,(size_t)w);
      std::cout << "{\"r\":" << json_arr(lines) << "}\n";
    } else if (cmd == "tokenize") {
      std::string ln  = json_get_str(line,"line");
      bool in_code    = json_get_bool(line,"inCode",false);
      std::cout << tokenize_line(ln,in_code) << "\n";
    } else if (cmd == "ping") {
      std::cout << "{\"r\":\"pong\"}\n";
    } else {
      std::cout << "{\"error\":\"unknown cmd\"}\n";
    }
    std::cout.flush();
  }
  return 0;
}
