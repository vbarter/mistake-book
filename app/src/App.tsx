import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import { BannerHost, Spinner } from "./components/ui";
import { TabBar } from "./components/TabBar";

import Welcome from "./pages/Welcome";
import Setup from "./pages/Setup";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Library from "./pages/Library";
import Papers from "./pages/Papers";
import TopicDetail from "./pages/TopicDetail";
import Detail from "./pages/Detail";
import Capture from "./pages/capture/Capture";
import Crop from "./pages/capture/Crop";
import Recognize from "./pages/capture/Recognize";
import Paper from "./pages/capture/Paper";
import Review from "./pages/Review";
import Practice from "./pages/Practice";
import Quiz from "./pages/Quiz";
import QuizResult from "./pages/QuizResult";
import Profile from "./pages/Profile";
import { Account, Goal, Parent, Privacy, Reminder, SubjectStats, Subjects } from "./pages/ProfilePages";

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
        <Route path="/" element={<Navigate to={token ? "/today" : "/welcome"} replace />} />
        <Route path="/welcome" element={token ? <Navigate to="/today" replace /> : <Welcome />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />

        <Route element={<RequireAuth />}>
          <Route element={<TabLayout />}>
            <Route path="/today" element={<Today />} />
            <Route path="/papers" element={<Papers />} />
            <Route path="/library" element={<Library />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="/library/topic/:subject/:topic" element={<TopicDetail />} />
          <Route path="/mistake/:id" element={<Detail />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/capture/crop" element={<Crop />} />
          <Route path="/capture/paper" element={<Paper />} />
          <Route path="/capture/review" element={<Recognize />} />
          <Route path="/review" element={<Review />} />
          <Route path="/practice/quiz/:sid" element={<Quiz />} />
          <Route path="/practice/result/:sid" element={<QuizResult />} />
          <Route path="/profile/subjects" element={<Subjects />} />
          <Route path="/profile/stats" element={<SubjectStats />} />
          <Route path="/profile/goal" element={<Goal />} />
          <Route path="/profile/reminder" element={<Reminder />} />
          <Route path="/profile/parent" element={<Parent />} />
          <Route path="/profile/account" element={<Account />} />
          <Route path="/profile/privacy" element={<Privacy />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
