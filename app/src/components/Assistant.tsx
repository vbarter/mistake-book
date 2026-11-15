import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { allErrors, groupByKnowledge } from "../lib/errors";
import { listFolders, loadPages, thumbOf, type Folder, type Paper } from "../lib/folders";
import { fetchQuestion, type KbCitation } from "../lib/kb";
import { haptic, pickImages, pushBackHandler, takePhoto } from "../lib/native";
import { canUseLiveCamera } from "../lib/scanCamera";
import { roleIconInner } from "../lib/roleIcons";
import { useTheme } from "../lib/theme";
import {
  agreeAssistant, currentConv, deleteConversation, dismissBubble, minimizeAssistant, newConversation, openAssistant, pickConversation, retryAnswer, retryUpload,
  sendQuestion, setAssistantMode, setFocus, setOrbBottom, setScope, STAGE_STEPS, startAssistant, stepOf, stopAnswer, uploadFile, uploadImages, useAssistant,
  type Msg, type Upload,
} from "../store/assistant";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";
import { Icon } from "./Icon";
import { mathNodes } from "./MathText";
import { RoleIcon } from "./RoleIcon";
import { useVisibleViewport } from "./ui";
import "../styles/assistant.css";

/**
 * 智能聊天「问小壹」（设计稿见项目文件「智能聊天模式-设计方案.md」）。
 * 挂在 App 根上，和横幅、拍照确认并列：
 *   - 收起：贴在屏幕右边缘的小人头像，可上下拖；后台有试卷在处理时外圈是进度环，有新消息亮红点、冒一句话；
 *   - 点开：先半屏（底下的页面压暗但看得见），上拉 / 点按钮变全屏，下拉 / 点「⌄」缩回头像；
 *   - 因为不是路由，缩小以后底下页面的位置、内容都不变。
 * 服务端没开通知识库（/api/kb/token 返回 503）时整个不渲染。
 */

/** 这些页面要么全屏操作、要么不该被打扰：不显示入口 */
const HIDE_RE = /^\/(scan|capture|import|welcome|login|register|setup|reset-password|splash|legal)(\/|$)|\/erase$|^\/homework\/focus/;

export function AssistantHost() {
  const token = useAuth((s) => s.token);
  const userId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!token || userId == null) return;
    return startAssistant(userId);
  }, [token, userId]);
  const available = useAssistant((s) => s.available);
  const { pathname } = useLocation();
  if (!token || !available) return null;
  return (
    <>
      <Orb hidden={HIDE_RE.test(pathname)} pathname={pathname} />
      <Panel />
    </>
  );
}

/** 小壹的头像：试卷小人的上半张，底色是黑板色 */
function Face({ size }: { size: number }) {
  const theme = useTheme((s) => s.theme);
  const dark = useTheme((s) => s.dark);
  return (
    <span className="as-face" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="14 46 92 92" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: roleIconInner("face", theme, dark, false) }} />
    </span>
  );
}

// ---------------------------------------------------------------- 右侧入口

function Orb({ hidden, pathname }: { hidden: boolean; pathname: string }) {
  const mode = useAssistant((s) => s.mode);
  const seen = useAssistant((s) => s.seen);
  const unread = useAssistant((s) => s.unread);
  const bubble = useAssistant((s) => s.bubble);
  const orbBottom = useAssistant((s) => s.orbBottom);
  const uploads = useAssistant((s) => s.uploads);
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ y: number; bottom: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const working = Object.values(uploads).filter((u) => u.state === "preparing" || u.state === "uploading" || u.state === "processing");
  const progress = working.length ? working.reduce((n, u) => n + (u.state === "processing" ? Math.max(0.1, u.progress) : 0.05), 0) / working.length : 0;

  if (hidden || mode !== "closed") return null;

  const clamp = (b: number) => Math.max(64, Math.min(window.innerHeight - 160, b));
  const onDown = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    drag.current = { y: e.clientY, bottom: window.innerHeight - rect.bottom, moved: false };
    ref.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setDragY(clamp(d.bottom - dy));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved && dragY != null) {
      setOrbBottom(dragY);
      setDragY(null);
      return;
    }
    void haptic.light();
    openAssistant("half");
  };

  const bottom = dragY ?? orbBottom;
  // 分析页底部有固定的「导出错题本」按钮：默认位置抬高一截，别压在它上面
  const style: CSSProperties = bottom != null ? { bottom } : pathname === "/rank" ? { bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 112px)" } : {};
  return (
    <>
      {bubble && (
        <button className="as-bubble" style={bottom != null ? { bottom: bottom + 62 } : pathname === "/rank" ? { bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 174px)" } : undefined} onClick={() => { dismissBubble(); openAssistant("full"); }}>
          {bubble}
        </button>
      )}
      <button
        ref={ref}
        className={`as-orb${dragY != null ? " as-orb--drag" : ""}`}
        style={style}
        aria-label={unread ? "问小壹，有新消息" : "问小壹"}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { drag.current = null; setDragY(null); }}
      >
        <span className="as-orb__ring" style={working.length ? { background: `conic-gradient(var(--brand) ${Math.round(progress * 360)}deg, var(--brand-tint) 0)` } : undefined}>
          <Face size={44} />
        </span>
        {unread && <span className="as-orb__dot" />}
        {!seen && <span className="as-orb__txt"><b>问小壹</b>有题就问</span>}
      </button>
    </>
  );
}

// ---------------------------------------------------------------- 对话面板

type View = "chat" | "history" | "papers";

const IconExpand = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>;
const IconShrink = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" /></svg>;
const IconSend = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
const IconStop = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" rx="3" fill="currentColor" /></svg>;
const IconEdit = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5H5v14h14v-7M18.5 3.5l2 2L12 14l-3 1 1-3z" /></svg>;

function Panel() {
  const mode = useAssistant((s) => s.mode);
  const agreed = useAssistant((s) => s.agreed);
  const conv = useAssistant(currentConv);
  const uploads = useAssistant((s) => s.uploads);
  const busyId = useAssistant((s) => s.busyId);
  const scope = useAssistant((s) => s.scope);
  const focus = useAssistant((s) => s.focus);
  const orbBottom = useAssistant((s) => s.orbBottom);
  const open = mode !== "closed";
  const full = mode === "full";
  const [view, setView] = useState<View>("chat");
  const [text, setText] = useState("");
  const [tray, setTray] = useState(false);
  const nav = useNavigate();
  const { pathname } = useLocation();
  const vp = useVisibleViewport(open);
  const kb = vp.keyboard > 0;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  // 安卓返回键 / Esc：先收起子页面，再缩小对话，不动底下的页面
  useEffect(() => {
    if (!open) return;
    const back = () => {
      if (view !== "chat") setView("chat");
      else if (tray) setTray(false);
      else minimizeAssistant();
      return true;
    };
    const off = pushBackHandler(back);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") back(); };
    window.addEventListener("keydown", onKey);
    return () => { off(); window.removeEventListener("keydown", onKey); };
  }, [open, view, tray]);

  // 开着的时候底下的页面不跟着滚
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => { if (!open) { setTray(false); setView("chat"); inputRef.current?.blur(); } }, [open]);
  // 键盘弹起来：半屏会被挤得只剩一条，直接变全屏
  useEffect(() => { if (kb && mode === "half") setAssistantMode("full"); }, [kb, mode]);

  // 有新内容时跟到底；用户自己往上翻了就不打扰
  const last = conv.msgs[conv.msgs.length - 1];
  const lastLen = last && last.role === "ai" ? last.text.length + last.citations.length : 0;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [conv.id, conv.msgs.length, lastLen, open, view, uploads, kb]);
  useEffect(() => { stick.current = true; }, [conv.id, open]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // 输入框跟着内容长高，最多四行
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [text, open]);

  const send = (t = text) => {
    if (!agreed || busyId || !t.trim()) return;
    stick.current = true;
    setTray(false);
    if (t === text) setText("");
    void sendQuestion(t);
  };

  // ---- 上传的四个来源
  const scan = async () => {
    setTray(false);
    if (canUseLiveCamera()) {
      // 连拍扫描：缩小对话去取景页，拍完点「完成」照片交回这里（store/assistant.ts 的 finishChatScan）
      minimizeAssistant();
      nav("/scan", { state: { folderId: null, from: pathname, chat: true } });
      return;
    }
    try {
      const src = await takePhoto();
      if (src) uploadImages([{ src }]);
    } catch (e) {
      toastError((e as Error).message === "permission_denied" ? new Error("需要相机权限，可以在系统设置里打开") : e);
    }
  };
  const album = async () => {
    setTray(false);
    try {
      const list = await pickImages(0);
      if (list.length) uploadImages(list.map((src) => ({ src })));
    } catch (e) {
      toastError((e as Error).message === "permission_denied" ? new Error("需要相册权限，可以在系统设置里打开") : e);
    }
  };
  const onFiles = (files: FileList | null) => {
    setTray(false);
    for (const f of Array.from(files ?? []).slice(0, 5)) {
      const problem = uploadFile(f);
      if (problem) toast(problem, "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const pickPaper = async (paper: Paper) => {
    setView("chat");
    try {
      const pages = await loadPages(paper);
      if (!pages.length) return toast("这份试卷的照片不在这台设备上");
      uploadImages(pages.map((p) => ({ src: p.src, width: p.width, height: p.height })), paper.name);
    } catch (e) {
      toastError(e);
    }
  };

  // ---- 顶部横条：上拉全屏、下拉缩小
  const grab = useRef<number | null>(null);
  const onGrabUp = (e: React.PointerEvent) => {
    if (grab.current == null) return;
    const dy = e.clientY - grab.current;
    grab.current = null;
    if (dy < -30) setAssistantMode("full");
    else if (dy > 30) (full ? setAssistantMode("half") : minimizeAssistant());
  };

  const working = Object.values(uploads).filter((u) => u.state === "preparing" || u.state === "uploading" || u.state === "processing").length;
  const sub = working ? `正在处理 ${working} 份试卷` : "有题就问";
  // 缩小时朝入口的位置收：动画的原点放在右边、入口那一行
  const origin = `100% calc(100% - ${(orbBottom ?? 130) + 28}px)`;
  const style: CSSProperties = kb ? { top: vp.top, height: vp.height, bottom: "auto", transformOrigin: origin } : { transformOrigin: origin };

  return (
    <>
      <div className={`as-scrim${open && !full ? " on" : ""}`} onClick={minimizeAssistant} aria-hidden="true" />
      <section className={`as as--${mode}${kb ? " as--kb" : ""}`} style={style} role="dialog" aria-modal={open} aria-label="问小壹" aria-hidden={!open}>
        <div className="as__grab" onPointerDown={(e) => { grab.current = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }} onPointerUp={onGrabUp} onPointerCancel={() => { grab.current = null; }}><i /></div>
        <header className="as__head">
          {view === "chat" ? (
            <>
              <Face size={36} />
              <span className="as__title"><b>问小壹</b><small>{sub}</small></span>
              <button className="as__hbtn" aria-label="历史对话" onClick={() => setView("history")}><Icon name="clock" size={18} stroke={2} /></button>
              <button className="as__hbtn" aria-label="新对话" onClick={() => { newConversation(); stick.current = true; }}><IconEdit /></button>
              <button className="as__hbtn" aria-label={full ? "退出全屏" : "全屏"} onClick={() => setAssistantMode(full ? "half" : "full")}>{full ? <IconShrink /> : <IconExpand />}</button>
            </>
          ) : (
            <>
              <button className="as__hbtn" aria-label="返回对话" onClick={() => setView("chat")}><Icon name="chevron-left" size={18} stroke={2.4} /></button>
              <span className="as__title"><b>{view === "history" ? "历史对话" : "选一份试卷"}</b><small>{view === "history" ? "只保存在这台设备上" : "把它的照片存进知识库"}</small></span>
            </>
          )}
          <button className="as__hbtn" aria-label="缩小" onClick={minimizeAssistant}><Icon name="chevron-down" size={20} stroke={2.4} /></button>
        </header>

        {view === "history" && <History onPick={() => { setView("chat"); stick.current = true; }} />}
        {view === "papers" && <PaperPicker onPick={pickPaper} />}

        {view === "chat" && (
          <>
            <div className="as__msgs" ref={listRef} onScroll={onScroll}>
              {!agreed ? (
                <Welcome onAgree={agreeAssistant} />
              ) : conv.msgs.length === 0 ? (
                <Hello onAsk={send} onUpload={() => setTray(true)} />
              ) : (
                conv.msgs.map((m, i) => (
                  <MsgRow key={m.id} msg={m} upload={m.role === "file" ? uploads[m.uploadId] : undefined} isLast={i === conv.msgs.length - 1} busy={!!busyId} onAsk={send} />
                ))
              )}
            </div>
            {agreed && (
              <>
                <div className="as__scope">
                  {focus ? (
                    <span className="as__chip as__chip--paper on">
                      <Icon name="document" size={14} stroke={2} />
                      <em>只问：{focus.title}</em>
                      <button aria-label="不限这一份" onClick={() => setFocus(null)}><Icon name="xmark" size={12} stroke={2.6} /></button>
                    </span>
                  ) : (
                    <>
                      <button className={`as__chip${scope.mine ? " on" : ""}`} aria-pressed={scope.mine} onClick={() => setScope({ ...scope, mine: !scope.mine })}>{scope.mine && <Icon name="check" size={13} stroke={3} />}我的试卷</button>
                      <button className={`as__chip${scope.system ? " on" : ""}`} aria-pressed={scope.system} onClick={() => setScope({ ...scope, system: !scope.system })}>{scope.system && <Icon name="check" size={13} stroke={3} />}系统题库</button>
                    </>
                  )}
                </div>
                <div className="as__in">
                  <button className={`as__plus${tray ? " open" : ""}`} aria-label={tray ? "收起" : "上传试卷"} aria-expanded={tray} onClick={() => { setTray((v) => !v); inputRef.current?.blur(); }}><Icon name="plus" size={22} stroke={2.4} /></button>
                  <textarea
                    ref={inputRef}
                    className="as__field"
                    rows={1}
                    value={text}
                    maxLength={1000}
                    placeholder={focus ? "问问这份卷子…" : conv.msgs.length ? "接着问…" : "问一道题，或点 + 传试卷"}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={() => setTray(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  {busyId ? (
                    <button className="as__send" aria-label="停止" onClick={stopAnswer}><IconStop /></button>
                  ) : (
                    <button className={`as__send${text.trim() ? "" : " off"}`} aria-label="发送" disabled={!text.trim()} onClick={() => send()}><IconSend /></button>
                  )}
                </div>
                {tray && (
                  <div className="as__tray">
                    <button className="as__att" onClick={scan}><i><Icon name="camera" size={26} stroke={2} /></i>拍照扫描<small>自动调正</small></button>
                    <button className="as__att" onClick={album}><i><Icon name="photo" size={26} stroke={2} /></i>相册<small>可多选</small></button>
                    <button className="as__att" onClick={() => fileRef.current?.click()}><i><Icon name="document" size={26} stroke={2} /></i>文件<small>PDF / Word</small></button>
                    <button className="as__att" onClick={() => { setTray(false); setView("papers"); }}><i><Icon name="books" size={26} stroke={2} /></i>我的试卷<small>已有的</small></button>
                  </div>
                )}
                <input ref={fileRef} type="file" hidden multiple accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => onFiles(e.target.files)} />
              </>
            )}
            <p className="as__ai">内容由 AI 生成，仅供参考</p>
          </>
        )}
      </section>
    </>
  );
}

/** 第一次用：先说清楚数据去了哪 */
function Welcome({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="as-hello">
      <RoleIcon name="chat" size={96} shadow={false} />
      <b>我是小壹，有不会的题可以问我</b>
      <span>我会翻你传给我的试卷和系统题库来回答。</span>
      <div className="as-consent">
        <p>开始之前请知悉：你的提问和传给我的试卷，会发送到试卷知识库，并交给文字识别服务和大模型服务处理后生成回答；不会附带你的手机号。回答由 AI 生成，可能有错，请自己再核对。</p>
        <button className="btn btn--primary" onClick={onAgree}>知道了，开始用</button>
      </div>
    </div>
  );
}

/** 一段对话还没开始：打个招呼，给三条能直接点的示例 */
function Hello({ onAsk, onUpload }: { onAsk: (t: string) => void; onUpload: () => void }) {
  const [weak, setWeak] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // 第二条示例用本机错题里错得最多的知识点；没有错题就给一个通用的
    listFolders().then((folders) => {
      const top = groupByKnowledge(allErrors(folders)).sort((a, b) => b[1].length - a[1].length)[0];
      const name = top?.[0]?.split("|").pop()?.trim();
      if (alive && name && top[1].length >= 2) setWeak(name);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const second = weak ? `讲讲「${weak}」，我最近错得最多` : "讲讲韦达定理怎么用";
  return (
    <div className="as-hello">
      <RoleIcon name="chat" size={96} shadow={false} />
      <b>有什么不会的，问我</b>
      <span>我会翻你传过的试卷和系统题库来回答，也可以先把试卷拍给我。</span>
      <div className="as-sugs">
        <button className="as-sug" onClick={() => onAsk("找几道勾股定理的题")}><i><Icon name="search" size={16} stroke={2} /></i><span>找几道勾股定理的题</span><Icon name="chevron-right" size={13} stroke={2.4} /></button>
        <button className="as-sug" onClick={() => onAsk(second)}><i><Icon name="bulb" size={16} stroke={2} /></i><span>{second}</span><Icon name="chevron-right" size={13} stroke={2.4} /></button>
        <button className="as-sug" onClick={onUpload}><i><Icon name="camera" size={16} stroke={2} /></i><span>拍一张试卷，帮我存进知识库</span><Icon name="chevron-right" size={13} stroke={2.4} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 一条消息

function MsgRow({ msg, upload, isLast, busy, onAsk }: { msg: Msg; upload?: Upload; isLast: boolean; busy: boolean; onAsk: (t: string) => void }) {
  if (msg.role === "user") return <div className="as-me">{msg.text}</div>;
  if (msg.role === "file") return upload ? <FileCard u={upload} /> : null;
  const streaming = msg.state === "streaming";
  const failed = msg.state === "error";
  const copy = () => {
    void navigator.clipboard?.writeText(msg.text).then(() => toast("已复制", "success")).catch(() => toast("复制不了，长按文字选一下"));
  };
  return (
    <div className="as-ai">
      <div className={`as-ai__b${failed ? " as-ai__b--err" : ""}`}>
        {streaming && !msg.text ? (
          <span className="as-dots" aria-label={msg.kind === "found" ? "正在找题" : "正在想"}><i /><i /><i /></span>
        ) : (
          <RichText text={msg.text} refs={msg.kind === "answer" ? msg.citations : []} />
        )}
        {streaming && msg.text && <span className="as-caret" />}
        {msg.state === "stopped" && <em className="as-ai__tag">已停止</em>}
        {msg.state === "cut" && <em className="as-ai__tag">没说完</em>}
      </div>
      {msg.citations.length > 0 && <Cites list={msg.citations} found={msg.kind === "found"} />}
      {!streaming && msg.kind !== "note" && (
        <div className="as-ai__meta">
          {msg.kind === "answer" && msg.text && !failed && <button onClick={copy}>复制</button>}
          {isLast && !busy && <button onClick={() => retryAnswer(msg.id)}>{failed || msg.state === "cut" ? "再试一次" : "重新回答"}</button>}
        </div>
      )}
      {isLast && !busy && msg.tips && msg.tips.length > 0 && (
        <div className="as-tips">{msg.tips.map((t) => <button key={t} className="as-tip" onClick={() => onAsk(t)}>{t}</button>)}</div>
      )}
    </div>
  );
}

/**
 * 小壹的回答：大模型写的是带一点 Markdown 的文字。这里只认最常见的几样——
 * **加粗**、# 标题（当加粗行）、$公式$（\(...\)、\[...\]、$$...$$ 先统一成 $...$）、[1] 这样的出处角标；其余原样显示。
 */
function RichText({ text, refs }: { text: string; refs: KbCitation[] }) {
  const nodes = useMemo(() => {
    const known = new Set(refs.map((r) => r.ref));
    const norm = text
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$${m.trim()}$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `$${m.trim()}$`);
    const out: ReactNode[] = [];
    norm.split("\n").forEach((line, li) => {
      if (li > 0) out.push("\n");
      const heading = /^#{1,6}\s+/.test(line);
      const body = heading ? line.replace(/^#{1,6}\s+/, "") : line.replace(/^(\s*)[-*]\s+/, "$1· ");
      const parts: ReactNode[] = [];
      let lastIdx = 0;
      let k = 0;
      const re = /\$[^$\n]{1,600}\$|\*\*([^*\n]+)\*\*|\[(\d{1,2})\]/g;
      for (const m of body.matchAll(re)) {
        const at = m.index ?? 0;
        if (at > lastIdx) parts.push(body.slice(lastIdx, at));
        if (m[0].startsWith("$")) parts.push(<Fragment key={`f${li}-${k++}`}>{mathNodes(m[0], `l${li}k${k}`)}</Fragment>);
        else if (m[1] != null) parts.push(<b key={`b${li}-${k++}`}>{mathNodes(m[1], `l${li}b${k}`)}</b>);
        else if (known.has(Number(m[2]))) parts.push(<sup className="as-ref" key={`r${li}-${k++}`}>{m[2]}</sup>);
        else parts.push(m[0]);
        lastIdx = at + m[0].length;
      }
      if (lastIdx < body.length) parts.push(body.slice(lastIdx));
      out.push(heading ? <b key={`h${li}`}>{parts}</b> : <Fragment key={`p${li}`}>{parts}</Fragment>);
    });
    return out;
  }, [text, refs]);
  return <span className="as-rich">{nodes}</span>;
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
    <div className="as-cites">
      {!found && <span className="as-cites__h">参考了 {list.length} 道题 · 点开看原题</span>}
      {list.map((c) => {
        const extra = loaded[c.questionId];
        const content = c.content ?? (extra && typeof extra === "object" ? extra.content : undefined);
        const options = c.options ?? (extra && typeof extra === "object" ? extra.options : undefined);
        const isOpen = openId === c.questionId;
        return (
          <div key={`${c.kb}-${c.questionId}`} className={`as-cite${isOpen ? " open" : ""}`}>
            <button className="as-cite__row" aria-expanded={isOpen} onClick={() => toggle(c)}>
              <i>{c.ref}</i>
              <span>{c.paperTitle}{c.number ? ` · 第 ${c.number} 题` : ""}</span>
              <em className={`as-kb as-kb--${c.kb === "system" ? "sys" : "mine"}`}>{c.kb === "system" ? "题库" : "我的"}</em>
            </button>
            {isOpen && (
              <div className="as-cite__body">
                {content ? (
                  <>
                    <span className="as-rich">{mathNodes(content, `c${c.questionId}`)}</span>
                    {options && options.length > 0 && (
                      <ul>{options.map((o, i) => <li key={i}>{o.label ? `${o.label}. ` : ""}{mathNodes(o.text ?? "", `o${c.questionId}${i}`)}</li>)}</ul>
                    )}
                  </>
                ) : extra === "none" ? "这道题的原文暂时看不了" : "正在取原题…"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const fmtSize = (n?: number) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** 传上去的试卷：一张卡片留在对话里，四步进度 */
function FileCard({ u }: { u: Upload }) {
  const step = stepOf(u);
  const meta = [u.pages ? `${u.pages} 页` : "", fmtSize(u.bytes)].filter(Boolean).join(" · ");
  const pct = u.state === "done" ? 100 : u.state === "preparing" ? 4 : u.state === "uploading" ? 10 : Math.max(14, Math.round(u.progress * 100));
  return (
    <div className={`as-file${u.state === "failed" ? " as-file--fail" : ""}`}>
      <div className="as-file__top">
        <span className="as-file__thumb" />
        <span className="as-file__n"><b>{u.title}</b><small>{meta || u.name}</small></span>
      </div>
      {u.state === "done" ? (
        <div className="as-file__ok"><Icon name="check" size={14} stroke={3} />已存进知识库{u.questions != null ? ` · 拆出 ${u.questions} 道题` : ""}</div>
      ) : u.state === "failed" ? (
        <div className="as-file__err">
          <span><Icon name="warning" size={14} stroke={2.2} />{u.error || "没传成功"}</span>
          <button onClick={() => retryUpload(u.id)}>重试</button>
        </div>
      ) : (
        <>
          <div className="as-steps">
            {STAGE_STEPS.map((name, i) => (
              <Fragment key={name}>
                {i > 0 && <hr className={i <= step ? "ok" : ""} />}
                <span className={i < step ? "ok" : i === step ? "now" : ""}>{i < step && <Icon name="check" size={12} stroke={3} />}{u.state === "preparing" && i === 0 ? "整理" : name}</span>
              </Fragment>
            ))}
          </div>
          <div className="as-pbar"><i style={{ width: `${pct}%` }} /></div>
        </>
      )}
    </div>
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
  if (!list.length) return <div className="as__list"><p className="as__empty">还没有对话记录</p></div>;
  return (
    <div className="as__list">
      {list.map((c) => (
        <div key={c.id} className={`as-conv${c.id === convId ? " on" : ""}`}>
          <button className="as-conv__main" onClick={() => { pickConversation(c.id); onPick(); }}>
            <b>{c.title || "新对话"}</b>
            <small>{day(c.at)} · {c.msgs.filter((m) => m.role === "user").length} 问</small>
          </button>
          <button className="as-conv__del" aria-label="删除这段对话" onClick={() => deleteConversation(c.id)}><Icon name="trash" size={17} stroke={2} /></button>
        </div>
      ))}
    </div>
  );
}

function PaperPicker({ onPick }: { onPick: (p: Paper) => void }) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  useEffect(() => { listFolders().then(setFolders).catch(() => setFolders([])); }, []);
  const rows = (folders ?? []).flatMap((f) => f.papers.map((p) => ({ f, p }))).sort((a, b) => (a.p.createdAt < b.p.createdAt ? 1 : -1)).slice(0, 60);
  if (!folders) return <div className="as__list"><p className="as__empty">正在读取…</p></div>;
  if (!rows.length) return <div className="as__list"><p className="as__empty">这台设备上还没有录入的试卷</p></div>;
  return (
    <div className="as__list">
      {rows.map(({ f, p }) => (
        <button key={p.id} className="as-paper" onClick={() => onPick(p)}>
          <img src={thumbOf(p.pages[0])} alt="" />
          <span><b>{p.name}</b><small>{f.name} · {p.pages.length} 页</small></span>
          <Icon name="chevron-right" size={14} stroke={2.4} />
        </button>
      ))}
    </div>
  );
}
