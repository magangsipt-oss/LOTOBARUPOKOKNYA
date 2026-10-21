import React, { useEffect, useRef } from 'react';
import dopPlanService from '../services/dopPlanService';
import { subscribeLive } from '../services/live';

export default function DOPPlan() {
  const frameRef = useRef(null);
  const frameLoadedRef = useRef(false);

  useEffect(() => {
    const startFrame = () => frameRef.current?.contentWindow?.postMessage({ type: 'eloto-dop-start' }, '*');
    const handleMessage = async event => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const request = event.data;
      if (request?.type !== 'eloto-dop-request' || typeof request.id !== 'string') return;

      try {
        let result;
        if (request.action === 'list') {
          result = await dopPlanService.getAll();
        } else if (request.action === 'create' && request.data && typeof request.data === 'object') {
          result = await dopPlanService.create(request.data);
        } else if (request.action === 'complete' && Number.isSafeInteger(request.idValue) &&
            request.data && typeof request.data === 'object') {
          result = await dopPlanService.complete(request.idValue, request.data);
        } else if (request.action === 'delete' && Number.isSafeInteger(request.idValue)) {
          result = await dopPlanService.delete(request.idValue);
        } else {
          throw new Error('Permintaan DOP tidak valid.');
        }
        event.source.postMessage({
          type: 'eloto-dop-response',
          id: request.id,
          success: true,
          data: result.data
        }, '*');
      } catch (error) {
        event.source.postMessage({
          type: 'eloto-dop-response',
          id: request.id,
          success: false,
          message: error.response?.data?.message || error.message || 'Gagal berkomunikasi dengan server.'
        }, '*');
      }
    };

    window.addEventListener('message', handleMessage);
    if (frameLoadedRef.current) startFrame();
    // Draft DOP baru dari box langsung muncul tanpa reload halaman.
    const stopLive = subscribeLive(() => {
      if (frameLoadedRef.current) frameRef.current?.contentWindow?.postMessage({ type: 'eloto-dop-refresh' }, '*');
    });
    return () => { window.removeEventListener('message', handleMessage); stopLive(); };
  }, []);

  return (
    <iframe
      ref={frameRef}
      id="dop-plan-frame"
      title="Daily Operation Plan"
      src={`${import.meta.env.BASE_URL}dop-plan.html`}
      onLoad={() => {
        frameLoadedRef.current = true;
        frameRef.current?.contentWindow?.postMessage({ type: 'eloto-dop-start' }, '*');
      }}
      sandbox="allow-scripts allow-forms allow-modals"
      className="h-[calc(100vh-2rem)] min-h-[620px] w-full rounded-xl border-0 bg-white"
    />
  );
}
