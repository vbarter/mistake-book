import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Mistake, PracticeSession, Subject } from "../api/types";
import { MistakeRow } from "../components/MistakeRow";
import { Button, Empty, InlineNav, Spinner, SubjectChip } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { toastError } from "../store/banner";

export default function TopicDetail() {
  const { subject = "math", topic = "" } = useParams();
  const nav = useNavigate();
  const name = decodeURIComponent(topic);
  const { data, loading } = useAsync(() => api<{ items: Mistake[]; total: number }>(`/api/mistakes?subject=${subject}&topic=${encodeURIComponent(name)}`), [subject, name]);
  const [busy, setBusy] = useState(false);

  const practice = async () => {
    setBusy(true);
    try {
      const res = await api<{ session: PracticeSession }>("/api/practice/start", { method: "POST", body: { mode: "weak", topic: name, subject, count: 3 } });
      nav(`/practice/quiz/${res.session.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const mastered = items.filter((m) => m.mastery === "mastered").length;

  return (
    <div className="screen">
      <InlineNav title={name} back backLabel="错题库" />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8 }}>
        <div className="card" style={{ gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SubjectChip subject={subject as Subject} />
            <span className="t-sub c-sec">{items.length} 题 · 已掌握 {mastered}</span>
          </div>
          <Button onClick={practice} disabled={busy || items.length === 0}>练这个知识点 · 3 题</Button>
        </div>
        {loading && !data && <Spinner />}
        {data && items.length === 0 && <Empty icon="books" title="这个知识点下没有错题了" />}
        {items.length > 0 && (
          <div className="group">
            {items.map((m) => (
              <MistakeRow key={m.id} m={m} showTopic={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
