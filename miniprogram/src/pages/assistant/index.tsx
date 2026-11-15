/**
 * 智能聊天「问小壹」的对话页（和 App 的 components/Assistant.tsx 同一套内容）。
 * App 里是盖在页面上的半屏 / 全屏浮层；小程序没有全局浮层，做成单独一页，从四个 Tab 页右边的入口进来，返回就是「缩小」。
 * 离开这一页回答照样往下生成、试卷照样处理（状态在 lib/assistant.ts），入口上亮红点。
 */
import { Image, ScrollView, Text, Textarea, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow, useUnload } from "@tarojs/taro";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Face } from "../../components/AssistantOrb";
import { base64, Icon, type IconName } from "../../components/Icon";
import {
  agreeAssistant, deleteConversation, ensureAssistant, newConversation, pickConversation, retryAnswer, retryUpload, sendQuestion, setAssistantPageOpen, setFocus, setScope,
  STAGE_STEPS, stepOf, stopAnswer, uploadFile, uploadImages, useAssistant, workingOf,
  type Msg, type Upload,
} from "../../lib/assistant";
import { errorText } from "../../lib/api";
import { pickPhotos } from "../../lib/capture";
import { allErrors, groupByKnowledge } from "../../lib/errors";
import { toast } from "../../lib/hooks";
import { fetchQuestion, type KbCitation } from "../../lib/kb";
import { latexToText } from "../../lib/math";
import { roleIconSvg } from "../../lib/roleIcons";
import { useShare } from "../../lib/share";
import { fileExists, listFolders, type Folder, type Paper } from "../../lib/store";
import { C, useTheme, useThemeClass } from "../../lib/theme";
import "./index.scss";

type View_ = "chat" | "history" | "papers";

export default function Assistant() {
  const tc = useThemeClass();
  useShare();
  const available = useAssistant((s) => s.available);
  const agreed = useAssistant((s) => s.agreed);
  const convs = useAssistant((s) => s.convs);
  const convId = useAssistant((s) => s.convId);
  const conv = convs.find((c) => c.id === convId) ?? convs[0];
  const uploads = useAssistant((s) => s.uploads);
  const busyId = useAssistant((s) => s.busyId);
  const scope = useAssistant((s) => s.scope);
  const focus = useAssistant((s) => s.focus);
  const [view, setView] = useState<View_>("chat");
  const [text, setText] = useState("");
  const [tray, setTray] = useState(false);
  const [kb, setKb] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const stick = useRef(true);
  const listH = useRef(0);
  const tick = useRef(0);

  useDidShow(() => {
    ensureAssistant();
    setAssistantPageOpen(true);
  });
  useDidHide(() => setAssistantPageOpen(false));
  useUnload(() => setAssistantPageOpen(false));

  // 键盘弹起来：整页底部让出键盘的高度（输入框不让微信自己上推页面，上推会把顶上的内容推出屏幕）
  useEffect(() => {
    const onChange = (r: { height: number }) => setKb(r.height || 0);
    Taro.onKeyboardHeightChange(onChange);
    return () => { Taro.offKeyboardHeightChange(onChange); };
  }, []);

  // 消息区有多高：判断用户是不是自己往上翻了
  const measure = () => {
    Taro.createSelectorQuery().select("#as-msgs").boundingClientRect((r) => {
      const rect = r as { height?: number } | null;
      if (rect?.height) listH.current = rect.height;
    }).exec();
  };
  useEffect(() => {
    const t = setTimeout(measure, 300);
    return () => clearTimeout(t);
  }, [kb, tray, view, agreed, focus]);

  // 有新内容时跟到底；用户自己往上翻了就不打扰
  const toBottom = () => {
    tick.current += 1;
    setScrollTop(1000000 + tick.current);
  };
  const last = conv.msgs[conv.msgs.length - 1];
  const lastLen = last && last.role === "ai" ? last.text.length + last.citations.length : 0;
  useEffect(() => {
    if (stick.current) toBottom();
  }, [conv.id, conv.msgs.length, lastLen, view, uploads, kb, tray]);
  useEffect(() => {
    stick.current = true;
    toBottom();
  }, [conv.id]);
  const onScroll = (e: { detail: { scrollTop: number; scrollHeight: number } }) => {
    if (!listH.current) return;
    stick.current = e.detail.scrollHeight - e.detail.scrollTop - listH.current < 80;
  };

  const send = (t = text) => {
    if (!agreed || busyId || !t.trim()) return;
    stick.current = true;
    setTray(false);
    if (t === text) setText("");
    void sendQuestion(t);
  };

  // ---- 上传的四个来源
  const photos = async (source: "camera" | "album") => {
    setTray(false);
    try {
      const list = await pickPhotos(source);
      if (list.length) {
        stick.current = true;
        uploadImages(list);
      }
    } catch (e) {
      toast(errorText(e));
    }
  };
  const files = async () => {
    setTray(false);
    let res: Taro.chooseMessageFile.SuccessCallbackResult;
    try {
      res = await Taro.chooseMessageFile({ count: 5, type: "file", extension: ["pdf", "docx", "txt"] });
    } catch (e) {
      const msg = String((e as { errMsg?: string }).errMsg || (e as Error).message || "");
      if (/cancel/i.test(msg)) return;
      if (/privacy|scope is not declared/i.test(msg)) return void Taro.showModal({ title: "暂时不能从聊天里选文件", content: "小程序后台的「用户隐私保护指引」还没有声明「选中的文件」，微信不让打开聊天文件。", showCancel: false });
      if (/not support|is not a function|undefined/i.test(msg)) return void Taro.showModal({ title: "这个微信版本不支持", content: "电脑版微信或版本太旧时不能从聊天里选文件，请在手机上把微信升到最新版再试。", showCancel: false });
      return void Taro.showModal({ title: "没选成", content: msg || "请再试一次", showCancel: false });
    }
    stick.current = true;
    for (const f of res.tempFiles) {
      const problem = uploadFile({ path: f.path, name: f.name, size: f.size });
      if (problem) toast(problem);
    }
  };
  const pickPaper = (paper: Paper) => {
    setView("chat");
    const srcs = paper.pages.map((p) => p.src).filter((p) => fileExists(p));
    if (!srcs.length) return void toast("这份试卷的照片不在这台手机上");
    stick.current = true;
    uploadImages(srcs, paper.name);
  };

  const working = workingOf(uploads).count;
  const sub = working ? `正在处理 ${working} 份试卷` : "有题就问";

  if (!available) {
    return (
      <View className={"as" + tc}>
        <View className="as-hello" style={{ paddingTop: "80px" }}>
          <RoleArt size={96} />
          <Text className="as-hello__t">{available === false ? "智能问答还没开通" : "正在连接小壹…"}</Text>
          <Text className="as-hello__s">{available === false ? "稍后再来看看。" : "没登录或没有网络时连不上，登录后再试。"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className={"as" + tc} style={kb ? { paddingBottom: `${kb}px` } : undefined}>
      <View className="as__head">
        {view === "chat" ? (
          <>
            <Face size={36} />
            <View className="as__title">
              <Text className="as__name">问小壹</Text>
              <Text className="as__sub ellipsis">{sub}</Text>
            </View>
            <HeadBtn icon="clock" onClick={() => { setTray(false); setView("history"); }} />
            <HeadBtn icon="pencil" onClick={() => { newConversation(); stick.current = true; }} />
          </>
        ) : (
          <>
            <HeadBtn icon="chevron-left" onClick={() => setView("chat")} />
            <View className="as__title">
              <Text className="as__name">{view === "history" ? "历史对话" : "选一份试卷"}</Text>
              <Text className="as__sub ellipsis">{view === "history" ? "只保存在这台手机上" : "把它的照片存进知识库"}</Text>
            </View>
          </>
        )}
      </View>

      {view === "history" && <History onPick={() => { setView("chat"); stick.current = true; }} />}
      {view === "papers" && <PaperPicker onPick={pickPaper} />}

      {view === "chat" && (
        <>
          <ScrollView id="as-msgs" className="as__msgs" scrollY enhanced showScrollbar={false} scrollTop={scrollTop} onScroll={onScroll} onClick={() => setTray(false)}>
            <View className="as__list">
              {!agreed ? (
                <Welcome onAgree={agreeAssistant} />
              ) : conv.msgs.length === 0 ? (
                <Hello onAsk={send} onUpload={() => setTray(true)} />
              ) : (
                conv.msgs.map((m, i) => (
                  <MsgRow key={m.id} msg={m} upload={m.role === "file" ? uploads[m.uploadId] : undefined} isLast={i === conv.msgs.length - 1} busy={!!busyId} onAsk={send} />
                ))
              )}
            </View>
          </ScrollView>
          {agreed && (
            <>
              <View className="as__scope">
                {focus ? (
                  <View className="as__chip as__chip--paper on">
                    <Icon name="document" size={14} color={C.brand} stroke={2} />
                    <Text className="as__chipt ellipsis">只问：{focus.title}</Text>
                    <View className="as__chipx" onClick={() => setFocus(null)}><Icon name="xmark" size={12} color={C.brand} stroke={2.6} /></View>
                  </View>
                ) : (
                  <>
                    <View className={`as__chip${scope.mine ? " on" : ""}`} onClick={() => setScope({ ...scope, mine: !scope.mine })}>
                      {scope.mine && <Icon name="check" size={13} color={C.brand} stroke={3} />}
                      <Text>我的试卷</Text>
                    </View>
                    <View className={`as__chip${scope.system ? " on" : ""}`} onClick={() => setScope({ ...scope, system: !scope.system })}>
                      {scope.system && <Icon name="check" size={13} color={C.brand} stroke={3} />}
                      <Text>系统题库</Text>
                    </View>
                  </>
                )}
              </View>
              <View className="as__in">
                <View className={`as__plus${tray ? " open" : ""}`} hoverClass="as--press" onClick={() => { setTray((v) => !v); void Taro.hideKeyboard().catch(() => undefined); }}>
                  <Icon name="plus" size={22} color={C.brand} stroke={2.4} />
                </View>
                <Textarea
                  className="as__field"
                  value={text}
                  maxlength={1000}
                  autoHeight
                  adjustPosition={false}
                  showConfirmBar={false}
                  disableDefaultPadding
                  cursorSpacing={12}
                  confirmType="send"
                  placeholder={focus ? "问问这份卷子…" : conv.msgs.length ? "接着问…" : "问一道题，或点 + 传试卷"}
                  placeholderClass="as__ph"
                  onInput={(e) => setText(e.detail.value)}
                  onFocus={() => setTray(false)}
                  onConfirm={() => send()}
                />
                {busyId ? (
                  <View className="as__send" hoverClass="as--press" onClick={stopAnswer}><View className="as__stop" /></View>
                ) : (
                  <View className={`as__send${text.trim() ? "" : " off"}`} hoverClass="as--press" onClick={() => send()}>
                    <Icon name="chevron-up" size={22} color={text.trim() ? "#ffffff" : C.tertiary} stroke={2.8} />
                  </View>
                )}
              </View>
              {tray && (
                <View className="as__tray">
                  <Att icon="camera" title="拍照扫描" note="可连拍" onClick={() => void photos("camera")} />
                  <Att icon="photo" title="相册" note="可多选" onClick={() => void photos("album")} />
                  <Att icon="document" title="聊天文件" note="PDF / Word" onClick={() => void files()} />
                  <Att icon="books" title="我的试卷" note="已有的" onClick={() => { setTray(false); setView("papers"); }} />
                </View>
              )}
            </>
          )}
          {!kb && <Text className="as__ai">内容由 AI 生成，仅供参考</Text>}
        </>
      )}
    </View>
  );
}

function HeadBtn({ icon, onClick }: { icon: IconName; onClick: () => void }) {
  return (
    <View className="as__hbtn" hoverClass="as--press" onClick={onClick}>
      <Icon name={icon} size={18} color={C.secondary} stroke={2} />
    </View>
  );
}

function Att({ icon, title, note, onClick }: { icon: IconName; title: string; note: string; onClick: () => void }) {
  return (
    <View className="as__att" hoverClass="as--press" onClick={onClick}>
      <View className="as__atti"><Icon name={icon} size={26} color={C.brand} stroke={2} /></View>
      <Text>{title}</Text>
      <Text className="as__attn">{note}</Text>
    </View>
  );
}

const artCache = new Map<string, string>();
/** 举着对话气泡的小壹（打招呼用） */
function RoleArt({ size }: { size: number }) {
  const theme = useTheme();
  let u = artCache.get(theme);
  if (!u) {
    u = `data:image/svg+xml;base64,${base64(roleIconSvg("chat", theme, false, false))}`;
    artCache.set(theme, u);
  }
  return <Image src={u} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px`, flexShrink: 0 }} />;
}

/** 第一次用：先说清楚数据去了哪 */
function Welcome({ onAgree }: { onAgree: () => void }) {
  return (
    <View className="as-hello">
      <RoleArt size={96} />
      <Text className="as-hello__t">我是小壹，有不会的题可以问我</Text>
      <Text className="as-hello__s">我会翻你传给我的试卷和系统题库来回答。</Text>
      <View className="as-consent">
        <Text className="as-consent__p">开始之前请知悉：你的提问和传给我的试卷，会发送到试卷知识库，并交给文字识别服务和大模型服务处理后生成回答；不会附带你的手机号。回答由 AI 生成，可能有错，请自己再核对。</Text>
        <View className="btn" hoverClass="btn--hover" onClick={onAgree}><Text>知道了，开始用</Text></View>
      </View>
    </View>
  );
}

/** 一段对话还没开始：打个招呼，给三条能直接点的示例 */
function Hello({ onAsk, onUpload }: { onAsk: (t: string) => void; onUpload: () => void }) {
  // 第二条示例用本机错题里错得最多的知识点；没有错题就给一个通用的
  const weak = useMemo(() => {
    try {
      const top = groupByKnowledge(allErrors(listFolders())).sort((a, b) => b[1].length - a[1].length)[0];
      const name = top?.[0]?.split("|").pop()?.trim();
      return name && top[1].length >= 2 ? name : null;
    } catch {
      return null;
    }
  }, []);
  const second = weak ? `讲讲「${weak}」，我最近错得最多` : "讲讲韦达定理怎么用";
  const sug = (icon: IconName, label: string, onClick: () => void) => (
    <View className="as-sug" hoverClass="as--press" onClick={onClick}>
      <View className="as-sug__i"><Icon name={icon} size={16} color={C.brand} stroke={2} /></View>
      <Text className="as-sug__t">{label}</Text>
      <Icon name="chevron-right" size={13} color={C.tertiary} stroke={2.4} />
    </View>
  );
  return (
    <View className="as-hello">
      <RoleArt size={96} />
      <Text className="as-hello__t">有什么不会的，问我</Text>
      <Text className="as-hello__s">我会翻你传过的试卷和系统题库来回答，也可以先把试卷拍给我。</Text>
      <View className="as-sugs">
        {sug("search", "找几道勾股定理的题", () => onAsk("找几道勾股定理的题"))}
        {sug("bulb", second, () => onAsk(second))}
        {sug("camera", "拍一张试卷，帮我存进知识库", onUpload)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- 一条消息

function MsgRow({ msg, upload, isLast, busy, onAsk }: { msg: Msg; upload?: Upload; isLast: boolean; busy: boolean; onAsk: (t: string) => void }) {
  if (msg.role === "user") return <View className="as-me"><Text userSelect>{msg.text}</Text></View>;
  if (msg.role === "file") return upload ? <FileCard u={upload} /> : null;
  const streaming = msg.state === "streaming";
  const failed = msg.state === "error";
  const copy = () => void Taro.setClipboardData({ data: plainOf(msg.text) }).catch(() => toast("复制不了，长按文字选一下"));
  return (
    <View className="as-ai">
      <View className={`as-ai__b${failed ? " as-ai__b--err" : ""}`}>
        {streaming && !msg.text ? (
          <View className="as-dots"><View className="as-dots__i" /><View className="as-dots__i" /><View className="as-dots__i" /></View>
        ) : (
          <RichText text={msg.text} refs={msg.kind === "answer" ? msg.citations : []} />
        )}
        {streaming && !!msg.text && <View className="as-caret" />}
        {msg.state === "stopped" && <Text className="as-ai__tag">已停止</Text>}
        {msg.state === "cut" && <Text className="as-ai__tag">没说完</Text>}
      </View>
      {msg.citations.length > 0 && <Cites list={msg.citations} found={msg.kind === "found"} />}
      {!streaming && msg.kind !== "note" && (
        <View className="as-ai__meta">
          {msg.kind === "answer" && !!msg.text && !failed && <Text className="as-ai__act" onClick={copy}>复制</Text>}
          {isLast && !busy && <Text className="as-ai__act" onClick={() => retryAnswer(msg.id)}>{failed || msg.state === "cut" ? "再试一次" : "重新回答"}</Text>}
        </View>
      )}
      {isLast && !busy && msg.tips && msg.tips.length > 0 && (
        <View className="as-tips">{msg.tips.map((t) => <View key={t} className="as-tip" hoverClass="as--press" onClick={() => onAsk(t)}><Text>{t}</Text></View>)}</View>
      )}
    </View>
  );
}

/** \(...\)、\[...\]、$$...$$ 先统一成 $...$ */
const normMath = (text: string) =>
  text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `$${m.trim()}$`);

/** 复制出去的纯文字：公式换成好读的写法，去掉加粗的星号 */
const plainOf = (text: string) => normMath(text).replace(/\$([^$\n]{1,600})\$/g, (_, m: string) => latexToText(m)).replace(/\*\*([^*\n]+)\*\*/g, "$1");

/** 小程序里不跑 KaTeX：$公式$ 换成好读的 Unicode 文字 */
const mathText = (s: string) => s.replace(/\$([^$\n]{1,600})\$/g, (_, m: string) => latexToText(m));

/**
 * 小壹的回答：大模型写的是带一点 Markdown 的文字。这里只认最常见的几样——
 * **加粗**、# 标题（当加粗行）、$公式$、[1] 这样的出处角标；其余原样显示。
 */
function RichText({ text, refs }: { text: string; refs: KbCitation[] }) {
  const nodes = useMemo(() => {
    const known = new Set(refs.map((r) => r.ref));
    const out: ReactNode[] = [];
    normMath(text).split("\n").forEach((line, li) => {
      if (li > 0) out.push("\n");
      const heading = /^#{1,6}\s+/.test(line);
      const body = heading ? line.replace(/^#{1,6}\s+/, "") : line.replace(/^(\s*)[-*]\s+/, "$1· ");
      const parts: ReactNode[] = [];
      let lastIdx = 0;
      let k = 0;
      const re = /\$[^$\n]{1,600}\$|\*\*([^*\n]+)\*\*|\[(\d{1,2})\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        const at = m.index;
        if (at > lastIdx) parts.push(body.slice(lastIdx, at));
        if (m[0].startsWith("$")) parts.push(<Text key={`f${li}-${k++}`} className="as-math">{latexToText(m[0].slice(1, -1))}</Text>);
        else if (m[1] != null) parts.push(<Text key={`b${li}-${k++}`} className="as-b">{mathText(m[1])}</Text>);
        else if (known.has(Number(m[2]))) parts.push(<Text key={`r${li}-${k++}`} className="as-ref">{` ${m[2]} `}</Text>);
        else parts.push(m[0]);
        lastIdx = at + m[0].length;
      }
      if (lastIdx < body.length) parts.push(body.slice(lastIdx));
      out.push(heading ? <Text key={`h${li}`} className="as-b">{parts}</Text> : <Fragment key={`p${li}`}>{parts}</Fragment>);
    });
    return out;
  }, [text, refs]);
  return <Text className="as-rich" userSelect>{nodes}</Text>;
}

/** 出处 / 找到的题：一行一条，点开看原题 */
function Cites({ list, found }: { list: KbCitation[]; found: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, { content: string; options?: KbCitation["options"] } | "none" | "loading">>({});
  const toggle = (c: KbCitation) => {
    const next = openId === c.questionId ? null : c.questionId;
    setOpenId(next);
    if (next && !c.content && !loaded[c.questionId]) {
      setLoaded((s) => ({ ...s, [c.questionId]: "loading" }));
      void fetchQuestion(c.kb, c.questionId).then((q) => setLoaded((s) => ({ ...s, [c.questionId]: q ?? "none" })));
    }
  };
  return (
    <View className="as-cites">
      {!found && <Text className="as-cites__h">参考了 {list.length} 道题 · 点开看原题</Text>}
      {list.map((c) => {
        const extra = loaded[c.questionId];
        const content = c.content ?? (extra && typeof extra === "object" ? extra.content : undefined);
        const options = c.options ?? (extra && typeof extra === "object" ? extra.options : undefined);
        const isOpen = openId === c.questionId;
        return (
          <View key={`${c.kb}-${c.questionId}`} className={`as-cite${isOpen ? " open" : ""}`}>
            <View className="as-cite__row" hoverClass="as--press" onClick={() => toggle(c)}>
              <Text className="as-cite__n">{c.ref}</Text>
              <Text className="as-cite__t">{c.paperTitle}{c.number ? ` · 第 ${c.number} 题` : ""}</Text>
              <Text className={`as-kb as-kb--${c.kb === "system" ? "sys" : "mine"}`}>{c.kb === "system" ? "题库" : "我的"}</Text>
            </View>
            {isOpen && (
              <View className="as-cite__body">
                {content ? (
                  <>
                    <Text className="as-rich" userSelect>{mathText(normMath(content))}</Text>
                    {options && options.length > 0 && options.map((o, i) => <Text key={i} className="as-cite__opt" userSelect>{o.label ? `${o.label}. ` : ""}{mathText(normMath(o.text ?? ""))}</Text>)}
                  </>
                ) : <Text>{extra === "none" ? "这道题的原文暂时看不了" : "正在取原题…"}</Text>}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const fmtSize = (n?: number) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** 传上去的试卷：一张卡片留在对话里，四步进度 */
function FileCard({ u }: { u: Upload }) {
  const step = stepOf(u);
  const meta = [u.pages ? `${u.pages} 页` : "", fmtSize(u.bytes)].filter(Boolean).join(" · ");
  const pct = u.state === "done" ? 100 : u.state === "preparing" ? 4 : u.state === "uploading" ? 10 : Math.max(14, Math.round(u.progress * 100));
  return (
    <View className={`as-file${u.state === "failed" ? " as-file--fail" : ""}`}>
      <View className="as-file__top">
        <View className="as-file__thumb"><Icon name="document" size={22} color={C.tertiary} stroke={1.8} /></View>
        <View className="as-file__n">
          <Text className="as-file__t ellipsis">{u.title}</Text>
          <Text className="as-file__m ellipsis">{meta || u.name}</Text>
        </View>
      </View>
      {u.state === "done" ? (
        <View className="as-file__ok"><Icon name="check" size={14} color={C.ok} stroke={3} /><Text>已存进知识库{u.questions != null ? ` · 拆出 ${u.questions} 道题` : ""}</Text></View>
      ) : u.state === "failed" ? (
        <View className="as-file__err">
          <View className="as-file__errt"><Icon name="warning" size={14} color={C.wrong} stroke={2.2} /><Text>{u.error || "没传成功"}</Text></View>
          <View className="as-file__retry" hoverClass="as--press" onClick={() => retryUpload(u.id)}><Text>重试</Text></View>
        </View>
      ) : (
        <>
          <View className="as-steps">
            {STAGE_STEPS.map((name, i) => (
              <Fragment key={name}>
                {i > 0 && <View className={`as-steps__hr${i <= step ? " ok" : ""}`} />}
                <View className={`as-steps__s${i < step ? " ok" : i === step ? " now" : ""}`}>
                  {i < step && <Icon name="check" size={12} color={C.ok} stroke={3} />}
                  <Text>{u.state === "preparing" && i === 0 ? "整理" : name}</Text>
                </View>
              </Fragment>
            ))}
          </View>
          <View className="as-pbar"><View className="as-pbar__i" style={{ width: `${pct}%` }} /></View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- 历史对话、选已有试卷

function History({ onPick }: { onPick: () => void }) {
  const convs = useAssistant((s) => s.convs);
  const convId = useAssistant((s) => s.convId);
  const list = convs.filter((c) => c.msgs.length).sort((a, b) => b.at - a.at);
  const day = (t: number) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  if (!list.length) return <View className="as__panel"><Text className="as__empty">还没有对话记录</Text></View>;
  return (
    <ScrollView className="as__panel" scrollY enhanced showScrollbar={false}>
      <View className="as__rows">
        {list.map((c) => (
          <View key={c.id} className={`as-conv${c.id === convId ? " on" : ""}`}>
            <View className="as-conv__main" hoverClass="as--press" onClick={() => { pickConversation(c.id); onPick(); }}>
              <Text className="as-conv__t ellipsis">{c.title || "新对话"}</Text>
              <Text className="as-conv__m ellipsis">{day(c.at)} · {c.msgs.filter((m) => m.role === "user").length} 问</Text>
            </View>
            <View className="as-conv__del" hoverClass="as--press" onClick={() => deleteConversation(c.id)}><Icon name="trash" size={17} color={C.tertiary} stroke={2} /></View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PaperPicker({ onPick }: { onPick: (p: Paper) => void }) {
  const rows = useMemo(() => {
    let folders: Folder[] = [];
    try { folders = listFolders(); } catch { /* 读不出来当没有 */ }
    return folders.flatMap((f) => f.papers.filter((p) => p.pages.length).map((p) => ({ f, p }))).sort((a, b) => (a.p.createdAt < b.p.createdAt ? 1 : -1)).slice(0, 60);
  }, []);
  if (!rows.length) return <View className="as__panel"><Text className="as__empty">这台手机上还没有录入的试卷</Text></View>;
  return (
    <ScrollView className="as__panel" scrollY enhanced showScrollbar={false}>
      <View className="as__rows">
        {rows.map(({ f, p }) => (
          <View key={p.id} className="as-paper" hoverClass="as--press" onClick={() => onPick(p)}>
            <Image className="as-paper__img" src={p.pages[0].src} mode="aspectFill" lazyLoad />
            <View className="as-paper__n">
              <Text className="as-conv__t ellipsis">{p.name}</Text>
              <Text className="as-conv__m ellipsis">{f.name} · {p.pages.length} 页</Text>
            </View>
            <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
