import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./store/auth";
import { startJobPoller } from "./lib/jobs";
import { startSync } from "./lib/sync";
import { joinPath, parseJoinUrl, pendingJoin, rememberJoin, startPlanSync } from "./lib/plans";
import { isNative, isTabRoot, needsPhotoConfirm, setupBackButton, setupEdgeSwipeBack } from "./lib/native";
import { listenRestoredPhoto } from "./lib/cameraRestore";
import { addPaper, getFolder, loadPages, toPage, updatePaper } from "./lib/folders";
import { useCapture } from "./store/capture";
import { toast, toastError } from "./store/banner";
import { BannerHost, Spinner } from "./components/ui";
import { PhotoConfirmHost } from "./components/PhotoConfirm";
import { confirmPhoto } from "./store/photoConfirm";
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
import ScanCamera from "./pages/scan/ScanCamera";
import ScanArrange from "./pages/scan/ScanArrange";
import Ranking from "./pages/Ranking";
import RankDetail from "./pages/RankDetail";
import Papers from "./pages/Papers";
import FolderDetail from "./pages/FolderDetail";
import Capture from "./pages/capture/Capture";
import Paper from "./pages/capture/Paper";
import { ErasePaper } from "./pages/Erase";
import Profile from "./pages/Profile";
import { Account, Privacy, Subjects } from "./pages/ProfilePages";
import { Exports } from "./pages/Exports";
import Plans from "./pages/plans/Plans";
import PlanNew from "./pages/plans/PlanNew";
import PlanDetail from "./pages/plans/PlanDetail";
import PlanJoin from "./pages/plans/PlanJoin";
import Assignment from "./pages/plans/Assignment";
import Submission from "./pages/plans/Submission";
import HomeworkToday from "./pages/homework/Today";
import HomeworkConfirm from "./pages/homework/Confirm";
import HomeworkRemind from "./pages/homework/Remind";
import HomeworkItem from "./pages/homework/Item";
import HomeworkFocus from "./pages/homework/Focus";
import { HomeworkAlarm } from "./components/HomeworkAlarm";

function RequireAuth() {
  const { ready, token } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!token) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  return (
    <>
      <Outlet />
      <HomeworkAlarm />
    </>
  );
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

/** 唤起 App 的那条链接（getLaunchUrl）是否已经处理过 */
let launchUrlHandled = false;

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
  // 登录后和云端同步：本机改动、回前台时自动推拉（lib/sync.ts）
  useEffect(() => {
    if (!token) return;
    return startSync();
  }, [token]);
  const nav = useNavigate();
  // 学习计划：回填老师布置的扫描件电子版、学生交的作业的批改结果（lib/plans.ts）
  useEffect(() => {
    if (!token) return;
    return startPlanSync();
  }, [token]);
  // 学习计划：点开微信里的卡片（shangyike://plans/join?code=…）唤起 App 后自动加入；还没登录就先记下，登录 / 注册完再加入。
  // useNavigate 返回的函数每换一个页面就是新的，这里不能依赖它：否则每次跳转都会重新读一遍「启动链接」，
  // 加入成功跳走后又被带回加入页，来回循环（iOS 上最后报 history.replaceState 超过 100 次）。
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    if (!ready) return;
    const go = (url: string | undefined | null) => {
      const target = url ? parseJoinUrl(url) : null;
      if (!target) return;
      rememberJoin(target);
      if (useAuth.getState().token) navRef.current(joinPath(target));
    };
    // 网页：没登录时直接打开了加入链接，会被带去欢迎页，先把邀请码记下
    if (!useAuth.getState().token && window.location.pathname.endsWith("/plans/join")) go(window.location.href);
    if (!isNative) return;
    let remove: (() => void) | undefined;
    let active = true;
    void import("@capacitor/app").then(async ({ App: CapApp }) => {
      const handle = await CapApp.addListener("appUrlOpen", ({ url }) => go(url));
      if (active) remove = () => void handle.remove();
      else void handle.remove();
      // 启动链接在 App 这次运行期间一直不变，只处理一次
      if (!launchUrlHandled) {
        launchUrlHandled = true;
        go((await CapApp.getLaunchUrl())?.url);
      }
    });
    return () => {
      active = false;
      remove?.();
    };
  }, [ready]);
  useEffect(() => {
    if (!token || startup) return;
    const target = pendingJoin();
    if (target) navRef.current(joinPath(target), { replace: true });
  }, [token, startup]);
  // 安卓：拍照时 App 被系统回收，重启后把那张照片放回原来的试卷，打开录入页接着扫
  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | undefined;
    let active = true;
    void listenRestoredPhoto(async ({ dataUrl, target }) => {
      try {
        const folder = target?.folderId ? await getFolder(target.folderId) : undefined;
        const paper = target?.paperId ? folder?.papers.find((p) => p.id === target.paperId) : undefined;
        // 找回的照片也先全屏确认：下滑不要这张，回到录入页直接再起相机重拍
        const confirmed = needsPhotoConfirm ? await confirmPhoto(dataUrl) : dataUrl;
        if (!confirmed) {
          const capture = useCapture.getState();
          capture.reset();
          capture.setReturnTo(folder ? `/papers/${folder.id}` : "/home");
          nav("/capture", { state: { folderId: folder?.id ?? null, paperId: paper?.id ?? null, source: "camera" } });
          return;
        }
        const page = await toPage(confirmed);
        let folderId: string | null = null;
        let paperId: string | null = null;
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
      <PhotoConfirmHost />
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
          <Route path="/papers/:folderId/:paperId/erase" element={<ErasePaper />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/scan" element={<ScanCamera />} />
          <Route path="/scan/arrange" element={<ScanArrange />} />
          <Route path="/import" element={<Navigate to="/scan/arrange" replace />} />
          <Route path="/rank/q/:index" element={<RankDetail />} />
          <Route path="/profile/subjects" element={<Subjects />} />
          <Route path="/profile/account" element={<Account />} />
          <Route path="/profile/privacy" element={<Privacy />} />
          <Route path="/profile/exports" element={<Exports />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/new" element={<PlanNew />} />
          <Route path="/plans/join" element={<PlanJoin />} />
          <Route path="/plans/a/:assignmentId" element={<Assignment />} />
          <Route path="/plans/s/:submissionId" element={<Submission />} />
          <Route path="/plans/:planId" element={<PlanDetail />} />
          <Route path="/plans/:planId/new" element={<PlanNew />} />
          <Route path="/homework" element={<HomeworkToday />} />
          <Route path="/homework/confirm" element={<HomeworkConfirm />} />
          <Route path="/homework/remind" element={<HomeworkRemind />} />
          <Route path="/homework/focus/:id" element={<HomeworkFocus />} />
          <Route path="/homework/:id" element={<HomeworkItem />} />
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
