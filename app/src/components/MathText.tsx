/** 识别结果里的文字：$...$ 里的 LaTeX 用 KaTeX 排成数学公式，换行保留，「□」（照片上看不清的字）显示成红色「未识别」。 */
import katex from "katex";
import "katex/dist/katex.min.css";
import { Fragment, useMemo, type ReactNode } from "react";

const MATH_RE = /\$([^$]{1,600})\$/g;

function renderMath(tex: string): string {
  try {
    // 公式里看不清的字也显示成红色「未识别」
    const src = tex.replace(/□/g, "\\textcolor{#d92d20}{\\textbf{\\text{未识别}}}");
    return katex.renderToString(src, { throwOnError: false, output: "html", strict: "ignore", trust: false });
  } catch {
    return "";
  }
}

/** 普通文字片段：把「□」换成红色「未识别」 */
function plain(text: string, key: string): ReactNode {
  if (!text.includes("□")) return <Fragment key={key}>{text}</Fragment>;
  return (
    <Fragment key={key}>
      {text.split("□").map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="unrec">未识别</span>}
          {seg}
        </Fragment>
      ))}
    </Fragment>
  );
}

/** 把一段文字拆成普通文字和公式两种片段 */
export function mathNodes(text: string, keyPrefix = "m"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of (text || "").matchAll(MATH_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(plain(text.slice(last, start), `${keyPrefix}t${i++}`));
    const html = renderMath(m[1]);
    out.push(html ? <span className="math" key={`${keyPrefix}f${i++}`} dangerouslySetInnerHTML={{ __html: html }} /> : plain(m[0], `${keyPrefix}r${i++}`));
    last = start + m[0].length;
  }
  if (last < (text || "").length) out.push(plain(text.slice(last), `${keyPrefix}t${i++}`));
  return out;
}

/** 行内使用：<MathText text={q.stemText} />；换行由外层的 white-space: pre-wrap 保留 */
export function MathText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const nodes = useMemo(() => mathNodes(text), [text]);
  return <span className={className} style={{ whiteSpace: "pre-wrap", ...style }}>{nodes}</span>;
}

/** 有没有看不清的字（用来提示「建议重拍」） */
export const hasUnrecognized = (text: string | undefined) => Boolean(text && text.includes("□"));
