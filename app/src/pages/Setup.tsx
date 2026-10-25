import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { Button, InlineNav } from "../components/ui";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../lib/format";

export default function Setup() {
  const nav = useNavigate();
  const [nickname, setNickname] = useState("");
  const [grade, setGrade] = useState("5");
  const [subjects, setSubjects] = useState<Subject[]>([...SUBJECTS]);

  const toggle = (s: Subject) => {
    setSubjects((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]));
  };

  // 资料带到登录页：用手机号（或 iPhone 上用 Apple）注册时一起建进账号
  const next = () => nav("/login", { state: { profile: { nickname: nickname.trim() || "小同学", grade, subjects } } });

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
          <Button onClick={next}>下一步：注册账号</Button>
        </div>
      </div>
    </div>
  );
}
