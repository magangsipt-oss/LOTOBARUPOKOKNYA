import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import taskService from '../services/taskService';
import { livePoll } from '../services/live';
import { TasksContext } from './TasksState';

// Tugas formulir lapangan (izin LOTO, daftar hadir) untuk pengguna yang login: dipakai angka merah di menu,
// kotak "Tugas Anda", dan judul tab browser. Diperbarui lewat event live setiap ada perubahan data.
const ROLES = ['admin', 'pengawas', 'safety', 'teknisi'];
const BASE_TITLE = typeof document === 'undefined' ? 'E-LOTO' : document.title;
const NONE = [];

export function TasksProvider({ children }) {
  const { sessionUser } = useAuth();
  const enabled = ROLES.includes(sessionUser?.role);
  const [loaded, setLoaded] = useState([]);
  const tasks = enabled ? loaded : NONE;

  const refreshTasks = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await taskService.getMine();
      setLoaded(Array.isArray(result.data) ? result.data : []);
    } catch { /* tetap tampilkan tugas terakhir */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshTasks();
    return livePoll(refreshTasks, 30000);
  }, [enabled, refreshTasks]);

  useEffect(() => {
    document.title = tasks.length ? `(${tasks.length}) ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [tasks.length]);

  const value = useMemo(() => ({ tasks, refreshTasks }), [tasks, refreshTasks]);
  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
