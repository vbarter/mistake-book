/** 成员看到的学习计划页（和 App 的 pages/plans/PlanMember.tsx 对应）。 */
import { useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Icon, type IconName } from "./Icon";
import { Busy, Count, ScanSheet } from "./plan";
import { Button, Sheet, Stat, Tag } from "./ui";
import { errorText } from "../lib/api";
import { submitExport } from "../lib/export";
import { toast } from "../lib/hooks";
import { STATUS_LABEL, canHandIn, createdLabel, dueLabel, fetchAssignment, fileBadge, isOverdue, openPlanFile, sizeLabel, submitHomework, type MemberAssignment, type PlanDetailRes } from "../lib/plans";
import { C } from "../lib/theme";

type Look = "done" | "returned" | "todo" | "revoked";
/** 一份作业的样子：交了 = 绿，退回重做 = 红，待交 = 橙 */
const lookOf = (a: MemberAssignment): Look => (a.status === "submitted" || a.status === "reviewed" ? "done" : a.status === "returned" ? "returned" : a.revoked ? "revoked" : "todo");
const LOOK_ICON: Record<Look, [IconName, string]> = { done: ["checkcircle", C.ok], returned: ["refresh", C.wrong], todo: ["clock", C.accentOn], revoked: ["minus", C.tertiary] };

/**
 * 成员不再有单独的「作业」页，全在这一页：待交 / 已交两个数，一张卡片顶上是计划名 + 创建时间，下面每份作业一段（作业名 + 状态，下面直接平铺它的文件，点文件打开），
 * 底部「导出」「扫描上传」。扫描上传：拍照（连拍）或相册选好照片 → 选这次交的是哪一份作业 → 交给老师；
 * 交完页面跟着刷新，交了的作业整块标成绿色。交过的作业点作业名看自己那份的批改结果。
 */
export function PlanMember({ data, reload }: { data: PlanDetailRes; reload: () => Promise<void> }) {
  const list = data.assignments as MemberAssignment[];
  const [shots, setShots] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [handing, setHanding] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
      toast("交上去了", "success");
      await reload();
    } catch (e) {
      await Taro.showModal({ title: "没交上去", content: errorText(e), showCancel: false });
      setHanding(true);
    } finally {
      setStage(null);
    }
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
    }
  };

  const statusTag = (a: MemberAssignment, onTint = false) =>
    a.revoked ? (
      <Tag kind="neutral" icon={null}>
        已撤回
      </Tag>
    ) : (
      <Tag
        kind={a.status === "todo" ? "pending" : a.status === "returned" ? "wrong" : "correct"}
        icon={a.status === "todo" ? "clock" : a.status === "returned" ? "refresh" : undefined}
        style={onTint && a.status !== "todo" ? { background: C.card } : undefined}
      >
        {STATUS_LABEL[a.status]}
      </Tag>
    );
  const exportable = list.filter((a) => a.digitized || (a.files ?? []).length > 0);

  return (
    <>
      <View className="stats">
        <Stat icon="clock" label="待交" value={todo.length} color={todo.length ? C.accentOn : undefined} />
        <Stat icon="checkcircle" label="已交" value={handed} color={handed ? C.ok : undefined} />
      </View>
      {/* 一张卡片：最上面是计划名 + 创建时间（只出现一次），下面一份份作业 */}
      <View className="group">
        <View className="plan-task">
          <Text className="t-headline ellipsis">{data.plan.name}</Text>
          <Text className="t-foot c-sec">{createdLabel(data.plan.createdAt)}</Text>
        </View>
        {list.length === 0 && <Text className="plan-empty">还没有作业</Text>}
        {list.map((a) => {
        const look = lookOf(a);
        const waiting = a.status === "todo" || a.status === "returned";
        const files = a.files ?? [];
        const mine = a.status !== "todo"; // 交过：点作业名看自己那份和批改结果
        return (
          <View key={a.id} className="plan-hw">
            <View
              className={`plan-task plan-task--${look}`}
              hoverClass={mine ? "list-row--hover" : "none"}
              onClick={() => mine && void Taro.navigateTo({ url: `/pages/plan-task/index?id=${a.id}` })}
            >
              <View className="plan-task__head">
                <Icon name={LOOK_ICON[look][0]} size={18} color={LOOK_ICON[look][1]} stroke={2.4} />
                <Text className="t-headline ellipsis flex1">{a.title}</Text>
                {statusTag(a, true)}
                {mine && <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />}
              </View>
              <View className="plan-counts" style={waiting && !a.dueAt ? { display: "none" } : undefined}>
                {waiting ? (
                  a.dueAt && (
                    <Count icon="clock" color={isOverdue(a.dueAt) ? C.wrong : C.secondary}>
                      {dueLabel(a.dueAt)}
                    </Count>
                  )
                ) : a.score ? (
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
                  <Text className="t-foot c-sec">批改中</Text>
                )}
                {!waiting && a.late && <Text className="t-foot c-sec">迟交</Text>}
              </View>
              {a.comment && (
                <View className="plan-count" style={{ alignItems: "flex-start" }}>
                  <Icon name="bubble" size={14} color={a.status === "returned" ? C.wrong : C.tertiary} stroke={2.2} style={{ marginTop: "2px" }} />
                  <Text className="t-foot flex1" style={{ color: a.status === "returned" ? C.wrong : C.secondary, fontWeight: 400 }}>
                    {a.comment}
                  </Text>
                </View>
              )}
            </View>
            {files.map((f) => (
              <View key={f.id} className="list-row" hoverClass="list-row--hover" onClick={() => void openPlanFile(f, files)}>
                <View className="plan-file__icon plan-file__icon--sm">
                  <Text>{fileBadge(f.mime)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">{f.name}</Text>
                  <Text className="row__sub">{sizeLabel(f.size)}</Text>
                </View>
                <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
              </View>
            ))}
          </View>
        );
      })}
      </View>

      <View className="bottom-bar">
        <Button variant="outline" icon="printer" className={open.length ? undefined : "flex1"} disabled={exportable.length === 0} onClick={() => setExporting(true)}>
          导出
        </Button>
        {open.length > 0 && (
          <Button icon={shots.length ? "check" : "camera"} className="flex1" onClick={() => (shots.length ? setHanding(true) : setScanning(true))}>
            {shots.length ? `交作业 · ${shots.length} 页` : "扫描上传"}
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
        <View className="group group--fill">
          {open.map((a) => {
            const on = chosen?.id === a.id;
            return (
              <View key={a.id} className="list-row" hoverClass="list-row--hover" onClick={() => setTarget(a.id)}>
                <View className={`plan-radio${on ? " plan-radio--on" : ""}`}>{on && <Icon name="check" size={13} color="#ffffff" stroke={3.2} />}</View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">{a.title}</Text>
                  {a.status === "submitted" && <Text className="row__sub">交过了，再交会换掉上次那份</Text>}
                </View>
                {statusTag(a)}
              </View>
            );
          })}
        </View>
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
