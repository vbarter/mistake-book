/** 成员看到的学习计划页（和 App 的 pages/plans/PlanMember.tsx 对应）。 */
import { useState, type ReactNode } from "react";
import { Image, Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useCelebrate } from "./Celebrate";
import { Icon } from "./Icon";
import { Busy, Count, ScanSheet } from "./plan";
import { SwipeRow, swipeGuard, useSwipeCloseOnScroll } from "./SwipeRow";
import { Button, Sheet, Stat, Tag } from "./ui";
import { errorText } from "../lib/api";
import { submitExport } from "../lib/export";
import { toast } from "../lib/hooks";
import { AI_GRADING, HW_PREVIEW, STATUS_LABEL, shownStatus, absoluteUrl, canHandIn, canWithdraw, dueLabel, fetchAssignment, fileBadge, handInLabel, hwMeta, isOverdue, openPlanFile, planGone, sizeLabel, submitHomework, withdrawHomework, type MemberAssignment, type PlanDetailRes } from "../lib/plans";
import { C } from "../lib/theme";

type Look = "done" | "returned" | "todo" | "revoked";
/** 一份作业的样子：交了 = 绿，退回重做 = 红，没交 = 不上色 */
const lookOf = (a: MemberAssignment): Look => { const st = shownStatus(a.status); return st === "submitted" || st === "reviewed" ? "done" : st === "returned" ? "returned" : a.revoked ? "revoked" : "todo"; };

const SWIPE_HINT = "zcb.plan.unbindHint";
function swipeHintPending(): boolean {
  try {
    return !Taro.getStorageSync(SWIPE_HINT);
  } catch {
    return false;
  }
}

/**
 * 成员不再有单独的「作业」页，全在这一页：待交 / 已交两个数，下面一份作业一张卡片：头部是序号 + 作业名 + 布置日期和文件数 + 自己的状态（待交 / 已交 / 退回重做），
 * 文件缩进排在下面（点文件打开）。待交和退回的默认展开，交过的收起，点头部展开 / 收起；文件多于 3 个先显示 3 个。
 * 底部「导出」「交作业」。扫描上传：拍照（连拍）或相册选好照片 → 选这次交的是哪一份作业 → 交给老师；
 * 交完页面跟着刷新，交了的作业整张标成绿色，退回的标红。交了、老师还没批阅的那份可以整张向左滑，露出「解绑」：撤掉自己交的那份，回到没交，可以重新扫描上传。
 * 批改关着时，交过的作业展开后最下面多一行「我交的作业」，点开翻看自己交上去的照片。
 *AI 批改开着（AI_GRADING）时下面多一行对 / 错 / 没做，点进去看自己那份的批改结果。
 */
export function PlanMember({ data, reload }: { data: PlanDetailRes; reload: () => Promise<void> }) {
  const list = data.assignments as MemberAssignment[];
  const [shots, setShots] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [handing, setHanding] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [swiped, setSwiped] = useState<string | null>(null); // 左滑开着的那份作业
  const [opened, setOpened] = useState<Record<string, boolean>>({}); // 手动展开 / 收起过的作业（没动过的：待交、退回的展开，交过的收起）
  const [full, setFull] = useState<Record<string, boolean>>({}); // 文件全部展开了的作业
  const [hint, setHint] = useState(swipeHintPending); // 第一次有交过的作业：那一行自己滑出一小截，露一下「解绑」
  const [cele, celebrate] = useCelebrate();
  useSwipeCloseOnScroll(swiped, () => setSwiped(null));

  const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned"));
  const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
  const open = list.filter(canHandIn);
  // 选中的那份：只有一份待交（或只有一份能交）时不用选
  const chosen = open.find((a) => a.id === target) ?? (todo.length === 1 ? todo[0] : open.length === 1 ? open[0] : null);

  const hand = async () => {
    if (!chosen || !shots.length) return;
    setHanding(false);
    try {
      await submitHomework(chosen, shots, setStage);
      setShots([]);
      setTarget(null);
      void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
      // 交上了：庆祝一下；这一份交完就没有待交的了，算「交齐」，纸屑多一些
      const cleared = todo.every((a) => a.id === chosen.id);
      celebrate({ title: "交上啦！", sub: cleared && list.length > 1 ? `${chosen.title} · 作业都交齐了` : chosen.title, big: cleared });
      await reload();
    } catch (e) {
      await Taro.showModal({ title: "没交上去", content: errorText(e), showCancel: false });
      if (planGone(e)) return void reload(); // 计划被解散 / 自己被移出了：重新拉一次，页面换成提示
      setHanding(true);
    } finally {
      setStage(null);
    }
  };

  const withdraw = async (a: MemberAssignment) => {
    setSwiped(null);
    try {
      await withdrawHomework(a.id);
      toast("已解绑", "success");
    } catch (e) {
      toast(errorText(e));
    }
    await reload();
  };
  /** 看自己交上去的那几页：批改关着时照片只在服务器上，点开直接翻看 */
  const viewMine = async (a: MemberAssignment) => {
    Taro.showLoading({ title: "打开中…", mask: true });
    try {
      const sub = (await fetchAssignment(a.id)).submission;
      const urls = (sub?.files ?? []).filter((f) => f.url).map((f) => absoluteUrl(f.url!));
      Taro.hideLoading();
      if (!urls.length) return toast(sub?.files.length ? "照片还在上传，稍后再试" : "没找到交上去的照片");
      void Taro.previewImage({ current: urls[0], urls });
    } catch (e) {
      Taro.hideLoading();
      toast(errorText(e));
      if (planGone(e)) void reload();
    }
  };
  /** 行上的点击：刚滑过的那一下不算；有一行滑开着时，这一下只把它收回 */
  const tap = (fn: () => void) => () => {
    if (swipeGuard.moved) return;
    if (swiped) return setSwiped(null);
    fn();
  };

  const exportPdf = async (a: MemberAssignment) => {
    setExporting(false);
    Taro.showLoading({ title: "正在提交…", mask: true });
    try {
      const digitized = (await fetchAssignment(a.id)).assignment.digitized;
      if (!digitized) throw new Error("电子版还没准备好");
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      Taro.hideLoading();
      toast(job ? (job.status === "done" ? "已生成，在「我的导出」里" : "正在生成，好了会提醒你") : "服务器暂时不支持导出");
    } catch (e) {
      Taro.hideLoading();
      toast(errorText(e));
      if (planGone(e)) void reload();
    }
  };

  /** 头部右边自己的状态：待交 / 已交 / 已阅 / 退回重做 / 已删除 */
  const statusTag = (a: MemberAssignment, st = shownStatus(a.status)) =>
    a.revoked && st === "todo" ? (
      <Tag kind="neutral" icon={null}>
        已删除
      </Tag>
    ) : (
      <Tag
        kind={st === "todo" ? "pending" : st === "returned" ? "wrong" : "correct"}
        icon={st === "todo" ? "clock" : st === "returned" ? "refresh" : undefined}
        style={st === "submitted" || st === "reviewed" ? { background: C.card } : undefined}
      >
        {STATUS_LABEL[st]}
      </Tag>
    );
  const firstSwipe = list.find(canWithdraw)?.id;
  /** 这份作业在页面上的序号（卡片头部左边那个数） */
  const noOf = (a: MemberAssignment) => list.length - list.findIndex((x) => x.id === a.id);
  const exportable = list.filter((a) => a.digitized || (a.files ?? []).length > 0);

  return (
    <>
      <View className="stats" onClick={tap(() => undefined)}>
        <Stat icon="clock" label="待交" value={todo.length} />
        <Stat icon="checkcircle" label="已交" value={handed} color={handed ? C.ok : undefined} />
      </View>
      {list.length === 0 && (
        <View className="group">
          <View className="hw-empty">
            <Icon name="document" size={34} color={C.tertiary} stroke={1.6} />
            <Text className="hw-empty__title">还没有作业</Text>
            <Text className="hw-empty__sub">老师布置后会出现在这里</Text>
          </View>
        </View>
      )}
      {/* 一份作业一张卡片（计划名在顶部标题栏，创建时间在页面头部创建人名字下面） */}
      {list.map((a, i) => {
        const look = lookOf(a);
        const st = shownStatus(a.status);
        const waiting = st === "todo" || st === "returned";
        const files = a.files ?? [];
        const mine = st !== "todo";
        const open = opened[a.id] ?? (waiting && !a.revoked);
        const shownFiles = open ? (full[a.id] ? files : files.slice(0, HW_PREVIEW)) : [];
        const rest = files.length - HW_PREVIEW;
        const overdue = waiting && isOverdue(a.dueAt);
        const body: ReactNode = (
          <>
            <View className="hw-head" hoverClass="list-row--hover" onClick={tap(() => setOpened((o) => ({ ...o, [a.id]: !open })))}>
              <View className="hw-no">
                <Text>{list.length - i}</Text>
              </View>
              <View className="flex1 col minw0">
                <Text className="hw-title ellipsis">{a.title}</Text>
                <View className="hw-sub">
                  <Text className="flex1 ellipsis" style={overdue ? { color: C.wrong } : undefined}>
                    {hwMeta(a)}
                    {waiting && a.dueAt ? ` · ${dueLabel(a.dueAt)}截止` : ""}
                    {a.late ? " · 迟交" : ""}
                  </Text>
                </View>
              </View>
              {statusTag(a)}
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={C.tertiary} stroke={2.4} />
            </View>
            {shownFiles.map((f) => (
              <View key={f.id} className="list-row hw-file" hoverClass="list-row--hover" onClick={tap(() => void openPlanFile(f, files))}>
                <View className="plan-file__icon plan-file__icon--sm">
                  <Text>{fileBadge(f.mime)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="hw-file__name ellipsis">{f.name}</Text>
                  <Text className="row__sub">{sizeLabel(f.size)}</Text>
                </View>
                <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
              </View>
            ))}
            {open && rest > 0 && (
              <View className="hw-foot" hoverClass="list-row--hover" onClick={tap(() => setFull((m) => ({ ...m, [a.id]: !m[a.id] })))}>
                <Text>{full[a.id] ? "收起" : `其余 ${rest} 个文件`}</Text>
                <Icon name={full[a.id] ? "chevron-up" : "chevron-down"} size={13} color={C.brand} stroke={2.4} />
              </View>
            )}
            {/* 退回重做：一句提醒；老师留的话跟在后面 */}
            {open && st === "returned" && (
              <View className="hw-foot hw-foot--wrong">
                <Text>老师退回了，重新交一次</Text>
              </View>
            )}
            {open && a.comment && (
              <View className={`hw-foot ${st === "returned" ? "hw-foot--wrong" : "hw-foot--mute"}`} style={{ height: "auto", padding: "10px 16px 10px 48px", alignItems: "flex-start" }}>
                <Icon name="bubble" size={14} color={st === "returned" ? C.wrong : C.tertiary} stroke={2.2} style={{ marginTop: "3px" }} />
                <Text className="flex1" style={{ fontWeight: 400, lineHeight: "20px" }}>
                  {a.comment}
                </Text>
              </View>
            )}
            {/* 批改开着：交过的多一行对 / 错 / 没做，点进去看自己那份的批改结果 */}
            {open && AI_GRADING && mine && (
              <View className="hw-foot hw-foot--mute" hoverClass="list-row--hover" onClick={tap(() => void Taro.navigateTo({ url: `/pages/plan-task/index?id=${a.id}` }))}>
                <View className="plan-counts flex1">
                  {a.score ? (
                    <>
                      <Count icon="checkcircle" color={C.ok}>
                        {a.score.correct}
                      </Count>
                      <Count icon="xcircle" color={C.wrong}>
                        {a.score.wrong}
                      </Count>
                      <Count icon="minus" color={C.tertiary}>
                        {a.score.blank}
                      </Count>
                    </>
                  ) : (
                    <Text>{st === "returned" ? "" : "批改中"}</Text>
                  )}
                </View>
                <Text>批改结果</Text>
                <Icon name="chevron-right" size={13} color={C.tertiary} stroke={2.4} />
              </View>
            )}
            {/* 批改关着：交过的多一行「我交的作业」，点开翻看自己交上去的照片 */}
            {open && !AI_GRADING && mine && (
              <View className="hw-foot hw-foot--mute" hoverClass="list-row--hover" onClick={tap(() => void viewMine(a))}>
                <Icon name="photo" size={14} color={C.secondary} stroke={2.2} />
                <Text className="flex1">我交的作业</Text>
                <Text>查看</Text>
                <Icon name="chevron-right" size={13} color={C.tertiary} stroke={2.4} />
              </View>
            )}
          </>
        );
        const cls = `hw hw--${look}`;
        // 交了、老师还没批阅：这一份整张可以向左滑出「解绑」
        return canWithdraw(a) ? (
          <View key={a.id} className={cls}>
            <SwipeRow
              label="解绑"
              icon="unlink"
              open={swiped === a.id}
              onOpenChange={(o) => setSwiped(o ? a.id : null)}
              onDelete={() => void withdraw(a)}
              hint={hint && a.id === firstSwipe}
              onHintDone={() => {
                setHint(false);
                try {
                  Taro.setStorageSync(SWIPE_HINT, "1");
                } catch {
                  /* 存不下：下次再演示一遍 */
                }
              }}
            >
              {body}
            </SwipeRow>
          </View>
        ) : (
          <View key={a.id} className={`${cls} group`}>
            {body}
          </View>
        );
      })}

      {cele}
      <View className="bottom-bar">
        <Button variant="outline" icon="printer" className={open.length ? undefined : "flex1"} disabled={exportable.length === 0} onClick={() => setExporting(true)}>
          导出
        </Button>
        {open.length > 0 && (
          <Button icon={shots.length ? "check" : "camera"} className="flex1" onClick={() => (shots.length ? setHanding(true) : setScanning(true))}>
            {shots.length ? `交作业 · ${shots.length} 页` : "交作业"}
          </Button>
        )}
      </View>

      {/* 拍完：看一眼拍的几页，选这次交的是哪一份作业 */}
      <Sheet open={handing} onClose={() => setHanding(false)} title={`拍了 ${shots.length} 页`}>
        <View className="plan-thumbs">
          {shots.map((p, i) => (
            <View key={p} className="plan-thumb">
              <Image className="thumb" src={p} mode="aspectFill" onClick={() => Taro.previewImage({ current: p, urls: shots })} />
              <View className="plan-thumb__x" onClick={() => setShots((cur) => cur.filter((_, j) => j !== i))}>
                <Icon name="xmark" size={11} color="#ffffff" stroke={3} />
              </View>
            </View>
          ))}
          <View
            className="thumb plan-thumb__add"
            onClick={() => {
              setHanding(false);
              setScanning(true);
            }}
          >
            <Icon name="plus" size={18} color={C.brand} stroke={2.4} />
          </View>
        </View>
        <Text className="t-foot c-sec">交到哪一份作业</Text>
        {/* 下拉选择：点开是微信自带的滚轮，列出所有还能交的作业 */}
        <Picker mode="selector" range={open.map((a) => handInLabel(a, noOf(a)))} value={Math.max(0, open.findIndex((a) => a.id === chosen?.id))} onChange={(e) => setTarget(open[Number(e.detail.value)]?.id ?? null)}>
          <View className="field">
            <Text className={`ellipsis flex1${chosen ? "" : " c-sec"}`}>{chosen ? handInLabel(chosen, noOf(chosen)) : "请选择作业"}</Text>
            <Icon name="chevron-down" size={16} color={C.tertiary} stroke={2.4} />
          </View>
        </Picker>
        {/* 选中的那份：再说一遍是哪天布置的、里面几个文件，确认交的是整份作业 */}
        {chosen && <Text className="t-foot c-sec">{`作业 ${noOf(chosen)} · ${hwMeta(chosen)}`}</Text>}
        {chosen?.status === "submitted" && <Text className="t-foot c-sec">这份交过了，再交会换掉上次那份</Text>}
        <Button icon="check" disabled={!chosen || shots.length === 0 || Boolean(stage)} onClick={() => void hand()}>
          交给老师
        </Button>
      </Sheet>

      <Sheet open={exporting} onClose={() => setExporting(false)} title="导出作业">
        {exportable.map((a) => (
          <View key={a.id} className="group group--fill">
            <View className="group__header">
              <Text className="ellipsis">{a.title}</Text>
            </View>
            {a.digitized && (
              <View className="list-row" hoverClass="list-row--hover" onClick={() => void exportPdf(a)}>
                <View className="row__icon" style={{ background: C.brand }}>
                  <Icon name="printer" size={18} color="#ffffff" stroke={2} />
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title">电子版 PDF</Text>
                </View>
              </View>
            )}
            {(a.files ?? []).map((f) => (
              <View
                key={f.id}
                className="list-row"
                hoverClass="list-row--hover"
                onClick={() => {
                  setExporting(false);
                  void openPlanFile(f, a.files);
                }}
              >
                <View className="row__icon" style={{ background: C.secondary }}>
                  <Icon name={f.mime.startsWith("image/") ? "photo" : "document"} size={18} color="#ffffff" stroke={2} />
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">{f.name}</Text>
                  <Text className="row__sub">{sizeLabel(f.size)}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </Sheet>
      <ScanSheet
        open={scanning}
        title="拍下做完的作业"
        onClose={() => setScanning(false)}
        onPhotos={(p) => {
          setShots((cur) => [...cur, ...p]);
          setHanding(true);
        }}
      />
      {stage && <Busy text={stage} />}
    </>
  );
}
