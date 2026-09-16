import React, { useState, lazy, Suspense } from 'react';
import 'cropperjs/dist/cropper.css';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { AppProvider } from './context/AppContext';
import { useApp } from './context/useApp';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import { ModalUmum, ModalRadar, ModalCropPhoto, ModalEditUser, PrintDocument } from './components/Modals';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Supervisors = lazy(() => import('./pages/Supervisors'));
const Logs = lazy(() => import('./pages/Logs'));
const Users = lazy(() => import('./pages/Users'));
const BleTagManager = lazy(() => import('./pages/BleTagManager'));

/* ------------------------------------------------------------------ */
/*  Login Form                                                         */
/* ------------------------------------------------------------------ */
function LoginForm() {
  const { handleLogin } = useAuth();
  const [formData, setFormData] = useState({ sid: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setLoginError('');
    setIsLoading(true);
    try {
      await handleLogin(formData.sid.trim(), formData.password, (msg, type) => {
        if (type === 'fail') setLoginError(msg);
        if (type === 'ok') window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type: 'ok' } }));
      });
    } catch {
      setLoginError('Login gagal. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 25px 25px, rgba(0,0,0,0.03) 2%, transparent 0%)', backgroundSize: '50px 50px' }} />
      </div>

      {/* Floating Elements */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-red-100/40 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-red-100/30 rounded-full blur-3xl animate-pulse" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-red-500 to-red-700 rounded-2xl shadow-lg shadow-red-500/30 mb-4 transform hover:scale-105 transition-transform">
            <i className="fa-solid fa-shield-halved text-white text-3xl"></i>
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">E-LOTO</h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Industrial IoT Safety System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border-2 border-red-200">
          <div className="text-center mb-6 pb-4 border-b-2 border-red-100">
            <h2 className="text-xl font-bold text-slate-800">Selamat Datang</h2>
            <p className="text-slate-500 text-xs mt-1">Masuk ke sistem monitoring</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {loginError && (
              <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-700">
                {loginError}
              </p>
            )}
            <div className="space-y-1">
              <label className="block text-slate-700 text-xs font-semibold pl-1">ID Karyawan / SID</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <i className="fa-solid fa-fingerprint"></i>
                </span>
                <input
                  type="text"
                  required
                  placeholder="Masukkan ID Karyawan"
                  className="w-full bg-white border-2 border-red-200 rounded-xl pl-10 pr-4 py-3 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
                  value={formData.sid}
                  onChange={(e) => setFormData({ ...formData, sid: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-700 text-xs font-semibold pl-1">Kata Sandi</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <i className="fa-solid fa-lock"></i>
                </span>
                <input
                  type="password"
                  required
                  placeholder="Masukkan Kata Sandi"
                  className="w-full bg-white border-2 border-red-200 rounded-xl pl-10 pr-4 py-3 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-3.5 rounded-xl uppercase text-xs tracking-wider transition-all duration-200 shadow-lg shadow-red-500/30 hover:shadow-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <React.Fragment>
                  <i className="fa-solid fa-spinner fa-spin"></i> Memproses...
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <i className="fa-solid fa-right-to-bracket"></i> Masuk ke Dashboard
                </React.Fragment>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t-2 border-red-100">
            <p className="text-center text-[10px] text-slate-500">
              <i className="fa-solid fa-lock mr-1"></i> Sistem aman & terenkripsi
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-[10px] mt-6">
          © 2026 E-LOTO Platform. Sistem Penguncian & Keselamatan Kerja.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App Content (after login)                                     */
/* ------------------------------------------------------------------ */
function AppContent() {
  const { isLoggedIn, activeTab, sessionUser } = useAuth();
  const {
    toast, modalInfo, setModalInfo,
    showRadarModal, setShowRadarModal,
    radarModalSearch, setRadarModalSearch,
    radarDetailBox, setRadarDetailBox,
    cropPhotoSrc, handleConfirmProfileCrop, handleCancelProfileCrop,
    showEditUserModal, setShowEditUserModal,
    formEditUser, setFormEditUser, handleSimpanEditUser,
    hwData, handleProfilePhotoUpload, handleSelectBox,
    filteredBoxes, printActiveLog
  } = useApp();

  if (!isLoggedIn) return <LoginForm />;

  return (
    <React.Fragment>
      <div className="print-hidden h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row overflow-hidden">
        <Toast toast={toast} />
        <ModalUmum modalInfo={modalInfo} onClose={() => setModalInfo({ ...modalInfo, open: false })} />
        <ModalRadar
          show={showRadarModal}
          onClose={() => setShowRadarModal(false)}
          boxes={filteredBoxes}
          radarModalSearch={radarModalSearch}
          setRadarModalSearch={setRadarModalSearch}
          radarDetailBox={radarDetailBox}
          setRadarDetailBox={setRadarDetailBox}
          onSelectBox={handleSelectBox}
        />
        <ModalCropPhoto
          cropPhotoSrc={cropPhotoSrc}
          onConfirm={handleConfirmProfileCrop}
          onCancel={handleCancelProfileCrop}
        />
        <ModalEditUser
          show={showEditUserModal}
          onClose={() => setShowEditUserModal(false)}
          formEditUser={formEditUser}
          setFormEditUser={setFormEditUser}
          onSubmit={handleSimpanEditUser}
          hwData={hwData}
          onUploadPhoto={handleProfilePhotoUpload}
        />

        <Sidebar />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Suspense fallback={<p role="status">Memuat halaman…</p>}>
          {/* TAB: PROFIL SAYA */}
          {activeTab === 'profil-tab' && <Profile />}

          {/* TAB: TIM MEKANIK (PENGAWAS) */}
          {activeTab === 'team-tab' && sessionUser?.role === 'pengawas' && <Supervisors />}

          {/* TAB: DASHBOARD (admin / pengawas) */}
          {activeTab === 'dashboard' && (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && <Dashboard />}

          {/* TAB: FORM LAPORAN SERVIS (teknisi) */}
          {activeTab === 'teknisi-tab' && (sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && <Logs />}

          {/* TAB: RIWAYAT LAPORAN */}
          {activeTab === 'riwayat-tab' && <Logs />}

          {/* TAB: KELOLA PERSONEL (ADMIN) */}
          {activeTab === 'admin-tab' && sessionUser?.role === 'admin' && <Users />}

          {/* TAB: KELOLA BLE TAG (ADMIN / PENGAWAS) */}
          {activeTab === 'ble-tags' && (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && <BleTagManager />}
        </Suspense>
        </main>

        <PrintDocument printActiveLog={printActiveLog} />
      </div>
    </React.Fragment>
  );
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */
export default function App() {
  const isProtocolValid = window.location.protocol !== 'file:';

  if (!isProtocolValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="max-w-lg rounded-3xl bg-white p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto">
            <i className="fa-solid fa-triangle-exclamation text-amber-600 text-3xl"></i>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Web Server Diperlukan</h1>
            <p className="text-slate-500 text-sm mt-2">Aplikasi tidak dapat berjalan dengan protokol <code className="bg-slate-100 px-2 py-0.5 rounded text-red-600 font-mono text-xs">file:///</code></p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 text-sm border border-slate-200">
            <p className="text-slate-600 mb-2">Buka browser dan akses:</p>
            <p className="font-mono font-bold text-red-600">http://localhost:3000</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <SessionApp />
    </AuthProvider>
  );
}

function SessionApp() {
  const { sessionUser } = useAuth();
  return <AppProvider key={sessionUser?.sid || 'anonymous'}><AppContent /></AppProvider>;
}
