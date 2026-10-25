import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import { startJobPoller } from "./lib/jobs";
import { isTabRoot, setupBackButton, setupEdgeSwipeBack } from "./lib/native";
import { BannerHost, Spinner } from "./components/ui";
import { TabBar } from "./components/TabBar";
import Startup from "./components/Startup";

const Splash = lazy(() => import("./components/Splash"));

import Welcome from "./pages/Welcome";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Login from "./pages/Login";
import Library from "./pages/Library";
import Papers from "./pages/Papers";
import FolderDetail from "./pages/FolderDetail";
import Capture from "./pages/capture/Capture";
import Paper from "./pages/capture/Paper";
import Profile from "./pages/Profile";
import { Account, Privacy, Subjects } from "./pages/ProfilePages";

function RequireAuth() {
  const { ready, token } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!token) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

function TabLayout() {
  return (
    <>
      <Outlet />
      <TabBar />
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** 边缘右滑返回（网页层兜底；iOS 原生手势先识别时这里不会触发） */
function EdgeSwipeBack() {
  const nav = useNavigate();
  useEffect(() => setupEdgeSwipeBack(() => nav(-1), () => isTabRoot(window.location.pathname) || window.history.length <= 1), [nav]);
  return null;
}

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const ready = useAuth((s) => s.ready);
  const token = useAuth((s) => s.token);
  const [startup, setStartup] = useState(true);
  const [startupError, setStartupError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const closeStartup = useCallback(() => setStartup(false), []);
  const retryStartup = useCallback(() => {
    setStartupError(false);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void bootstrap().catch(() => { if (active) setStartupError(true); });
    return () => { active = false; };
  }, [bootstrap, attempt]);
  // 登录后开始轮询服务器上的还原任务；回前台立刻问一次
  useEffect(() => {
    if (!token) return;
    return startJobPoller();
  }, [token]);
  // Android 返回键
  useEffect(() => {
    let stop: (() => void) | undefined;
    setupBackButton().then((fn) => { stop = fn; });
    return () => stop?.();
  }, []);

  if (startup) return <Startup ready={ready} error={startupError} onRetry={retryStartup} onDone={closeStartup} />;
  if (!ready) return <Spinner />;

  return (
    <>
      <ScrollToTop />
      <EdgeSwipeBack />
      <BannerHost />
      <Routes>
        <Route path="/" element={<Navigate to={token ? "/papers" : "/welcome"} replace />} />
        <Route path="/welcome" element={token ? <Navigate to="/papers" replace /> : <Welcome />} />
        <Route path="/register" element={token ? <Navigate to="/papers" replace /> : <Register />} />
        <Route path="/setup" element={<Navigate to="/register" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<Login />} />
        <Route path="/splash" element={<SplashReplay />} />

        <Route element={<RequireAuth />}>
          <Route element={<TabLayout />}>
            <Route path="/papers" element={<Papers />} />
            <Route path="/library" element={<Library />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="/today" element={<Navigate to="/papers" replace />} />
          <Route path="/papers/:folderId" element={<FolderDetail />} />
          <Route path="/papers/:folderId/:paperId" element={<Paper />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/profile/subjects" element={<Subjects />} />
          <Route path="/profile/account" element={<Account />} />
          <Route path="/profile/privacy" element={<Privacy />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/** 重播开屏动效（我的 → 关于 / 调试用），播完回上一页 */
function SplashReplay() {
  const nav = useNavigate();
  return <Suspense fallback={null}><Splash onDone={() => (window.history.length > 1 ? nav(-1) : nav("/", { replace: true }))} /></Suspense>;
}
