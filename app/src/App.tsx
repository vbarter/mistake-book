import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import { startJobPoller } from "./lib/jobs";
import { isTabRoot, setupBackButton, setupEdgeSwipeBack } from "./lib/native";
import { listenRestoredPhoto } from "./lib/cameraRestore";
import { addPaper, getFolder, loadPages, toPage, updatePaper } from "./lib/folders";
import { useCapture } from "./store/capture";
import { toast, toastError } from "./store/banner";
import { BannerHost, Spinner } from "./components/ui";
import { TabBar } from "./components/TabBar";
import Startup from "./components/Startup";
import { hasConsented, PrivacyConsent } from "./components/PrivacyConsent";
import { LegalPage } from "./pages/Legal";

const Splash = lazy(() => import("./components/Splash"));

import Welcome from "./pages/Welcome";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Import from "./pages/Import";
import Ranking from "./pages/Ranking";
import RankDetail from "./pages/RankDetail";
import Papers from "./pages/Papers";
import FolderDetail from "./pages/FolderDetail";
import Capture from "./pages/capture/Capture";
import Paper from "./pages/capture/Paper";
import Profile from "./pages/Profile";
import { Account, Privacy, Subjects } from "./pages/ProfilePages";
import { Exports } from "./pages/Exports";

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
  // 隐私政策：同意之前不联网、不读登录态（null = 还在读本地记录）
  const [consented, setConsented] = useState<boolean | null>(null);
  useEffect(() => { void hasConsented().then(setConsented); }, []);
  const closeStartup = useCallback(() => setStartup(false), []);
  const retryStartup = useCallback(() => {
    setStartupError(false);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!consented) return;
    let active = true;
    void bootstrap().catch(() => { if (active) setStartupError(true); });
    return () => { active = false; };
  }, [bootstrap, attempt, consented]);
  // 登录后开始轮询服务器上的还原任务；回前台立刻问一次
  useEffect(() => {
    if (!token) return;
    return startJobPoller();
  }, [token]);
  // 安卓：拍照时 App 被系统回收，重启后把那张照片放回原来的试卷，打开录入页接着扫
  const nav = useNavigate();
  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | undefined;
    let active = true;
    void listenRestoredPhoto(async ({ dataUrl, target }) => {
      try {
        const page = await toPage(dataUrl);
        let folderId: string | null = null;
        let paperId: string | null = null;
        const folder = target?.folderId ? await getFolder(target.folderId) : undefined;
        const paper = target?.paperId ? folder?.papers.find((p) => p.id === target.paperId) : undefined;
        if (folder && paper) {
          const pages = [...(await loadPages(paper)), page];
          await updatePaper(folder.id, paper.id, { pages, digitized: undefined, scannedAt: undefined, corrected: {} });
          folderId = folder.id;
          paperId = paper.id;
        } else {
          const added = await addPaper(folder?.id ?? null, [page]);
          folderId = added.folder.id;
          paperId = added.paper.id;
        }
        const capture = useCapture.getState();
        capture.reset();
        capture.setReturnTo(`/papers/${folderId}`);
        nav("/capture", { state: { folderId, paperId } });
        toast("刚才拍的照片已经找回来了", "success");
      } catch (e) {
        toastError(e);
      }
    }).then((fn) => {
      if (active) stop = fn;
      else fn();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [token, nav]);
  // Android 返回键
  useEffect(() => {
    let stop: (() => void) | undefined;
    setupBackButton().then((fn) => { stop = fn; });
    return () => stop?.();
  }, []);

  if (startup) {
    return (
      <>
        <Startup ready={ready} error={startupError} onRetry={retryStartup} onDone={closeStartup} />
        {consented === false && <PrivacyConsent onAgree={() => setConsented(true)} />}
      </>
    );
  }
  if (!ready) return <Spinner />;

  return (
    <>
      <ScrollToTop />
      <EdgeSwipeBack />
      <BannerHost />
      <Routes>
        <Route path="/" element={<Navigate to={token ? "/home" : "/welcome"} replace />} />
        <Route path="/welcome" element={token ? <Navigate to="/home" replace /> : <Welcome />} />
        <Route path="/register" element={token ? <Navigate to="/home" replace /> : <Register />} />
        <Route path="/setup" element={<Navigate to="/register" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<Login />} />
        <Route path="/splash" element={<SplashReplay />} />
        <Route path="/legal/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/legal/terms" element={<LegalPage kind="terms" />} />

        <Route element={<RequireAuth />}>
          <Route element={<TabLayout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/papers" element={<Papers />} />
            <Route path="/rank" element={<Ranking />} />
            <Route path="/library" element={<Navigate to="/rank" replace />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="/today" element={<Navigate to="/home" replace />} />
          <Route path="/papers/:folderId" element={<FolderDetail />} />
          <Route path="/papers/:folderId/:paperId" element={<Paper />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/import" element={<Import />} />
          <Route path="/rank/q/:index" element={<RankDetail />} />
          <Route path="/profile/subjects" element={<Subjects />} />
          <Route path="/profile/account" element={<Account />} />
          <Route path="/profile/privacy" element={<Privacy />} />
          <Route path="/profile/exports" element={<Exports />} />
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
