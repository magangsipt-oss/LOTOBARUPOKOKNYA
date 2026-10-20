import React from 'react';

export default function Toast({ toast }) {
  if (!toast.show) return null;
  return (
    <div role={toast.type === 'fail' ? 'alert' : 'status'} aria-atomic="true" className={`app-toast flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm font-semibold shadow-lg ${
      toast.type === 'ok' ? 'border-green-200 text-green-700' : toast.type === 'fail' ? 'border-red-200 text-red-700' : 'border-blue-200 text-blue-700'
    }`}>
      <i className={`fa-solid mt-0.5 shrink-0 ${toast.type === 'ok' ? 'fa-circle-check' : toast.type === 'fail' ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} aria-hidden="true"></i>
      <span className="min-w-0 break-words">{toast.msg}</span>
    </div>
  );
}
