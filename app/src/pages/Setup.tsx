import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Subject, User } from "../api/types";
import { Button, InlineNav } from "../components/ui";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../lib/format";
import { useAuth } from "../store/auth";
import { toastError } from "../store/banner";

export default function Setup() {
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [nickname, setNickname] = useState("");
  const [grade, setGrade] = useState("5");
  const [subjects, setSubjects] = useState<Subject[]>([...SUBJECTS]);
  const [busy, setBusy] = useState(false);

  const toggle = (s: Subject) => {
    setSubjects((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]));
  };

  const start = async () => {
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/guest", {
        method: "POST",
        auth: false,
        body: { profile: { nickname: nickname || "小同学", grade, subjects } },
      });
      await setSession(res.token, res.user);
      nav("/papers", { replace: true });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--card screen--narrow">
      <InlineNav title="告诉我一点点" back />
      <div className="screen__content screen__content--modal" style={{ gap: 24, paddingTop: 12 }}>
        <p className="t-sub c-sec">只用来选年级知识点和安排学科，不收集学校和姓名。</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="t-headline">怎么称呼你</span>
          <input className="input" placeholder="小同学" value={nickname} maxLength={16} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="t-headline">年级</span>
          <div className="seg" role="radiogroup">
            {Object.entries(GRADE_LABEL).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={grade === k} className={`seg__item${grade === k ? " on" : ""}`} onClick={() => setGrade(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="t-headline">要整理的学科</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SUBJECTS.map((s) => (
              <button key={s} className={`chip chip--select${subjects.includes(s) ? " on" : ""}`} aria-pressed={subjects.includes(s)} onClick={() => toggle(s)}>
                {SUBJECT_LABEL[s]}
              </button>
            ))}
          </div>
          <span className="t-foot c-sec">之后可以在「我的」里修改。</span>
        </div>
        <div style={{ marginTop: "auto" }}>
          <Button onClick={start} disabled={busy}>
            {busy ? "准备中…" : "开始录第一道题"}
          </Button>
        </div>
      </div>
    </div>
  );
}
