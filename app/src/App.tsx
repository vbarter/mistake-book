import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import { BannerHost, Spinner } from "./components/ui";
import { TabBar } from "./components/TabBar";

import Welcome from "./pages/Welcome";
import Setup from "./pages/Setup";
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

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const ready = useAuth((s) => s.ready);
  const token = useAuth((s) => s.token);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!ready) return <Spinner />;

  return (
    <>
      <ScrollToTop />
      <BannerHost />
      <Routes>
        <Route path="/" element={<Navigate to={token ? "/papers" : "/welcome"} replace />} />
        <Route path="/welcome" element={token ? <Navigate to="/papers" replace /> : <Welcome />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />

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
