/** 小程序里不跑 KaTeX：把 $...$ 里常见的 LaTeX 换成好读的 Unicode 文字（x²、√(2)、a/b、≤、π…）。
 *  拆出的片段交给 MathText 显示；「□」（看不清的字）单独成段，显示成红色「未识别」。 */

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", m: "ᵐ", k: "ᵏ", t: "ᵗ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", n: "ₙ", i: "ᵢ", x: "ₓ", a: "ₐ", e: "ₑ", o: "ₒ", m: "ₘ", k: "ₖ", t: "ₜ" };

const SYMBOLS: Record<string, string> = {
  times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", cong: "≌", propto: "∝",
  infty: "∞", pi: "π", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", theta: "θ", lambda: "λ", mu: "μ", rho: "ρ", sigma: "σ", Sigma: "Σ", omega: "ω", Omega: "Ω", varphi: "φ", phi: "φ", epsilon: "ε", eta: "η", tau: "τ",
  angle: "∠", triangle: "△", parallel: "∥", perp: "⊥", circ: "°", degree: "°", because: "∵", therefore: "∴",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃",
  rightarrow: "→", to: "→", Rightarrow: "⇒", leftarrow: "←", Leftrightarrow: "⇔", uparrow: "↑", downarrow: "↓", ldots: "…", cdots: "⋯", dots: "…",
  quad: "　", qquad: "　　", ",": " ", ";": " ", "!": "", " ": " ", lbrace: "{", rbrace: "}", "{": "{", "}": "}", "%": "%", "$": "$", "#": "#", "&": "&", _: "_",
  sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln", lg: "lg", max: "max", min: "min", lim: "lim", sum: "∑", int: "∫", prod: "∏",
  left: "", right: "", big: "", Big: "", bigg: "", displaystyle: "", textstyle: "", limits: "",
};

/** 从 s[i] 起读一个参数：{...} 或单个字符 / 命令；返回内容和结束位置 */
function readArg(s: string, i: number): [string, number] {
  while (s[i] === " ") i++;
  if (s[i] === "{") {
    let depth = 1;
    let j = i + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}") depth--;
      j++;
    }
    return [s.slice(i + 1, j - 1), j];
  }
  if (s[i] === "\\") {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
    if (m) return [m[0], i + m[0].length];
  }
  return [s[i] ?? "", i + 1];
}

const wrap = (x: string) => (/^[\w.²³′]+$|^\(.*\)$/.test(x) ? x : `(${x})`);

function script(text: string, table: Record<string, string>, mark: string): string {
  const chars = [...text];
  if (chars.every((c) => table[c])) return chars.map((c) => table[c]).join("");
  return `${mark}${wrap(text)}`;
}

/** 把一段 LaTeX 变成纯文本 */
export function latexToText(tex: string): string {
  let out = "";
  let i = 0;
  const s = tex;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [a, j] = readArg(s, i);
        const [b, k] = readArg(s, j);
        i = k;
        out += `${wrap(latexToText(a))}/${wrap(latexToText(b))}`;
      } else if (name === "sqrt") {
        let n = "";
        if (s[i] === "[") {
          const end = s.indexOf("]", i);
          n = s.slice(i + 1, end);
          i = end + 1;
        }
        const [a, j] = readArg(s, i);
        i = j;
        const root = n === "3" ? "∛" : n === "4" ? "∜" : n ? `${script(n, SUP, "^")}√` : "√";
        const inner = latexToText(a);
        out += root + (/^[\w.]+$/.test(inner) && inner.length <= 3 ? inner : `(${inner})`);
      } else if (["text", "mathrm", "textbf", "mathbf", "mathit", "operatorname", "textrm", "boldsymbol", "mbox"].includes(name)) {
        const [a, j] = readArg(s, i);
        i = j;
        out += latexToText(a);
      } else if (name === "overline" || name === "bar") {
        const [a, j] = readArg(s, i);
        i = j;
        out += [...latexToText(a)].map((ch) => ch + "̅").join("");
      } else if (name === "vec" || name === "overrightarrow") {
        const [a, j] = readArg(s, i);
        i = j;
        out += `${latexToText(a)}⃗`;
      } else if (name === "hat") {
        const [a, j] = readArg(s, i);
        i = j;
        out += `${latexToText(a)}̂`;
      } else if (name === "textcolor" || name === "color") {
        const [, j] = readArg(s, i);
        i = j;
      } else if (name === "begin" || name === "end") {
        const [, j] = readArg(s, i);
        i = j;
      } else if (name === "\\") {
        out += "\n";
      } else if (name in SYMBOLS) {
        const sym = SYMBOLS[name];
        out += /^[a-z]{2,}$/.test(sym) ? `${sym} ` : sym;
      } else out += name;
    } else if (c === "^" || c === "_") {
      const [a, j] = readArg(s, i + 1);
      i = j;
      const t = latexToText(a);
      if (c === "^" && (t === "°" || t === "∘")) out += "°";
      else if (c === "^" && t === "′") out += "′";
      else out += script(t, c === "^" ? SUP : SUB, c);
    } else if (c === "{" || c === "}") {
      i++;
    } else if (c === "&") {
      out += " ";
      i++;
    } else if (c === "~") {
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/[ \t]{2,}/g, " ");
}

const MATH_RE = /\$([^$]{1,600})\$/g;

export interface Seg {
  text: string;
  unrec?: boolean; // 看不清的字：红色「未识别」
}

/** 文本 → 片段：公式转成文字，□ 拆成「未识别」 */
export function toSegments(text: string): Seg[] {
  const plain = (text || "").replace(MATH_RE, (_, tex: string) => latexToText(tex));
  const out: Seg[] = [];
  plain.split("□").forEach((part, i) => {
    if (i > 0) out.push({ text: "未识别", unrec: true });
    if (part) out.push({ text: part });
  });
  return out;
}

/** 纯文本版本（标题、分享等不需要红字的地方） */
export const mathPlain = (text: string) => toSegments(text).map((s) => s.text).join("");
