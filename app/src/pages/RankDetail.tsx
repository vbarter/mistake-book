import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorCard } from "../components/ErrorCard";
import { Icon } from "../components/Icon";
import { Empty, InlineNav } from "../components/ui";
import { allErrors, type ErrorItem } from "../lib/errors";
import { listFolders } from "../lib/folders";
import { haptic } from "../lib/native";
import { useRankView } from "../store/rankView";

/**
 * 错题详情：从错题榜点进来，整张榜的题按名次排成一行，左右滑一张一张看（scroll-snap，手感和系统相册一样）。
 * 每张顶部是名次、易错指数、所属知识点，下面是原题、作答、正确答案和解析。
 */
export default function RankDetail() {
  const nav = useNavigate();
  const { index = "0" } = useParams();
  const { title, entries } = useRankView();
  const [items, setItems] = useState<Map<string, ErrorItem> | null>(null);
  const [current, setCurrent] = useState(Number(index) || 0);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listFolders().then((fs) => setItems(new Map(allErrors(fs).map((e) => [e.key, e])))).catch(() => setItems(new Map()));
  }, []);

  const slides = useMemo(() => (items ? entries.map((en) => ({ en, item: items.get(en.key) })).filter((s): s is { en: typeof s.en; item: ErrorItem } => Boolean(s.item)) : []), [items, entries]);

  // 进来时直接停在点的那一张，不要从第一张滑过去
  useEffect(() => {
    const el = track.current;
    if (el && slides.length) el.scrollTo({ left: el.clientWidth * current, behavior: "instant" as ScrollBehavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== current) {
      setCurrent(i);
      void haptic.light();
    }
  };

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" });
  };

  if (items && slides.length === 0) return <Empty icon="seal" title="这道题找不到了" action={<button className="nav-btn" onClick={() => nav("/library", { replace: true })}>回到错题榜</button>} />;

  return (
    <div className="screen detail-screen">
      <InlineNav title={title || "错题详情"} subtitle={slides.length ? `${current + 1} / ${slides.length}` : ""} back backLabel="错题榜" />
      <div className="detail-progress" aria-hidden="true"><span style={{ width: `${slides.length ? ((current + 1) / slides.length) * 100 : 0}%` }} /></div>
      <div className="detail-track" ref={track} onScroll={onScroll}>
        {slides.map(({ en, item }, i) => (
          <section key={item.key} className="detail-slide" aria-roledescription="slide" aria-label={`第 ${i + 1} 道，共 ${slides.length} 道`}>
            <div className={`detail-head${i === current ? " on" : ""}`}>
              <span className={`rank-badge rank-badge--${en.rank <= 3 ? en.rank : "n"}`}>{en.rank}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="t-headline ellipsis">{en.group || item.knowledge}</span>
                <span className="t-foot c-sec ellipsis">{item.folderName} · {item.paperName} · 第 {item.q.number} 题</span>
              </span>
              <span className="rank-index">易错指数 {en.score.toFixed(1)}</span>
            </div>
            <ErrorCard item={item} showSource={false} />
          </section>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="detail-nav">
          <button className="detail-nav__btn" onClick={() => go(current - 1)} disabled={current === 0} aria-label="上一道"><Icon name="chevron-left" size={22} stroke={2.4} /></button>
          <span className="detail-dots" aria-hidden="true">
            {slides.slice(0, 12).map((_, i) => <span key={i} className={i === Math.min(current, 11) ? "on" : ""} />)}
          </span>
          <button className="detail-nav__btn" onClick={() => go(current + 1)} disabled={current === slides.length - 1} aria-label="下一道"><Icon name="chevron-right" size={22} stroke={2.4} /></button>
        </div>
      )}
    </div>
  );
}
