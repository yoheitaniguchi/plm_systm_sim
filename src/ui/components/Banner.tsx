interface BannerProps {
  kind: 'error' | 'warning' | 'info';
  message: string;
  onDismiss?: () => void;
}

export function Banner({ kind, message, onDismiss }: BannerProps) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="banner__dismiss" onClick={onDismiss} aria-label="閉じる">
          ×
        </button>
      )}
    </div>
  );
}
