import React from 'react';
import { resolveUserPhotoUrl, getInitialAvatar } from '../utils/helpers';

export default function Avatar({ profile, className = 'w-9 h-9' }) {
  return (
    <img
      src={resolveUserPhotoUrl(profile, profile?.foto)}
      alt={`Foto ${profile?.nama || 'personel'}`}
      className={`${className} rounded-full object-cover border-2 border-white shadow-sm bg-red-50 shrink-0`}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = getInitialAvatar(profile?.nama);
      }}
    />
  );
}
