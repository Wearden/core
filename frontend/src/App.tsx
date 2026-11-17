import { ReactNode } from "react";
import { getPrefs } from "./prefs";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Assets from "./pages/Assets";
import Audit from "./pages/Audit";
import Sessions from "./pages/Sessions";
import Benchmarks from "./pages/Benchmarks";
import Scans from "./pages/Scans";
import ScanDetail from "./pages/ScanDetail";
import Hardening from "./pages/Hardening";
import HardeningRun from "./pages/HardeningRun";
import Rollback from "./pages/Rollback";
import PamAssets from "./pages/PamAssets";
import PamScans from "./pages/PamScans";
import PamHardening from "./pages/PamHardening";
import Reports from "./pages/Reports";
import AttackMatrix from "./pages/AttackMatrix";
import { useI18n } from "./i18n";

function Spinner() {
  const { t } = useI18n();
  return <div className="flex min-h-screen items-center justify-center text-slate-400">{t("common.loading")}</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

/** The host panel on the Assets page replaced the standalone analytics page; old links keep working. */
function HostRedirect() {
  const { id } = useParams();
  return <Navigate to={`/assets?host=${encodeURIComponent(id ?? "")}`} replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user && user.must_change_password) return <Navigate to="/change-password" replace />;
  if (user) return <Navigate to={getPrefs().startPage} replace />;
  return <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePassword />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/pam/sessions" element={<Sessions />} />
            <Route path="/sessions" element={<Navigate to="/pam/sessions" replace />} />
            <Route path="/benchmarks" element={<Benchmarks />} />
            <Route path="/scans" element={<Scans />} />
            <Route path="/scans/:id" element={<ScanDetail />} />
            <Route path="/hardening" element={<Hardening />} />
            <Route path="/hardening/:id" element={<HardeningRun />} />
            <Route path="/rollback" element={<Rollback />} />
            <Route path="/pam/assets" element={<PamAssets />} />
            <Route path="/pam/scans" element={<PamScans />} />
            <Route path="/pam/scans/:id" element={<ScanDetail />} />
            <Route path="/pam/hardening" element={<PamHardening />} />
            <Route path="/pam/hardening/:id" element={<HardeningRun />} />
            <Route path="/pam/rollback" element={<Rollback pam />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/attack" element={<AttackMatrix />} />
            <Route path="/hosts/:id" element={<HostRedirect />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
