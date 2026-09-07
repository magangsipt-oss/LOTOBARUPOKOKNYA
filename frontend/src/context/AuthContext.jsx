import React, { createContext, useContext, useState, useEffect } from 'react';
import userService from '../services/userService';
import { normalizeUserRole } from '../utils/helpers';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionUser, setSessionUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Restore session from sessionStorage on mount
  useEffect(() => {
    const sesiTersimpan = sessionStorage.getItem('eloto_industrial_session');
    if (sesiTersimpan) {
      try {
        const userAktif = JSON.parse(sesiTersimpan);
        setSessionUser(userAktif);
        setIsLoggedIn(true);
        if (userAktif.role === 'teknisi' || userAktif.role === 'mekanik') setActiveTab('teknisi-tab');
        else setActiveTab('dashboard');
      } catch (e) {
        sessionStorage.removeItem('eloto_industrial_session');
      }
    }
  }, []);

  const handleLogin = async (sid, password, pemicuToast) => {
    if (!sid || !password) return;
    try {
      const result = await userService.login(sid, password);
      if (!result.success || !result.data) {
        pemicuToast(result.message || "ID Karyawan (SID) atau Kata Sandi Salah!", "fail");
        return;
      }
      const role = normalizeUserRole(result.data.role);
      const user = {
        ...result.data,
        rfidUid: result.data.rfid_uid || result.data.rfidUid || '',
        foto: result.data.foto || 'assets/default-avatar.png',
        role
      };
      setSessionUser(user);
      setIsLoggedIn(true);
      sessionStorage.setItem('eloto_industrial_session', JSON.stringify(user));
      pemicuToast(`Selamat Datang: ${user.nama}`, 'ok');
      if (user.role === 'teknisi' || user.role === 'mekanik') setActiveTab('teknisi-tab');
      else setActiveTab('dashboard');
    } catch (error) {
      pemicuToast("Gagal terhubung ke server login!", "fail");
    }
  };

  const handleLogout = (pemicuToast) => {
    setIsLoggedIn(false);
    setSessionUser(null);
    sessionStorage.removeItem('eloto_industrial_session');
    pemicuToast("Sesi kerja berhasil ditutup.", "ok");
  };

  return (
    <AuthContext.Provider value={{
      isLoggedIn, setIsLoggedIn,
      sessionUser, setSessionUser,
      activeTab, setActiveTab,
      handleLogin, handleLogout
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
