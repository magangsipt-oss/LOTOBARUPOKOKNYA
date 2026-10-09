import React, { useState, useEffect } from 'react';
import api, { setCsrfToken, getSessionVersion, beginAuthChange, cancelAuthChange } from '../services/api';
import userService from '../services/userService';
import { normalizeUserRole } from '../utils/helpers';
import { AuthContext } from './AuthState';
const normalize = user => ({ ...user, rfidUid: user.rfid_uid || '', role: normalizeUserRole(user.role) });
export function AuthProvider({ children }) {
  const [sessionUser, setSessionUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const isLoggedIn = sessionUser !== null;
  useEffect(() => {
    let active = true;
    sessionStorage.removeItem('eloto_industrial_session');
    const expire = () => { setSessionUser(null); setCsrfToken(''); };
    window.addEventListener('eloto-session-expired', expire);
    const version = getSessionVersion();
    api.get('/users/me').then(({ data }) => {
      if (active && version === getSessionVersion() && data.success) {
        setCsrfToken(data.csrfToken);
        const user = normalize(data.data);
        setSessionUser(user);
        setActiveTab(user.role === 'teknisi' ? 'teknisi-tab' : user.role === 'fuelman' ? 'profil-tab' : 'dashboard');
      }
    }).catch(() => {});
    return () => { active = false; window.removeEventListener('eloto-session-expired', expire); };
  }, []);
  const handleLogin = async (sid, password, toast) => {
    const version = beginAuthChange();
    try {
      const result = await userService.login(sid, password);
      if (version !== getSessionVersion()) return;
      const user = normalize(result.data);
      setCsrfToken(result.csrfToken);
      setSessionUser(user);
      setActiveTab(user.role === 'teknisi' ? 'teknisi-tab' : user.role === 'fuelman' ? 'profil-tab' : 'dashboard');
      toast(`Selamat Datang: ${user.nama}`, 'ok');
    } catch (error) {
      if (version !== getSessionVersion()) return;
      cancelAuthChange(version);
      toast(error.response?.data?.message || 'Gagal terhubung ke server login.', 'fail');
    }
  };
  const handleLogout = async toast => {
    const version = beginAuthChange();
    try {
      await api.post('/users/logout');
      if (version !== getSessionVersion()) return;
      setSessionUser(null);
      setCsrfToken('');
      toast('Sesi kerja berhasil ditutup.', 'ok');
    } catch {
      if (version !== getSessionVersion()) return;
      cancelAuthChange(version);
      toast('Logout gagal. Coba lagi agar sesi server ditutup.', 'fail');
    }
  };
  return <AuthContext.Provider value={{ isLoggedIn, sessionUser, setSessionUser, activeTab, setActiveTab, handleLogin, handleLogout }}>{children}</AuthContext.Provider>;
}
