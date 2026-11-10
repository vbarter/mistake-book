import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { PrintSheets } from "../../components/PrintSheets";
import { Busy, LoginGate, MenuRow, PageState, QuestionGrid, ScanSheet, ShareButton, confirm, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { Button, Segmented, Sheet, Tag } from "../../components/ui";
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

  const load = async () => {
    if (!loggedIn()) return;
    try {
      const r = await fetchAssignment(id);
      setData(r);
      setError("");
      void Taro.setNavigationBarTitle({ title: r.plan.role === "owner" ? "作业情况" : "作业" });
    } catch (e) {
      if (!data) setError(errorText(e) || "打不开");
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
  const canSubmit = !owner && !a.revoked && (!sub || sub.status !== "reviewed");

  const hand = async () => {
    try {
      await submitHomework(a, shots, setStage);
      setShots([]);
      void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
      toast("交上去了，批改好会显示在这里");
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
      toast(job ? (job.status === "done" ? "已生成，在「我的 › 我的导出」里" : "正在后台生成，好了会提醒你") : "服务器暂时不支持导出");
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

  const content = (
    <>
      <View className="card" style={{ gap: "6px" }}>
        <View className="row-center gap8">
          <Text className="t-title3 flex1" style={{ fontWeight: 800 }}>
            {a.title}
          </Text>
          {owner && !a.revoked && <ShareButton pill>转发</ShareButton>}
          {owner && !a.revoked && (
            <View className="plan-file__x" onClick={() => setMenu(true)}>
              <Icon name="ellipsis" size={24} color={C.brand} stroke={2} />
            </View>
          )}
        </View>
        <Text className="t-foot c-sec">
          {plan.name}
          {owner ? "" : ` · ${plan.teacher}`}
          {a.dueAt ? ` · ${isOverdue(a.dueAt) ? "已截止 " : "截止 "}${dueLabel(a.dueAt)}` : ""}
          {a.questionCount ? ` · ${a.questionCount} 题` : ""}
        </Text>
        {a.revoked && (
          <Tag kind="neutral" icon={null} style={{ alignSelf: "flex-start" }}>
            老师已撤回
          </Tag>
        )}
      </View>
      {attachments.length > 0 && (
        <View className="group">
          <View className="group__header">
            <Text>附件</Text>
            <Text>点开后右上角可以转发、打印</Text>
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
              <Text className="t-foot c-sec">正在识别成电子版，同学现在已经可以看照片</Text>
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
            <View className="stat">
              <Text className="stat__label">已交</Text>
              <Text className="stat__value num" style={{ color: C.ok }}>
                {board.submitted.length}
                <Text className="t-foot c-sec" style={{ fontWeight: 500 }}>
                  {" "}
                  /{board.members}
                </Text>
              </Text>
            </View>
            <View className="stat">
              <Text className="stat__label">没交</Text>
              <Text className="stat__value num" style={board.missing.length ? { color: C.accentOn } : undefined}>
                {board.missing.length}
              </Text>
            </View>
            <View className="stat">
              <Text className="stat__label">还没看</Text>
              <Text className="stat__value num">{board.unseen}</Text>
            </View>
          </View>
          {board.hardest.length > 0 && (
            <View className="group">
              <View className="group__header">
                <Text>错得最多的题</Text>
                <Text>已批改 {board.hardest[0].graded} 份</Text>
              </View>
              {board.hardest.map((h) => (
                <View key={h.number} className="list-row" style={{ alignItems: "flex-start" }}>
                  <View className="plan-q plan-q--wrong">
                    <Text>{h.number}</Text>
                  </View>
                  <View className="flex1 col gap2 minw0">
                    <Text className="t-body clamp2">{h.stem || "（没有识别出题干）"}</Text>
                    {h.knowledge && <Text className="row__sub">{h.knowledge}</Text>}
                  </View>
                  <Text className="t-headline c-wrong shrink0">{h.wrong} 人错</Text>
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
                  <View className="plan-avatar">
                    <Text>{m.name.slice(-1)}</Text>
                  </View>
                  <Text className="row__title ellipsis flex1">{memberName(m)}</Text>
                  {m.returned ? (
                    <Tag kind="wrong" icon={null}>
                      已退回重做
                    </Tag>
                  ) : m.viewed ? (
                    <Tag kind="neutral" icon={null}>
                      看过
                    </Tag>
                  ) : (
                    <Tag kind="pending" icon={null}>
                      没看
                    </Tag>
                  )}
                </View>
              ))}
            </View>
          )}
          <View className="group">
            <View className="group__header">
              <Text>已交 {board.submitted.length}</Text>
            </View>
            {board.submitted.length === 0 && <Text className="plan-empty">{board.members === 0 ? "还没有人加入。点下面作业名旁边的「转发」发到微信群。" : "还没有人交。"}</Text>}
            {board.submitted.map((s) => (
              <View key={s.submissionId} className="list-row" hoverClass="list-row--hover" onClick={() => Taro.navigateTo({ url: `/pages/plan-review/index?id=${s.submissionId}` })}>
                <View className="plan-avatar">
                  <Text>{s.name.slice(-1)}</Text>
                </View>
                <View className="flex1 col gap2 minw0">
                  <Text className="row__title ellipsis">
                    {memberName(s)}
                    {s.left ? "（已退出）" : ""}
                  </Text>
                  <Text className="row__sub">
                    {s.score ? `对 ${s.score.correct} · 错 ${s.score.wrong} · 没做 ${s.score.blank}` : "批改中"}
                    {s.late ? " · 迟交" : ""}
                  </Text>
                </View>
                {s.status === "reviewed" ? (
                  <Tag kind="correct">已阅</Tag>
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
              <View className="stats">
                <View className="stat stat--ok">
                  <Text className="stat__label">对</Text>
                  <Text className="stat__value num c-ok">{sub.score.correct}</Text>
                </View>
                <View className="stat stat--wrong">
                  <Text className="stat__label">错</Text>
                  <Text className="stat__value num c-wrong">{sub.score.wrong}</Text>
                </View>
                <View className="stat stat--mute">
                  <Text className="stat__label">没做</Text>
                  <Text className="stat__value num">{sub.score.blank}</Text>
                </View>
              </View>
              <QuestionGrid results={sub.results} />
              <Text className="t-cap c-sec">错题已经自动进了你的错题榜，交的这份也存在「试卷」里。</Text>
            </>
          ) : (
            <Text className="t-sub c-sec">{isSubmissionPending(sub.id) ? "正在批改，好了会显示在这里。可以先离开。" : "已经交给老师了。批改结果在「试卷」里这份作业上，打开小程序时会自动补交给老师。"}</Text>
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
                  {sub ? "重新扫描上传" : "扫描上传"}
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
                <Text className="row__sub">排好版的原题，方便打印</Text>
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
                <Text className="row__sub">原件 · {sizeLabel(f.size)} · {f.mime.startsWith("image/") ? "长按图片保存" : "打开后右上角转发或打印"}</Text>
              </View>
            </View>
          ))}
        </View>
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)} title={a.title}>
        <View className="group group--fill">
          <MenuRow title="撤回这份作业" sub="没交的同学不会再看到；交过的同学还能看到自己那份" danger onClick={() => void revoke()} />
        </View>
      </Sheet>
      <ScanSheet open={scanning} title={owner ? "扫描" : "拍下做完的作业"} onClose={() => setScanning(false)} onPhotos={(p) => setShots((cur) => [...cur, ...p])} />
      {stage && <Busy text={stage} />}
    </View>
  );
}
