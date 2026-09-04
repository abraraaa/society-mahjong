'use client';

/** A bottom sheet with one question and two answers. The scrim is the second "no". */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Stay',
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="grabber" />
        <h2 id="confirm-title" className="font-display mb-2 text-xl">
          {title}
        </h2>
        <p className="text-ivory-200/70 mb-5 text-sm leading-snug">{body}</p>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-primary btn-block" onClick={onConfirm} disabled={busy}>
            {busy ? 'One moment…' : confirmLabel}
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}
