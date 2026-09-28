import { useEffect, useRef, useState } from 'react';
import { Modal, Spin, Alert, Tag, Space, Typography } from 'antd';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

const { Text } = Typography;

interface VideoPreviewModalProps {
  open: boolean;
  url: string;
  title?: string;
  onClose: () => void;
}

/**
 * VideoPreviewModal — plays IPTV streams (HLS/m3u8 via hls.js, FLV via mpegts.js, or native video).
 * Supports IPv4 and IPv6 URLs transparently via the browser's native network stack.
 */
export default function VideoPreviewModal({ open, url, title, onClose }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const mediaRecoveredRef = useRef(false);
  const networkRecoveredRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<string>('');
  const [openTick, setOpenTick] = useState(0);

  const detectType = (u: string): string => {
    const lower = u.toLowerCase().split('?')[0];
    if (lower.endsWith('.m3u8') || lower.includes('/hls/') || lower.includes('m3u8')) return 'HLS (m3u8)';
    if (lower.endsWith('.ts')) return 'MPEG-TS';
    if (lower.endsWith('.flv') || lower.includes('/stream/flv/')) return 'FLV';
    if (lower.startsWith('rtmp')) return 'RTMP';
    return 'Direct';
  };

  useEffect(() => {
    if (!open || !url) return;

    const video = videoRef.current;
    if (!video) return;

    const playbackUrl = url;

    setLoading(true);
    setError(null);
    setStreamType(detectType(url));
    mediaRecoveredRef.current = false;
    networkRecoveredRef.current = false;

    // Destroy previous player instances
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const isFlv = /\.flv/i.test(url) || /\/stream\/flv\//i.test(url);
    const isHls = /\.m3u8/i.test(url) || /\/hls\//i.test(url) || /m3u8/i.test(url);

    if (isFlv && mpegts.isSupported()) {
      try {
        const flvPlayer = mpegts.createPlayer({
          type: 'flv',
          isLive: true,
          url: playbackUrl,
        }, {
          enableWorker: true,
          lazyLoad: false,
          liveBufferLatencyChasing: true,
        });
        mpegtsRef.current = flvPlayer;
        flvPlayer.attachMediaElement(video);
        flvPlayer.load();
        const playPromise = flvPlayer.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.then(() => setLoading(false)).catch(() => {});
        } else {
          setLoading(false);
        }

        video.addEventListener('loadedmetadata', () => {
          setLoading(false);
        }, { once: true });
        video.addEventListener('canplay', () => {
          setLoading(false);
        }, { once: true });

        flvPlayer.on(mpegts.Events.ERROR, (errType: any, errDetail: any) => {
          setLoading(false);
          setError(`FLV 播放错误: ${errType} (${errDetail})`);
        });
      } catch (err: any) {
        setLoading(false);
        setError(`FLV 播放器初始化失败: ${err.message}`);
      }
    } else if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(playbackUrl);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRecoveredRef.current) {
            networkRecoveredRef.current = true;
            hls.startLoad();
            return;
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveredRef.current) {
            mediaRecoveredRef.current = true;
            hls.recoverMediaError();
            return;
          }

          setLoading(false);
          setError(`播放失败：${data.type} — ${data.details}`);
        }
      });

      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = playbackUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', () => {
        setLoading(false);
        setError('视频加载失败，请检查流地址是否有效');
      }, { once: true });
    } else {
      // Non-HLS direct stream (ts, mp4, etc.)
      video.src = playbackUrl;
      video.addEventListener('canplay', () => {
        setLoading(false);
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', () => {
        setLoading(false);
        setError('视频加载失败，请检查流地址是否有效');
      }, { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
      video.src = '';
    };
  }, [open, url, openTick]);

  const handleClose = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    setLoading(true);
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      afterOpenChange={(visible) => {
        if (visible) {
          setOpenTick((tick) => tick + 1);
        }
      }}
      footer={null}
      title={
        <Space>
          <span>{title || '频道预览'}</span>
          {streamType && <Tag color="blue" style={{ fontSize: 11, fontWeight: 'normal' }}>{streamType}</Tag>}
        </Space>
      }
      width={760}
      destroyOnHidden={false}
      styles={{ body: { padding: '12px 0 0 0' } }}
    >
      <div style={{ position: 'relative', background: '#000', borderRadius: 4, overflow: 'hidden' }}>
        {loading && !error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.7)', zIndex: 10, gap: 12
          }}>
            <Spin size="large" />
            <Text style={{ color: '#aaa', fontSize: 13 }}>正在连接流媒体…</Text>
          </div>
        )}

        {error ? (
          <div style={{ padding: '24px 0' }}>
            <Alert
              type="error"
              message="无法播放"
              description={error}
              showIcon
              style={{ margin: '0 16px 16px' }}
            />
            <div style={{ padding: '0 16px 8px' }}>
              <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                流地址：{url}
              </Text>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              aspectRatio: '16/9',
              display: 'block',
              background: '#000',
            }}
          />
        )}
      </div>

      <div style={{ padding: '8px 16px 4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Text
          type="secondary"
          style={{ fontSize: 11, wordBreak: 'break-all', cursor: 'pointer' }}
          title="点击复制"
          onClick={() => {
            navigator.clipboard.writeText(url);
          }}
        >
          {url}
        </Text>
      </div>
    </Modal>
  );
}
