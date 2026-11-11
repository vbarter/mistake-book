import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { PrintSheets } from "../../components/PrintSheets";
import { Busy, Count, LoginGate, PageState, PlanCreator, QuestionGrid, ScanSheet, ScoreCounts, ScoreStats, ShareButton, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { Avatar, Button, Segmented, Sheet, Stat, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { submitExport } from "../../lib/export";
import { toast } from "../../lib/hooks";
import { STATUS_LABEL, absoluteUrl, bumpPlans, dueLabel, fetchAssignment, fileBadge, isAssignmentScanning, isOverdue, isSubmissionPending, memberName, openPlanFile, revokeAssignment, sizeLabel, submitHomework, type AssignmentRes } from "../../lib/plans";
import type { Paper } from "../../lib/store";
import { C } from "../../lib/theme";

/**
 * 作业页（和 App 一致）。成员：作业内容 + 底部「导出」「扫描上传」，交了以后看自己的对 / 错 / 没做。
 * 创建人：谁交了、谁没交、谁没看，错得最多的题，提醒没交的同学。成员这边不会拿到任何别人的信息。
 */
export default function PlanTask() {
  const id = useRouter().params.id || "";
  const [version] = usePlansVersion();
  const [data, setData] = useState<AssignmentRes | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"photo" | "text">("photo");
  const [shots, setShots] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const logged = loggedIn();
  const loaded = useRef(false);

  const load = async () => {
    if (!loggedIn()) return;
    try {
      const r = await fetchAssignment(id);
      loaded.current = true;
      setData(r);
      setError("");
      void Taro.setNavigationBarTitle({ title: r.plan.role === "owner" ? "作业情况" : "作业" });
    } catch (e) {
      // 已经显示出来了就不换成报错页：进页面时会连着请求两次，后到的那次失败不该盖掉已有的内容
      if (!loaded.current) setError(errorText(e) || "打不开");
    }
  };
  useEffect(() => {
    void load();
  }, [id, version]);
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  usePlanShare(() => (data?.invite && data.plan.role === "owner" && !data.assignment.revoked ? { plan: data.plan, invite: data.invite, title: data.assignment.title, assignmentId: data.assignment.id } : null));

  const digitized = data?.assignment.digitized ?? null;
  // 电子版用现成的打印版排版；手边没有原照片，插图在「照片」里看
  const pseudo = useMemo<Paper | null>(() => (data && digitized ? { id: data.assignment.id, name: data.assignment.title, createdAt: "", updatedAt: "", pages: [], digitized } : null), [data, digitized]);

  if (!logged) return <LoginGate />;
  if (error) return <PageState error={error} action={<Button size="sm" onClick={() => void Taro.redirectTo({ url: "/pages/plans/index" })}>看看我的学习计划</Button>} />;
  if (!data) return <PageState />;

  const { plan, assignment: a, board, submission: sub } = data;
  const owner = plan.role === "owner";
  const scans = a.files.filter((f) => f.kind === "scan");
  const attachments = a.files.filter((f) => f.kind === "attachment");
  const canRevoke = owner && !a.revoked;
  const canSubmit = !owner && !a.revoked && (!sub || sub.status !== "reviewed");

  const hand = async () => {
    try {
      await submitHomework(a, shots, setStage);
      setShots([]);
      void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
      toast("交上去了", "success");
      await load();
    } catch (e) {
      void Taro.showModal({ title: "没交上去", content: errorText(e), showCancel: false });
    } finally {
      setStage(null);
    }
  };
  const exportPdf = async () => {
    if (!digitized) return;
    setExporting(false);
    Taro.showLoading({ title: "正在提交…", mask: true });
    try {
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      Taro.hideLoading();
      toast(job ? (job.status === "done" ? "已生成，在「我的导出」里" : "正在生成，好了会提醒你") : "服务器暂时不支持导出");
    } catch (e) {
      Taro.hideLoading();
      toast(errorText(e));
    }
  };
  const revoke = async () => {
    setMenu(false);
    if (!(await confirm("撤回这份作业？", "没交的同学不会再看到；交过的同学还能看到自己那份。", "撤回", true))) return;
    try {
      await revokeAssignment(a.id);
      bumpPlans();
      toast("已撤回", "success");
      if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
      else void Taro.redirectTo({ url: `/pages/plan/index?id=${plan.id}` });
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** 去学习计划页看全部作业：本来就是从那一页点进来的就退回去，从卡片直接进来的就打开它 */
  const toPlan = () => {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1 && pages[pages.length - 2]?.route === "pages/plan/index") void Taro.navigateBack();
    else void Taro.navigateTo({ url: `/pages/plan/index?id=${plan.id}` });
  };

  const content = (
    <>
      {/* 成员：先看到是谁的哪个学习计划，点一下去看这个计划的全部作业 */}
      {!owner && <PlanCreator plan={plan} more="全部作业" onClick={toPlan} />}
      <View className="card" style={{ gap: "6px" }}>
        <View className="row-center gap8">
          {/* 创建人点作业名：不常用的「撤回」收在面板里，和学习计划页点计划名一个习惯 */}
          <View className="flex1 row-center gap4 minw0" onClick={() => canRevoke && setMenu(true)}>
            {/* 成员这边作业名最多两行，长名字不截成一行 */}
            <Text className={`t-title3 ${owner ? "ellipsis" : "clamp2"}`} style={{ fontWeight: 800 }}>
              {a.title}
            </Text>
            {canRevoke && <Icon name="chevron-down" size={14} color={C.tertiary} stroke={2.6} />}
          </View>
          {a.revoked && (
            <Tag kind="neutral" icon={null}>
              已撤回
            </Tag>
          )}
          {canRevoke && <ShareButton pill>转发</ShareButton>}
        </View>
        <View className="plan-counts" style={owner || a.dueAt || a.questionCount ? undefined : { display: "none" }}>
          {owner && <Text className="t-foot c-sec ellipsis">{plan.name}</Text>}
          {a.dueAt && (
            <Count icon="clock" color={isOverdue(a.dueAt) ? C.wrong : C.secondary}>
              {dueLabel(a.dueAt)}
            </Count>
          )}
          {a.questionCount ? <Count icon="list">{a.questionCount} 题</Count> : null}
        </View>
      </View>
      {attachments.length > 0 && (
        <View className="group">
          <View className="group__header">
            <Text>附件</Text>
          </View>
          {attachments.map((f) => (
            <View key={f.id} className="list-row" hoverClass="list-row--hover" onClick={() => void openPlanFile(f, attachments)}>
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
      )}
      {scans.length > 0 && (
        <>
          {pseudo ? (
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "photo", label: "照片" },
                { value: "text", label: "电子版" },
              ]}
            />
          ) : owner && isAssignmentScanning(a.id) ? (
            <View className="row-center gap8 pad12">
              <View className="spinner" />
              <Text className="t-foot c-sec">正在识别电子版…</Text>
            </View>
          ) : null}
          {view === "text" && pseudo ? (
            <PrintSheets paper={pseudo} sheets={digitized!.pages} clean />
          ) : (
            scans.map((f) =>
              f.url ? (
                <Image key={f.id} className="plan-photo" src={absoluteUrl(f.url)} mode="widthFix" lazyLoad onClick={() => void openPlanFile(f, scans)} />
              ) : (
                <View key={f.id} className="card">
                  <Text className="plan-empty">「{f.name}」还在上传</Text>
                </View>
              ),
            )
          )}
        </>
      )}
    </>
  );

  return (
    <View className="page">
      {owner && board && (
        <>
          <View className="stats">
            <Stat icon="checkcircle" label="已交" value={`${board.submitted.length}/${board.members}`} color={board.submitted.length ? C.ok : undefined} />
            <Stat icon="clock" label="没交" value={board.missing.length} color={board.missing.length ? C.accentOn : undefined} />
            <Stat icon="eye-off" label="没看" value={board.unseen} />
          </View>
          {board.hardest.length > 0 && (
            <View className="group">
              <View className="group__header">
                <Text>错得最多</Text>
              </View>
              {board.hardest.map((h) => (
                <View key={h.number} className="list-row" style={{ alignItems: "flex-start" }}>
                  <View className="plan-q plan-q--wrong">
                    <Text>{h.number}</Text>
                  </View>
                  <View className="flex1 col gap2 minw0">
                    <Text className="t-body clamp2">{h.stem || `第 ${h.number} 题`}</Text>
                    {h.knowledge && <Text className="row__sub">{h.knowledge}</Text>}
                  </View>
                  <Count icon="person" color={C.wrong}>
                    {h.wrong}
                  </Count>
                </View>
              ))}
            </View>
          )}
          {board.missing.length > 0 && (
            <View className="group">
              <View className="group__header">
                <Text>没交 {board.missing.length}</Text>
              </View>
              {board.missing.map((m) => (
                <View key={m.userId} className="list-row">
                  <Avatar name={m.name} url={m.avatar} />
                  <Text className="row__title ellipsis flex1">{memberName(m)}</Text>
                  {m.returned ? (
                    <Tag kind="wrong" icon="refresh">
                      退回
                    </Tag>
                  ) : (
                    <Icon name={m.viewed ? "eye" : "eye-off"} size={18} color={m.viewed ? C.tertiary : C.accentOn} stroke={2.2} />
                  )}
                </View>
              ))}
            </View>
          )}
          <View className="group">
            <View className="group__header">
              <Text>已交 {board.submitted.length}</Text>
            </View>
            {board.submitted.length === 0 && <Text className="plan-empty">{board.members === 0 ? "还没有人加入" : "还没有人交"}</Text>}
            {board.submitted.map((s) => (
              <View key={s.submissionId} className="list-row" hoverClass="list-row--hover" onClick={() => Taro.navigateTo({ url: `/pages/plan-review/index?id=${s.submissionId}` })}>
                <Avatar name={s.name} url={s.avatar} />
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">
                    {memberName(s)}
                    {s.left ? "（已退出）" : ""}
                  </Text>
                  {s.score ? <ScoreCounts score={s.score} /> : <Text className="row__sub">批改中</Text>}
                </View>
                {s.late && (
                  <Tag kind="neutral" icon={null}>
                    迟交
                  </Tag>
                )}
                {s.status === "reviewed" ? (
                  <Icon name="checkcircle" size={20} color={C.ok} stroke={2.2} />
                ) : (
                  <Tag kind="info" icon="pencil">
                    待阅
                  </Tag>
                )}
                <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
              </View>
            ))}
          </View>
          <View className="plan-field__label" style={{ paddingTop: "4px" }}>
            <Text>作业内容</Text>
          </View>
        </>
      )}

      {!owner && sub && (
        <View className="card" style={{ gap: "12px" }}>
          <View className="row-center gap8">
            <Text className="t-headline flex1">我交的作业</Text>
            {sub.late && (
              <Tag kind="neutral" icon={null}>
                迟交
              </Tag>
            )}
            <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"} icon={sub.status === "reviewed" ? undefined : null}>
              {STATUS_LABEL[sub.status]}
            </Tag>
          </View>
          {sub.comment && (
            <Text className="t-sub" style={sub.status === "returned" ? { color: C.wrong } : undefined}>
              老师：{sub.comment}
            </Text>
          )}
          {sub.results && sub.score ? (
            <>
              <ScoreStats score={sub.score} />
              <QuestionGrid results={sub.results} />
              {sub.score.wrong > 0 && <Text className="t-cap c-sec">错题已进错题榜</Text>}
            </>
          ) : (
            <Text className="t-sub c-sec">{isSubmissionPending(sub.id) ? "正在批改…" : "已交，批改结果在「试卷」里"}</Text>
          )}
        </View>
      )}

      {content}

      {canSubmit && shots.length > 0 && (
        <View className="card" style={{ gap: "12px" }}>
          <Text className="t-headline">准备交 {shots.length} 页</Text>
          <View className="plan-thumbs">
            {shots.map((p, i) => (
              <View key={p} className="plan-thumb">
                <Image className="thumb" src={p} mode="aspectFill" onClick={() => Taro.previewImage({ current: p, urls: shots })} />
                <View className="plan-thumb__x" onClick={() => setShots((cur) => cur.filter((_, j) => j !== i))}>
                  <Icon name="xmark" size={11} color="#ffffff" stroke={3} />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {owner && !a.revoked && board && board.missing.length > 0 && (
        <View className="bottom-bar">
          <ShareButton icon="bell" remind style={{ flex: 1 }}>
            提醒没交的同学
          </ShareButton>
        </View>
      )}
      {!owner && (
        <View className="bottom-bar">
          {shots.length > 0 ? (
            <>
              <Button variant="outline" icon="camera" onClick={() => setScanning(true)}>
                再拍一页
              </Button>
              <Button icon="check" className="flex1" disabled={Boolean(stage)} onClick={() => void hand()}>
                交给老师
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" icon="printer" className={canSubmit ? undefined : "flex1"} onClick={() => setExporting(true)}>
                导出
              </Button>
              {canSubmit && (
                <Button icon="camera" className="flex1" onClick={() => setScanning(true)}>
                  {sub ? "重新扫描" : "扫描上传"}
                </Button>
              )}
            </>
          )}
        </View>
      )}

      <Sheet open={exporting} onClose={() => setExporting(false)} title="导出作业">
        <View className="group group--fill">
          {digitized && (
            <View className="list-row" hoverClass="list-row--hover" onClick={() => void exportPdf()}>
              <View className="row__icon" style={{ background: C.brand }}>
                <Icon name="printer" size={18} color="#ffffff" stroke={2} />
              </View>
              <View className="flex1 col gap2 minw0">
                <Text className="row__title">电子版 PDF</Text>
              </View>
            </View>
          )}
          {a.files.map((f) => (
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
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)} title={a.title}>
        <View className="plan-quiet plan-quiet--only">
          <Text className="plan-quiet__item c-wrong" onClick={() => void revoke()}>
            撤回这份作业
          </Text>
        </View>
      </Sheet>
      <ScanSheet open={scanning} title={owner ? "扫描" : "拍下做完的作业"} onClose={() => setScanning(false)} onPhotos={(p) => setShots((cur) => [...cur, ...p])} />
      {stage && <Busy text={stage} />}
    </View>
  );
}
