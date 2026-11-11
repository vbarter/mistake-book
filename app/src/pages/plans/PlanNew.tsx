import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon, WechatIcon } from "../../components/Icon";
import { Button, InlineNav } from "../../components/ui";
import { SUBJECTS } from "../../lib/format";
import { PLAN_SUBJECT_LABEL, attachmentDraft, fetchPlan, publishAssignment, scanDraft, shareInvite, sizeLabel, type DraftFile, type PlanInfo, type PlanSubject } from "../../lib/plans";
import { haptic, isAndroid } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { Busy, useScanPick } from "./shared";

const MAX_FILES = 30;
/**
 * 「上传文件」只选 PDF、Word：图片和拍照都归「扫描」，两个按钮不重复。
 * 类型里只要带图片，iOS 就会先弹「照片图库 / 拍照 / 选取文件」三选一；只写文档类型才直接打开「文件」。
 * 安卓不限类型：带上类型时系统按第一个类型（PDF）起文件选择器，不少国产手机的选择器不认后面的类型，Word 点不了。选完再在 attachmentDraft 里按扩展名把关。
 */
const ATTACH_ACCEPT = isAndroid ? undefined : ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const fileBadge = (f: DraftFile) => (f.mime === "application/pdf" ? "PDF" : f.mime.includes("word") ? "DOC" : "图片");

/**
 * 新建学习计划（同时布置第一份作业），以及在已有计划里布置新作业，是同一个页面：
 * 名称、学科、作业内容（不设截止时间）（文件列表自己滚动，下面固定「扫描」「上传文件」两个按钮），确定后直接拉起转发。
 */
export default function PlanNew() {
  const nav = useNavigate();
  const { planId } = useParams();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<PlanSubject | null>(null);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (planId) fetchPlan(planId).then((r) => setPlan(r.plan)).catch(toastError);
  }, [planId]);

  const add = (more: DraftFile[]) => {
    setFiles((cur) => {
      const room = MAX_FILES - cur.length;
      if (more.length > room) toast(`一份作业最多 ${MAX_FILES} 个文件`);
      return [...cur, ...more.slice(0, Math.max(0, room))];
    });
    // 新加的在最下面，滚过去让人看到
    setTimeout(() => list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }), 50);
  };
  const scan = useScanPick((pages) => add(pages.map((p, i) => scanDraft(p, files.filter((f) => f.kind === "scan").length + i))));

  const onAttach = (picked: FileList | null) => {
    const ok: DraftFile[] = [];
    for (const file of Array.from(picked ?? [])) {
      const d = attachmentDraft(file);
      if (typeof d === "string") toast(d, "error");
      else ok.push(d);
    }
    if (ok.length) add(ok);
    if (input.current) input.current.value = "";
  };

  const submit = async () => {
    if (!planId && !name.trim()) return toast("给学习计划起个名字");
    if (!planId && !subject) return toast("选一个学科");
    // 新建计划可以先不放作业：建好就转发让大家加入，之后再布置；在已有计划里布置就必须有内容
    if (planId && !files.length) return toast("先扫描或上传一个文件");
    try {
      const res = await publishAssignment(planId ?? null, planId ? { dueAt: null, title: title.trim() } : { name: name.trim(), subject: subject!, dueAt: null, title: title.trim() }, files, setStage);
      setStage(null);
      void haptic.success();
      // 直接转发到微信；取消了也没关系，作业页右上角还能再转发
      const a = res.assignment;
      const shared = await shareInvite({ plan: res.plan, title: a?.title, invite: res.invite, assignmentId: a?.id }).catch(() => false);
      const what = a ? "已布置" : "已创建";
      toast(shared ? what : `${what}，可以在${a ? "作业页" : "计划页"}再转发`, "success");
      nav(a ? `/plans/a/${a.id}` : `/plans/${res.plan.id}`, { replace: true });
    } catch (e) {
      setStage(null);
      toastError(e);
    }
  };

  return (
    <div className="screen">
      <InlineNav title={planId ? "布置新作业" : "新建学习计划"} subtitle={planId ? plan?.name : undefined} back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 16 }}>
        {!planId && (
          <label className="plan-field">
            <span className="plan-field__label">计划名称</span>
            <input className="input input--card" value={name} maxLength={60} placeholder="例如：五（2）班数学" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {planId && (
          <label className="plan-field">
            <span className="plan-field__label"><span>作业名称</span><span style={{ fontWeight: 400 }}>选填</span></span>
            <input className="input input--card" value={title} maxLength={120} placeholder="例如：第三单元练习" onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        {!planId && (
          <div className="plan-field">
            <span className="plan-field__label">学科</span>
            <div className="plan-subjects">
              {([...SUBJECTS, "mixed"] as PlanSubject[]).map((s) => (
                <button key={s} className={`chip chip--select${subject === s ? " on" : ""}`} style={subject === s ? undefined : { background: "var(--card)" }} onClick={() => setSubject(s)} aria-pressed={subject === s}>{PLAN_SUBJECT_LABEL[s]}</button>
              ))}
            </div>
          </div>
        )}

        <div className="plan-field">
          <span className="plan-field__label"><span>作业内容</span>{!planId && files.length === 0 && <span style={{ fontWeight: 400 }}>选填</span>}{files.length > 0 && <span style={{ fontWeight: 400 }}>{files.length}</span>}</span>
          <div className="plan-files" ref={list}>
            {files.length === 0 && <div className="plan-files__empty"><Icon name="document" size={32} stroke={1.6} style={{ color: "var(--tertiary)" }} /></div>}
            {files.map((f) => (
              <div key={f.clientId} className="plan-file">
                {f.thumb ? <img className="plan-file__icon" src={f.thumb} alt="" /> : <span className="plan-file__icon">{fileBadge(f)}</span>}
                <span className="plan-file__main">
                  <span className="t-body ellipsis" style={{ fontWeight: 500 }}>{f.name}</span>
                  <span className="t-cap c-sec">{sizeLabel(f.size)}</span>
                </span>
                <button className="plan-file__x" aria-label={`删除 ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.clientId !== f.clientId))}><Icon name="xmark" size={16} stroke={2.4} /></button>
              </div>
            ))}
          </div>
          <div className="plan-add">
            <Button variant="outline" icon="camera" onClick={scan.open}>扫描</Button>
            <Button variant="outline" icon="document" onClick={() => input.current?.click()}>上传文件</Button>
          </div>
          <input ref={input} type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={(e) => onAttach(e.target.files)} />
        </div>

        <div className="bottom-bar" style={{ marginTop: "auto" }}>
          <Button onClick={submit} disabled={Boolean(stage)}><WechatIcon size={22} color="#fff" />确定，转发到微信</Button>
        </div>
      </div>
      {scan.sheet}
      {stage && <Busy text={stage} />}
    </div>
  );
}
