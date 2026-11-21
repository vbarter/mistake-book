import { useEffect, useRef, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { Buddy } from "../../components/Buddy";
import { HomeworkLoginGate, useTick } from "../../components/homework";
import { Icon } from "../../components/Icon";
import { SwipeRow, swipeGuard, useSwipeCloseOnScroll } from "../../components/SwipeRow";
import { Button, Sheet, subjectColors } from "../../components/ui";
import { errorText } from "../../lib/api";
import { isLoggedIn } from "../../lib/auth";
import { pickPhotos } from "../../lib/capture";
import {
  act, addItems, deleteItem, finishedLabel, hourMin, hwSubjectLabel, HW_SUBJECTS, liveUsed, loadTodos, mergedText, mmss, parseHomework, splitArchived, splitTodo, tileSubject,
  updateItem, useHomework, type HwItem, type HwSubject, type HwTodos, type PickedFile,
} from "../../lib/homework";
import { toast } from "../../lib/hooks";
import { C, useThemeClass } from "../../lib/theme";

const MAX_IMAGES = 6;
const MAX_FILES = 3;
const EDIT_GRAY = "#8e8e93";

type Tab = "todo" | "archived";
interface Snack {
  text: string;
  /** 给了就带一个「撤销」：把这一项重新打开 */
  undoId?: string;
}

/**
 * 待办事项（界面稿 screenshots/todo-simplify-v4/）：
 * 扫描 / 上传文件 → 识别完直接进待办列表；点一项进时钟计时页；左滑一项：编辑 / 归档 / 删除。
 * 「已归档」里是做完的，点左边的勾或左滑可以重新打开。
 */
export default function Homework() {
  const tc = useThemeClass();
  const { data, fetchedAt } = useHomework();
  const [tab, setTab] = useState<Tab>("todo");
  const [parsing, setParsing] = useState<{ photos: number; files: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HwItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [snack, setSnack] = useState<Snack | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout>>();
  const logged = isLoggedIn();
  const now = useTick(data?.todo.some((it) => it.status === "running") ?? false);
  useSwipeCloseOnScroll(openId, () => setOpenId(null));

  const load = () => (isLoggedIn() ? loadTodos().catch((e) => toast(errorText(e))) : Promise.resolve());
  useDidShow(() => void load());
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });
  useEffect(() => () => clearTimeout(snackTimer.current), []);

  if (!logged) return <HomeworkLoginGate />;

  const say = (s: Snack) => {
    clearTimeout(snackTimer.current);
    setSnack(s);
    snackTimer.current = setTimeout(() => setSnack(null), s.undoId ? 5000 : 3000);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setOpenId(null);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e));
    }
  };

  /* ---------------- 添加：扫描 / 相册 / 微信聊天文件 → 识别 → 直接加入待办 ---------------- */
  const submit = async (images: string[], files: PickedFile[]) => {
    if (!images.length && !files.length) return;
    setParsing({ photos: images.length, files: files.length });
    try {
      const items = await parseHomework(images, files);
      if (!items.length) {
        toast(images.length ? "没认出待办，换一张清楚点的试试" : "文件里没认出待办");
        return;
      }
      const res = await addItems(items);
      const added = items.length - (res.merged ?? 0);
      setTab("todo");
      say({ text: added > 0 ? `识别出 ${items.length} 项，已加入待办${res.merged ? `（${res.merged} 项重复没加）` : ""}` : mergedText(res) || "这些待办都已经在列表里了" });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setParsing(null);
    }
  };
  const fromPhotos = async (source: "camera" | "album") => {
    setAdding(false);
    try {
      const list = await pickPhotos(source);
      if (list.length > MAX_IMAGES) toast(`一次最多 ${MAX_IMAGES} 张，先用前 ${MAX_IMAGES} 张`);
      await submit(list.slice(0, MAX_IMAGES), []);
    } catch (e) {
      toast(errorText(e));
    }
  };
  const fromChat = async () => {
    setAdding(false);
    let picked: { path: string; name: string; type?: string }[] = [];
    try {
      picked = (await Taro.chooseMessageFile({ count: MAX_IMAGES, type: "all" })).tempFiles;
    } catch (e) {
      if (!/cancel/i.test(String((e as { errMsg?: string }).errMsg || ""))) toast("没能打开聊天文件，稍后再试");
      return;
    }
    const images: string[] = [];
    const files: PickedFile[] = [];
    let skipped = 0;
    for (const f of picked) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (f.type === "image" || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) images.push(f.path);
      else if (["pdf", "docx", "txt"].includes(ext)) files.push({ path: f.path, name: f.name });
      else skipped++;
    }
    if (skipped) toast(images.length || files.length ? `有 ${skipped} 个文件不支持，已跳过` : "只支持图片、PDF 和 Word（.docx）");
    await submit(images.slice(0, MAX_IMAGES), files.slice(0, MAX_FILES));
  };
  const upload = async () => {
    try {
      const r = await Taro.showActionSheet({ itemList: ["从相册选图片", "从微信聊天选文件"] });
      if (r.tapIndex === 0) await fromPhotos("album");
      else await fromChat();
    } catch {
      /* 取消 */
    }
  };

  /* ---------------- 列表上的操作 ---------------- */
  const open = (it: HwItem) => {
    if (swipeGuard.moved) return;
    if (openId) return setOpenId(null);
    void Taro.navigateTo({ url: `/pages/homework-focus/index?id=${it.id}` });
  };
  const archive = (it: HwItem) =>
    run(async () => {
      await act(it.id, "finish");
      say({ text: `「${it.title}」已归档`, undoId: it.id });
    });
  const reopen = (it: HwItem) =>
    run(async () => {
      await act(it.id, "undo");
      say({ text: `「${it.title}」已放回待办` });
    });
  const remove = (it: HwItem) =>
    run(async () => {
      const r = await Taro.showModal({ title: "删除这一项？", content: `「${it.title}」删掉后找不回来。`, confirmText: "删除", confirmColor: "#b42323" });
      if (r.confirm) await deleteItem(it.id);
    });
  const undo = () => {
    const id = snack?.undoId;
    setSnack(null);
    if (id) void run(() => act(id, "undo"));
  };

  if (parsing) return <Parsing tc={tc} photos={parsing.photos} files={parsing.files} />;

  return (
    <View className={"page td-page" + tc}>
      {!data && (
        <View className="empty">
          <View className="spinner spinner--lg" />
        </View>
      )}
      {data && (
        <>
          <View className="td-head">
            <Text className="td-head__t">{tab === "todo" ? "待办" : "已归档"}</Text>
            <Text className="td-head__s">{tab === "todo" ? (data.todo.length ? "点一项，开始计时" : "拍一张或传个文件，自动列出来") : archivedNote(data)}</Text>
          </View>
          <View className="seg td-seg">
            {(["todo", "archived"] as Tab[]).map((t) => (
              <View key={t} className={`seg__item${tab === t ? " on" : ""}`} onClick={() => { setOpenId(null); setTab(t); }}>
                <Text>{t === "todo" ? "待办" : "已归档"}</Text>
                <Text className="td-seg__n">{t === "todo" ? data.todo.length : data.archivedTotal}</Text>
              </View>
            ))}
          </View>

          {tab === "todo" && data.todo.length === 0 && (
            <>
              <View className="hw-empty">
                <Buddy scene="empty" size={120} />
                <Text className="hw-empty__b">还没有待办</Text>
                <Text className="t-sub">把作业单、通知拍下来或传上来，自动拆成一项一项。</Text>
              </View>
              <View className="add-grid">
                <View className="add-tile td-tile" hoverClass="card--pressed" onClick={() => void fromPhotos("camera")}>
                  <View className="add-tile__icon"><Icon name="camera" size={28} color="#ffffff" stroke={2} /></View>
                  <Text className="t-headline">扫描</Text>
                  <Text className="t-cap c-sec">拍黑板、家校本、作业单</Text>
                </View>
                <View className="add-tile td-tile" hoverClass="card--pressed" onClick={() => void upload()}>
                  <View className="add-tile__icon td-tile__icon2"><Icon name="document" size={28} color={C.brand} stroke={2} /></View>
                  <Text className="t-headline">上传文件</Text>
                  <Text className="t-cap c-sec">相册图片、微信聊天文件</Text>
                </View>
              </View>
            </>
          )}

          {tab === "todo" &&
            splitTodo(data.todo, data.today).map((g) => (
              <View key={g.key}>
                <View className="td-sec">
                  <Text className="td-sec__b">{g.label}</Text>
                  {g.note && <Text className="td-sec__s">{g.note}</Text>}
                </View>
                <View className="td-list">
                  {g.items.map((it) => {
                    const cur = it.status === "running" || it.status === "paused";
                    const used = liveUsed(it, fetchedAt, now);
                    return (
                      <SwipeRow
                        key={it.id}
                        inline
                        open={openId === it.id}
                        onOpenChange={(o) => setOpenId(o ? it.id : null)}
                        actions={[
                          { label: "编辑", icon: "pencil", color: EDIT_GRAY, onClick: () => { setOpenId(null); setEditing(it); } },
                          { label: "归档", icon: "archive", color: C.brand, onClick: () => void archive(it) },
                          { label: "删除", icon: "trash", onClick: () => void remove(it) },
                        ]}
                      >
                        <View className={`td-row${cur ? " td-row--cur" : ""}`}>
                          <View className={`td-check${cur ? " td-check--run" : ""}`} onClick={(e) => { e.stopPropagation(); if (!swipeGuard.moved) void archive(it); }} />
                          <View className="td-main" hoverClass="hw-press" onClick={() => open(it)}>
                            <Text className="td-title ellipsis">{it.title}</Text>
                            <View className="td-sub">
                              <Text className="td-subj" style={{ color: subjectColors(tileSubject(it.subject)).color }}>{hwSubjectLabel(it.subject)}</Text>
                              {it.status === "running" ? (
                                <View className="td-meta td-meta--run"><Icon name="timer" size={12} color={C.brand} stroke={2.4} /><Text>计时中 {mmss(used)}</Text></View>
                              ) : used > 0 ? (
                                <View className="td-meta"><Icon name="clock" size={12} color={C.secondary} stroke={2.2} /><Text>{it.status === "paused" ? "已暂停 · " : ""}已用 {hourMin(used)}</Text></View>
                              ) : null}
                            </View>
                          </View>
                          <View className="td-go" onClick={() => open(it)}><Icon name="chevron-right" size={15} color={C.tertiary} stroke={2.4} /></View>
                        </View>
                      </SwipeRow>
                    );
                  })}
                </View>
              </View>
            ))}

          {tab === "archived" && data.archived.length === 0 && (
            <View className="hw-empty">
              <Buddy scene="empty" size={120} />
              <Text className="hw-empty__b">还没有归档的事项</Text>
              <Text className="t-sub">在计时页点「完成」，这一项就会放到这里。</Text>
            </View>
          )}
          {tab === "archived" &&
            splitArchived(data.archived, data.today).map((g) => (
              <View key={g.key}>
                <View className="td-sec"><Text className="td-sec__b">{g.label}</Text></View>
                <View className="td-list">
                  {g.items.map((it) => (
                    <SwipeRow
                      key={it.id}
                      inline
                      open={openId === it.id}
                      onOpenChange={(o) => setOpenId(o ? it.id : null)}
                      actions={[
                        { label: "重新打开", icon: "undo", color: C.brand, onClick: () => void reopen(it) },
                        { label: "删除", icon: "trash", onClick: () => void remove(it) },
                      ]}
                    >
                      <View className="td-row td-row--done">
                        <View className="td-check td-check--done" onClick={(e) => { e.stopPropagation(); if (!swipeGuard.moved) void reopen(it); }}>
                          <Icon name="check" size={14} color="#ffffff" stroke={3} />
                        </View>
                        <View className="td-main" onClick={() => openId && setOpenId(null)}>
                          <Text className="td-title ellipsis">{it.title}</Text>
                          <View className="td-sub">
                            <Text className="td-subj" style={{ color: subjectColors(tileSubject(it.subject)).color }}>{hwSubjectLabel(it.subject)}</Text>
                            <Text className="td-meta">{finishedLabel(it, data.today)}</Text>
                            {it.used > 0 && <View className="td-meta"><Icon name="clock" size={12} color={C.tertiary} stroke={2.2} /><Text>用时 {hourMin(it.used)}</Text></View>}
                          </View>
                        </View>
                      </View>
                    </SwipeRow>
                  ))}
                </View>
              </View>
            ))}
          {tab === "archived" && data.archived.length > 0 && (
            <Text className="td-hint">
              点左边的勾，或者左滑，可以重新打开{data.archivedTotal > data.archived.length ? `。只显示最近 ${data.archived.length} 项` : ""}
            </Text>
          )}
        </>
      )}

      {data && tab === "todo" && data.todo.length > 0 && (
        <View className="td-fab" hoverClass="fc--press" onClick={() => { setOpenId(null); setAdding(true); }}>
          <Icon name="plus" size={26} color="#ffffff" stroke={2.6} />
        </View>
      )}
      {snack && (
        <View className={`td-snack${tab === "todo" && data?.todo.length ? " td-snack--fab" : ""}`}>
          <View className="td-snack__ok"><Icon name="check" size={12} color="#ffffff" stroke={3.4} /></View>
          <Text className="td-snack__t ellipsis">{snack.text}</Text>
          {snack.undoId && <Text className="td-snack__u" onClick={undo}>撤销</Text>}
        </View>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="添加待办">
        <AddRow icon="camera" main title="扫描" sub="对着作业单、黑板、家校本拍照，可连拍多张" onClick={() => void fromPhotos("camera")} />
        <AddRow icon="photo" title="从相册选图片" sub="老师发在群里的作业截图" onClick={() => void fromPhotos("album")} />
        <AddRow icon="bubble" title="从微信聊天选文件" sub="图片、PDF、Word" onClick={() => void fromChat()} />
        <Button variant="plain" onClick={() => setAdding(false)}>取消</Button>
      </Sheet>
      <EditSheet item={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

function archivedNote(data: HwTodos): string {
  const n = data.archived.filter((it) => (it.finishedAt ?? "").slice(0, 10) >= data.today).length;
  return n ? `今天完成 ${n} 项` : "做完的事项都在这里";
}

function AddRow({ icon, title, sub, main, onClick }: { icon: "camera" | "photo" | "bubble"; title: string; sub: string; main?: boolean; onClick: () => void }) {
  return (
    <View className="td-opt" hoverClass="list-row--hover" onClick={onClick}>
      <View className={`td-opt__ic${main ? " td-opt__ic--main" : ""}`}><Icon name={icon} size={22} color={main ? "#ffffff" : C.brand} stroke={2} /></View>
      <View className="flex1">
        <Text className="hw-help__b">{title}</Text>
        <Text className="hw-help__s">{sub}</Text>
      </View>
      <Icon name="chevron-right" size={15} color={C.tertiary} stroke={2.4} />
    </View>
  );
}

/** 左滑「编辑」：改名称和学科 */
function EditSheet({ item, onClose }: { item: HwItem | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<HwSubject>("other");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setSubject(item.subject);
    }
  }, [item?.id]);
  const save = async () => {
    if (!item) return;
    const t = title.trim();
    if (!t) return void toast("名称不能是空的");
    setBusy(true);
    try {
      if (t !== item.title || subject !== item.subject) await updateItem(item.id, { title: t, subject });
      onClose();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!item} onClose={onClose} title="编辑待办">
      <Text className="td-lab">名称</Text>
      <Input className="input" value={title} onInput={(e) => setTitle(e.detail.value)} maxlength={120} adjustPosition={false} confirmType="done" onConfirm={() => void save()} />
      <Text className="td-lab">学科</Text>
      <View className="hw-chips">
        {HW_SUBJECTS.map((s) => (
          <Text key={s} className={`hw-chip td-chip${subject === s ? " hw-chip--on" : ""}`} onClick={() => setSubject(s)}>{hwSubjectLabel(s)}</Text>
        ))}
      </View>
      <Button disabled={busy} onClick={() => void save()}>保存</Button>
      <Button variant="plain" onClick={onClose}>取消</Button>
    </Sheet>
  );
}

/** 正在识别：识别完自动回到待办列表 */
function Parsing({ tc, photos, files }: { tc: string; photos: number; files: number }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setStep(1), 1800), setTimeout(() => setStep(2), 5000)];
    return () => t.forEach(clearTimeout);
  }, []);
  const what = [photos ? `${photos} 张照片` : "", files ? `${files} 个文件` : ""].filter(Boolean).join(" · ");
  const rows: [number, string, string?][] = [[0, "看清内容", what], [1, "拆成一项一项"], [2, "生成待办列表"]];
  return (
    <View className={"page" + tc} style={{ gap: "16px" }}>
      <View className="hw-empty">
        <Buddy scene="scan" size={120} />
        <Text className="hw-empty__b">正在整理成待办</Text>
        <Text className="t-sub">大约 10 秒，识别完自动进入待办列表。</Text>
      </View>
      <View className="hw-steps">
        {rows.map(([i, label, extra]) => (
          <View key={i} className={`hw-steps__r${step < i ? " hw-off" : ""}`}>
            <View className={`hw-dot ${step > i ? "hw-dot--ok" : step === i ? "hw-dot--run" : "hw-dot--wait"}`}>{step > i && <Icon name="check" size={13} color="#ffffff" stroke={3} />}</View>
            <Text className="flex1">{label}</Text>
            {extra && <Text className="t-cap c-sec">{extra}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}
