import React, { useState, useEffect } from 'react';
import 'cropperjs/dist/cropper.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import { ModalUmum, ModalRadar, ModalCropPhoto, ModalEditUser, PrintDocument } from './components/Modals';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Supervisors from './pages/Supervisors';
import Logs from './pages/Logs';
import Users from './pages/Users';

/* ------------------------------------------------------------------ */
/*  Login Form                                                         */
/* ------------------------------------------------------------------ */
function LoginForm() {
  const { handleLogin } = useAuth();
  const [formData, setFormData] = useState({ sid: '', password: '' });

  const onSubmit = (e) => {
    e.preventDefault();
    handleLogin(formData.sid.trim(), formData.password, (msg, type) => {
      window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
    });
  };

  return (
    <div className="bg-white min-h-screen flex items-center justify-center p-4 relative">
      <div className="bg-red-50 border border-red-200 w-full max-w-md rounded-2xl p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <i className="fa-solid fa-radio text-red-600 text-4xl animate-pulse"></i>
          <h1 className="text-2xl font-black tracking-wider text-red-600 font-mono-tech">E-LOTO PLATFORM</h1>
          <p className="text-[10px] text-slate-500 tracking-widest uppercase font-bold font-mono-tech">Sistem Penguncian & Keselamatan Kerja</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-800 font-bold mb-1">ID Karyawan / SID</label>
            <input type="text" required placeholder="Masukkan ID Karyawan Anda" className="w-full bg-gray-100 border border-red-200 rounded-lg p-3 text-slate-950 font-mono focus:outline-none" value={formData.sid} onChange={(e) => setFormData({ ...formData, sid: e.target.value })} />
          </div>
          <div>
            <label className="block text-slate-800 font-bold mb-1">Kata Sandi</label>
            <input type="password" required placeholder="Masukkan Kata Sandi" className="w-full bg-gray-100 border border-red-200 rounded-lg p-3 text-slate-950 focus:outline-none" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
          </div>
          <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-black p-3.5 rounded-xl uppercase text-xs tracking-wider font-mono-tech transition-colors">Masuk ke Dashboard</button>
        </form>
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
      <div className="print-hidden min-h-screen text-slate-900 flex flex-col md:flex-row w-full relative">
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

        <main className="flex-1 p-4 sm:p-8 overflow-y-auto w-full space-y-6">
          {/* TAB: PROFIL SAYA */}
          {activeTab === 'profil-tab' && sessionUser?.role !== 'admin' && <Profile />}

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
  const [isProtocolValid, setIsProtocolValid] = useState(true);

  useEffect(() => {
    if (window.location.protocol === 'file:') setIsProtocolValid(false);
    else setIsProtocolValid(true);
  }, []);

  if (!isProtocolValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-xl rounded-3xl bg-white p-8 shadow-2xl border border-slate-200 text-slate-900">
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold">Jalankan Lewat Web Server (HTTP/HTTPS)</h1>
            <p className="text-slate-600">Aplikasi tidak dapat memanggil API jika dibuka langsung dengan protokol <code>file:///</code>.</p>
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-slate-800 font-mono-tech text-sm border border-slate-200">
            <p>Buka peramban dan akses melalui URL lokal:</p>
            <p className="mt-3 font-bold text-red-600">http://localhost/ELOTO-v1/</p>
            <p>atau</p>
            <p className="font-bold text-red-600">http://localhost:5173/</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
}
