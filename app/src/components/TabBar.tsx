import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

const tabs: { to: string; label: string; icon: IconName }[] = [
  { to: "/home", label: "首页", icon: "house" },
  { to: "/papers", label: "试卷", icon: "folder" },
  { to: "/library", label: "分析", icon: "chart" },
  { to: "/profile", label: "我的", icon: "person" },
];

export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="主导航">
      {tabs.map((t) => {
        const on = pathname === t.to || pathname.startsWith(t.to + "/");
        return (
          <NavLink
            key={t.to}
            to={t.to}
            className={`tab${on ? " on" : ""}`}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              if (on && pathname === t.to) {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          >
            <Icon name={t.icon} size={26} fill={on} stroke={1.8} />
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
