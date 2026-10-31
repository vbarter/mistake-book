import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { haptic } from "../lib/native";
import { useAddPaper } from "./AddSheet";
import { Icon, type IconName } from "./Icon";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/home", label: "首页", icon: "house" },
  { to: "/papers", label: "试卷", icon: "folder" },
  { to: "/library", label: "分析", icon: "chart" },
  { to: "/profile", label: "我的", icon: "person" },
];

/** 底部导航：中间是凸起的相机键。点一下弹出「拍照 / 相册导入」两个气泡（弹簧动画），再点或点空白收起。 */
export function TabBar() {
  const { pathname } = useLocation();
  const add = useAddPaper();
  const [open, setOpen] = useState(false);

  const toggle = () => {
    void haptic.light();
    setOpen((v) => !v);
  };

  const tab = (t: (typeof tabs)[number]) => {
    const on = pathname === t.to || pathname.startsWith(t.to + "/");
    return (
      <NavLink
        key={t.to}
        to={t.to}
        className={`tab${on ? " on" : ""}`}
        aria-current={on ? "page" : undefined}
        onClick={(e) => {
          setOpen(false);
          if (on && pathname === t.to) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        <span className="tab__icon"><Icon name={t.icon} size={26} fill={on} stroke={1.8} /></span>
        {t.label}
      </NavLink>
    );
  };

  return (
    <>
      {open && <div className="fab-scrim" onClick={() => setOpen(false)} />}
      <div className={`fab-menu${open ? " open" : ""}`} aria-hidden={!open}>
        <button className="fab-bubble fab-bubble--left" tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void add.camera(); }}>
          <span className="fab-bubble__icon"><Icon name="camera" size={24} stroke={2} /></span>拍照
        </button>
        <button className="fab-bubble fab-bubble--right" tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void add.photos(); }}>
          <span className="fab-bubble__icon"><Icon name="photo" size={24} stroke={2} /></span>相册导入
        </button>
      </div>
      <nav className="tabbar tabbar--fab" aria-label="主导航">
        {tabs.slice(0, 2).map(tab)}
        <span className="tab tab--fab">
          <button className={`fab${open ? " open" : ""}`} onClick={toggle} aria-label={open ? "收起" : "添加试卷"} aria-expanded={open}>
            <span className="fab__ring" />
            <Icon name={open ? "plus" : "camera"} size={28} stroke={2.2} />
          </button>
        </span>
        {tabs.slice(2).map(tab)}
      </nav>
      {add.sheet}
    </>
  );
}
