import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { Modal } from './ui';

export function PhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return url ? (
    <img className="return-photo-preview" src={url} alt="设备和当前放置位置的归还照片预览" />
  ) : null;
}

export function ReturnPhoto({ path }: { path: string }) {
  const { api } = useApp();
  const [opened, setOpened] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setUrl('');
    setError('');
    api
      .returnPhotoUrl(path)
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, path, api]);
  return (
    <>
      <button className="return-photo-link" onClick={() => setOpened(true)}>
        查看归还照片
      </button>
      {opened && (
        <Modal title="设备归还照片" onClose={() => setOpened(false)}>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : url ? (
            <img
              className="return-photo-full"
              src={url}
              alt="归还时的设备和放置位置"
              onError={() => setError('照片加载失败，请关闭后重新打开')}
            />
          ) : (
            <p>正在加载照片…</p>
          )}
        </Modal>
      )}
    </>
  );
}
