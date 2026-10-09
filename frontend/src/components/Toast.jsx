import React from 'react';

export default function Toast({ toast }) {
  if (!toast.show) return null;
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 bg-white border px-6 py-3 rounded-xl text-xs font-mono shadow-2xl z-50 flex items-center gap-2 ${
      toast.type === 'ok' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'
    }`}>
      <i className={toast.type === 'ok' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation'}></i>
      {toast.msg}
    </div>
  );
}
